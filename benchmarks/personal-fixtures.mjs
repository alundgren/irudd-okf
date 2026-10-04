import fs from 'node:fs/promises';
import path from 'node:path';
import { hash, write } from './lib.mjs';

export const methods = ['none', 'oracle', 'flat', 'global', 'skill', 'symlink', 'search', 'suggest', 'grouped'];
export const facts = [
  { id: 'old-usage', topic: 'metrics', title: 'Previous runtime usage convention', source: 'synthetic supersession trap', text: 'Obsolete memory-lab summarizeUsage advice formerly replaced unavailable counts with zero. This entry is superseded by metrics/usage.md. Do not use this old convention.' },
  { id: 'usage', topic: 'metrics', title: 'Runtime usage reports', source: '.okf/experiments/evidence.md', text: 'For memory-lab summarizeUsage, this replaces metrics/old-usage.md. input_tokens already includes cached_input_tokens. Never add cached input a second time. Return {input, cached, output, total}. Preserve missing input, cached or output as null, including a missing usage object. total is input + output only when both are available, otherwise null. Reject negative, non-finite or non-numeric supplied counts with TypeError. Preserve legitimate zero counts.' },
  { id: 'draft', topic: 'editing', title: 'Optimistic draft recovery', source: '.okf/gotchas/edits.md', text: 'For memory-lab replaceDocument, treat current.raw as opaque text, including malformed YAML and unknown fields. A version mismatch returns {status:"conflict", raw:current.raw, draft:proposed} without changing current. A match returns {status:"saved", raw:proposed, draft:null}. Do not parse or normalize either document. The expected version must equal current.version exactly.' },
  { id: 'old-limit', topic: 'exports', title: 'Previous export limit', source: 'sanitized benchmark scenario', text: 'Obsolete personal guidance: exportBytes formerly accepted only 1024 bytes. This entry is superseded by exports/current-limit.md. Do not use this old limit.' },
  { id: 'current-limit', topic: 'exports', title: 'Current personal export limit', source: 'sanitized benchmark scenario', text: 'Personal default: exportBytes accepts payloads up to 32 MiB inclusive. This replaces exports/old-limit.md. A repository that explicitly sets another limit takes precedence. Return {accepted:boolean, bytes:payload.byteLength}; do not truncate or mutate payloads.' },
  { id: 'other-project', topic: 'pagination', title: 'Archive project pagination', source: 'synthetic scope trap', text: 'For archive-project only, paginate sorts records by name before selecting a page. This rule does not apply to memory-lab. No personal rule changes memory-lab pagination ordering.' },
];

