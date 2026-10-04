import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { command, hash } from './lib.mjs';

export const model = 'gpt-6.1-sol';
export const effort = 'medium';
export function runtimeEnvironment(layout) {
  const env=Object.fromEntries(['PATH','LANG','SHELL','TERM','SSL_CERT_FILE','SSL_CERT_DIR','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  return {...env,HOME:layout.taskHome,CODEX_HOME:layout.codexRoot,XDG_CONFIG_HOME:path.join(layout.taskHome,'.config'),XDG_CACHE_HOME:path.join(layout.taskHome,'.cache'),XDG_DATA_HOME:path.join(layout.taskHome,'.local/share'),XDG_STATE_HOME:path.join(layout.taskHome,'.local/state'),TMPDIR:path.join(layout.taskHome,'tmp'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',NO_COLOR:'1'};
}
export function controls() {
  const disabled=['apps','plugins','remote_plugin','hooks','multi_agent','multi_agent_v2','shell_snapshot','skill_search','skill_mcp_dependency_install','browser_use','browser_use_external'];
  return [...disabled.flatMap(k=>['-c',`features.${k}=false`]),'-c','skills.bundled.enabled=false','-c','web_search="disabled"','-c','mcp_servers={}','-c','history.persistence="none"','-c','project_doc_max_bytes=32768'];
}
export function execArgs(sandbox) {
  if (!['workspace-write','danger-full-access'].includes(sandbox)) throw new Error('Unknown experiment sandbox.');
  return ['exec','--json','--ignore-user-config','--ignore-rules','--ephemeral','-m',model,'-c',`model_reasoning_effort="${effort}"`,...controls(),'-c','approval_policy="never"','--sandbox',sandbox,'--skip-git-repo-check','-'];
}
export async function probeSkills(layout,persist=async()=>{}) {
  const result=await command(process.execPath,[fileURLToPath(import.meta.url),'probe'],{cwd:layout.repo,env:runtimeEnvironment(layout),input:JSON.stringify({cwd:layout.repo,args:controls()})+'\n',timeoutMs:20000});
  await persist('registry',result);
  if (result.code!==0) throw new Error(`Skill registry preflight failed: ${result.stderr.slice(0,1500)}`);
  return JSON.parse(result.stdout);
}
export async function runCodex(layout,{sandbox='workspace-write',timeoutMs=180000,persist=async()=>{}}={}) {
  await fs.mkdir(path.join(layout.taskHome,'tmp'),{recursive:true});
  const authSource=path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'auth.json');
  await fs.chmod(layout.codexRoot,0o700);
  try {
  await fs.copyFile(authSource,path.join(layout.codexRoot,'auth.json'));
  await fs.chmod(path.join(layout.codexRoot,'auth.json'),0o600);
  const registry=await probeSkills(layout,persist);
  const expected=layout.method==='skill'?['okf']:layout.method==='grouped'?['personal-compatibility','personal-editing','personal-exports','personal-logging','personal-metrics','personal-pagination','personal-releases','personal-testing']:[];
  const actual=registry.data.flatMap(entry=>entry.skills.filter(s=>s.enabled).map(s=>s.name)).sort();
  if (registry.data.some(entry=>entry.errors.length)||JSON.stringify(actual)!==JSON.stringify(expected.sort())) throw new Error(`Unexpected enabled skill registry: ${JSON.stringify(actual)}`);
  const args=execArgs(sandbox);
  const result=await command('codex',args,{cwd:layout.repo,env:runtimeEnvironment(layout),input:layout.prompt,timeoutMs});
  await persist('runtime',result);
  return {...result,registry,requested_model:model,requested_effort:effort,argv:['codex',...args],registry_hash:hash(registry)};
  } finally {await fs.rm(path.join(layout.codexRoot,'auth.json'),{force:true});}
}

async function probe() {
  const input=JSON.parse(await new Promise(resolve=>{let text='';process.stdin.on('data',b=>text+=b);process.stdin.on('end',()=>resolve(text));}));
  const p=spawn('codex',['app-server','--listen','stdio://',...input.args],{cwd:input.cwd,env:process.env,stdio:['pipe','pipe','pipe']});
  let buffer='',nextId=0,stderr='';const pending=new Map();
  p.stderr.on('data',b=>stderr+=b);
  p.stdout.on('data',b=>{buffer+=b;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let m;try{m=JSON.parse(line);}catch{continue;}const cb=pending.get(m.id);if(cb){pending.delete(m.id);m.error?cb.reject(new Error(JSON.stringify(m.error))):cb.resolve(m.result);}}});
  p.on('error',e=>{for(const cb of pending.values())cb.reject(e);});
  p.on('close',code=>{for(const cb of pending.values())cb.reject(new Error(`Registry process exited ${code}: ${stderr.slice(0,500)}`));});
  const call=(method,params)=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});p.stdin.write(JSON.stringify({id,method,params})+'\n');});
  try {
    await call('initialize',{clientInfo:{name:'okf-personal-registry',version:'1'},capabilities:{experimentalApi:true}});
    p.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
    process.stdout.write(JSON.stringify(await call('skills/list',{cwds:[input.cwd],forceReload:true}))+'\n');
  } finally {p.kill('SIGKILL');p.stdin.destroy();p.stdout.destroy();p.stderr.destroy();}
}
if (process.argv[2]==='probe') probe().catch(e=>{console.error(e.message);process.exitCode=1;});
