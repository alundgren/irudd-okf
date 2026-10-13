import { afterEach, describe, expect, it } from 'vite-plus/test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Effect } from 'effect';
import { createStore, contentDigest, initializeBundle, type MemoryContext, type StoreOptions, type MemoryKind, type MaintenanceProposal, type MemoryPolicy } from '../src/index.ts';
import { DEFAULT_MEMORY_POLICY, policyRaw, patchMetadata, isMemoryPolicyPath } from '../src/memory.ts';
import { hash, requireCanonicalComponent } from '../src/files.ts';
import { previewDigest } from '../src/maintenance.ts';
import { decode, TemplateSchema } from '../src/schemas.ts';

const roots: string[] = [];
const run = Effect.runPromise;
const at = '2026-10-01T00:00:00.000Z';
async function fixture(options: StoreOptions = {}, personal = false) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'okf-memory-'))); roots.push(root);
  const bundle = path.join(root, '.okf'); await fs.mkdir(bundle);
  const context: MemoryContext = { version: 1, cwd: root, gitRoot: null, configPath: path.join(root, 'config.json'), bundles: [{ name: 'repo', root: bundle, kind: personal ? 'personal' : 'repository', writable: true }] };
  const store = createStore(context, { now: () => new Date(at), ...options });
  const write = async (file: string, raw: string) => { await fs.mkdir(path.dirname(path.join(bundle, file)), { recursive: true }); await fs.writeFile(path.join(bundle, file), raw); };
  const policy = { ...DEFAULT_MEMORY_POLICY, namespaces: ['shared', 'backend', 'frontend'] };
  await write('memory-policy.md', policyRaw(policy));
  await write('index.md', '---\nokf_version: "0.2"\n---\n\n# Knowledge\n\n[policy](memory-policy.md)\n');
  const note = async (file: string, namespace?: string, kind: MemoryKind = 'semantic', fields: Array<{path: string[]; value: unknown}> = []) => {
    const template = await run(store.template({ bundle: 'repo', kind, namespace, title: 'Memory ' + file, description: 'Relevant recall evidence', tags: ['testing'], actor: 'agent:writer', at, sources: ['https://example.org/evidence'] }));
    await write(file, fields.length ? patchMetadata(template.raw, fields) : template.raw);
    return run(store.read('repo', file));
  };
  return {root, bundle, store, context, write, note, policy};
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

const proposal = (changes: MaintenanceProposal['changes'], purpose: MaintenanceProposal['purpose'] = 'maintenance', extra: Partial<MaintenanceProposal> = {}): MaintenanceProposal => ({ version: 1, bundle: 'repo', purpose, changes, reason: 'Maintain attributable memory.', ...extra });

describe('memory profile and namespace retrieval', () => {
  it('activates only a valid canonical policy and keeps generic/raw files readable', async () => {
    const f = await fixture();
    expect(await run(f.store.profile('repo'))).toMatchObject({ mode: 'memory', policy: { version: 1 } });
    expect((await run(f.store.bootstrap('repo'))).raw).toContain('regardless of selected namespace');
    await fs.unlink(path.join(f.bundle, 'memory-policy.md'));
    await f.write('other-policy.md', policyRaw());
    expect((await run(f.store.profile('repo'))).mode).toBe('generic');
    expect((await run(f.store.bootstrap('repo'))).path).toBe('index.md');
    expect((await run(f.store.validate({ lint: true }))).diagnostics.some(item => item.code === 'EXTRA_MEMORY_POLICY')).toBe(true);
    await f.write('memory-policy.md', policyRaw().replace('version: 1', 'version: 99'));
    await expect(run(f.store.search('anything'))).rejects.toMatchObject({ code: 'INVALID_MEMORY_POLICY' });
    await expect(run(f.store.namespaces('repo'))).rejects.toMatchObject({ code: 'INVALID_MEMORY_POLICY' });
    expect((await run(f.store.read('repo', 'memory-policy.md'))).raw).toContain('version: 99');
    expect((await run(f.store.audit())).diagnostics.some(item => item.code === 'INVALID_MEMORY_POLICY')).toBe(true);
  });
  it('initializes with portable policy and root route without changing existing files', async () => {
    const f = await fixture(); const other = path.join(f.root, 'new');
    await run(initializeBundle(other));
    expect(await fs.readFile(path.join(other, 'index.md'), 'utf8')).toContain('(memory-policy.md)');
    expect(await fs.readFile(path.join(other, 'memory-policy.md'), 'utf8')).toContain('name: agent-memory');
    expect(await fs.readFile(path.join(other, '.gitignore'), 'utf8')).toBe('.irudd-okf/\n');
    const before = await fs.readFile(path.join(other, 'memory-policy.md'), 'utf8');
    await expect(run(initializeBundle(other))).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    expect(await fs.readFile(path.join(other, 'memory-policy.md'), 'utf8')).toBe(before);
  });
  it('selects OR namespaces plus relevant shared notes before counts and pagination in every recall API', async () => {
    const f = await fixture();
    await f.note('a-shared.md'); await f.note('b-backend.md', 'backend'); await f.note('c-frontend.md', 'frontend');
    await f.note('d-unrelated.md', undefined, 'semantic', [{path: ['description'], value: 'Elsewhere'}, {path: ['title'], value: 'Elsewhere'}]);
    await f.write('index.md', '# Knowledge\n[backend](b-backend.md)\n[frontend](c-frontend.md)\n');
    const result = await run(f.store.search('Relevant', { namespaces: ['backend'], limit: 1, offset: 1 }));
    expect(result.total).toBe(2); expect(result.results[0].path).toBe('b-backend.md');
    expect((await run(f.store.search('Relevant', { namespaces: ['backend', 'frontend'] }))).total).toBe(3);
    expect((await run(f.store.search('Relevant'))).total).toBe(3);
    expect((await run(f.store.list('repo', { namespaces: ['backend'] }))).map(item => item.path)).not.toContain('c-frontend.md');
    expect((await run(f.store.index('repo', '', { namespaces: ['backend'] }))).body).not.toContain('c-frontend.md');
    expect((await run(f.store.graph({ namespaces: ['backend'] }))).nodes.map(item => item.path)).not.toContain('c-frontend.md');
    await expect(run(f.store.search('Relevant', { namespaces: ['backned'] }))).rejects.toMatchObject({ code: 'UNKNOWN_NAMESPACE' });
  });
  it('validates requested namespaces against the union of selected bundle registries', async () => {
    const f = await fixture(); await f.note('backend.md', 'backend');
    const personal = path.join(f.root, 'personal'); await fs.mkdir(personal);
    await fs.writeFile(path.join(personal, 'memory-policy.md'), policyRaw());
    await fs.writeFile(path.join(personal, 'shared.md'), (await run(f.store.template({bundle:'repo',kind:'semantic',title:'Personal shared',description:'Relevant shared rule',tags:['testing'],actor:'agent:writer',at}))).raw);
    const generic = path.join(f.root, 'generic'); await fs.mkdir(generic); await fs.writeFile(path.join(generic,'legacy.md'),'---\ntype: Rule\ntitle: Relevant legacy\n---\nRelevant\n');
    const store = createStore({...f.context,bundles:[...f.context.bundles,{name:'personal',root:personal,kind:'personal',writable:true},{name:'legacy',root:generic,kind:'explicit',writable:true}]});
    const result = await run(store.search('Relevant',{namespaces:['backend']}));
    expect(result.results.map(item=>item.bundle).sort()).toEqual(['legacy','personal','repo']);
    expect((await run(store.audit({namespaces:['backend']}))).concepts.some(item=>item.bundle==='personal' && item.path==='shared.md')).toBe(true);
    await expect(run(store.search('Relevant',{bundle:'personal',namespaces:['backend']}))).rejects.toMatchObject({code:'UNKNOWN_NAMESPACE'});
  });
  it('keeps write destination independent of retrieval and rejects conflicts, lists and unknown names', async () => {
    const f = await fixture(); const note = await f.note('shared.md');
    await run(f.store.search('Relevant', {namespaces:['backend']}));
    expect((await run(f.store.read('repo','shared.md'))).memory?.namespace).toBe('shared');
    const raw = patchMetadata(note.raw,[{path:['memory','namespace'],value:'frontend'}]);
    await expect(run(f.store.save({bundle:'repo',path:'x.md',raw,namespace:'backend',expectedHash:null}))).rejects.toMatchObject({code:'NAMESPACE_CONFLICT'});
    await expect(run(f.store.save({bundle:'repo',path:'x.md',raw:note.raw,namespace:'typo',expectedHash:null}))).rejects.toMatchObject({code:'UNKNOWN_NAMESPACE'});
    await expect(run(f.store.save({bundle:'repo',path:'x.md',raw:patchMetadata(note.raw,[{path:['memory','namespace'],value:['backend','frontend']}]),expectedHash:null}))).rejects.toMatchObject({code:'UNKNOWN_NAMESPACE'});
    await run(f.store.save({bundle:'repo',path:'backend.md',raw:note.raw,namespace:'backend',expectedHash:null}));
    expect((await run(f.store.read('repo','backend.md'))).memory?.namespace).toBe('backend');
    await f.write('typo.md',patchMetadata(note.raw,[{path:['memory','namespace'],value:'typo'}]));
    expect((await run(f.store.search('Relevant'))).results.some(item=>item.path==='typo.md')).toBe(false);
    expect((await run(f.store.validate({lint:true}))).diagnostics.some(item=>item.code==='UNKNOWN_NAMESPACE')).toBe(true);
  });
});

