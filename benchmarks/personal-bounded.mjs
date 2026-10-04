#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { hash, json, operation } from './lib.mjs';
import { study } from './personal.mjs';
import { runCodex } from './personal-runtime.mjs';

export function capInstructions(original) {
  const divider='\n# Personal rules\n\n';
  const at=original.indexOf(divider);
  if(at<0)throw new Error('Global rule header missing.');
  const prefix=original.slice(0,at+divider.length);
  const rules=original.slice(at+divider.length).split(/\n(?=---\ntype: Rule\n)/);
  const included=[];
  let capped=prefix;
  for(const rule of rules) {
    const next=capped+(included.length?'\n':'')+rule;
    if(Buffer.byteLength(next)>32768)break;
    capped=next;included.push(rule);
  }
  if(Buffer.byteLength(prefix)>32768)throw new Error('Common instructions exceed the cap.');
  return {kind:'physically_capped_global_instructions',cap_bytes:32768,actual_bytes:Buffer.byteLength(capped),original_bytes:Buffer.byteLength(original),retained_concepts:included.length,total_concepts:rules.length,retained_titles:included.map(rule=>rule.match(/^title: (.+)$/m)?.[1]),instructions_sha256:hash(capped),instructions:capped,selection:'Largest complete-rule prefix; no relevance filtering or partial concepts.'};
}

// The phase freezes this module's complete source alongside study's frozen
// dependencies. The locator reference uses the unchanged runtime adapter.
export async function runBoundedCodex(layout,options) {
  if(layout.method!=='flat')return runCodex(layout,options);
  return withCappedInstructions(layout,options,runCodex);
}

export async function withCappedInstructions(layout,options,runtime) {
  const file=path.join(layout.codexRoot,'AGENTS.md');
  const original=await fs.readFile(file,'utf8');
  const metadata=capInstructions(original),capped=metadata.instructions;
  await options.persist('bounded-instructions',{stdout:JSON.stringify(metadata,null,2)+'\n',stderr:'',code:0});
  let response;
  const errors=[];
  try {
    await fs.writeFile(file,capped);
    response=await runtime(layout,options);
  } catch(error) {errors.push(error);}
  finally {
    try {
      const after=await fs.readFile(file,'utf8');
      if(after!==capped) {
        errors.push(new Error('Agent changed read-only capped global instructions.'));
        await options.persist('bounded-instructions-modified',{stdout:after,stderr:'Read-only capped instructions were changed.',code:1});
      }
    } catch(error) {errors.push(error);}
    try{await fs.writeFile(file,original);}catch(error){errors.push(error);}
  }
  if(errors.length)throw new AggregateError(errors,errors.map(e=>e.message).join(' '));
  return response;
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),at=args.indexOf('--output'),output=args[at+1];
  if(at<0||!output)throw new Error('Usage: node benchmarks/personal-bounded.mjs --output NEW_DIRECTORY [--resume] [--dry-run]');
  await Effect.runPromise(operation(async()=>{
    const studyRoot=path.resolve(output),sourceHash=hash(await fs.readFile(fileURLToPath(import.meta.url)));
    const configuration={output:studyRoot,selectedMethods:['flat','global'],concurrency:2,adapter:runBoundedCodex};
    if(!args.includes('--resume'))await study({...configuration,dryRun:true});
    const freeze=JSON.parse(await fs.readFile(path.join(studyRoot,'freeze.json'),'utf8'));
    const protocol={kind:'bounded_instruction_followup',study_sha256:hash(freeze),wrapper_sha256:sourceHash,adapter_sha256:hash(runBoundedCodex.toString()),cap_bytes:32768,reference:'global locator selected before completion of the primary study',selection:'Largest complete-rule prefix in existing corpus order',interpretation:'Separate phase; do not pool with primary schedule. Core request inventory describes preparation. bounded-instructions.stdout.txt records actual runtime instructions.'};
    if(args.includes('--resume')) {
      const prior=JSON.parse(await fs.readFile(path.join(studyRoot,'phase.json'),'utf8'));
      if(hash(prior)!==hash(protocol))throw new Error('Bounded phase source or protocol changed; use a new directory.');
    } else {
      await json(path.join(studyRoot,'phase.json'),protocol);
      await fs.writeFile(path.join(studyRoot,'phase.sha256'),hash(protocol)+'\n');
    }
    console.log(JSON.stringify(await study({...configuration,resume:true,dryRun:args.includes('--dry-run')})));
  }));
}
