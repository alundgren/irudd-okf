#!/usr/bin/env node
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { command, hash, operation } from './lib.mjs';
import { makeCorpus, prepare, tasks } from './personal-fixtures.mjs';
import { execArgs, runtimeEnvironment } from './personal-runtime.mjs';

// The client sends its first request to a loopback server that always rejects it.
// There is no auth copy, model inference, or provider request.
export async function probeInstructions(output) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'okf-instruction-probe-'));
  const captured=[];
  const server=http.createServer((request,response)=>{
    const chunks=[];
    request.on('data',chunk=>chunks.push(chunk));
    request.on('end',()=>{
      const raw=Buffer.concat(chunks),body=raw.toString('utf8');
      captured.push({path:request.url,bytes:raw.length,sha256:hash(raw),has_usage_rule:body.includes('Never add cached input a second time'),has_final_archive:body.includes('archive-04993'),unique_archive_ids:new Set(body.match(/archive-\d{5}/g)??[]).size});
      response.writeHead(400,{'Content-Type':'application/json'});
      response.end(JSON.stringify({error:{message:'Offline instruction capture complete',type:'invalid_request_error'}}));
    });
  });
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const layout=await prepare(root,tasks[0],makeCorpus(5000,'beginning'),'flat',path.resolve('skills/okf'));
    await fs.mkdir(path.join(layout.taskHome,'tmp'),{recursive:true});
    const address=server.address();
    const args=[...execArgs('workspace-write'),'-c','model_provider="capture"','-c','model_providers.capture.name="Offline capture"','-c',`model_providers.capture.base_url="http://127.0.0.1:${address.port}/v1"`,'-c','model_providers.capture.wire_api="responses"','-c','model_providers.capture.requires_openai_auth=false'];
    const result=await command('codex',args,{cwd:layout.repo,env:runtimeEnvironment(layout),input:layout.prompt,timeoutMs:20000});
    if(!captured.length)throw new Error('No loopback request captured.');
    const evidence={kind:'offline_no_inference_client_request_probe',corpus_count:5000,placement:'beginning',project_doc_max_bytes:32768,runtime:(await command('codex',['--version'])).stdout.trim(),captured,runtime_exit:result.code,timed_out:result.timed_out};
    await fs.writeFile(output,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
    return evidence;
  } finally {
    server.closeAllConnections();
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    await fs.rm(root,{recursive:true,force:true});
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const output=process.argv[2];
  if(!output)throw new Error('Usage: node benchmarks/personal-instruction-probe.mjs NEW_EVIDENCE.json');
  console.log(JSON.stringify(await Effect.runPromise(operation(()=>probeInstructions(path.resolve(output))))));
}