describe('current revision review, verification and lifecycle', () => {
  it('binds decisions and checks to canonical content independently of producer, stage and bookkeeping', async () => {
    const f=await fixture(); let note=await f.note('rule.md',undefined,'procedural');
    const originalDigest=contentDigest(note);
    await run(f.store.verify({bundle:'repo',path:note.path,expectedHash:note.hash,actor:'agent:checker',method:'Unit tests',at}));
    note=await run(f.store.read('repo',note.path));
    expect(contentDigest(note)).toBe(originalDigest); expect(note.memory).toMatchObject({review:'pending',verified:true,machineVerified:true,humanReviewed:false,trustTier:'machine-confirmed'});
    await run(f.store.review({bundle:'repo',path:note.path,expectedHash:note.hash,actor:'agent:reviewer',decision:'approve',reason:'Evidence checked',at}));
    note=await run(f.store.read('repo',note.path));
    expect(note.memory).toMatchObject({review:'approved',humanReviewed:false,trustTier:'machine-confirmed'});
    await expect(run(f.store.review({bundle:'repo',path:note.path,expectedHash:note.hash,actor:'human:ada',decision:'approve',reason:'Checked',at}))).rejects.toMatchObject({code:'HUMAN_REVIEW_AUTHORIZATION'});
    await run(f.store.review({bundle:'repo',path:note.path,expectedHash:note.hash,actor:'human:ada',operator:true,decision:'approve',reason:'Evidence checked',at}));
    note=await run(f.store.read('repo',note.path));
    expect(note.memory).toMatchObject({review:'approved',humanReviewed:true,machineVerified:true,trustTier:'human-reviewed',stage:'bronze'});
    expect(contentDigest(note)).toBe(originalDigest);
    expect(contentDigest({...note,metadata:{...note.metadata,generated:{by:'another-producer',at}}})).not.toBe(originalDigest);
    await run(f.store.save({bundle:'repo',path:note.path,expectedHash:note.hash,raw:note.raw+'Meaningful change.\n'}));
    note=await run(f.store.read('repo',note.path));
    expect(note.memory).toMatchObject({review:'pending',verified:false,humanReviewed:false,machineVerified:false});
    expect(note.memory?.reviewEvents).toHaveLength(2); expect(note.memory?.historicalVerificationEvents).toHaveLength(1);
    await expect(run(f.store.verify({bundle:'repo',path:note.path,expectedHash:note.hash,actor:'human:ada',method:'Human checked',at}))).rejects.toMatchObject({code:'HUMAN_REVIEW_AUTHORIZATION'});
    const noOp=await run(f.store.save({bundle:'repo',path:note.path,expectedHash:note.hash,raw:note.raw})); expect(noOp.changedPaths).toEqual([]);
  });
  it('keeps legacy unbound verification advisory and metadata reordering digest-stable', async () => {
    const f=await fixture(); let note=await f.note('legacy.md',undefined,'semantic',[{path:['verified'],value:[{by:'human:ada',at}]}]);
    expect(note.memory).toMatchObject({verified:false,trustTier:'unverified',humanReviewed:false});
    expect(note.memory?.historicalVerificationEvents).toEqual([{by:'human:ada',at}]);
    const reversed=Object.fromEntries(Object.entries(note.metadata).reverse());
    expect(contentDigest({...note,metadata:reversed})).toBe(contentDigest(note));
    expect(contentDigest({...note,metadata:{...note.metadata,status:'deprecated'}})).not.toBe(contentDigest(note));
  });
  it('excludes current rejected notes from recall and retains exact read/audit and review history', async () => {
    const f=await fixture(); let note=await f.note('episode.md',undefined,'episodic');
    await run(f.store.review({bundle:'repo',path:note.path,expectedHash:note.hash,actor:'agent:reviewer',decision:'reject',reason:'Counterexample disproves this claim',at}));
    note=await run(f.store.read('repo',note.path)); expect(note.memory?.review).toBe('rejected');
    expect((await run(f.store.search('Relevant'))).total).toBe(0);
    expect((await run(f.store.list())).some(item=>item.path===note.path)).toBe(false);
    expect((await run(f.store.graph())).nodes.some(item=>item.path===note.path)).toBe(false);
    expect((await run(f.store.audit())).concepts.find(item=>item.path===note.path)?.memory?.review).toBe('rejected');
    await run(f.store.review({bundle:'repo',path:note.path,expectedHash:note.hash,actor:'human:ada',operator:true,decision:'approve',reason:'Correction and evidence accepted',at}));
    expect((await run(f.store.search('Relevant'))).total).toBe(1);
  });
  it('evaluates UTC expiration/recheck boundaries on every cached recall and reports invalid dates without losing raw files', async () => {
    let time=Date.parse(at); const f=await fixture({now:()=>new Date(time)});
    const note=await f.note('timed.md',undefined,'semantic',[{path:['stale_after'],value:'2026-10-02'},{path:['memory','expires_at'],value:'2026-10-03T00:00:00Z'}]);
    expect((await run(f.store.search('Relevant'))).results[0].memory?.freshness).toBe('current');
    time=Date.parse('2026-10-02T00:00:00Z'); expect((await run(f.store.search('Relevant'))).results[0].memory?.freshness).toBe('stale');
    time=Date.parse('2026-10-03T00:00:00Z'); expect((await run(f.store.search('Relevant'))).total).toBe(0);
    expect((await run(f.store.read('repo',note.path))).memory?.freshness).toBe('expired');
    expect((await run(f.store.search('Relevant',{includeExcluded:true}))).total).toBe(1);
    await f.write('invalid.md',patchMetadata(note.raw,[{path:['memory','expires_at'],value:'2026-02-31'}]));
    expect((await run(f.store.read('repo','invalid.md'))).raw).toContain('2026-02-31');
    expect((await run(f.store.audit())).diagnostics.some(item=>item.path==='invalid.md'&&item.code==='INVALID_MEMORY_DATE')).toBe(true);
  });
  it('manages task closure retention, historical overrides, expiration, archive and replacements as distinct actions', async () => {
    const f=await fixture(); let note=await f.note('task.md','backend','episodic');
    const task={reference:'task:local-123',state:'completed' as const,completed_at:at};
    await run(f.store.updateTask({bundle:'repo',path:note.path,expectedHash:note.hash,task}));
    note=await run(f.store.read('repo',note.path)); expect((note.metadata.memory as Record<string,unknown>).expires_at).toBe('2026-10-31T00:00:00.000Z');
    await run(f.store.updateTask({bundle:'repo',path:note.path,expectedHash:note.hash,task,retentionReason:'Keep failed-case history',retentionDays:2}));
    note=await run(f.store.read('repo',note.path)); expect((note.metadata.memory as Record<string,unknown>).expires_at).toBeUndefined();
    await run(f.store.updateTask({bundle:'repo',path:note.path,expectedHash:note.hash,task,retentionReason:null,retentionDays:null}));
    note=await run(f.store.read('repo',note.path)); expect((note.metadata.memory as Record<string,unknown>).expires_at).toBe('2026-10-31T00:00:00.000Z');
    await run(f.store.lifecycle({bundle:'repo',path:note.path,expectedHash:note.hash,action:'expire',at}));
    note=await run(f.store.read('repo',note.path)); expect(note.memory?.freshness).toBe('expired');
    await run(f.store.lifecycle({bundle:'repo',path:note.path,expectedHash:note.hash,action:'clear-expiration'}));
    note=await run(f.store.read('repo',note.path)); expect(note.memory?.freshness).toBe('current');
    await run(f.store.lifecycle({bundle:'repo',path:note.path,expectedHash:note.hash,action:'archive'}));
    note=await run(f.store.read('repo',note.path)); expect(note.memory?.archived).toBe(true);
    await run(f.store.lifecycle({bundle:'repo',path:note.path,expectedHash:note.hash,action:'restore'}));
    note=await run(f.store.read('repo',note.path)); expect(note.memory?.archived).toBe(false);
    await run(f.store.lifecycle({bundle:'repo',path:note.path,expectedHash:note.hash,action:'recheck',at:'2026-12-01'}));
    note=await run(f.store.read('repo',note.path)); expect(note.metadata.stale_after).toBe('2026-12-01');
    await expect(run(f.store.lifecycle({bundle:'repo',path:note.path,expectedHash:note.hash,action:'deprecate'}))).rejects.toMatchObject({code:'REPLACEMENT_REQUIRED'});
    await run(f.store.lifecycle({bundle:'repo',path:note.path,expectedHash:note.hash,action:'deprecate',replacement:'replacement.md'}));
    expect((await run(f.store.read('repo',note.path))).memory?.deprecated).toBe(true);
  });
});

