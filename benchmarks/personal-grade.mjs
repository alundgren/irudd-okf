import fs from 'node:fs/promises';
import vm from 'node:vm';
import { tasks } from './personal-fixtures.mjs';

export async function gradeSource(taskId,source) {
  const task=tasks.find(t=>t.id===taskId);if(!task)throw new Error('Unknown task.');
  const context=vm.createContext({});
  let api;
  try {
    const module=new vm.SourceTextModule(source,{context});
    await module.link(()=>{throw new Error('Fixture modules must be self-contained; external imports are unavailable to this evaluator.');});
    await module.evaluate({timeout:1000});api=module.namespace;
  } catch(e) {return {kind:'hidden_behavioral_tests',passed:0,total:task.tests.length,correct:false,checks:[],error:e.message,human_rating:null};}
  const checks=[];
  for(const [name,test] of task.tests) {
    // Tests and the candidate run in one realm so native error and typed-array checks agree.
    const assertion=`const same=(a,b)=>{if(Object.is(a,b))return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;if(Array.isArray(a)&&a.length!==b.length)return false;const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();return ak.length===bk.length&&ak.every((k,i)=>k===bk[i]&&same(a[k],b[k]));}; const assert={equal:(a,b)=>{if(!Object.is(a,b))throw Error('Values differ');},deepEqual:(a,b)=>{if(!same(a,b))throw Error('Structures differ');},throws:(f,t)=>{try{f();}catch(e){if(e instanceof t)return;throw e;}throw Error('Expected exception');}}; ${test}`;
    try {context.api=api;new vm.Script(`{ ${assertion} }`).runInContext(context,{timeout:1000});checks.push({name,passed:true});}
    catch(e){checks.push({name,passed:false,error:e.message});}
  }
  return {kind:'hidden_behavioral_tests',passed:checks.filter(c=>c.passed).length,total:checks.length,correct:checks.every(c=>c.passed),checks,human_rating:null};
}
if (process.argv[2]) gradeSource(process.argv[2],await fs.readFile(process.argv[3],'utf8')).then(r=>console.log(JSON.stringify(r)));
