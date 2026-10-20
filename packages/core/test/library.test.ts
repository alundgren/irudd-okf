import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Effect } from 'effect';
import { spawn,spawnSync } from 'node:child_process';
import {pathToFileURL} from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createStore, initializeBundle, type ChangeRecord, type MemoryContext, type StoreOptions, type Applicability } from '../src/index.ts';
import { hash } from '../src/files.ts';
import { patchMetadata } from '../src/memory.ts';
import { previewDigest } from '../src/maintenance.ts';
vi.mock('node:fs/promises', async importOriginal => ({...await importOriginal<typeof fs>()}));
const run = Effect.runPromise;
const roots: string[] = [];
const actor = {type:'agent' as const,id:'test-librarian'};
const human = {type:'human' as const,id:'test-operator'};
const raw = (id: string, text = 'Accepted evidence.', kind = 'semantic', scope: Applicability = {type:'global'}) => `---\ntype: Memory\ntitle: ${id}\ncustom: preserved # original comment\nmemory:\n  id: ${id}\n  kind: ${kind}\n  stage: bronze\n  applicability: ${JSON.stringify(scope)}\n---\n${text}\n`;
async function fixture(options: StoreOptions = {}, initialized = true) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'okf-library-'))); roots.push(root);
  const bundle = path.join(root,'library'); if (initialized) await run(initializeBundle(bundle)); else await fs.mkdir(bundle);
  const context: MemoryContext = {version:1,cwd:root,gitRoot:null,configPath:path.join(root,'config.json'),bundles:[{name:'memory',root:bundle,kind:'explicit',writable:true}]};
  const store = createStore(context,options);
  const propose = (file: string, content: string | null, expectedHash: string | null = null, extra = {}) => run(store.proposeChange({bundle:'memory',path:file,raw:content,expectedHash,actor,reason:'Actual task observation.',...extra}));
  const review = (change: ChangeRecord, decision: 'accept'|'reject' = 'accept', asHuman = false) => run(store.reviewChange({bundle:'memory',id:change.id,expectedRevisionHash:change.revisionHash,actor:asHuman ? human : actor,reason:'Checked the exact revision against evidence.',decision,sources:change.sources,...(asHuman ? {operator:true as const} : {})}));
  return {root,bundle,context,store,propose,review};
}
afterEach(async () => {vi.restoreAllMocks();await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});