export const tasks = [
  { id: 'usage', file: 'src/usage.mjs', prompt: 'Finish summarizeUsage in src/usage.mjs so the report can compare runtime token usage. Handle partial usage records and keep the exported API. Run the visible tests.', relevant: ['old-usage','usage'], source: 'export function summarizeUsage(usage) { return { input: 0, cached: 0, output: 0, total: 0 }; }\n', visible: 'assert.equal(summarizeUsage({input_tokens:10,cached_input_tokens:4,output_tokens:2}).output,2);', importName: 'summarizeUsage', tests: [
    ['cached input is not counted twice', 'assert.deepEqual(api.summarizeUsage({input_tokens:10,cached_input_tokens:4,output_tokens:2}),{input:10,cached:4,output:2,total:12});'],
    ['missing values remain unavailable', 'assert.deepEqual(api.summarizeUsage({output_tokens:2}),{input:null,cached:null,output:2,total:null}); assert.deepEqual(api.summarizeUsage(null),{input:null,cached:null,output:null,total:null});'],
    ['zero and partial cached counts', 'assert.deepEqual(api.summarizeUsage({input_tokens:0,output_tokens:0}),{input:0,cached:null,output:0,total:0});'],
    ['invalid supplied counts rejected', 'for(const field of ["input_tokens","cached_input_tokens","output_tokens"]) for(const v of [-1,NaN,Infinity,"10"]) assert.throws(()=>api.summarizeUsage({[field]:v}),TypeError);'],
  ] },
  { id: 'draft', file: 'src/document.mjs', prompt: 'Finish replaceDocument in src/document.mjs for the optimistic document editor. It receives the current {version,raw}, an expected version, and proposed text. Return a saved or conflict result and keep the exported API. Run the visible tests.', relevant: ['draft'], source: 'export function replaceDocument(current, expectedVersion, proposed) { return {status:"saved",raw:proposed,draft:null}; }\n', visible: 'assert.equal(replaceDocument({version:"v1",raw:"old"},"v1","new").status,"saved");', importName: 'replaceDocument', tests: [
    ['conflict retains proposed draft', 'assert.deepEqual(api.replaceDocument({version:"v2",raw:"server"},"v1","draft"),{status:"conflict",raw:"server",draft:"draft"});'],
    ['raw malformed document survives save', 'const raw="---\\nunknown: [broken\\n# preserve this\\n"; assert.deepEqual(api.replaceDocument({version:"v2",raw:"old"},"v2",raw),{status:"saved",raw,draft:null});'],
    ['current document is never mutated', 'const c=Object.freeze({version:"v3",raw:"server"}); api.replaceDocument(c,"v2","draft"); assert.deepEqual(c,{version:"v3",raw:"server"});'],
    ['versions compared exactly', 'assert.equal(api.replaceDocument({version:1,raw:"server"},"1","draft").status,"conflict");'],
    ['malformed current text survives conflict', 'const raw="---\\ninvalid: [yaml\\n";assert.deepEqual(api.replaceDocument({version:2,raw},1,"draft"),{status:"conflict",raw,draft:"draft"});'],
  ] },
  { id: 'exports', file: 'src/export.mjs', prompt: 'Finish exportBytes in src/export.mjs. Decide whether a Uint8Array can be exported, report its original byte length, and keep the exported API. Run the visible tests.', relevant: ['old-limit', 'current-limit'], source: 'export function exportBytes(payload) { return {accepted:true,bytes:payload.byteLength}; }\n', visible: 'assert.deepEqual(exportBytes(new Uint8Array(16)),{accepted:true,bytes:16});', importName: 'exportBytes', repoRule: 'This repository sets the exportBytes limit to 8 MiB inclusive. This overrides personal default limits. Payloads must not be truncated or mutated.\n', tests: [
    ['repository limit overrides personal default', 'assert.deepEqual(api.exportBytes(new Uint8Array(9*1024*1024)),{accepted:false,bytes:9*1024*1024});'],
    ['obsolete limit is ignored', 'assert.deepEqual(api.exportBytes(new Uint8Array(2048)),{accepted:true,bytes:2048});'],
    ['boundary remains inclusive', 'assert.equal(api.exportBytes(new Uint8Array(8*1024*1024)).accepted,true);'],
    ['payload stays intact', 'const p=new Uint8Array([1,2,3]); api.exportBytes(p); assert.deepEqual([...p],[1,2,3]);'],
  ] },
  { id: 'pagination', file: 'src/pagination.mjs', prompt: 'Implement paginate in src/pagination.mjs. Return at most limit records starting at offset, preserving input order and leaving the input array untouched. Nonnegative integer offset and limit are supplied. Run the visible tests.', relevant: [], source: 'export function paginate(records, offset, limit) { return records; }\n', visible: 'assert.deepEqual(paginate([1,2,3],1,1),[2]);', importName: 'paginate', tests: [
    ['unrelated ordering rule is ignored', 'const r=[{name:"z"},{name:"a"},{name:"m"}]; assert.deepEqual(api.paginate(r,0,2),r.slice(0,2));'],
    ['no mutation', 'const r=Object.freeze([3,1,2]); assert.deepEqual(api.paginate(r,1,2),[1,2]);'],
    ['empty and past-end pages', 'assert.deepEqual(api.paginate([1,2],10,2),[]); assert.deepEqual(api.paginate([1,2],0,0),[]);'],
  ] },
];

const topics = ['metrics', 'editing', 'exports', 'pagination', 'testing', 'releases', 'logging', 'compatibility'];
export function makeCorpus(count, placement = 'middle') {
  if (!Number.isInteger(count) || count < facts.length) throw new Error('Concept count must include all fixed facts.');
  if (!['beginning', 'middle', 'end'].includes(placement)) throw new Error('Unknown placement.');
  const other = Array.from({length:count-facts.length}, (_, i) => {
    const topic=topics[i%topics.length], project=`archive-${String(i).padStart(5,'0')}`;
    return {id:hash(project).slice(0,12),topic,title:`${project} ${topic} conventions`,source:'synthetic distractor',text:`Scope: ${project} only. These ${topic} rules do not apply to memory-lab. Use its own adapter and tests; preserve original event identifiers and public contracts.`};
  });
  const at=placement==='beginning'?0:placement==='end'?other.length:Math.floor(other.length/2);
  const ordered=[...other.slice(0,at),...facts,...other.slice(at)];
  return ordered.map(c=>({...c,path:`${c.topic}/${c.id}.md`,raw:`---\ntype: Rule\ntitle: ${c.title}\ntags: [${c.topic}]\n---\n\n${c.text}\n`}));
}

