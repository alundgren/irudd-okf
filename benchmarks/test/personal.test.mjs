import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { facts, makeCorpus, methods, prepare, tasks } from '../personal-fixtures.mjs';
import { execArgs, probeSkills } from '../personal-runtime.mjs';
import { schedule, summarize, study } from '../personal.mjs';
import { hash, inventory } from '../lib.mjs';

test('every size and placement preserves exact applicable facts; large corpus exceeds 32 KiB',()=>{
  const relevant=corpus=>corpus.filter(c=>facts.some(f=>f.id===c.id)).map(c=>[c.id,c.raw]).sort();
  const expected=hash(relevant(makeCorpus(100)));
  for(const count of [100,5000]) for(const placement of ['beginning','middle','end']) {
    const corpus=makeCorpus(count,placement);assert.equal(corpus.length,count);assert.equal(new Set(corpus.map(c=>c.path)).size,count);assert.equal(hash(relevant(corpus)),expected);
  }
  assert.ok(makeCorpus(5000).reduce((n,c)=>n+Buffer.byteLength(c.raw),0)>1_000_000);
  assert.ok(makeCorpus(100).reduce((n,c)=>n+Buffer.byteLength(c.raw),0)<31000);
  assert.equal(makeCorpus(100,'beginning')[0].id,'old-usage');assert.equal(makeCorpus(100,'end').at(-1).id,'other-project');
});

test('frozen schedule covers all methods, tasks, scales and positions without score selection',()=>{
  const cells=schedule();assert.equal(cells.length,216);assert.equal(new Set(cells.map(c=>c.id)).size,216);
  for(const method of methods)for(const task of tasks)for(const count of [100,5000])assert.deepEqual(cells.filter(c=>c.method===method&&c.task_id===task.id&&c.count===count).map(c=>c.placement),['beginning','middle','end']);
  assert.throws(()=>schedule({selectedMethods:['none','none']}));
  assert.ok(execArgs('workspace-write').includes('model_reasoning_effort="medium"'));assert.ok(execArgs('workspace-write').includes('gpt-6.1-sol'));
});