describe('portable memory library', () => {
  it('keeps accepted recall during pending gold edits and rejected revisions, including default read and directory titles', async () => {
    const f=await fixture(); const initial=await f.propose('topic/note.md',raw('note'));
    expect(initial.status).toBe('pending');expect(initial.display).toMatchObject({title:'note',afterMemory:{kind:'semantic',stage:'bronze',applicability:{type:'global'}}}); expect((await run(f.store.search('evidence'))).total).toBe(0);
    await expect(run(f.store.read('memory','topic/note.md'))).rejects.toMatchObject({code:'NOT_ACCEPTED'});
    await f.review(initial); const accepted=await run(f.store.read('memory','topic/note.md'));
    const update=await f.propose('topic/note.md',patchMetadata(raw('note','Unreviewed replacement.'),[{path:['memory','stage'],value:'gold'},{path:['title'],value:'Unaccepted title'}]),accepted.hash);
    expect((await run(f.store.read('memory','topic/note.md'))).raw).toBe(accepted.raw);
    expect((await run(f.store.read('memory','topic/note.md',{current:true}))).raw).toContain('Unreviewed replacement');
    expect((await run(f.store.browse({bundle:'memory',path:'topic'}))).entries[0].title).toBe('note');
    expect((await run(f.store.search('evidence'))).results[0].memory?.stage).toBe('bronze');
    await f.review(update,'reject');
    expect(await fs.readFile(path.join(f.bundle,'topic/note.md'),'utf8')).toBe(accepted.raw);
    expect((await run(f.store.listChanges('memory','pending'))).changes).toEqual([]);
    expect((await run(f.store.readChange('memory',update.id))).after?.raw).toContain('stage: gold');
    const next=await f.propose('topic/note.md',raw('note','Reviewed gold result.'),accepted.hash); await f.review(next);
    expect((await run(f.store.search('Reviewed gold'))).total).toBe(1);
  });
  it('tracks removal, requires a human decision and restores deleted evidence through a new pending proposal', async () => {
    const f=await fixture(); const created=await f.propose('evidence.md',raw('evidence'));await f.review(created);
    const deleted=await f.propose('evidence.md',null,created.after!.hash);
    expect((await run(f.store.search('Accepted evidence'))).total).toBe(1);
    await expect(f.review(deleted)).rejects.toMatchObject({code:'HUMAN_REVIEW_REQUIRED'});await f.review(deleted,'accept',true);
    expect((await run(f.store.search('Accepted evidence'))).total).toBe(0);
    const restored=await run(f.store.undoChange({bundle:'memory',id:deleted.id,expectedRevisionHash:deleted.revisionHash,actor,reason:'Restore retained evidence.'}));
    expect(restored.after?.raw).toBe(created.after!.raw);expect(restored.status).toBe('pending');
    expect((await run(f.store.search('Accepted evidence'))).total).toBe(0);await f.review(restored);
    expect((await run(f.store.search('Accepted evidence'))).total).toBe(1);
  });
  it('separates declared machine and repository applicability from bundle aliases and enforces stable unique IDs', async () => {
    const f=await fixture();
    for (const [id,scope] of [['global',{type:'global'}],['machine',{type:'machine',id:'machine-a'}],['repo',{type:'repository',id:'repo-a'}]] as const) {const change=await f.propose(id+'.md',raw(id,'Targeted recall.','semantic',scope));await f.review(change);}
    expect((await run(f.store.search('Targeted'))).total).toBe(1);
    expect((await run(f.store.search('Targeted',{machine:'machine-a'}))).total).toBe(2);
    expect((await run(f.store.search('Targeted',{repository:'repo-a',machine:'machine-a'}))).total).toBe(3);
    expect((await run(f.store.search('Targeted',{allApplicability:true}))).total).toBe(3);
    expect((await run(f.store.browse({bundle:'memory',allApplicability:true}))).entries).toHaveLength(3);
    await expect(f.propose('copy.md',raw('global'))).rejects.toMatchObject({code:'DUPLICATE_MEMORY_ID'});
    await expect(f.propose('missing.md','---\ntype: Memory\nmemory: {id:missing,kind:semantic,stage:bronze}\n---\nScope missing.')).rejects.toMatchObject({code:'CLASSIFICATION_REQUIRED'});
    const original=await run(f.store.read('memory','machine.md',{allApplicability:true})); const wider=await f.propose('machine.md',raw('machine','Wider applicability.'),original.hash);
    await expect(f.review(wider)).rejects.toMatchObject({code:'HUMAN_REVIEW_REQUIRED'});
    await expect(run(f.store.reviewChange({bundle:'memory',id:wider.id,expectedRevisionHash:wider.revisionHash,actor:human,reason:'Human checked scope.',decision:'accept',sources:wider.sources}))).rejects.toMatchObject({code:'HUMAN_REVIEW_AUTHORIZATION'});
    await f.review(wider,'accept',true);
  });
  it('retains separate agent and human attestations and refuses agent changes to accepted procedures', async () => {
    const f=await fixture();const initial=await f.propose('procedure.md',raw('procedure','Run the checked command.','procedural'));await f.review(initial);await f.review(initial,'accept',true);await f.review(initial);
    expect((await run(f.store.read('memory','procedure.md'))).memory?.humanReviewed).toBe(true);
    expect((await run(f.store.readChange('memory',initial.id))).reviews).toHaveLength(3);
    const update=await f.propose('procedure.md',raw('procedure','Run a different command.','procedural'),initial.after!.hash);
    await expect(f.review(update)).rejects.toMatchObject({code:'HUMAN_REVIEW_REQUIRED'});
    await expect(f.propose('new-gold.md',raw('new-gold').replace('stage: bronze','stage: gold'))).rejects.toMatchObject({code:'BRONZE_REQUIRED'});
  });
  it('includes metadata evidence guards, rejects omitted or changed sources and invalidates derived recall', async () => {
    const f=await fixture();const source=await f.propose('source.md',raw('source','Source observation.'));await f.review(source);
    const derived=await f.propose('derived.md',patchMetadata(raw('derived','Derived conclusion.'),[{path:['sources'],value:['source.md']},{path:['memory','derived_from'],value:[{resource:'source.md',content_hash:source.after!.hash}]}]));
    expect(derived.sources).toMatchObject([{id:'source',path:'source.md',hash:source.after!.hash}]);
    await expect(run(f.store.reviewChange({bundle:'memory',id:derived.id,expectedRevisionHash:derived.revisionHash,actor,reason:'Omitted source.',decision:'accept',sources:[]}))).rejects.toMatchObject({code:'SOURCE_CONFLICT'});
    await f.review(derived);expect((await run(f.store.search('Derived conclusion'))).total).toBe(1);
    const changed=await f.propose('source.md',raw('source','Source changed.'),source.after!.hash);
    expect((await run(f.store.search('Derived conclusion'))).total).toBe(1);
    await f.review(changed);
    expect((await run(f.store.search('Derived conclusion'))).total).toBe(0);
    await expect(f.review(derived)).rejects.toMatchObject({code:'SOURCE_CONFLICT'});
  });
  it('detects external changes while retaining accepted recall, rejects superseded proposals and does not reopen rejected bytes', async () => {
    const f=await fixture();const original=await f.propose('note.md',raw('note'));await f.review(original);
    await fs.writeFile(path.join(f.bundle,'note.md'),raw('note','External edit.'));
    expect((await run(f.store.search('Accepted evidence'))).total).toBe(1);
    const external=(await run(f.store.listChanges('memory','pending'))).changes[0];expect(external.actor.id).toBe('external-edit');
    await expect(f.review(original)).rejects.toMatchObject({code:'REVIEW_CONFLICT'});
    await f.review(external,'reject',true);expect((await run(f.store.listChanges('memory','pending'))).changes).toEqual([]);
    await fs.unlink(path.join(f.bundle,'note.md'));
    const removal=(await run(f.store.listChanges('memory','pending'))).changes[0];expect(removal.action).toBe('delete');
    expect((await run(f.store.read('memory','note.md'))).raw).toBe(original.after!.raw);
  });
  it('preserves accepted history on portable copy without runtime or Git directories and handles idempotent retries', async () => {
    const f=await fixture();const request={requestId:'durable-request'};const first=await f.propose('note.md',raw('note'),null,request);await f.review(first);
    expect((await f.propose('note.md',raw('note'),null,request)).id).toBe(first.id);
    await expect(f.propose('note.md',raw('note','Different payload.'),null,request)).rejects.toMatchObject({code:'REQUEST_ID_CONFLICT'});
    await expect(f.propose('note.md',raw('note'),first.after!.hash,request)).rejects.toMatchObject({code:'REQUEST_ID_CONFLICT'});
    const copied=await fixture({},false);for(const filename of ['memory-bundle.json','memory-history.json','note.md'])await fs.copyFile(path.join(f.bundle,filename),path.join(copied.bundle,filename));
    expect((await run(copied.store.search('Accepted evidence'))).total).toBe(1);expect((await run(copied.store.inspectBundle('memory'))).id).toBe((await run(f.store.inspectBundle('memory'))).id);
    await fs.writeFile(path.join(copied.bundle,'memory-bundle.json'),JSON.stringify({formatVersion:99,id:'newer',name:'newer'}));
    await expect(copied.propose('x.md',raw('x'))).rejects.toMatchObject({code:'NEWER_BUNDLE_FORMAT'});
    await expect(run(copied.store.save({bundle:'memory',path:'x.md',raw:raw('x'),expectedHash:null}))).rejects.toMatchObject({code:'NEWER_BUNDLE_FORMAT'});
  });
  it('requires human review when a new derived memory applies beyond its accepted evidence scope',async()=>{
    const f=await fixture();const source=await f.propose('source.md',raw('source','Project evidence.','semantic',{type:'repository',id:'project-a'}));await f.review(source);
    const global=await f.propose('global.md',patchMetadata(raw('global','General conclusion.'),[{path:['sources'],value:['source.md']}]));expect(global.humanRequired).toBe(true);await expect(f.review(global)).rejects.toMatchObject({code:'HUMAN_REVIEW_REQUIRED'});
    const same=await f.propose('same.md',patchMetadata(raw('same','Project conclusion.','semantic',{type:'repository',id:'project-a'}),[{path:['sources'],value:['source.md']}]));expect(same.humanRequired).toBe(false);await f.review(same);
  });
  it('keeps human decisions effective across agent assessments and supports stable-ID moves with retained source evidence', async () => {
    const f=await fixture(); const source=await f.propose('old.md',raw('source','Stable evidence.'));await f.review(source,'accept',true);
    await f.review(source,'reject');expect((await run(f.store.readChange('memory',source.id))).status).toBe('accepted');
    const derived=await f.propose('derived.md',patchMetadata(raw('derived','Derived fact.'),[{path:['sources'],value:['old.md']}]));await f.review(derived);
    const deleted=await f.propose('old.md',null,source.after!.hash);await f.review(deleted,'accept',true);
    expect((await run(f.store.search('Derived fact'))).results.some(item=>item.path==='derived.md')).toBe(true);
    const moved=await f.propose('new.md',source.after!.raw);await f.review(moved);
    expect((await run(f.store.search('Derived fact'))).results.some(item=>item.path==='derived.md')).toBe(true);
    await expect(run(f.store.undoChange({bundle:'memory',id:deleted.id,expectedRevisionHash:deleted.revisionHash,actor,reason:'Duplicate restore attempt.'}))).rejects.toMatchObject({code:'DUPLICATE_MEMORY_ID'});
    const rejected=await f.propose('rejected.md',raw('rejected'));await f.review(rejected,'reject',true);await f.review(rejected);
    expect((await run(f.store.readChange('memory',rejected.id))).status).toBe('rejected');
    await expect(run(f.store.read('memory','rejected.md'))).rejects.toMatchObject({code:'NOT_ACCEPTED'});
    const original=await f.propose('kind.md',raw('kind'));await f.review(original);
    const procedure=await f.propose('kind.md',raw('kind','Execute a new command.','procedural'),original.after!.hash);await expect(f.review(procedure)).rejects.toMatchObject({code:'HUMAN_REVIEW_REQUIRED'});
  });
  it('repairs a corrected derivation using fresh accepted evidence and requires human review', async()=>{
    const f=await fixture();const source=await f.propose('source.md',raw('source','Initial fact.'));await f.review(source);
    const first=await f.propose('derived.md',patchMetadata(raw('derived','Initial conclusion.'),[{path:['sources'],value:['source.md']},{path:['memory','derived_from'],value:[{resource:'source.md',content_hash:source.after!.hash}]}]));await f.review(first);
    const corrected=await f.propose('source.md',raw('source','Corrected fact.'),source.after!.hash);await f.review(corrected);
    const repair=await f.propose('derived.md',patchMetadata(raw('derived','Corrected conclusion.'),[{path:['sources'],value:['source.md']},{path:['memory','derived_from'],value:[{resource:'source.md',content_hash:corrected.after!.hash}]}]),first.after!.hash);
    expect(repair.sources[0].hash).toBe(corrected.after!.hash);expect(repair.humanRequired).toBe(true);await f.review(repair,'accept',true);
    expect((await run(f.store.search('Corrected conclusion'))).results.some(item=>item.path==='derived.md')).toBe(true);
    const archive=await f.propose('source.md',patchMetadata(corrected.after!.raw,[{path:['memory','archived_at'],value:'2026-10-01T00:00:00Z'}]),corrected.after!.hash);await f.review(archive);
    expect((await run(f.store.search('Corrected conclusion'))).results.some(item=>item.path==='derived.md')).toBe(true);
  });
  it('recovers a killed proposal writer through public CLI and preserves external edits as another pending revision',async()=>{
    const f=await fixture();const script=path.join(f.root,'writer.mjs');
    const request={bundle:'memory',path:'note.md',raw:raw('note'),expectedHash:null,actor,reason:'Killed writer test.'};
    await fs.writeFile(script,`import {createStore} from ${JSON.stringify(pathToFileURL(path.join(process.cwd(),'packages/core/src/index.ts')).href)};
import {Effect} from ${JSON.stringify(pathToFileURL(path.join(process.cwd(),'node_modules/effect/dist/index.js')).href)};
await Effect.runPromise(createStore(${JSON.stringify(f.context)},{afterChangeWrite:async()=>process.kill(process.pid,'SIGKILL')}).proposeChange(${JSON.stringify(request)}));`);
    const child=spawn(process.execPath,['--import','tsx',script],{cwd:process.cwd(),env:{...process.env,TSX_DISABLE_CACHE:'1'},stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',chunk=>{errors+=String(chunk);});
    const termination=await new Promise<{code:number|null;signal:string|null}>((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
    if(process.platform==='win32')expect(termination.code,errors).not.toBe(0);else expect(termination.signal,errors).toBe('SIGKILL');
    expect((await run(f.store.inspectChanges('memory'))).publication?.state).toBe('untouched');
    await fs.writeFile(path.join(f.bundle,'note.md'),raw('note','External bytes retained.'));
    const cli=spawnSync(process.execPath,['--import','tsx',path.join(process.cwd(),'packages/cli/src/main.ts'),'--bundle',`memory=${f.bundle}`,'change','recover','memory'],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,XDG_CONFIG_HOME:path.join(f.root,'config'),NODE_NO_WARNINGS:'1',TSX_DISABLE_CACHE:'1'},timeout:60000});
    expect(cli.status,cli.stderr).toBe(0);expect(JSON.parse(cli.stdout)).toMatchObject({lockRecovered:true,publication:null});
    expect(await fs.readFile(path.join(f.bundle,'note.md'),'utf8')).toContain('External bytes retained.');
    const changes=(await run(f.store.listChanges('memory'))).changes.filter(item=>item.path==='note.md');expect(changes.map(item=>item.status)).toEqual(['superseded','pending']);expect(changes[1].humanRequired).toBe(true);
    await fs.writeFile(path.join(f.bundle,'.irudd-okf','write.lock'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
    await expect(run(f.store.recoverChanges('memory'))).rejects.toMatchObject({code:'LOCK_OWNER_RUNNING'});
  },60000);
  it('replays an interrupted Markdown publication from portable intent without creating another change', async () => {
    const f=await fixture();const original=fs.link;let fail=true;
    vi.spyOn(fs,'link').mockImplementation(async (from,to)=>{if(fail&&String(to).endsWith('note.md'))throw new Error('Interrupted publication');return original(from,to);});
    await expect(f.propose('note.md',raw('note'),null,{requestId:'retry'})).rejects.toMatchObject({code:'IO_ERROR'});fail=false;
    const retried=await f.propose('note.md',raw('note'),null,{requestId:'retry'});expect(retried.status).toBe('pending');
    expect((await run(f.store.listChanges('memory','pending'))).changes).toHaveLength(1);expect(await fs.readFile(path.join(f.bundle,'note.md'),'utf8')).toBe(raw('note'));
  });
});

describe('explicit format migration', () => {
  it('adds explicit classification to untagged Markdown without changing original body bytes',async()=>{
    const f=await fixture({},false),original='A specific untagged lesson.\r\n';await fs.writeFile(path.join(f.bundle,'plain.md'),original);
    const unresolved=await run(f.store.previewMigration({bundle:'memory'}));expect(unresolved.unresolved.some(item=>item.field==='applicability')).toBe(true);
    const preview=await run(f.store.previewMigration({bundle:'memory',decisions:{'plain.md':{id:'plain',kind:'semantic',stage:'bronze',applicability:{type:'global'}}}}));expect(preview.unresolved).toEqual([]);await run(f.store.applyMigration({preview}));
    const record=(await run(f.store.listChanges('memory','pending'))).changes[0];expect(record.before?.raw).toBe(original);expect(record.after?.raw.endsWith(original)).toBe(true);
  });
  it('migrates more than 100 notes through decisions and preview JSON larger than 2MB using bounded progress journals',async()=>{
    const f=await fixture({},false),decisions:Record<string,{id:string;kind:'semantic';stage:'bronze';applicability:{type:'global'};raw:string}>={};
    const content='Recorded observation. '.repeat(1100);
    for(let index=0;index<102;index++){const file=`note-${index}.md`;await fs.writeFile(path.join(f.bundle,file),'---\ntype: Fact\n---\n'+content);decisions[file]={id:'note-'+index,kind:'semantic',stage:'bronze',applicability:{type:'global'},raw:'---\ntype: Fact\nmemory: '+JSON.stringify({id:'note-'+index,kind:'semantic',stage:'bronze',applicability:{type:'global'}})+'\n---\n'+content};}
    const decisionsFile=path.join(f.root,'decisions.json'),decisionsRaw=JSON.stringify({decisions});expect(Buffer.byteLength(decisionsRaw)).toBeGreaterThan(2_000_000);await fs.writeFile(decisionsFile,decisionsRaw);
    const previewProcess=spawnSync(process.execPath,['--import','tsx',path.join(process.cwd(),'packages/cli/src/main.ts'),'--bundle',`memory=${f.bundle}`,'migration','preview','memory','--file',decisionsFile],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,TSX_DISABLE_CACHE:'1',NODE_NO_WARNINGS:'1',XDG_CONFIG_HOME:path.join(f.root,'config')},timeout:60000,maxBuffer:64_000_000});
    expect(previewProcess.status,previewProcess.stderr).toBe(0);const preview=JSON.parse(previewProcess.stdout);expect(preview.unresolved).toEqual([]);expect(preview.changes.length).toBeGreaterThan(100);
    const serialized=JSON.stringify(preview);expect(Buffer.byteLength(serialized)).toBeGreaterThan(2_000_000);const file=path.join(f.root,'preview.json');await fs.writeFile(file,serialized);
    const cli=spawnSync(process.execPath,['--import','tsx',path.join(process.cwd(),'packages/cli/src/main.ts'),'--bundle',`memory=${f.bundle}`,'migration','apply','--file',file],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,TSX_DISABLE_CACHE:'1',NODE_NO_WARNINGS:'1',XDG_CONFIG_HOME:path.join(f.root,'config')},timeout:60000});
    expect(cli.status,cli.stderr).toBe(0);const result=JSON.parse(cli.stdout);expect((await fs.stat(result.journalPath+'.progress')).size).toBeLessThan(10000);
    expect((await run(f.store.inspectBundle('memory'))).status).toBe('current');expect((await run(f.store.listChanges('memory','pending',{limit:100}))).total).toBe(102);
  },60000);
  it('binds migrated local provenance and tracks index edits with the same proposal rules',async()=>{
    const f=await fixture({},false);await fs.writeFile(path.join(f.bundle,'index.md'),'---\nokf_version: "0.2"\n---\n# Knowledge\n[source](source.md)\n');
    await fs.writeFile(path.join(f.bundle,'source.md'),'---\ntype: Fact\n---\nOriginal source.\n');await fs.writeFile(path.join(f.bundle,'derived.md'),'---\ntype: Fact\nsources: [source.md]\n---\nDerived observation.\n');
    const decisions=Object.fromEntries(['source.md','derived.md'].map(file=>[file,{id:file.replace('.md',''),kind:'semantic' as const,stage:'bronze' as const,applicability:{type:'global' as const}}]));
    const preview=await run(f.store.previewMigration({bundle:'memory',decisions}));expect(preview.unresolved).toEqual([]);await run(f.store.applyMigration({preview}));
    const records=(await run(f.store.listChanges('memory','pending'))).changes;expect(records.find(item=>item.path==='derived.md')?.sources).toMatchObject([{id:'source',path:'source.md'}]);
    await f.review(records.find(item=>item.path==='source.md')!,'accept',true);await f.review(records.find(item=>item.path==='derived.md')!,'accept',true);await f.review(records.find(item=>item.path==='index.md')!,'accept',true);
    expect((await run(f.store.search('Derived observation'))).results.some(item=>item.path==='derived.md')).toBe(true);
    await fs.writeFile(path.join(f.bundle,'index.md'),'# External instructions\n');
    expect((await run(f.store.read('memory','index.md'))).raw).toContain('# Knowledge');expect((await run(f.store.listChanges('memory','pending'))).changes.some(item=>item.path==='index.md')).toBe(true);
  });
  it('preserves unknown and malformed bytes, requires explicit scope/classification and publishes the marker last on resumable apply', async () => {
    let interrupt=true;const f=await fixture({afterJournalWrite:async()=>{if(interrupt)throw new Error('Stop');}},false);
    const legacy='---\ntype: Fact # original\ncustom: {keep: true}\n---\nLegacy evidence.\n';const malformed='---\ntype: [broken\n---\nOriginal broken bytes.\n';
    await fs.writeFile(path.join(f.bundle,'legacy.md'),legacy);await fs.writeFile(path.join(f.bundle,'broken.md'),malformed);
    const unresolved=await run(f.store.previewMigration({bundle:'memory'}));expect(unresolved.unresolved.map(item=>item.field)).toContain('applicability');
    const forged=structuredClone(unresolved);forged.unresolved=[];forged.previewHash=previewDigest(forged);
    await expect(run(f.store.applyMigration({preview:forged}))).rejects.toMatchObject({code:'INVALID_MEMORY'});
    expect(await fs.readFile(path.join(f.bundle,'broken.md'),'utf8')).toBe(malformed);
    const preview=await run(f.store.previewMigration({bundle:'memory',decisions:{'legacy.md':{id:'legacy',kind:'semantic',stage:'silver',applicability:{type:'repository',id:'explicit-repo'}},'broken.md':{raw:raw('broken','Explicit repair.')}}}));expect(preview.unresolved).toEqual([]);
    await expect(run(f.store.applyMigration({preview}))).rejects.toMatchObject({code:'INTERRUPTED'});
    expect((await run(f.store.inspectBundle('memory'))).status).toBe('migration-required');
    interrupt=false;await run(f.store.applyMigration({preview}));expect((await run(f.store.inspectBundle('memory'))).status).toBe('current');
    expect(await fs.readFile(path.join(f.bundle,'legacy.md'),'utf8')).toContain('type: Fact # original');
    const changes=(await run(f.store.listChanges('memory','pending'))).changes;expect(changes.find(item=>item.path==='broken.md')?.before?.raw).toBe(malformed);
    expect((await run(f.store.search('Legacy',{repository:'explicit-repo'}))).total).toBe(0);
    expect((await run(f.store.applyMigration({preview}))).state).toBe('unchanged');
  });
});