describe('revision lineage and file links', () => {
  it('adds source graph/backlinks, repairs metadata references on rename and invalidates changed or rejected evidence', async () => {
    const f=await fixture(); let source=await f.note('source.md','backend','episodic');
    let derived=await f.note('derived.md','backend','semantic',[{path:['sources'],value:[{resource:'source.md',detail:'Observed failure'}]},{path:['memory','derived_from'],value:[{resource:'source.md',content_hash:contentDigest(source)}]}]);
    expect((await run(f.store.read('repo','source.md'))).backlinks.map(item=>item.path)).toEqual(['derived.md']);
    expect((await run(f.store.graph({namespaces:['backend']}))).edges.some(edge=>edge.label==='derived from'&&edge.to==='repo:source.md')).toBe(true);
    await run(f.store.rename({bundle:'repo',path:'source.md',newPath:'events/source.md',expectedHash:source.hash,updateLinks:true}));
    derived=await run(f.store.read('repo','derived.md'));
    expect(derived.raw).toContain('resource: events/source.md'); expect(derived.raw).toContain('detail: Observed failure');
    expect(derived.memory?.dependency).toBe('valid');
    source=await run(f.store.read('repo','events/source.md'));
    await run(f.store.lifecycle({bundle:'repo',path:source.path,expectedHash:source.hash,action:'expire',at}));
    // Expiration metadata is a meaningful source revision; a summary can explicitly retain that revision.
    source=await run(f.store.read('repo',source.path));
    await f.write('derived.md',patchMetadata(derived.raw,[{path:['memory','derived_from'],value:[{resource:'events/source.md',content_hash:contentDigest(source)}]}]));
    expect((await run(f.store.read('repo','derived.md'))).memory?.dependency).toBe('valid');
    await run(f.store.review({bundle:'repo',path:source.path,expectedHash:source.hash,actor:'agent:reviewer',decision:'reject',reason:'Disproved by counterexample',at}));
    expect((await run(f.store.read('repo','derived.md'))).memory?.dependency).toBe('rejected');
    expect((await run(f.store.search('Relevant'))).total).toBe(0);
  });
  it('propagates invalid evidence transitively and reports unavailable sources and cycles without unbounded traversal', async () => {
    const f=await fixture(); const a=await f.note('a.md',undefined,'episodic');
    const b=await f.note('b.md',undefined,'semantic',[{path:['memory','derived_from'],value:[{resource:'a.md',content_hash:contentDigest(a)}]}]);
    await f.note('c.md',undefined,'procedural',[{path:['memory','derived_from'],value:[{resource:'b.md',content_hash:contentDigest(b)}]}]);
    await f.write('a.md',a.raw+'Corrected observation.\n');
    expect((await run(f.store.read('repo','c.md'))).memory?.dependency).toBe('changed');
    await f.note('missing.md',undefined,'semantic',[{path:['memory','derived_from'],value:[{resource:'absent.md',content_hash:'a'.repeat(64)}]}]);
    expect((await run(f.store.read('repo','missing.md'))).memory?.dependency).toBe('unavailable');
    await f.note('x.md',undefined,'semantic',[{path:['memory','derived_from'],value:[{resource:'y.md',content_hash:'a'.repeat(64)}]}]);
    await f.note('y.md',undefined,'semantic',[{path:['memory','derived_from'],value:[{resource:'x.md',content_hash:'b'.repeat(64)}]}]);
    expect((await run(f.store.read('repo','x.md'))).memory?.dependency).toBe('cycle');
    expect((await run(f.store.read('repo','y.md'))).memory?.dependency).toBe('cycle');
  });
  it('does not invalidate historical evidence just because time moves past source recall expiration', async () => {
    let time=Date.parse(at); const f=await fixture({now:()=>new Date(time)});
    const source=await f.note('source.md',undefined,'episodic',[{path:['memory','expires_at'],value:'2026-10-02'}]);
    await f.note('fact.md',undefined,'semantic',[{path:['memory','derived_from'],value:[{resource:'source.md',content_hash:contentDigest(source)}]}]);
    time=Date.parse('2026-10-03T00:00:00Z');
    expect((await run(f.store.search('Relevant'))).results.map(item=>item.path)).toEqual(['fact.md']);
    expect((await run(f.store.read('repo','fact.md'))).memory?.dependency).toBe('valid');
  });
});