export async function putBundle(root, corpus) {
  await write(root,'index.md','---\nokf_version: "0.2"\n---\n\n# Personal development memories\n\nEach concept is Markdown with YAML frontmatter. Search titles and bodies for the current task, read a few matching files, and check their project scope. Most archive entries concern other projects. Follow replacement links for obsolete rules. Repository instructions override conflicting personal defaults in this experiment. Avoid reading the full corpus.\n\n'+topics.map(t=>`- [${t}](${t}/index.md)`).join('\n')+'\n');
  for (const topic of topics) await write(root,`${topic}/index.md`,`# ${topic}\n\nSearch the Markdown files in this directory for task terms. Entries state their scope.\n`);
  for (const c of corpus) await write(root,c.path,c.raw);
}

export async function prepare(root, task, corpus, method, skillSource) {
  if (!methods.includes(method)) throw new Error('Unknown method.');
  const repo=path.join(root,'repository'), taskHome=path.join(root,'user'), codexRoot=path.join(root,'codex'), bundle=path.join(taskHome,'.local/share/irudd-scope/memory/personal');
  await fs.mkdir(codexRoot,{recursive:true}); await fs.mkdir(taskHome,{recursive:true});
  const instructions='This is memory-lab. Implement the requested code change in the existing module. These fixture functions are self-contained; do not add imports to application modules. You may add tests. Use node --test test/*.test.mjs for visible checks. Personal guidance is read-only. Repository instructions override conflicting personal defaults. Do not read outside the assigned repository, temporary home or explicitly identified memory directories. Do not use network tools or delegate.\n'+(task.repoRule??'');
  await write(repo,'AGENTS.md',instructions);
  await write(repo,'package.json','{"name":"memory-lab","type":"module","scripts":{"test":"node --test test/*.test.mjs"}}\n');
  await write(repo,task.file,task.source);
  await write(repo,'test/visible.test.mjs',`import assert from 'node:assert/strict';\nimport {${task.importName}} from '../${task.file}';\n${task.visible}\n`);
  await write(codexRoot,'AGENTS.md','');
  const pointer=`Personal development memories live in ${bundle}. Before editing, read index.md and search for task-relevant guidance. Retrieve a few applicable files; check scope and replacement links.\n`;
  if (['global','skill','symlink','search','suggest'].includes(method)) {
    await putBundle(bundle,corpus);
    await write(taskHome,'.config/irudd-okf/config.json',JSON.stringify({version:1,bundles:[{name:'personal',path:bundle,personal:true}],active:['personal']})+'\n');
  }
  if (method==='global') await write(codexRoot,'AGENTS.md',pointer);
  if (method==='skill') await fs.cp(skillSource,path.join(taskHome,'.agents/skills/okf'),{recursive:true});
  if (method==='symlink') {
    await fs.mkdir(path.join(repo,'.okf'),{recursive:true});await fs.symlink(bundle,path.join(repo,'.okf/personal'),'dir');
    await write(repo,'AGENTS.md',instructions+'When .okf/personal exists, consult its index.md and search its task-relevant Markdown before editing. Ordinary rg does not traverse directory symlinks by default; use an explicit .okf/personal/ search root or rg -L.\n');
  }
  if (method==='search') await write(codexRoot,'AGENTS.md',pointer+`Use rg -n -i 'task terms' '${bundle}' to locate candidate files, then read relevant Markdown. Refine terms if needed.\n`);
  if (method==='flat') await write(codexRoot,'AGENTS.md',instructions+'\n# Personal rules\n\n'+corpus.map(c=>c.raw).join('\n'));
  if (method==='grouped') for (const topic of topics) await write(taskHome,`.agents/skills/personal-${topic}/SKILL.md`,`---\nname: personal-${topic}\ndescription: Consult personal ${topic} development rules when a coding task concerns ${topic}; check each rule's project scope.\n---\n\n${corpus.filter(c=>c.topic===topic).map(c=>c.raw).join('\n')}`);
  const note=method==='oracle'?corpus.filter(c=>task.relevant.includes(c.id)).map(c=>c.raw).join('\n'):'';
  return {repo,taskHome,codexRoot,bundle,prompt:task.prompt+(note?'\nApplicable personal guidance supplied directly:\n'+note:''),instructions};
}