describe('routine librarian work', () => {
  const stage = (text: string, value: string) => patchMetadata(text, [{path:['memory','stage'],value}]);
  const archived = (text: string) => patchMetadata(text, [{path:['memory','archived_at'],value:'2026-10-01T00:00:00Z'}]);
  const pin = (change: ChangeRecord) => ({path:change.path,hash:change.after!.hash});
  async function accepted(f: Awaited<ReturnType<typeof fixture>>, file: string, content: string, asHuman = true) {
    const change=await f.propose(file,content);await f.review(change,'accept',asHuman);return change;
  }
  it('lets an agent finish a mixed pile of human-accepted memories and leaves only the procedure rewrite for a person', async () => {
    const f=await fixture();
    const first=await accepted(f,'episodes/first.md',raw('first','The build failed until the cache was cleared.','episodic'));
    const second=await accepted(f,'episodes/second.md',raw('second','Clearing the cache fixed the build again.','episodic'));
    const kept=await accepted(f,'facts/cache.md',raw('cache','Stale caches break the build.'));
    const duplicate=await accepted(f,'facts/cache-copy.md',raw('cache-copy','The build breaks on a stale cache.'));
    const procedure=await accepted(f,'procedures/build.md',raw('build','Clear the cache, then run the build.','procedural'));
    const stale=await accepted(f,'facts/old.md',raw('old','The old build server is in use.'));

    const fact=await f.propose('facts/cache-fix.md',raw('cache-fix','Clearing the cache fixes stale-cache build failures.'),null,{sources:[pin(first),pin(second)]});
    expect(fact.humanRequired).toBe(false);await f.review(fact);
    for (const episode of [first,second]) {const removal=await f.propose(episode.path,null,episode.after!.hash);expect(removal.humanRequired).toBe(false);await f.review(removal);}

    const merged=await f.propose(kept.path,raw('cache','Stale caches break the build. Clearing them restores it.'),kept.after!.hash,{sources:[pin(duplicate)]});
    expect(merged.humanRequired).toBe(false);await f.review(merged);
    const copyRemoval=await f.propose(duplicate.path,null,duplicate.after!.hash);expect(copyRemoval.humanRequired).toBe(false);await f.review(copyRemoval);

    const howto=await f.propose('procedures/cache.md',raw('cache-steps','Delete the cache folder before rebuilding.','procedural'),null,{sources:[pin(fact)]});await f.review(howto);
    const promotedFact=await f.propose(fact.path,stage(fact.after!.raw,'silver'),fact.after!.hash,{sources:fact.sources});expect(promotedFact.humanRequired).toBe(false);await f.review(promotedFact);
    expect((await run(f.store.search('cache folder'))).results.map(item=>item.path)).toContain('procedures/cache.md');
    const evidence=await f.propose('procedures/cache.md',raw('cache-steps','Delete the cache folder before rebuilding.','procedural'),howto.after!.hash,{sources:[pin(promotedFact),pin(merged)]});
    expect(evidence.humanRequired).toBe(false);await f.review(evidence);

    const promotedProcedure=await f.propose(procedure.path,stage(procedure.after!.raw,'silver'),procedure.after!.hash);expect(promotedProcedure.humanRequired).toBe(false);await f.review(promotedProcedure);
    const archive=await f.propose(stale.path,archived(stale.after!.raw),stale.after!.hash);expect(archive.humanRequired).toBe(false);await f.review(archive);
    expect((await run(f.store.search('old build server'))).results.map(item=>item.path)).not.toContain(stale.path);

    const rewrite=await f.propose(procedure.path,stage(raw('build','Run the build with a fresh cache directory.','procedural'),'silver'),promotedProcedure.after!.hash);
    expect(rewrite.humanRequired).toBe(true);await expect(f.review(rewrite)).rejects.toMatchObject({code:'HUMAN_REVIEW_REQUIRED'});
    expect((await run(f.store.listChanges('memory','pending'))).changes.map(item=>item.id)).toEqual([rewrite.id]);
    expect((await run(f.store.read('memory',procedure.path))).raw).toContain('Clear the cache, then run the build.');
  });
  it('keeps removals of procedures and uncited memories, narrowing removals and retired procedures with a person', async () => {
    const f=await fixture();
    const procedure=await accepted(f,'procedure.md',raw('procedure','Run the checked command.','procedural'));
    const note=await accepted(f,'note.md',raw('note','A global fact.'));
    const citesProcedure=await f.propose('summary.md',raw('summary','Summary of the checked command.'),null,{sources:[pin(procedure)]});await f.review(citesProcedure);
    expect((await f.propose(procedure.path,null,procedure.after!.hash)).humanRequired).toBe(true);
    const narrower=await f.propose('local.md',raw('local','Repository copy of the fact.','semantic',{type:'repository',id:'repo-a'}),null,{sources:[pin(note)]});await f.review(narrower,'accept',true);
    expect((await f.propose(note.path,null,note.after!.hash)).humanRequired).toBe(true);

    const retired=await accepted(f,'retired.md',archived(raw('retired','Use the old deploy script.','procedural')));
    const restored=await f.propose(retired.path,raw('retired','Use the old deploy script.','procedural'),retired.after!.hash);
    expect(restored.humanRequired).toBe(true);
    const kind=await accepted(f,'kind.md',raw('kind','Run tests before pushing.'));
    expect((await f.propose(kind.path,raw('kind','Run tests before pushing.','procedural'),kind.after!.hash)).humanRequired).toBe(true);
    const reviewed=await accepted(f,'reviewed.md',raw('reviewed','Run the reviewed deploy.','procedural'));
    const replacement=await f.propose('reviewed-v2.md',raw('reviewed-v2','Run an unchecked deploy.','procedural'));await f.review(replacement);
    expect((await f.propose(reviewed.path,archived(reviewed.after!.raw),reviewed.after!.hash)).humanRequired).toBe(true);
  });
  it('keeps outside edits in front of a person when an agent proposes over them', async () => {
    const f=await fixture();
    const fact=await accepted(f,'fact.md',raw('fact','A reviewed fact.'));
    const summary=await f.propose('summary.md',raw('summary','Summary of the fact.'),null,{sources:[pin(fact)]});await f.review(summary);
    const edited=raw('fact','A reviewed fact. A note only the person added.');
    await fs.writeFile(path.join(f.bundle,'fact.md'),edited);
    for (let attempt=0;attempt<2;attempt++) await expect(f.propose('fact.md',null,hash(edited))).rejects.toMatchObject({code:'HUMAN_DECISION_PENDING'});
    const outside=(await run(f.store.listChanges('memory','pending'))).changes.find(item=>item.path==='fact.md')!;
    expect(outside.after?.raw).toBe(edited);
    const procedure=await accepted(f,'procedure.md',raw('procedure','Run the checked command.','procedural'));
    const changed=raw('procedure','Run the checked command twice.','procedural');
    await fs.writeFile(path.join(f.bundle,'procedure.md'),changed);
    await expect(f.propose('procedure.md',procedure.after!.raw,hash(changed))).rejects.toMatchObject({code:'HUMAN_DECISION_PENDING'});
    await f.review(outside,'accept',true);
    const removal=await f.propose('fact.md',null,hash(edited));expect(removal.humanRequired).toBe(true);
  });
  it('rechecks a routine removal at review and lets a pending removal be proposed again under current rules', async () => {
    const f=await fixture();
    const episode=await accepted(f,'episode.md',raw('episode','The deploy needed a retry.','episodic'));
    const early=await f.propose(episode.path,null,episode.after!.hash);expect(early.humanRequired).toBe(true);
    const summary=await f.propose('summary.md',raw('summary','Deploys can need a retry.'),null,{sources:[pin(episode)]});await f.review(summary);
    const again=await f.propose(episode.path,null,null);
    expect(again.humanRequired).toBe(false);expect((await run(f.store.readChange('memory',early.id))).status).toBe('superseded');
    const retire=await f.propose(summary.path,archived(summary.after!.raw),summary.after!.hash,{sources:summary.sources});await f.review(retire);
    await expect(f.review(again)).rejects.toMatchObject({code:'HUMAN_REVIEW_REQUIRED'});
    await f.review(again,'accept',true);
  });
});