describe('safe maintenance and durable interruption recovery', () => {
  it('applies exact previews, preserves originals and reports unchanged second run', async () => {
    const f=await fixture(); const note=await f.note('note.md');
    const preview=await run(f.store.previewMaintenance(proposal([{path:note.path,expectedHash:note.hash,raw:note.raw+'Evidence corrected.\n'}])));
    expect(preview.guards.map(item=>item.path)).toEqual(['index.md','memory-policy.md','note.md']);
    const applied=await run(f.store.applyMaintenance({preview})); expect(applied.changedPaths).toEqual(['note.md']);
    const journal=await run(f.store.inspectMaintenance({bundle:'repo',previewHash:preview.previewHash}));
    expect(journal.state).toBe('applied'); expect(journal.paths[0].state).toBe('applied');
    expect(await fs.readFile(journal.paths[0].recoveryPath!,'utf8')).toBe(note.raw);
    const repeated=await run(f.store.applyMaintenance({preview})); expect(repeated).toMatchObject({state:'unchanged',changedPaths:[]});
    expect((await run(f.store.list())).some(item=>item.path.includes('.irudd-okf'))).toBe(false);
  });
  it('rejects a stale preview without modifying any document and persists conflict evidence', async () => {
    const f=await fixture(); const a=await f.note('a.md'); const b=await f.note('b.md');
    const preview=await run(f.store.previewMaintenance(proposal([{path:a.path,expectedHash:a.hash,raw:a.raw+'Changed a.\n'},{path:b.path,expectedHash:b.hash,raw:b.raw+'Changed b.\n'}])));
    await f.write('b.md',b.raw+'External edit.\n');
    await expect(run(f.store.applyMaintenance({preview}))).rejects.toMatchObject({code:'CONFLICT',details:{previewHash:preview.previewHash}});
    expect(await fs.readFile(path.join(f.bundle,'a.md'),'utf8')).toBe(a.raw);
    const journal=await run(f.store.inspectMaintenance({bundle:'repo',previewHash:preview.previewHash}));
    expect(journal.state).toBe('conflict'); expect(journal.paths.map(item=>item.state)).toEqual(['untouched','externally-changed']);
    expect(await fs.readFile(journal.journalPath,'utf8')).toContain('actualHash');
  });
  it('detects a newly created backlink after preview through the complete inventory', async () => {
    const f=await fixture(); const source=await f.note('source.md');
    const preview=await run(f.store.previewMaintenance(proposal([{path:source.path,expectedHash:source.hash,raw:null}])));
    await f.write('new-backlink.md','---\ntype: Rule\n---\n[Evidence](source.md)\n');
    await expect(run(f.store.applyMaintenance({preview}))).rejects.toMatchObject({code:'CONFLICT'});
    expect(await fs.readFile(path.join(f.bundle,source.path),'utf8')).toBe(source.raw);
  });
  it('protects source/backlinks on purge and requires explicit repairs', async () => {
    const f=await fixture(); const source=await f.note('source.md');
    await f.write('index.md','# Knowledge\n[source](source.md)\n[policy](memory-policy.md)\n');
    const index=await run(f.store.read('repo','index.md'));
    await expect(run(f.store.remove({bundle:'repo',path:source.path,expectedHash:source.hash}))).rejects.toMatchObject({code:'PROTECTED_EVIDENCE_LINK'});
    const protectedPreview=await run(f.store.previewMaintenance(proposal([{path:source.path,expectedHash:source.hash,raw:null}])));
    expect(protectedPreview.diagnostics.some(item=>item.code==='PROTECTED_EVIDENCE_LINK')).toBe(true);
    await expect(run(f.store.applyMaintenance({preview:protectedPreview}))).rejects.toMatchObject({code:'UNRESOLVED_PROPOSAL'});
    const repaired=await run(f.store.previewMaintenance(proposal([{path:source.path,expectedHash:source.hash,raw:null},{path:index.path,expectedHash:index.hash,raw:'# Knowledge\n[policy](memory-policy.md)\n'}])));
    expect(repaired.diagnostics).toEqual([]); await run(f.store.applyMaintenance({preview:repaired}));
    await expect(run(f.store.read('repo','source.md'))).rejects.toMatchObject({code:'NOT_FOUND'});
  });
  it('resumes after one journaled file in a fresh store and skips bytes already published', async () => {
    const f=await fixture({afterJournalWrite:async completed=>{if(completed===1) throw new Error('Injected interruption');}});
    const a=await f.note('a.md'); const b=await f.note('b.md');
    const preview=await run(f.store.previewMaintenance(proposal([{path:a.path,expectedHash:a.hash,raw:a.raw+'New a.\n'},{path:b.path,expectedHash:b.hash,raw:b.raw+'New b.\n'}])));
    await expect(run(f.store.applyMaintenance({preview}))).rejects.toMatchObject({code:'INTERRUPTED',details:{previewHash:preview.previewHash}});
    const restarted=createStore(f.context,{now:()=>new Date(at)});
    expect((await run(restarted.inspectMaintenance({bundle:'repo',previewHash:preview.previewHash}))).paths.map(item=>item.state)).toEqual(['applied','untouched']);
    const result=await run(restarted.applyMaintenance({preview})); expect(result.changedPaths).toEqual(['b.md']);
    expect((await run(restarted.applyMaintenance({preview}))).state).toBe('unchanged');
  });
  it('never overwrites external edits during recovery and preserves durable per-path conflict state', async () => {
    const f=await fixture({afterJournalWrite:async completed=>{if(completed===1) throw new Error('Injected interruption');}});
    const a=await f.note('a.md'); const b=await f.note('b.md');
    const preview=await run(f.store.previewMaintenance(proposal([{path:a.path,expectedHash:a.hash,raw:a.raw+'New a.\n'},{path:b.path,expectedHash:b.hash,raw:b.raw+'New b.\n'}])));
    await expect(run(f.store.applyMaintenance({preview}))).rejects.toMatchObject({code:'INTERRUPTED'});
    const external=a.raw+'External correction.\n'; await f.write('a.md',external);
    const restarted=createStore(f.context,{now:()=>new Date(at)});
    await expect(run(restarted.applyMaintenance({preview}))).rejects.toMatchObject({code:'CONFLICT',details:{paths:[expect.objectContaining({path:'a.md',state:'externally-changed'}),expect.objectContaining({path:'b.md',state:'untouched'})]}});
    expect(await fs.readFile(path.join(f.bundle,'a.md'),'utf8')).toBe(external);
    expect(await fs.readFile(path.join(f.bundle,'b.md'),'utf8')).toBe(b.raw);
    const journal=await run(restarted.inspectMaintenance({bundle:'repo',previewHash:preview.previewHash})); expect(journal.state).toBe('conflict');
    const content=JSON.parse(await fs.readFile(journal.journalPath,'utf8'));
    expect(await fs.readFile(content.conflicts[0].recoveryPath,'utf8')).toBe(external);
  });
  it('rolls back only current-attempt writes when a later destination changes during apply', async () => {
    let edited=false;
    const f=await fixture({afterJournalWrite:async completed=>{if(completed===1&&!edited){edited=true;await f.write('b.md','---\ntype: Rule\n---\nExternal\n');}}});
    const a=await f.note('a.md'); const b=await f.note('b.md');
    const preview=await run(f.store.previewMaintenance(proposal([{path:a.path,expectedHash:a.hash,raw:a.raw+'New a.\n'},{path:b.path,expectedHash:b.hash,raw:b.raw+'New b.\n'}])));
    await expect(run(f.store.applyMaintenance({preview}))).rejects.toMatchObject({code:'CONFLICT'});
    expect(await fs.readFile(path.join(f.bundle,'a.md'),'utf8')).toBe(a.raw);
    expect(await fs.readFile(path.join(f.bundle,'b.md'),'utf8')).toContain('External');
  });
  it('rejects an initial new destination even if external bytes equal the proposed content', async () => {
    const f=await fixture(); const existing=await f.note('source.md');
    const preview=await run(f.store.previewMaintenance(proposal([{path:'new.md',expectedHash:null,raw:existing.raw}])));
    await f.write('new.md',existing.raw);
    await expect(run(f.store.applyMaintenance({preview}))).rejects.toMatchObject({code:'CONFLICT'});
    expect(await fs.readFile(path.join(f.bundle,'new.md'),'utf8')).toBe(existing.raw);
  });
  it('requires separate lineage-backed consolidation and explicit cross-namespace publication', async () => {
    const f=await fixture(); const source=await f.note('episode.md','backend','episodic');
    const durable=(await run(f.store.template({bundle:'repo',kind:'semantic',stage:'silver',title:'Durable fact',description:'Source-backed observation',tags:['testing'],actor:'agent:librarian',at,sources:[{resource:'episode.md'}]}))).raw;
    const raw=patchMetadata(durable,[{path:['memory','derived_from'],value:[{resource:'episode.md',content_hash:contentDigest(source)}]}]);
    const cross=await run(f.store.previewMaintenance(proposal([{path:'fact.md',expectedHash:null,raw}],'consolidation')));
    expect(cross.diagnostics.some(item=>item.code==='NAMESPACE_PROMOTION_REQUIRED')).toBe(true);
    const reviewed=await run(f.store.previewMaintenance(proposal([{path:'fact.md',expectedHash:null,raw}],'consolidation',{allowNamespaceChange:true})));
    expect(reviewed.diagnostics).toEqual([]); await run(f.store.applyMaintenance({preview:reviewed}));
    expect((await run(f.store.read('repo','episode.md'))).memory?.kind).toBe('episodic');
    expect((await run(f.store.read('repo','fact.md'))).memory).toMatchObject({kind:'semantic',stage:'silver',review:'pending',dependency:'valid'});
    const wrong=await run(f.store.previewMaintenance(proposal([{path:source.path,expectedHash:source.hash,raw:patchMetadata(source.raw,[{path:['memory','kind'],value:'semantic'}])}],'consolidation')));
    expect(wrong.diagnostics.some(item=>item.code==='SOURCE_RECLASSIFICATION')).toBe(true);
  });
});