test('symlink treatment preserves link and target separately; no-memory has no personal store',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'okf-personal-test-'));
  try {
    const none=await prepare(path.join(root,'none'),tasks[0],makeCorpus(100),'none',path.resolve('skills/okf'));
    await assert.rejects(fs.stat(none.bundle));
    const link=await prepare(path.join(root,'link'),tasks[0],makeCorpus(100),'symlink',path.resolve('skills/okf'));
    const entries=await inventory(link.repo,{allowSymlinks:true});assert.equal(entries.find(e=>e.path==='.okf/personal').symlink_target,link.bundle);
    assert.match(await fs.readFile(path.join(link.repo,'.okf/personal/metrics/usage.md'),'utf8'),/Never add cached input/);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('native registry exposes only the selected trial skills without model inference',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'okf-personal-registry-test-'));
  try {
    for(const method of ['none','skill','grouped']) {
      const layout=await prepare(path.join(root,method),tasks[0],makeCorpus(100),method,path.resolve('skills/okf'));
      const registry=await probeSkills(layout),enabled=registry.data.flatMap(e=>e.skills.filter(s=>s.enabled).map(s=>s.name));
      assert.equal(registry.data.flatMap(e=>e.errors).length,0);assert.equal(enabled.length,method==='none'?0:method==='skill'?1:8);
      if(method==='skill')assert.deepEqual(enabled,['okf']);
    }
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('behavioral grader rejects stubs and accepts correct implementations, preserving null and scope cases',async()=>{
  const solutions={
    usage:'export function summarizeUsage(u){const value=k=>{const v=u?.[k];if(v==null)return null;if(typeof v!=="number"||!Number.isFinite(v)||v<0)throw TypeError("Invalid count");return v;};const input=value("input_tokens"),output=value("output_tokens"),cached=value("cached_input_tokens");return {total:input===null||output===null?null:input+output,output,cached,input};}',
    draft:'export function replaceDocument(c,v,p){return c.version===v?{status:"saved",raw:p,draft:null}:{status:"conflict",raw:c.raw,draft:p};}',
    exports:'export function exportBytes(p){return {accepted:p.byteLength<=8*1024*1024,bytes:p.byteLength};}',
    pagination:'export function paginate(r,o,l){return r.slice(o,o+l);}',
  };
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'okf-personal-grade-test-'));
  try {
    for(const task of tasks)for(const [good,source] of [[false,task.source],[true,solutions[task.id]]]) {
      const file=path.join(root,`${task.id}-${good}.mjs`);await fs.writeFile(file,source);
      const result=await promisify(execFile)(process.execPath,['--experimental-vm-modules','benchmarks/personal-grade.mjs',task.id,file],{timeout:10000});
      assert.equal(JSON.parse(result.stdout).correct,good,task.id);
    }
    const file=path.join(root,'nan.mjs');await fs.writeFile(file,solutions.usage.replace('if(v==null)return null','if(v==null)return NaN').replace('input===null||output===null?null:input+output','input+output'));
    const invalid=await promisify(execFile)(process.execPath,['--experimental-vm-modules','benchmarks/personal-grade.mjs','usage',file],{timeout:10000});assert.equal(JSON.parse(invalid.stdout).correct,false);
    await fs.writeFile(file,'export function paginate(r,o,l){const page=r.slice(o,o+l);page.length+=4;return page;}');
    const sparse=await promisify(execFile)(process.execPath,['--experimental-vm-modules','benchmarks/personal-grade.mjs','pagination',file],{timeout:10000});assert.equal(JSON.parse(sparse.stdout).correct,false);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('summary retains failed attempts and reports completed and successful token totals separately',()=>{
  const rows=[{method:'global',count:5000,task_id:'usage',status:'completed',seconds:10,metrics:{total_input_output_tokens:100},grade:{correct:true}},{method:'global',count:5000,task_id:'usage',status:'completed',seconds:20,metrics:{total_input_output_tokens:200},grade:{correct:false}},{id:'bad',method:'global',count:5000,task_id:'usage',status:'failed',failure:'timeout'}];
  const [summary]=summarize(rows);assert.equal(summary.attempted,3);assert.equal(summary.completed,2);assert.equal(summary.correct,1);assert.equal(summary.median_success_tokens,100);assert.equal(summary.failures.length,1);
  assert.equal(summary.median_seconds,15);assert.equal(summary.median_total_tokens,150);
});

test('runtime failures retain raw evidence and interrupted rows cannot silently rerun',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'okf-personal-failure-test-')),output=path.join(root,'study');
  const adapter=async(layout,{persist})=>{await persist('runtime',{stdout:'not-json\n',stderr:'failed transport',code:2});throw new Error('simulated runtime failure');};
  const options={output,counts:[100],repeats:1,selectedMethods:['none'],selectedTasks:['usage'],adapter};
  try {
    await study(options);assert.equal(await fs.readFile(path.join(output,'cell-0000/runtime.stdout.txt'),'utf8'),'not-json\n');
    const rows=JSON.parse(await fs.readFile(path.join(output,'results.json'),'utf8'));assert.equal(rows[0].status,'failed');assert.match(rows[0].failure,/simulated/);
    const interrupted=await fs.mkdtemp(path.join(os.tmpdir(),'okf-personal-cell-'));
    const plan=JSON.parse(await fs.readFile(path.join(output,'freeze.json'),'utf8'));
    await fs.writeFile(path.join(interrupted,'owner.json'),JSON.stringify({study_sha256:hash(plan),cell_id:rows[0].id}));
    await fs.writeFile(path.join(interrupted,'auth.json'),'synthetic credential marker');
    rows[0].status='running';rows[0].private_root=interrupted;await fs.writeFile(path.join(output,'results.json'),JSON.stringify(rows));
    await study({...options,resume:true});const resumed=JSON.parse(await fs.readFile(path.join(output,'results.json'),'utf8'));assert.match(resumed[0].failure,/interrupted/);
    await assert.rejects(fs.stat(interrupted));
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
