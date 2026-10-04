#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { command, hash, inventory, json, operation, shuffle, write } from './lib.mjs';
import { measure, parseTrace } from './metrics.mjs';
import { facts, makeCorpus, methods, prepare, tasks } from './personal-fixtures.mjs';
import { effort, model, runCodex, runtimeEnvironment } from './personal-runtime.mjs';

const sourceRoot=path.dirname(fileURLToPath(import.meta.url));
const skillSource=path.resolve(sourceRoot,'../skills/okf');
const codeFiles=['personal.mjs','personal-fixtures.mjs','personal-runtime.mjs','personal-grade.mjs','lib.mjs','metrics.mjs'];
async function cleanupOwnedRoot(row,plan) {
  if(!row.private_root)return;
  const root=row.private_root;
  try{await fs.lstat(root);}catch(e){if(e.code==='ENOENT')return;throw e;}
  if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('okf-personal-cell-')||(await fs.lstat(root)).isSymbolicLink())throw new Error('Refuse to clean an unrecognized trial directory.');
  const owner=JSON.parse(await fs.readFile(path.join(root,'owner.json'),'utf8'));
  if(owner.study_sha256!==hash(plan)||owner.cell_id!==row.id)throw new Error('Trial directory ownership differs from the frozen study.');
  await fs.rm(root,{recursive:true,force:true});
}
export function schedule({counts=[100,5000],repeats=3,selectedMethods=methods,selectedTasks=tasks.map(t=>t.id),seed=20261004}={}) {
  if (!Number.isInteger(repeats)||repeats<1||repeats>3||counts.some(n=>!Number.isInteger(n)||n<facts.length)||selectedMethods.some(m=>!methods.includes(m))||selectedTasks.some(id=>!tasks.some(t=>t.id===id))) throw new Error('Invalid study configuration.');
  if ([counts,selectedMethods,selectedTasks].some(v=>new Set(v).size!==v.length))throw new Error('Duplicate study cells.');
  const result=[];
  for(let repetition=0;repetition<repeats;repetition++) for(const taskId of selectedTasks) for(const {count,method} of shuffle(counts.flatMap(count=>selectedMethods.map(method=>({count,method}))),seed+repetition*100+selectedTasks.indexOf(taskId))) result.push({id:`cell-${String(result.length).padStart(4,'0')}`,method,task_id:taskId,count,repetition,placement:['beginning','middle','end'][repetition]});
  return result;
}
export function summarize(rows) {
  const groups=new Map();
  for(const row of rows){const key=`${row.method}:${row.count}`;const group=groups.get(key)??[];group.push(row);groups.set(key,group);}
  const median=v=>{const a=v.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
  return [...groups].map(([key,group])=>({method:key.split(':')[0],count:Number(key.split(':')[1]),scheduled:group.length,attempted:group.filter(r=>r.status!=='planned').length,completed:group.filter(r=>r.status==='completed').length,correct:group.filter(r=>r.status==='completed'&&r.grade?.correct).length,median_seconds:median(group.filter(r=>r.status==='completed').map(r=>r.seconds)),median_total_tokens:median(group.filter(r=>r.status==='completed').map(r=>r.metrics?.total_input_output_tokens)),median_success_seconds:median(group.filter(r=>r.status==='completed'&&r.grade?.correct).map(r=>r.seconds)),median_success_tokens:median(group.filter(r=>r.status==='completed'&&r.grade?.correct).map(r=>r.metrics?.total_input_output_tokens)),failures:group.filter(r=>r.status==='failed').map(r=>({id:r.id,error:r.failure})),task_results:tasks.map(t=>({id:t.id,attempted:group.filter(r=>r.task_id===t.id&&r.status!=='planned').length,correct:group.filter(r=>r.task_id===t.id&&r.status==='completed'&&r.grade?.correct).length}))}));
}
async function identities() {
  const located=await command('which',['irudd-okf']);if(located.code!==0)throw new Error('Installed irudd-okf is required for this experiment.');
  const cliPath=await fs.realpath(located.stdout.trim());
  return {code:Object.fromEntries(await Promise.all(codeFiles.map(async f=>[f,hash(await fs.readFile(path.join(sourceRoot,f)))]))),skill:await inventory(skillSource),runtime:(await command('codex',['--version'])).stdout.trim(),node:process.version,okf:{path:cliPath,sha256:hash(await fs.readFile(cliPath)),version:(await command('irudd-okf',['--version'])).stdout.trim()}};
}
export async function study({output,counts=[100,5000],repeats=3,selectedMethods=methods,selectedTasks=tasks.map(t=>t.id),sandbox='workspace-write',seed=20261004,timeoutMs=180000,limit=Infinity,resume=false,dryRun=false,concurrency=1,adapter=runCodex}={}) {
  if(![1,2].includes(concurrency))throw new Error('Concurrency must be 1 or 2.');
  const identity=await identities(),cells=schedule({counts,repeats,selectedMethods,selectedTasks,seed});
  const plan={version:1,kind:'descriptive_sanitized_personal_memory_experiment',model,effort,counts,repeats,methods:selectedMethods,tasks:selectedTasks,seed,sandbox,timeout_ms:timeoutMs,concurrency,adapter_sha256:hash(adapter.toString()),identity,facts_sha256:hash(facts),tasks_sha256:hash(tasks),cells,stopping:'Execute the frozen schedule; retain every failure. No score-dependent arm selection.',human_equivalence_audit:'pending',human_correctness_rating:'pending',source_backed_large_corpus:false};
  let rows;
  if(resume){const prior=JSON.parse(await fs.readFile(path.join(output,'freeze.json'),'utf8'));if(hash(prior)!==hash(plan))throw new Error('Frozen plan or runner identity changed. Preserve this study and use a new output directory.');rows=JSON.parse(await fs.readFile(path.join(output,'results.json'),'utf8'));if(hash(rows.map(({id,method,task_id,count,repetition,placement})=>({id,method,task_id,count,repetition,placement})))!==hash(cells))throw new Error('Result ledger differs from frozen schedule.');}
  else {await fs.mkdir(output,{recursive:false});await json(path.join(output,'freeze.json'),plan);await write(output,'freeze.sha256',hash(plan)+'\n');rows=cells.map(c=>({...c,status:'planned'}));await json(path.join(output,'results.json'),rows);}
  let saveQueue=Promise.resolve();
  const save=()=>{saveQueue=saveQueue.then(async()=>{for(const [file,data] of [['results.json',rows],['summary.json',summarize(rows)]]){await json(path.join(output,file+'.tmp'),data);await fs.rename(path.join(output,file+'.tmp'),path.join(output,file));}});return saveQueue;};
  for(const row of rows)if(row.status==='running'){row.status='failed';row.failure='Previous controller was interrupted; preserve partial evidence and do not silently retry this cell.';try{await cleanupOwnedRoot(row,plan);}catch(e){row.cleanup_failure={root:row.private_root,error:e.message};}await json(path.join(output,row.id,'result.json'),row);}
  await save();
  if(dryRun){await save();return {status:'frozen',cells:cells.length,freeze_sha256:hash(plan)};}
  const pending=rows.filter(r=>r.status==='planned').slice(0,limit);let next=0;
  const execute=async row=>{
    const task=tasks.find(t=>t.id===row.task_id),dir=path.join(output,row.id),corpus=makeCorpus(row.count,row.placement);
    let root;row.status='running';row.started_at=new Date().toISOString();await save();await fs.mkdir(dir,{recursive:false});
    try {
      root=await fs.mkdtemp(path.join(os.tmpdir(),'okf-personal-cell-'));await fs.chmod(root,0o700);
      row.private_root=root;await json(path.join(root,'owner.json'),{study_sha256:hash(plan),cell_id:row.id});await save();
      const layout={...await prepare(root,task,corpus,row.method,skillSource),method:row.method};
      const persist=async(label,result)=>{await write(dir,`${label}.stdout.txt`,result.stdout);await write(dir,`${label}.stderr.txt`,result.stderr);await json(path.join(dir,`${label}.process.json`),Object.fromEntries(Object.entries(result).filter(([key])=>!['stdout','stderr'].includes(key))));};
      if(row.method==='suggest') {
        const query=task.prompt.replace(/[^a-zA-Z0-9]+/g,' ').split(/\s+/).filter(w=>w.length>3).join(' ');
        const suggested=await command('irudd-okf',['search',query,'--scope','personal','--limit','3'],{cwd:layout.repo,env:runtimeEnvironment(layout),timeoutMs:30000});
        await persist('suggestion',suggested);
        if(suggested.code!==0)throw new Error(`Visible-input suggestion search failed: ${suggested.stderr.slice(0,500)}`);
        await write(dir,'suggestions.json',suggested.stdout);
        const suggestions=JSON.parse(suggested.stdout);
        if(!suggestions||suggestions.version!==1||!Array.isArray(suggestions.results))throw new Error('Invalid suggestion result envelope.');
        const entries=suggestions.results;
        if(entries.some(s=>s.bundle!=='personal'||typeof s.path!=='string'||!s.path.endsWith('.md')||path.isAbsolute(s.path)||s.path.split('/').includes('..')))throw new Error('Invalid suggestion file path or bundle.');
        layout.prompt+='\nPersonal memory search suggested these candidate files. Inspect their content and scope before using them:\n'+entries.map(s=>path.join(layout.bundle,s.path)).join('\n');
        row.suggestion_seconds=suggested.wall_time_ms/1000;
      }
      const before=await inventory(layout.repo,{allowSymlinks:true});
      const bundleBefore=['global','skill','symlink','search','suggest'].includes(row.method)?await inventory(layout.bundle):[];
      const globalBefore=await fs.readFile(path.join(layout.codexRoot,'AGENTS.md'));
      const skillsRoot=path.join(layout.taskHome,'.agents/skills');
      const skillsBefore=['skill','grouped'].includes(row.method)?await inventory(skillsRoot):[];
      row.corpus_sha256=hash(corpus);row.applicable_facts_sha256=hash(corpus.filter(c=>task.relevant.includes(c.id)).map(c=>c.raw));row.corpus_bytes=corpus.reduce((n,c)=>n+Buffer.byteLength(c.raw),0);
      row.expected_flat_loaded_facts=row.method==='flat'?corpus.filter(c=>task.relevant.includes(c.id)&&Buffer.byteLength(layout.instructions+'\n# Personal rules\n\n'+corpus.slice(0,corpus.indexOf(c)+1).map(d=>d.raw).join('\n'))<=32768).map(c=>c.id):null;
      await json(path.join(dir,'request.json'),{prompt:layout.prompt,model,effort,method:row.method,sandbox,timeout_ms:timeoutMs,corpus_sha256:row.corpus_sha256,before_inventory:before,global_agents_sha256:hash(globalBefore),skills_inventory:skillsBefore,bundle_inventory:bundleBefore});
      for(const args of [['init','--quiet'],['config','maintenance.auto','false'],['config','gc.auto','0'],['add','.'],['-c','user.name=Memory experiment','-c','user.email=experiment@example.invalid','-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','--quiet','-m','Fixture']]){
        const r=await command('git',args,{cwd:layout.repo,env:runtimeEnvironment(layout)});if(r.code!==0)throw new Error('Fixture Git setup failed.');
      }
      const response=await adapter(layout,{sandbox,timeoutMs,persist});
      await write(dir,'trace.jsonl',response.stdout);await write(dir,'stderr.txt',response.stderr);
      await json(path.join(dir,'registry.json'),response.registry);
      row.seconds=response.wall_time_ms/1000+(row.suggestion_seconds??0);row.runtime={requested_model:response.requested_model,requested_effort:response.requested_effort,argv:response.argv,version:identity.runtime,code:response.code,signal:response.signal,timed_out:response.timed_out,registry_hash:response.registry_hash};
      const parsed=parseTrace(response.stdout);row.metrics=measure(parsed.events);row.trace_malformed_lines=parsed.malformed;
      const completed=parsed.events.some(e=>e.type==='turn.completed');
      const commands=parsed.events.filter(e=>e.type==='item.completed'&&e.item?.type==='command_execution').map(e=>e.item);
      row.memory_commands=commands.filter(c=>(c.command??'').includes(layout.bundle)||(c.command??'').includes(skillsRoot)||(c.command??'').includes(path.join(layout.codexRoot,'AGENTS.md'))||/irudd-okf|SKILL\.md|\.okf\/personal|\.agents\/skills/.test(c.command??'')).map(c=>({command:c.command,exit_code:c.exit_code,content_read:/\b(cat|sed|read|head|tail|rg)\b/.test(c.command??'')&&!/rg --files/.test(c.command??'')}));
      row.full_applicable_text_observed=corpus.filter(c=>task.relevant.includes(c.id)&&commands.some(cmd=>cmd.exit_code===0&&(cmd.aggregated_output??'').includes(c.text))).map(c=>c.id);
      row.skill_read_observed=commands.some(c=>/SKILL\.md/.test(c.command??'')&&c.exit_code===0);
      await write(dir,'answer.txt',parsed.events.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').map(e=>e.item.text).join('\n'));
      const candidate=await fs.readFile(path.join(layout.repo,task.file),'utf8');await write(dir,'candidate.mjs',candidate);
      const patch=await command('git',['diff','--no-ext-diff'],{cwd:layout.repo,env:runtimeEnvironment(layout)});await write(dir,'patch.diff',patch.stdout);
      const after=await inventory(layout.repo,{allowSymlinks:true});
      const changes=after.filter(a=>before.find(b=>b.path===a.path)?.hash!==a.hash).map(a=>a.path);
      row.changed_files=changes;
      if (before.some(b=>!after.find(a=>a.path===b.path)))throw new Error('Agent deleted a fixture file.');
      for(const file of changes)await write(dir,path.join('changed-files',file),await fs.readFile(path.join(layout.repo,file)));
      if(changes.some(p=>p!==task.file&&!p.startsWith('test/')))throw new Error('Agent changed files outside the requested module or tests.');
      if(bundleBefore.length&&hash(await inventory(layout.bundle))!==hash(bundleBefore))throw new Error('Agent changed read-only personal memories.');
      if(hash(await fs.readFile(path.join(layout.codexRoot,'AGENTS.md')))!==hash(globalBefore)||skillsBefore.length&&hash(await inventory(skillsRoot))!==hash(skillsBefore))throw new Error('Agent changed read-only global instructions or skills.');
      if(response.code!==0||response.timed_out||!completed||parsed.malformed.length)throw new Error(`Runtime did not complete cleanly: exit=${response.code}, timeout=${response.timed_out}, completed=${completed}.`);
      const grading=await command(process.execPath,['--experimental-vm-modules',path.join(sourceRoot,'personal-grade.mjs'),task.id,path.join(dir,'candidate.mjs')],{timeoutMs:10000});
      await persist('grading',grading);
      await write(dir,'grading.stderr.txt',grading.stderr);
      if(grading.code!==0)throw new Error('Hidden grader failed.');
      row.grade=JSON.parse(grading.stdout);row.status='completed';row.failure=null;
    } catch(e) {row.status='failed';row.failure=e.message;row.grade=null;}
    finally {if(root)try{await cleanupOwnedRoot(row,plan);}catch(e){row.status='failed';row.cleanup_failure={root,error:e.message};row.failure=(row.failure??'')+' Cleanup failed; private trial directory retained.';}}
    row.finished_at=new Date().toISOString();await json(path.join(dir,'result.json'),row);await save();
    console.log(JSON.stringify({id:row.id,method:row.method,count:row.count,task:row.task_id,status:row.status,correct:row.grade?.correct??null,tokens:row.metrics?.total_input_output_tokens??null,seconds:row.seconds??null,failure:row.failure}));
  };
  await Promise.all(Array.from({length:concurrency},async()=>{while(next<pending.length){const row=pending[next++];await execute(row);}}));
  return {attempted:rows.filter(r=>r.status!=='planned').length,planned:rows.filter(r=>r.status==='planned').length,failed:rows.filter(r=>r.status==='failed').length,output};
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),value=(k,d)=>{const at=args.indexOf(`--${k}`);return at<0?d:args[at+1];};
  if(args.includes('--help')) console.log('node benchmarks/personal.mjs --output NEW_DIRECTORY [--counts 100,5000] [--repeats 3] [--methods none,oracle,flat,global,skill,symlink,search,suggest,grouped] [--tasks usage,draft,exports,pagination] [--sandbox workspace-write|danger-full-access] [--dry-run] [--resume] [--limit N]');
  else {
    const output=value('output');if(!output)throw new Error('Missing --output.');
    try{const result=await Effect.runPromise(operation(()=>study({output:path.resolve(output),counts:value('counts','100,5000').split(',').map(Number),repeats:Number(value('repeats',3)),selectedMethods:value('methods',methods.join(',')).split(','),selectedTasks:value('tasks',tasks.map(t=>t.id).join(',')).split(','),sandbox:value('sandbox','workspace-write'),seed:Number(value('seed',20261004)),timeoutMs:Number(value('timeout-ms',180000)),limit:Number(value('limit',Infinity)),concurrency:Number(value('concurrency',1)),resume:args.includes('--resume'),dryRun:args.includes('--dry-run')})));console.log(JSON.stringify(result));}
    catch(e){console.error(e.message);process.exitCode=1;}
  }
}