describe('migration preservation and domain request validation', () => {
  it('recognizes canonical policy case aliases on Windows and macOS while preserving Linux filenames', () => {
    expect(isMemoryPolicyPath('MEMORY-POLICY.md','win32')).toBe(true);
    expect(isMemoryPolicyPath('MEMORY-POLICY.md','darwin')).toBe(true);
    expect(isMemoryPolicyPath('MEMORY-POLICY.md','linux')).toBe(false);
    expect(isMemoryPolicyPath('topics/MEMORY-POLICY.md','win32')).toBe(false);
    expect(isMemoryPolicyPath('memory-policy.md','linux')).toBe(true);
    expect(() => requireCanonicalComponent('C:\\bundle\\memory~1.md','C:\\bundle\\memory-policy.md','win32')).toThrow();
    expect(() => requireCanonicalComponent('C:\\bundle\\MEMORY-POLICY.md','C:\\bundle\\memory-policy.md','win32')).not.toThrow();
  });
  it.skipIf(!['win32','darwin'].includes(process.platform))('protects the initialized policy through filesystem case aliases', async () => {
    const f=await fixture(); const policy=await run(f.store.read('repo','memory-policy.md'));
    let resolvesAlias=true;
    try { await fs.access(path.join(f.bundle,'MEMORY-POLICY.md')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; resolvesAlias=false; }
    const request={bundle:'repo',path:'MEMORY-POLICY.md',newPath:'ordinary.md',expectedHash:policy.hash,updateLinks:true};
    if (resolvesAlias) for (const effect of [f.store.previewRename(request),f.store.rename(request),f.store.remove({bundle:'repo',path:request.path,expectedHash:policy.hash}),f.store.previewMaintenance(proposal([{path:request.path,expectedHash:policy.hash,raw:null}]))]) await expect(run(effect as Effect.Effect<unknown,unknown>)).rejects.toMatchObject({code:'MEMORY_POLICY_PROTECTED'});
    expect((await run(f.store.profile('repo'))).mode).toBe('memory');
    expect(await fs.readFile(path.join(f.bundle,'memory-policy.md'),'utf8')).toBe(policy.raw);
    await fs.rename(path.join(f.bundle,'memory-policy.md'),path.join(f.bundle,'MEMORY-POLICY.md'));
    const bootstrap=await run(f.store.bootstrap('repo'));
    expect(bootstrap.path).toBe('MEMORY-POLICY.md'); expect(bootstrap.raw).toBe(policy.raw);
  });
  it.skipIf(process.platform !== 'win32')('rejects a native short policy alias when the volume provides one', async () => {
    const f=await fixture(); const policy=await run(f.store.read('repo','memory-policy.md'));
    const script=`Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class PolicyShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder output, uint size); }'; $output = New-Object System.Text.StringBuilder 4096; $length = [PolicyShortPath]::GetShortPathName($env:OKF_POLICY_TEST_FILE, $output, 4096); if ($length -gt 0) { $output.ToString() }`;
    const short=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',env:{...process.env,OKF_POLICY_TEST_FILE:path.join(f.bundle,'memory-policy.md')}}).trim();
    const alias=path.win32.basename(short).toLowerCase();
    if (!alias || alias==='memory-policy.md') { console.info('Native short policy alias unavailable on this volume.'); return; }
    const request={bundle:'repo',path:alias,newPath:'ordinary.md',expectedHash:policy.hash,updateLinks:true};
    await expect(run(f.store.previewRename(request))).rejects.toMatchObject({code:'UNSAFE_PATH'});
    await expect(run(f.store.rename(request))).rejects.toMatchObject({code:'UNSAFE_PATH'});
    expect(await fs.readFile(path.join(f.bundle,'memory-policy.md'),'utf8')).toBe(policy.raw);
  });
  it('emits unresolved decisions without fabricating classification, producer or evidence and preserves raw malformed/unknown YAML', async () => {
    const f=await fixture(); await fs.unlink(path.join(f.bundle,'memory-policy.md'));
    const legacy='---\ntype: Rule # retain comment\ncustom: { field: original }\n---\nDo the work.\n'; await f.write('legacy.md',legacy);
    const malformed='---\ntype: [unfinished\n---\nRaw recovery\n'; await f.write('malformed.md',malformed);
    const preview=await run(f.store.previewMigration({bundle:'repo'}));
    expect(preview.unresolved.map(item=>item.field)).toContain('kind'); expect(preview.unresolved.map(item=>item.field)).toContain('frontmatter');
    expect(preview.changes.some(item=>item.path==='legacy.md')).toBe(false);
    await expect(run(f.store.applyMigration({preview}))).rejects.toMatchObject({code:'UNRESOLVED_PROPOSAL'});
    expect(await fs.readFile(path.join(f.bundle,'legacy.md'),'utf8')).toBe(legacy);
    expect(await fs.readFile(path.join(f.bundle,'malformed.md'),'utf8')).toBe(malformed);
    const fixed=(await run(createStore({...f.context,bundles:f.context.bundles}).bootstrap('repo'))).path; expect(fixed).toBe('index.md');
  });
  it('migrates full typed decisions with task, expiry, prerequisites, replacement and derivation metadata preserving unknown fields/comments', async () => {
    const f=await fixture(); const source=await f.note('source.md');
    const legacy='---\ntype: Episode # keep comment\ncustom: { field: original }\n---\nObserved failure.\n'; await f.write('legacy.md',legacy);
    await f.write('index.md','# Knowledge\n[legacy](legacy.md)\n[source](source.md)\n[policy](memory-policy.md)\n');
    const preview=await run(f.store.previewMigration({bundle:'repo',decisions:{'legacy.md':{kind:'episodic',stage:'silver',actor:'agent:writer',at,title:'Failure episode',description:'Task failure observation',tags:['failures'],status:'draft',sources:[{resource:'source.md',detail:'Attribution kept'}],occurredAt:'2026-09-30T23:00:00+02:00',task:{reference:'task:local',state:'completed',completed_at:at},retentionReason:'Historical failed case',expiresAt:'2026-12-01',staleAfter:'2026-11-01',prerequisites:['source.md'],replaces:['source.md'],replacedBy:'source.md',derivedFrom:[{resource:'source.md',content_hash:contentDigest(source)}]}}}));
    expect(preview.unresolved).toEqual([]); expect(preview.diagnostics).toEqual([]);
    await run(f.store.applyMigration({preview}));
    const note=await run(f.store.read('repo','legacy.md'));
    expect(note.raw).toContain('# keep comment'); expect(note.metadata.custom).toEqual({field:'original'});
    expect(note.metadata.stale_after).toBe('2026-11-01');
    expect(note.metadata.memory).toMatchObject({kind:'episodic',stage:'silver',expires_at:'2026-12-01',retention_reason:'Historical failed case',task:{reference:'task:local',state:'completed'},replaced_by:'source.md',prerequisites:['source.md'],derived_from:[{resource:'source.md',content_hash:contentDigest(source)}]});
    expect((note.metadata.sources as Array<Record<string,unknown>>)[0].detail).toBe('Attribution kept');
    expect((await run(f.store.applyMigration({preview}))).state).toBe('unchanged');
    const second=await run(f.store.previewMigration({bundle:'repo'})); expect(second.changes).toEqual([]); expect(second.unresolved).toEqual([]);
  });
  it('requires personal authorization for all mutations including journal apply', async () => {
    const f=await fixture({},true); const note=await f.note('personal.md');
    await expect(run(f.store.review({bundle:'repo',path:note.path,expectedHash:note.hash,actor:'agent:reviewer',decision:'approve',reason:'Checked'}))).rejects.toMatchObject({code:'PERSONAL_AUTHORIZATION'});
    const preview=await run(f.store.previewMaintenance(proposal([{path:note.path,expectedHash:note.hash,raw:note.raw+'Authorized correction.\n'}])));
    await expect(run(f.store.applyMaintenance({preview}))).rejects.toMatchObject({code:'PERSONAL_AUTHORIZATION'});
    await run(f.store.applyMaintenance({preview,authorizePersonal:true}));
  });
  it('validates untrusted nested requests and edited preview payloads in core', async () => {
    const f=await fixture(); const note=await f.note('note.md');
    for (const effect of [f.store.template({bundle:'repo',kind:'invalid'} as never),f.store.review({bundle:'repo',decision:'maybe'} as never),f.store.verify({actor:123} as never),f.store.updateTask({task:{state:'closed'}} as never),f.store.lifecycle({action:'purge'} as never),f.store.previewMaintenance({changes:[]} as never),f.store.applyMaintenance({preview:{}} as never),f.store.previewMigration({bundle:'repo',decisions:{'note.md':{task:{state:'bogus'}}}} as never),f.store.inspectMaintenance({bundle:'repo',previewHash:'invalid'})]) await expect(run(effect as Effect.Effect<unknown, unknown>)).rejects.toMatchObject({code:'INVALID_REQUEST'});
    const preview=await run(f.store.previewMaintenance(proposal([{path:note.path,expectedHash:note.hash,raw:note.raw+'Changed.\n'}])));
    preview.changes[0].raw='Unexpected payload';
    await expect(run(f.store.applyMaintenance({preview}))).rejects.toMatchObject({code:'INVALID_PREVIEW'});
    expect((await run(f.store.read('repo',note.path))).raw).toBe(note.raw);
  });
  it('rejects unsupported proposal controls rather than silently ignoring them', async () => {
    const f=await fixture(); const note=await f.note('note.md');
    const change={path:note.path,expectedHash:note.hash,raw:note.raw+'Proposed correction.\n'};
    await expect(run(f.store.previewMaintenance({...proposal([change]),unresolvedQuestions:['Missing outcome']} as never))).rejects.toMatchObject({code:'INVALID_REQUEST'});
    await expect(run(f.store.previewMaintenance(proposal([{...change,namespace:'shared'} as never])))).rejects.toMatchObject({code:'INVALID_REQUEST'});
    await expect(run(f.store.previewMigration({bundle:'repo',decisions:{'note.md':{kind:'semantic',unresolvedQuestions:['Missing outcome']} as never}}))).rejects.toMatchObject({code:'INVALID_REQUEST'});
    expect((await run(f.store.read('repo',note.path))).raw).toBe(note.raw);
  });
  it('uses numeric-offset timestamp boundaries and diagnoses contradictory review identity', async () => {
    let time=Date.parse('2026-10-01T21:59:59Z');const f=await fixture({now:()=>new Date(time)});
    let note=await f.note('offset.md',undefined,'semantic',[{path:['generated','at'],value:'2026-10-02T00:00:00+02:00'},{path:['memory','expires_at'],value:'2026-10-02T00:00:00+02:00'}]);
    expect(note.memory?.freshness).toBe('current');
    time=Date.parse('2026-10-01T22:00:00Z'); expect((await run(f.store.read('repo',note.path))).memory?.freshness).toBe('expired');
    note=await run(f.store.read('repo',note.path));
    await f.write('offset.md',patchMetadata(note.raw,[{path:['memory','reviews'],value:[{actor_type:'human',by:'agent:librarian',at,decision:'approve',reason:'Contradictory actor',content_hash:contentDigest(note)}]}]));
    const inspected=await run(f.store.read('repo','offset.md'));expect(inspected.memory?.humanReviewed).toBe(false);expect(inspected.memory?.diagnostics.some(item=>item.code==='INVALID_REVIEW_EVENT')).toBe(true);
  });
  it('keeps stage independent of approval and lints the permitted gold review policy', async () => {
    const f=await fixture();let note=await f.note('gold.md',undefined,'semantic',[{path:['memory','stage'],value:'gold'}]);
    expect(note.memory?.diagnostics.some(item=>item.code==='GOLD_REVIEW_PENDING')).toBe(true);
    await run(f.store.review({bundle:'repo',path:note.path,expectedHash:note.hash,actor:'agent:reviewer',decision:'approve',reason:'Checked against source',at}));
    note=await run(f.store.read('repo',note.path));expect(note.memory?.stage).toBe('gold');expect(note.memory?.diagnostics.some(item=>item.code==='GOLD_REVIEW_PENDING')).toBe(false);
    await f.write('memory-policy.md',policyRaw({...f.policy,gold_review:'human'}));
    note=await run(f.store.read('repo',note.path));expect(note.memory?.diagnostics.some(item=>item.code==='GOLD_REVIEW_REQUIRED')).toBe(true);
    await run(f.store.review({bundle:'repo',path:note.path,expectedHash:note.hash,actor:'human:ada',operator:true,decision:'approve',reason:'Checked source and failures',at}));
    expect((await run(f.store.read('repo',note.path))).memory?.diagnostics.some(item=>item.code.startsWith('GOLD_REVIEW'))).toBe(false);
  });
});


describe('process termination and lock recovery', () => {
  it('recovers a killed writer after checking its stopped PID, then resumes journaled changes', async () => {
    const f=await fixture();const a=await f.note('a.md');const b=await f.note('b.md');
    const preview=await run(f.store.previewMaintenance(proposal([{path:a.path,expectedHash:a.hash,raw:a.raw+'New a.\n'},{path:b.path,expectedHash:b.hash,raw:b.raw+'New b.\n'}])));
    const script=path.join(f.root,'writer.mjs');
    const core=pathToFileURL(path.join(process.cwd(),'packages/core/src/index.ts')).href;
    const effect=pathToFileURL(path.join(process.cwd(),'node_modules/effect/dist/index.js')).href;
    await fs.writeFile(script, `import {createStore} from ${JSON.stringify(core)};\nimport {Effect} from ${JSON.stringify(effect)};\nconst store=createStore(${JSON.stringify(f.context)},{afterJournalWrite:async()=>process.kill(process.pid,'SIGKILL')});\nawait Effect.runPromise(store.applyMaintenance({preview:${JSON.stringify(preview)}}));\n`);
    const child=spawn(process.execPath,['--import','tsx',script],{cwd:process.cwd(),env:{...process.env,TSX_DISABLE_CACHE:'1'},stdio:['ignore','ignore','pipe']});
    let errorOutput='';child.stderr.on('data',chunk=>{errorOutput+=String(chunk);});
    const termination=await new Promise<{code:number|null;signal:string|null}>((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
    if (process.platform === 'win32') {
      expect(termination.signal,errorOutput).toBeNull();
      expect(termination.code,errorOutput).not.toBeNull();
      expect(termination.code,errorOutput).not.toBe(0);
    } else expect(termination.signal,errorOutput).toBe('SIGKILL');
    const restarted=createStore(f.context);
    const inspected=await run(restarted.inspectMaintenance({bundle:'repo',previewHash:preview.previewHash}));
    expect(inspected.paths.map(item=>item.state)).toEqual(['applied','untouched']);
    await expect(run(restarted.applyMaintenance({preview}))).rejects.toMatchObject({code:'LOCKED',details:{ownerPid:child.pid}});
    const recovered=await run(restarted.recoverMaintenance({bundle:'repo',previewHash:preview.previewHash}));
    expect(recovered.lockRecovered).toBe(true);expect(JSON.parse(await fs.readFile(recovered.lockRecoveryPath!,'utf8')).pid).toBe(child.pid);
    expect((await run(restarted.applyMaintenance({preview}))).changedPaths).toEqual(['b.md']);
    expect((await run(restarted.recoverMaintenance({bundle:'repo',previewHash:preview.previewHash}))).lockRecovered).toBe(false);
  });
  it('refuses live and unknown lock owners without deleting their files', async () => {
    const f=await fixture();const note=await f.note('note.md');
    const preview=await run(f.store.previewMaintenance(proposal([{path:note.path,expectedHash:note.hash,raw:note.raw+'New.\n'}])));
    await run(f.store.applyMaintenance({preview}));
    const lock=path.join(f.bundle,'.irudd-okf','write.lock');
    await fs.writeFile(lock,JSON.stringify({pid:process.pid,startedAt:at}));
    await expect(run(f.store.recoverMaintenance({bundle:'repo',previewHash:preview.previewHash}))).rejects.toMatchObject({code:'LOCK_OWNER_RUNNING'});
    expect(JSON.parse(await fs.readFile(lock,'utf8')).pid).toBe(process.pid);
    await fs.writeFile(lock,'unknown');
    await expect(run(f.store.recoverMaintenance({bundle:'repo',previewHash:preview.previewHash}))).rejects.toMatchObject({code:'LOCK_OWNER_UNKNOWN'});
    expect(await fs.readFile(lock,'utf8')).toBe('unknown');
  });
});

describe('portable authoring conventions', () => {
  it('defaults templates to draft with complete procedural sections and preserves citation fields through decode', async () => {
    const f=await fixture();
    const request=decode(TemplateSchema,{bundle:'repo',kind:'procedural',title:'Procedure',description:'When a task fails',tags:['workflow'],actor:'agent:writer',sources:[{resource:'https://example.org/evidence',detail:'Source observation',custom:{retained:true}}]});
    const template=await run(f.store.template(request));
    await f.write('procedure.md',template.raw);const note=await run(f.store.read('repo','procedure.md'));
    expect(note.metadata.status).toBe('draft');expect(note.memory?.diagnostics.some(item=>item.code==='MEMORY_STATUS')).toBe(false);
    expect((note.metadata.sources as Array<Record<string,unknown>>)[0]).toMatchObject({detail:'Source observation',custom:{retained:true}});
    for(const section of ['Trigger','Prerequisites','Applicability','Procedure','Verification','Failure cases']) expect(note.body).toContain('## '+section);
    await run(f.store.lifecycle({bundle:'repo',path:note.path,expectedHash:note.hash,action:'recheck'}));
    expect((await run(f.store.read('repo',note.path))).metadata.stale_after).toBe('2026-12-30T00:00:00.000Z');
    expect((await run(f.store.read('repo',note.path))).memory?.freshness).toBe('current');
  });
});


describe('inventory changes during apply', () => {
  it('rolls back its own mutations when a new evidence backlink appears during the batch', async () => {
    let inserted=false;
    const f=await fixture({afterJournalWrite:async()=>{if(!inserted){inserted=true;await f.write('new-reference.md','---\ntype: Rule\n---\n[Evidence](source.md)\n');}}});
    const a=await f.note('a.md');const source=await f.note('source.md');
    const preview=await run(f.store.previewMaintenance(proposal([{path:a.path,expectedHash:a.hash,raw:a.raw+'Changed.\n'},{path:source.path,expectedHash:source.hash,raw:null}])));
    await expect(run(f.store.applyMaintenance({preview}))).rejects.toMatchObject({code:'CONFLICT'});
    expect(await fs.readFile(path.join(f.bundle,a.path),'utf8')).toBe(a.raw);expect(await fs.readFile(path.join(f.bundle,source.path),'utf8')).toBe(source.raw);
  });
});


describe('policy metadata preservation', () => {
  it('preserves unknown policy fields and YAML comments while editing known policy options', async () => {
    const f=await fixture();const old=policyRaw(f.policy).replace('task_retention_days: 30','task_retention_days: 30 # keep retention comment').replace('  name: agent-memory','  custom: preserved # keep custom comment\n  name: agent-memory');
    await f.write('memory-policy.md',old);
    const preview=await run(f.store.previewMigration({bundle:'repo',policy:{task_retention_days:60}}));
    expect(preview.unresolved).toEqual([]);await run(f.store.applyMigration({preview}));
    const updated=await run(f.store.read('repo','memory-policy.md'));
    expect(updated.raw).toContain('custom: preserved # keep custom comment');expect(updated.raw).toContain('task_retention_days: 60 # keep retention comment');
  });
});


describe('generic metadata compatibility', () => {
  it('keeps legacy memory fields opaque until the canonical profile is explicitly activated', async () => {
    const f=await fixture();await fs.unlink(path.join(f.bundle,'memory-policy.md'));
    const raw='---\ntype: Custom\nmemory: { namespace: opaque-category, custom: original }\n---\nRelevant legacy document.\n';
    await run(f.store.save({bundle:'repo',path:'legacy.md',expectedHash:null,raw}));
    const legacy=await run(f.store.read('repo','legacy.md'));expect(legacy.raw).toBe(raw);expect(legacy.memory).toBeUndefined();
    expect((await run(f.store.search('Relevant',{namespaces:['shared']}))).total).toBe(1);
    expect((await run(f.store.audit({namespaces:['shared']}))).concepts.some(item=>item.path==='legacy.md')).toBe(true);
    await expect(run(f.store.save({bundle:'repo',path:'explicit.md',expectedHash:null,raw,namespace:'backend'}))).rejects.toMatchObject({code:'NAMESPACE_CONFLICT'});
  });
});


describe('generic extension links', () => {
  it('preserves opaque extension resources in graph and rename while handling standard sources', async () => {
    const f=await fixture();await fs.unlink(path.join(f.bundle,'memory-policy.md'));
    await f.write('target.md','---\ntype: Rule\n---\nTarget.\n');
    const extension='---\ntype: Custom\nmemory:\n  derived_from: [{ resource: target.md, content_hash: '+ 'a'.repeat(64) +' }]\n  prerequisites: [target.md]\n  replaces: [target.md]\n  replaced_by: target.md\n---\nOpaque extension.\n';
    await f.write('extension.md',extension);
    await f.write('citation.md','---\ntype: Custom\nsources: [{ resource: target.md, detail: Standard citation }]\n---\nEvidence.\n');
    const graph=await run(f.store.graph());expect(graph.edges.some(edge=>edge.from==='repo:extension.md')).toBe(false);expect(graph.edges.some(edge=>edge.from==='repo:citation.md')).toBe(true);
    const target=await run(f.store.read('repo','target.md'));await run(f.store.rename({bundle:'repo',path:target.path,newPath:'renamed.md',expectedHash:target.hash,updateLinks:true}));
    expect((await run(f.store.read('repo','extension.md'))).raw).toBe(extension);
    expect((await run(f.store.read('repo','citation.md'))).raw).toContain('resource: renamed.md');
  });
});


describe('editable preview and completed journal checks', () => {
  it('recomputes unresolved migration decisions even if preview bookkeeping and digest are edited', async () => {
    const f=await fixture();await fs.unlink(path.join(f.bundle,'memory-policy.md'));
    const legacy='---\ntype: Rule\n---\nLegacy unclassified guidance.\n';await f.write('legacy.md',legacy);
    const preview=await run(f.store.previewMigration({bundle:'repo'}));expect(preview.unresolved.length).toBeGreaterThan(0);
    preview.unresolved=[];preview.diagnostics=[];preview.previewHash=previewDigest(preview);
    await expect(run(f.store.applyMigration({preview}))).rejects.toMatchObject({code:'UNRESOLVED_PROPOSAL'});
    expect(await fs.readFile(path.join(f.bundle,'legacy.md'),'utf8')).toBe(legacy);await expect(fs.stat(path.join(f.bundle,'memory-policy.md'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('treats restoration to exact original bytes after a completed apply as an external change', async () => {
    const f=await fixture();const note=await f.note('note.md');
    const preview=await run(f.store.previewMaintenance(proposal([{path:note.path,expectedHash:note.hash,raw:note.raw+'Changed.\n'}])));
    await run(f.store.applyMaintenance({preview}));await f.write(note.path,note.raw);
    const restarted=createStore(f.context);expect((await run(restarted.inspectMaintenance({bundle:'repo',previewHash:preview.previewHash}))).paths[0].state).toBe('externally-changed');
    await expect(run(restarted.applyMaintenance({preview}))).rejects.toMatchObject({code:'CONFLICT'});expect(await fs.readFile(path.join(f.bundle,note.path),'utf8')).toBe(note.raw);
  });
});

describe('canonical policy and projected metadata protection', () => {
  it('protects the canonical policy from structured rename and deletion without reactivating rejected recall', async () => {
    const f=await fixture();const note=await f.note('rejected.md');
    await run(f.store.review({bundle:'repo',path:note.path,expectedHash:note.hash,actor:'agent:reviewer',decision:'reject',reason:'Counterexample found',at}));
    const policy=await run(f.store.read('repo','memory-policy.md'));
    const rename={bundle:'repo',path:policy.path,newPath:'renamed-policy.md',expectedHash:policy.hash,updateLinks:true};
    await expect(run(f.store.previewRename(rename))).rejects.toMatchObject({code:'MEMORY_POLICY_PROTECTED'});
    await expect(run(f.store.rename(rename))).rejects.toMatchObject({code:'MEMORY_POLICY_PROTECTED'});
    await expect(run(f.store.remove({bundle:'repo',path:policy.path,expectedHash:policy.hash}))).rejects.toMatchObject({code:'MEMORY_POLICY_PROTECTED'});
    await expect(run(f.store.previewMaintenance(proposal([{path:policy.path,expectedHash:policy.hash,raw:null}])))).rejects.toMatchObject({code:'MEMORY_POLICY_PROTECTED'});
    expect((await run(f.store.profile('repo'))).mode).toBe('memory');expect((await run(f.store.search('Relevant'))).total).toBe(0);
    await run(f.store.save({bundle:'repo',path:policy.path,expectedHash:policy.hash,raw:policy.raw+'\nPolicy clarification.\n'}));
    expect((await run(f.store.profile('repo'))).mode).toBe('memory');
  });
  it('refuses confirmation of lossy YAML and distinguishes projected infinity from ordinary null', async () => {
    const f=await fixture();const original=await f.note('projected.md');
    await f.write(original.path,original.raw.replace('type: Fact','type: Fact\ncustom_limit: .inf'));
    let projected=await run(f.store.read('repo',original.path));
    expect(projected.metadata.custom_limit).toBeNull();expect(projected.memory).toMatchObject({trust:'invalid',verified:false,humanReviewed:false});
    await expect(run(f.store.review({bundle:'repo',path:projected.path,expectedHash:projected.hash,actor:'human:ada',operator:true,decision:'approve',reason:'Checked',at}))).rejects.toMatchObject({code:'LOSSY_METADATA'});
    await expect(run(f.store.verify({bundle:'repo',path:projected.path,expectedHash:projected.hash,actor:'agent:checker',method:'Checked raw source',at}))).rejects.toMatchObject({code:'LOSSY_METADATA'});
    const digest=contentDigest(projected);
    const event={actor_type:'human',by:'human:ada',decision:'approve',reason:'Historical decision',at,content_hash:digest};
    await f.write(projected.path,patchMetadata(projected.raw,[{path:['memory','reviews'],value:[event]}]));
    projected=await run(f.store.read('repo',projected.path));expect(projected.memory?.review).toBe('pending');
    await f.note('derived-projection.md',undefined,'semantic',[{path:['memory','derived_from'],value:[{resource:projected.path,content_hash:digest}]}]);
    expect((await run(f.store.read('repo','derived-projection.md'))).memory?.dependency).toBe('invalid');
    await f.write(projected.path,projected.raw.replace('custom_limit: .inf','custom_limit: null'));
    const repaired=await run(f.store.read('repo',projected.path));
    expect(repaired.metadata.custom_limit).toBeNull();expect(repaired.memory?.contentHash).not.toBe(digest);expect(repaired.memory?.review).toBe('pending');
    expect(repaired.memory?.reviewEvents).toHaveLength(1);expect((await run(f.store.read('repo','derived-projection.md'))).memory?.dependency).toBe('changed');
  });
});

describe('profile index and durable review due dates', () => {
  it('lints a missing root index for an active profile while keeping exact files accessible', async () => {
    const f=await fixture();await f.note('note.md');await fs.unlink(path.join(f.bundle,'index.md'));
    expect((await run(f.store.profile('repo'))).mode).toBe('memory');
    const lint=await run(f.store.validate({lint:true}));expect(lint.diagnostics.some(item=>item.code==='MEMORY_ROOT_INDEX'&&item.path==='index.md')).toBe(true);
    expect((await run(f.store.read('repo','note.md'))).raw).toContain('type: Fact');
    await run(f.store.save({bundle:'repo',path:'index.md',expectedHash:null,raw:'# Knowledge\n[policy](memory-policy.md)\n[note](note.md)\n'}));
    expect((await run(f.store.validate({lint:true}))).diagnostics.some(item=>item.code==='MEMORY_ROOT_INDEX')).toBe(false);
  });
  it('derives missing durable deadlines from generation time and policy on every cached recall, then persists them during migration', async () => {
    let time=Date.parse(at);const f=await fixture({now:()=>new Date(time)});
    const generated='2020-01-01T00:00:00Z';const due=Date.parse(generated)+90*86400000;
    const note=await f.note('old-fact.md',undefined,'semantic',[{path:['generated','at'],value:generated},{path:['stale_after'],value:undefined}]);
    expect(note.memory?.freshness).toBe('stale');expect(note.memory?.diagnostics.some(item=>item.code==='MEMORY_REVIEW_DATE')).toBe(true);
    time=due-1;expect((await run(f.store.search('Relevant'))).results[0].memory?.freshness).toBe('current');
    time=due;expect((await run(f.store.search('Relevant'))).results[0].memory?.freshness).toBe('stale');
    const preview=await run(f.store.previewMigration({bundle:'repo'}));expect(preview.unresolved).toEqual([]);
    expect(preview.changes.find(item=>item.path===note.path)?.raw).toContain('stale_after: 2020-03-31T00:00:00.000Z');
    await run(f.store.applyMigration({preview}));
    const migrated=await run(f.store.read('repo',note.path));expect(migrated.memory?.freshness).toBe('stale');expect(migrated.memory?.diagnostics.some(item=>item.code==='MEMORY_REVIEW_DATE')).toBe(false);
    expect((await run(f.store.previewMigration({bundle:'repo'}))).changes).toEqual([]);
  });
});
