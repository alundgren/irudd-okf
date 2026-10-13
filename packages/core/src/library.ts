import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Applicability, Bundle, BundleInspection, ChangeProposal, ChangeRecord, ChangeRequest, ChangeReview, Concept, MemoryActor, MemoryContext, RecallSelection, SourceRevision, Store, StoreOptions, MaintenancePreview } from './contracts.ts';
import { OkfError, SUPPORTED_FORMAT_VERSION, VERSION } from './contracts.ts';
import { absent, atomicCreate, atomicReplace, canonicalDirectory, cleanPath, guarded, hash, operation, readRaw, scan, withLock } from './files.ts';
import { parseConcept, reserved, resolveLink } from './parser.ts';
import { canonicalJson, patchMetadata, record, metadataLinks } from './memory.ts';
import { ChangeSchema, ChangeReviewSchema, ChangeUndoSchema, decode, MigrationSchema, ApplySchema } from './schemas.ts';
import { applyJournal, previewDigest, recoverBundleLock } from './maintenance.ts';

export const MANIFEST_PATH = 'memory-bundle.json';
export const HISTORY_PATH = 'memory-history.json';
interface Manifest { formatVersion: number; id: string; name: string }
interface History { version: 1; proposals: ChangeProposal[]; decisions: Array<{ id: string; review: ChangeReview }>; observed?: Record<string,string|null>; publication?: { id: string; expectedHash: string | null; raw?: string | null } }
const emptyHistory = (): History => ({ version: 1, proposals: [], decisions: [] });
const bytes = (raw: string | null) => raw === null ? null : { raw, hash: hash(raw) };
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 2048;
const digest = (value: string | null) => { if (value !== null && !/^[a-f0-9]{64}$/.test(value)) throw new OkfError('INVALID_REQUEST', 'Expected revisions must be SHA-256 hex digests.'); };
const identity = (actor: MemoryActor, reason: string) => { if (!nonempty(actor.id) || !nonempty(reason)) throw new OkfError('INVALID_REQUEST', 'Actor identity and reason must be nonempty.'); };
const isControl = (file: string) => reserved(file) || file === 'memory-policy.md';
const sourceKey = (source: SourceRevision) => `${source.bundle ?? ''}:${source.id ?? ''}:${source.path}:${source.hash}`;
function proposalDigest(proposal: Omit<ChangeProposal, 'revisionHash'> | ChangeProposal): string { const { revisionHash: _, ...payload } = proposal as ChangeProposal; return hash(canonicalJson(payload)); }
function displayMemory(concept:Concept|null) {
  if(!concept || isControl(concept.path))return null;
  const memory=record(concept.metadata.memory);let scope:Applicability|null=null;try{scope=applicability(memory.applicability);}catch{}
  return {kind:['procedural','episodic','semantic'].includes(String(memory.kind))?memory.kind as 'procedural'|'episodic'|'semantic':null,stage:['bronze','silver','gold'].includes(String(memory.stage))?memory.stage as 'bronze'|'silver'|'gold':null,applicability:scope};
}
function view(history: History, proposal: ChangeProposal): ChangeRecord {
  const reviews = history.decisions.filter(item => item.id === proposal.id).map(item => item.review);
  const review = reviews.at(-1), agentReview = reviews.findLast(item=>item.actor.type === 'agent'), humanReview = reviews.findLast(item=>item.actor.type === 'human');
  const effective = humanReview ?? agentReview;
  const replacement = !effective ? history.proposals.findLast(item=>item.path===proposal.path && item.id!==proposal.id) : undefined;
  const superseded = replacement && history.proposals.indexOf(replacement)>history.proposals.indexOf(proposal);
  const prior=proposal.before?parseConcept(proposal.bundle,proposal.path,proposal.before.raw):null,next=proposal.after?parseConcept(proposal.bundle,proposal.path,proposal.after.raw):null;
  return { ...proposal, display:{title:next?.title ?? prior?.title ?? 'Memory',beforeBody:prior?.body ?? null,afterBody:next?.body ?? null,beforeMemory:displayMemory(prior),afterMemory:displayMemory(next)}, status: effective?.decision === 'accept' ? 'accepted' : effective ? 'rejected' : superseded ? 'superseded' : 'pending', ...(superseded ? {replacementChangeId:replacement.id} : {}), reviews, ...(agentReview ? {agentReview} : {}), ...(humanReview ? {humanReview} : {}), ...(review ? { review } : {}) };
}
function accepted(history: History): Map<string, ChangeProposal> {
  const output = new Map<string, ChangeProposal>();
  for (const proposal of history.proposals) if (view(history, proposal).status === 'accepted') output.set(proposal.path, proposal);
  return output;
}
async function current(bundle: Bundle, file: string): Promise<string | null> { try { return await readRaw(bundle, file); } catch (error) { if (absent(error)) return null; throw error; } }
export async function inspectLibrary(bundle: Bundle): Promise<BundleInspection> {
  const raw = await current(bundle, MANIFEST_PATH);
  let marker: unknown;
  try { marker = raw === null ? null : JSON.parse(raw); } catch { marker = undefined; }
  const manifest = record(marker);
  const valid = Number.isSafeInteger(manifest.formatVersion) && Number(manifest.formatVersion) > 0 && nonempty(manifest.id) && nonempty(manifest.name);
  const version = typeof manifest.formatVersion === 'number' ? manifest.formatVersion : null;
  return { version: 1, bundle: bundle.name, root: await canonicalDirectory(bundle.root), name: valid ? String(manifest.name) : bundle.name, id: valid ? String(manifest.id) : null, formatVersion: version, cliVersion: VERSION, supportedFormatVersion: SUPPORTED_FORMAT_VERSION, status: raw === null ? 'migration-required' : !valid ? 'invalid' : version! > SUPPORTED_FORMAT_VERSION ? 'newer' : version === SUPPORTED_FORMAT_VERSION ? 'current' : 'migration-required' };
}
export async function assertLibraryWrite(bundle: Bundle): Promise<boolean> {
  const inspection = await inspectLibrary(bundle);
  if (inspection.status === 'newer') throw new OkfError('NEWER_BUNDLE_FORMAT', 'Install a CLI that supports this bundle format before writing.', { inspection });
  if (inspection.status === 'invalid') throw new OkfError('INVALID_BUNDLE_FORMAT', 'Repair the bundle marker before writing.', { inspection });
  return inspection.status === 'current';
}
async function requireLibrary(bundle: Bundle): Promise<void> {
  if (!await assertLibraryWrite(bundle)) throw new OkfError('MIGRATION_REQUIRED', 'Run migration guide for this installed CLI before library operations.', { inspection: await inspectLibrary(bundle) });
}
async function readHistory(bundle: Bundle): Promise<History> {
  const raw = await current(bundle, HISTORY_PATH);
  if (raw === null) throw new OkfError('INVALID_MEMORY_HISTORY', 'Portable revision history is missing. Restore it with the bundle files.');
  let history: History;
  try { history = JSON.parse(raw); } catch { throw new OkfError('INVALID_MEMORY_HISTORY', 'Portable revision history cannot be parsed. Preserve it for recovery.'); }
  if (history?.version !== 1 || !Array.isArray(history.proposals) || !Array.isArray(history.decisions)) throw new OkfError('INVALID_MEMORY_HISTORY', 'Portable revision history has invalid metadata.');
  const ids = new Set<string>();
  for (const proposal of history.proposals) {
    if (proposal.version!==1 || !['create','update','delete'].includes(proposal.action) || typeof proposal.humanRequired!=='boolean' || !['agent','human'].includes(proposal.actor?.type) || !nonempty(proposal.actor?.id) || !nonempty(proposal.reason) || !Array.isArray(proposal.sources) || proposal.before===undefined || proposal.after===undefined || !nonempty(proposal.id) || ids.has(proposal.id) || proposal.revisionHash !== proposalDigest(proposal) || proposal.path !== cleanPath(proposal.path) || !proposal.path.endsWith('.md') || proposal.before && hash(proposal.before.raw) !== proposal.before.hash || proposal.after && hash(proposal.after.raw) !== proposal.after.hash) throw new OkfError('INVALID_MEMORY_HISTORY', 'An immutable proposal or its raw revision is invalid.');
    ids.add(proposal.id);
  }
  for (const event of history.decisions) if (!ids.has(event.id) || event.review?.revisionHash !== history.proposals.find(item => item.id === event.id)?.revisionHash || (!['accept', 'reject'].includes(event.review?.decision) || !['agent','human'].includes(event.review?.actor?.type) || !nonempty(event.review?.actor?.id) || !nonempty(event.review?.reason) || !Array.isArray(event.review?.sources))) throw new OkfError('INVALID_MEMORY_HISTORY', 'A decision references an unknown or different proposal revision.');
  if(history.publication && (!ids.has(history.publication.id) || !Object.hasOwn(history.publication,'expectedHash')))throw new OkfError('INVALID_MEMORY_HISTORY','Publication intent must identify a retained proposal and expected preimage.');
  return history;
}
async function persist(bundle: Bundle, history: History): Promise<void> { await atomicReplace(await guarded(bundle, HISTORY_PATH), JSON.stringify(history, null, 2) + '\n'); }
async function publish(bundle: Bundle, file: string, raw: string | null, expectedHash: string | null): Promise<void> {
  const actual = await current(bundle, file);
  if ((actual === null ? null : hash(actual)) !== expectedHash) throw new OkfError('CONFLICT', 'Current file differs from the observed revision.', { path: file, expectedHash, actualHash: actual === null ? null : hash(actual) });
  const destination = await guarded(bundle, file, true);
  const check = async () => { const value = await current(bundle, file); if ((value === null ? null : hash(value)) !== expectedHash) throw new OkfError('CONFLICT', 'File changed before publication.', { path: file }); };
  if (raw === null) { if (actual !== null) { await check(); await fs.unlink(destination); } }
  else if (actual === null) await atomicCreate(destination, raw, check);
  else await atomicReplace(destination, raw, (await fs.stat(destination)).mode & 0o777, check);
}
async function finishPublication(bundle: Bundle, history: History): Promise<void> {
  if (!history.publication) return;
  const intent = history.publication;
  const proposal = history.proposals.find(item => item.id === intent.id)!;
  const target = intent.raw !== undefined ? intent.raw : proposal.after?.raw ?? null;
  const targetHash = target === null ? null : hash(target);
  const actual = await current(bundle, proposal.path);
  const actualHash = actual === null ? null : hash(actual);
  if (actualHash === intent.expectedHash) await publish(bundle, proposal.path, target, intent.expectedHash);
  else if (actualHash !== targetHash) throw new OkfError('CONFLICT', 'Interrupted proposal contains an external file edit. Preserve it and inspect the portable history.', { path: proposal.path, changeId: proposal.id });
  history.observed ??= {}; history.observed[proposal.path] = targetHash;
  delete history.publication;
  await persist(bundle, history);
}
function applicability(value: unknown): Applicability {
  const item = record(value);
  if (item.type === 'global' && Object.keys(item).length === 1) return { type: 'global' };
  if (['machine', 'repository'].includes(String(item.type)) && nonempty(item.id) && Object.keys(item).every(key => ['type', 'id'].includes(key))) return { type: item.type as 'machine' | 'repository', id: item.id };
  throw new OkfError('APPLICABILITY_REQUIRED', 'Declare global applicability or one explicit machine or repository identity.');
}
export function validLibraryNote(bundle: string, file: string, raw: string): Concept {
  const concept = parseConcept(bundle, file, raw);
  if (concept.malformed || concept.diagnostics.some(item => item.level === 'error')) throw new OkfError('INVALID_MEMORY', 'Memory requires valid YAML and a nonempty type. Raw repairs remain available through external file editing.', { diagnostics: concept.diagnostics });
  if (!isControl(file)) {
    const memory = record(concept.metadata.memory);
    if (!nonempty(memory.id) || !['procedural', 'episodic', 'semantic'].includes(String(memory.kind)) || !['bronze', 'silver', 'gold'].includes(String(memory.stage))) throw new OkfError('CLASSIFICATION_REQUIRED', 'Declare a stable memory id, kind and independent processing stage.');
    applicability(memory.applicability);
  }
  return concept;
}
function evidenceDigest(raw:string):string {
  const concept=parseConcept('', 'evidence.md', raw),metadata=structuredClone(concept.metadata),memory=record(metadata.memory);
  delete memory.archived_at;delete memory.expires_at;delete metadata.stale_after;
  return hash(canonicalJson({metadata,body:concept.body}));
}
function humanRequired(before: string | null, after: string | null, bundle: string, file: string): boolean {
  if (before === null) return false;
  if (after === null) return true;
  const old = parseConcept(bundle, file, before), next = parseConcept(bundle, file, after);
  const prior = record(old.metadata.memory), updated = record(next.metadata.memory);
  return old.malformed || next.malformed || prior.kind === 'procedural' || updated.kind === 'procedural' || canonicalJson(prior.applicability) !== canonicalJson(updated.applicability);
}
function makeProposal(bundle: Bundle, request: ChangeRequest, before: string | null, sources: SourceRevision[]): ChangeProposal {
  const payload: Omit<ChangeProposal, 'revisionHash'> = { version: 1, id: randomUUID(), bundle: bundle.name, path: request.path, action: request.raw === null ? 'delete' : before === null ? 'create' : 'update', before: bytes(before), after: bytes(request.raw), actor: request.actor, reason: request.reason, createdAt: new Date().toISOString(), sources, humanRequired: humanRequired(before, request.raw, bundle.name, request.path), ...(request.requestId ? { requestId: request.requestId, requestHash: hash(canonicalJson({...request,authorizePersonal:undefined,sources:request.sources ?? []})), expectedHash:request.expectedHash } : {}) };
  return { ...payload, revisionHash: proposalDigest(payload) };
}
async function detectExternal(bundle: Bundle, history: History): Promise<void> {
  await finishPublication(bundle, history);
  const files = await scan(bundle), paths = new Set([...files.map(item => item.path), ...history.proposals.map(item => item.path)]);
  let changed = false;
  const acceptedByPath=accepted(history);
  for (const file of paths) {
    if (isControl(file) && !history.proposals.some(item => item.path === file)) continue;
    const latest = history.proposals.findLast(item => item.path === file);
    const raw = await current(bundle, file);
    if ((history.observed && file in history.observed ? history.observed[file] : latest?.after?.hash ?? null) === (raw === null ? null : hash(raw))) continue;
    const request: ChangeRequest = { bundle: bundle.name, path: file, raw, expectedHash: latest?.after?.hash ?? null, actor: { type: 'agent', id: 'external-edit' }, reason: 'Detected file mutation outside the library commands.' };
    const proposal = makeProposal(bundle, request, acceptedByPath.get(file)?.after?.raw ?? latest?.after?.raw ?? null, []);
    proposal.humanRequired = true; proposal.revisionHash = proposalDigest(proposal);
    history.proposals.push(proposal); history.observed ??= {}; history.observed[file] = raw === null ? null : hash(raw); changed = true;
  }
  if (changed) await persist(bundle, history);
}
export function createLibrary(context: MemoryContext, options: StoreOptions = {}) {
  const select = (name: string) => { const bundle = context.bundles.find(item => item.name === name); if (!bundle) throw new OkfError('BUNDLE_NOT_FOUND', 'Select an active bundle.', { bundle: name }); return bundle; };
  const writable = (bundle: Bundle, request: { authorizePersonal?: boolean }) => { if (!bundle.writable) throw new OkfError('READ_ONLY', 'This bundle is read-only.'); if (bundle.kind === 'personal' && !request.authorizePersonal) throw new OkfError('PERSONAL_AUTHORIZATION', 'Personal changes require explicit authorization.'); };
  const load = async (bundle: Bundle) => { await requireLibrary(bundle); return withLock(bundle.root, async () => { const history = await readHistory(bundle); await detectExternal(bundle, history); return history; }); };
  const sourcesFor = async (bundle: Bundle, file: string, raw: string | null, requested: SourceRevision[] = [], refreshHistorical = false): Promise<SourceRevision[]> => {
    const selectedBundles = await Promise.all(context.bundles.map(async item=>({item,inspection:await inspectLibrary(item)})));
    const resolveSource = async (source: {bundle?:string; id?:string; path:string; hash?:string}) => {
      const selected = source.bundle ? selectedBundles.find(item=>item.inspection.id === source.bundle || item.item.name === source.bundle) : selectedBundles.find(item=>item.item.name === bundle.name);
      if (!selected) throw new OkfError('SOURCE_UNAVAILABLE', 'Evidence bundle is not selected.', {bundle:source.bundle});
      const sourcePath = cleanPath(source.path);
      let sourceRaw: string | null = null, sourceId: unknown, retainedPath = sourcePath;
      if (selected.inspection.status === 'current') {
        const history = await readHistory(selected.item);
        const matching = history.proposals.filter(proposal=>proposal.after && (source.id ? record(parseConcept(selected.item.name,proposal.path,proposal.after.raw).metadata.memory).id === source.id : proposal.path === sourcePath) && view(history,proposal).status === 'accepted');
        let revision = matching.at(-1);
        if(source.hash && revision?.after?.hash !== source.hash) {
          const retained=matching.findLast(item=>item.after?.hash===source.hash);
          if(retained?.after && revision?.after && evidenceDigest(retained.after.raw)===evidenceDigest(revision.after.raw))revision=retained;
        }
        if (revision?.after) { sourceRaw=revision.after.raw; retainedPath=revision.path; sourceId=record(parseConcept(selected.item.name,revision.path,sourceRaw).metadata.memory).id; }
      } else {
        sourceRaw=await current(selected.item,sourcePath);
        if (sourceRaw!==null) sourceId=record(parseConcept(selected.item.name,sourcePath,sourceRaw).metadata.memory).id;
      }
      if (sourceRaw === null) throw new OkfError('SOURCE_UNAVAILABLE', 'No accepted source revision is available. Review source memories first.', {path:sourcePath});
      if (!refreshHistorical && source.hash !== undefined && hash(sourceRaw)!==source.hash || source.id !== undefined && sourceId!==source.id) throw new OkfError('SOURCE_CONFLICT','Accepted evidence differs from the recorded revision or memory identity.',{path:sourcePath});
      const sourceMemory=record(parseConcept(selected.item.name,retainedPath,sourceRaw).metadata.memory);
      let sourceApplicability:Applicability|undefined;try{sourceApplicability=applicability(sourceMemory.applicability);}catch{}
      return {...(sourceApplicability?{applicability:sourceApplicability}:{}),displayTitle:parseConcept(selected.item.name,retainedPath,sourceRaw).title,bundle:selected.inspection.id ?? selected.item.name,path:retainedPath,hash:hash(sourceRaw),...(nonempty(sourceId)?{id:sourceId}:{})};
    };
    const normalized: SourceRevision[] = [];
    for (const source of requested) {digest(source.hash); normalized.push(await resolveSource(source));}
    if (raw !== null) {
      const concept=parseConcept(bundle.name,file,raw), metadataSources=Array.isArray(concept.metadata.sources)?concept.metadata.sources:[], derivations=record(concept.metadata.memory).derived_from;
      for (const candidate of [...metadataSources,...(Array.isArray(derivations)?derivations:[])]) {
        const value=typeof candidate==='string'?candidate:record(candidate).resource;
        if (typeof value !== 'string') throw new OkfError('INVALID_SOURCE','Source references require a resource string.');
        const link=resolveLink(file,value);if(link.external)continue;
        if(link.unsafe || link.target===file)throw new OkfError('INVALID_SOURCE','Sources must identify safe separate bundle files.');
        const declaredBundle=record(candidate).bundle,declaredId=record(candidate).id;
        const recorded=requested.find(item=>item.path===link.target && (typeof declaredBundle!=='string' || item.bundle===declaredBundle));
        const declaredHash=record(candidate).content_hash;
        if(declaredHash!==undefined && typeof declaredHash!=='string')throw new OkfError('INVALID_SOURCE','Derivation revisions require SHA-256 raw digests.');
        normalized.push(await resolveSource({path:link.target,...(typeof declaredId==='string'?{id:declaredId}:recorded?.id?{id:recorded.id}:{}),...(!refreshHistorical && declaredHash!==undefined?{hash:declaredHash}:recorded?.hash && !refreshHistorical?{hash:recorded.hash}:{}),...(typeof declaredBundle==='string'?{bundle:declaredBundle}:recorded?.bundle?{bundle:recorded.bundle}:{})}));
      }
    }
    const unique = new Map(normalized.map(source => [sourceKey(source), source]));
    return [...unique.values()].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)));
  };
  const propose = async (request: ChangeRequest): Promise<ChangeRecord> => {
    request = decode(ChangeSchema, request); identity(request.actor, request.reason); digest(request.expectedHash);
    const bundle = select(request.bundle); writable(bundle, request); await requireLibrary(bundle);
    const file = cleanPath(request.path); if (file !== request.path || !file.endsWith('.md')) throw new OkfError('INVALID_PATH', 'Library proposals use canonical Markdown paths.');
    return withLock(bundle.root, async () => {
      const history = await readHistory(bundle); await detectExternal(bundle, history);
      if (request.requestId) {
        const previous = history.proposals.find(item => item.requestId === request.requestId);
        if (previous) { if (previous.requestHash !== hash(canonicalJson({...request,authorizePersonal:undefined,sources:request.sources ?? []}))) throw new OkfError('REQUEST_ID_CONFLICT', 'Request identity was already used for different content.'); return view(history, previous); }
      }
      const acceptedByPath=accepted(history);
      const before = await current(bundle, file);
      if ((before === null ? null : hash(before)) !== request.expectedHash) throw new OkfError('CONFLICT', 'The proposed file revision changed.', { expectedHash: request.expectedHash, actualHash: before === null ? null : hash(before) });
      if (request.raw === null && before === null) throw new OkfError('NOT_FOUND', 'Cannot remove an absent memory.');
      if (request.raw !== null) {
        const concept = validLibraryNote(bundle.name, file, request.raw), memory = record(concept.metadata.memory);
        if (!isControl(file)) {
          const oldMemory = before === null ? null : record(parseConcept(bundle.name, file, before).metadata.memory);
          const original = history.proposals.find(item => item.path === file && item.after)?.after?.raw;
          const stable = original === undefined ? oldMemory?.id : record(parseConcept(bundle.name, file, original).metadata.memory).id;
          if (stable !== undefined && stable !== memory.id) throw new OkfError('MEMORY_ID_CONFLICT', 'An existing memory keeps its stable identity.');
          const moved = history.proposals.some(item=>item.path!==file && item.after && acceptedByPath.get(item.path)?.after === null && record(parseConcept(bundle.name,item.path,item.after.raw).metadata.memory).id===memory.id);
          if (before === null && !original && !moved && request.actor.type === 'agent' && memory.stage !== 'bronze') throw new OkfError('BRONZE_REQUIRED', 'New agent memories start at bronze.');
          for (const candidate of history.proposals) if (candidate.path !== file && candidate.after && acceptedByPath.get(candidate.path)?.after !== null && record(parseConcept(bundle.name, candidate.path, candidate.after.raw).metadata.memory).id === memory.id) throw new OkfError('DUPLICATE_MEMORY_ID', 'A different memory already owns this stable identity.', { path: candidate.path });
        }
      }
      const baselineProposal=acceptedByPath.get(file);
      const baseline=baselineProposal?.after?.raw ?? null;
      const priorSources=await sourcesFor(bundle,file,baseline,[],true);
      const afterSources=await sourcesFor(bundle,file,request.raw,request.sources);
      const sources=await sourcesFor(bundle,file,null,[...priorSources,...afterSources]);
      const proposal = makeProposal(bundle, request, baseline, sources);
      let sourceWidening=false;
      if(request.raw!==null && !isControl(file)) {const target=applicability(record(parseConcept(bundle.name,file,request.raw).metadata.memory).applicability);sourceWidening=sources.some(source=>!source.applicability || source.applicability.type!=='global' && (target.type!==source.applicability.type || target.id!==source.applicability.id));}
      const lastHuman=history.decisions.findLast(event=>event.review.actor.type==='human' && history.proposals.find(item=>item.id===event.id)?.path===file)?.review;
      if (request.raw === null || sourceWidening || lastHuman?.decision==='reject' || baselineProposal && canonicalJson(baselineProposal.sources)!==canonicalJson(sources) || priorSources.length>afterSources.length) {proposal.humanRequired=true;proposal.revisionHash=proposalDigest(proposal);}
      // Publication intent is durable before Markdown changes, so a retry completes the same proposal.
      history.proposals.push(proposal); history.publication = { id: proposal.id, expectedHash: request.expectedHash }; await persist(bundle, history);
      await options.afterChangeWrite?.('prepared',proposal.id);
      await finishPublication(bundle, history);
      await options.afterChangeWrite?.('published',proposal.id);
      return view(history, proposal);
    });
  };
  const acceptedDocuments = async (bundle: Bundle, selection: RecallSelection): Promise<Concept[]> => {
    if ((await inspectLibrary(bundle)).status !== 'current') return [];
    const history = await load(bundle);
    const output: Concept[] = [];
    for (const proposal of accepted(history).values()) {
      if (!proposal.after) continue;
      const concept = parseConcept(bundle.name, proposal.path, proposal.after.raw);
      if (!isControl(proposal.path)) {
        const memory = record(concept.metadata.memory);
        const scope = applicability(memory.applicability);
        if (!selection.allApplicability && (scope.type === 'machine' && scope.id !== selection.machine || scope.type === 'repository' && scope.id !== selection.repository)) continue;
        const reviews = history.decisions.filter(event => event.id === proposal.id && event.review.decision === 'accept').map(event => event.review);
        const human = reviews.some(review => review.actor.type === 'human');
        const expired = typeof memory.expires_at === 'string' && Date.parse(memory.expires_at) <= (options.now?.() ?? new Date()).getTime();
        const stale = typeof concept.metadata.stale_after === 'string' && Date.parse(concept.metadata.stale_after) <= (options.now?.() ?? new Date()).getTime();
        if (!selection.includeExcluded && (expired || memory.archived_at || concept.metadata.status === 'deprecated')) continue;
        let dependency: 'valid' | 'changed' | 'unavailable' = 'valid';
        try { await sourcesFor(bundle, proposal.path, proposal.after.raw, proposal.sources); } catch (error) { dependency = error instanceof OkfError && error.code === 'SOURCE_UNAVAILABLE' ? 'unavailable' : 'changed'; }
        if (!selection.includeExcluded && dependency !== 'valid') continue;
        concept.memory = { id: String(memory.id), applicability: scope, revisionHash: proposal.after.hash, kind: memory.kind as 'procedural' | 'semantic' | 'episodic', stage: memory.stage as 'bronze' | 'silver' | 'gold', namespace: 'shared', review: 'approved', verified: false, humanReviewed: human, machineVerified: false, trustTier: human ? 'human-reviewed' : 'machine-confirmed', historicalVerificationEvents: [], freshness: stale ? 'stale' : 'current', archived: false, deprecated: false, contentHash: proposal.after.hash, dependency, eligible: !expired && !memory.archived_at && concept.metadata.status !== 'deprecated' && dependency === 'valid', trust: 'approved', reviewEvents: reviews.map(review => ({ decision: 'approve', actor_type: review.actor.type === 'human' ? 'human' : 'machine', by: review.actor.id, at: review.at, reason: review.reason, content_hash: proposal.after!.hash })), verificationEvents: [], diagnostics: [] };
      }
      output.push(concept);
    }
    const all=new Map(output.map(concept=>[concept.path,concept]));
    for(const concept of output) {
      for(const source of metadataLinks(concept,true)) {const link=resolveLink(concept.path,source.resource);if(!concept.links.some(item=>item.target===link.target && item.external===link.external))concept.links.push({target:link.target,label:source.label,external:link.external,broken:!!link.unsafe});}
      for(const link of concept.links)if(!link.external) {const target=all.get(link.target);link.broken=!target;if(target && !target.backlinks.some(item=>item.path===concept.path))target.backlinks.push({bundle:bundle.name,path:concept.path,title:concept.title});}
    }
    return output;
  };
  const inspectPublication=async (bundle:Bundle) => {
    await requireLibrary(bundle);const history=await readHistory(bundle),intent=history.publication;
    if(!intent)return null;
    const proposal=history.proposals.find(item=>item.id===intent.id)!;
    const raw=await current(bundle,proposal.path),actual=raw===null?null:hash(raw),target=intent.raw!==undefined?intent.raw:proposal.after?.raw ?? null;
    return {id:proposal.id,path:proposal.path,state:actual===intent.expectedHash?'untouched' as const:actual===(target===null?null:hash(target))?'applied' as const:'externally-changed' as const};
  };
  const methods: Pick<Store, 'inspectChanges' | 'recoverChanges' | 'inspectBundle' | 'migrationGuide' | 'proposeChange' | 'listChanges' | 'readChange' | 'reviewChange' | 'undoChange' | 'browse'> = {
    inspectChanges: name=>operation(async()=>({version:1,bundle:name,lockRecovered:false,publication:await inspectPublication(select(name))})),
    recoverChanges: (name,authorizePersonal)=>operation(async()=>{
      const bundle=select(name);writable(bundle,{authorizePersonal});await requireLibrary(bundle);
      const recovery=await recoverBundleLock(bundle);
      await withLock(bundle.root,async()=>{
        const history=await readHistory(bundle);
        const inspection=await inspectPublication(bundle);
        if(inspection?.state==='externally-changed') {delete history.publication;await persist(bundle,history);}
        await detectExternal(bundle,history);
      });
      return {version:1,bundle:name,...recovery,publication:await inspectPublication(bundle)};
    }),
    inspectBundle: name => operation(async () => { const bundle = select(name), inspection = await inspectLibrary(bundle); if (inspection.status === 'current') { try { await readHistory(bundle); } catch { return { ...inspection, status: 'invalid' }; } } return inspection; }),
    migrationGuide: name => operation(async () => {
      const bundle = select(name), inspection = await inspectLibrary(bundle);
      const questions = [];
      for (const file of await scan(bundle)) {
        if (isControl(file.path)) continue;
        const concept = parseConcept(name, file.path, (await current(bundle, file.path))!); const memory = record(concept.metadata.memory);
        for (const field of ['id', 'kind', 'stage', 'applicability']) if (memory[field] === undefined) questions.push({ path: file.path, field, message: `Supply an explicit ${field}; migration does not infer applicability or classification.` });
        try{validLibraryNote(name,file.path,concept.raw);}catch(error){questions.push({path:file.path,field:concept.malformed?'raw':error instanceof OkfError?error.code:'raw',message:error instanceof Error?error.message:'Provide an explicitly repaired candidate.'});}
      }
      return { version: 1, inspection, instructions: inspection.status === 'newer' ? ['Install a newer CLI supporting the indicated format. This CLI cannot write it.'] : [`These commands apply to CLI ${VERSION} and bundle format ${SUPPORTED_FORMAT_VERSION}.`, 'Select this bundle explicitly. Write a JSON decisions object keyed by relative note path.', 'Run migration preview BUNDLE --file decisions.json; resolve every question and inspect before/after bytes.', 'Run migration apply --file preview.json. The journal preserves original bytes and supports retry.', 'The format marker is published last. Migrated memories remain pending until an exact revision review.', 'Sync memory-history.json and memory-bundle.json together with Markdown.'], questions, requestExample: { decisions: { 'example.md': { id: 'example-stable-id', kind: 'semantic', stage: 'bronze', applicability: { type: 'repository', id: 'explicit-repository-id' } } } } };
    }),
    proposeChange: request => operation(() => propose(request)),
    listChanges: (name, status, page = {}) => operation(async () => { if (status !== undefined && !['pending', 'accepted', 'rejected', 'superseded'].includes(status)) throw new OkfError('INVALID_REQUEST', 'Unknown change status.'); const history = await load(select(name)); const changes = history.proposals.map(proposal => view(history, proposal)).filter(item => !status || item.status === status); const limit = Math.max(1, Math.min(100, Math.floor(page.limit ?? 30))), offset = Math.max(0, Math.floor(page.offset ?? 0)); return { version: 1, bundle: name, changes: changes.slice(offset, offset + limit), total: changes.length, limit, offset, truncated: changes.length > offset + limit }; }),
    readChange: (name, id) => operation(async () => { const history = await load(select(name)); const proposal = history.proposals.find(item => item.id === id); if (!proposal) throw new OkfError('CHANGE_NOT_FOUND', 'The immutable change does not exist.'); return view(history, proposal); }),
    reviewChange: request => operation(async () => {
      request = decode(ChangeReviewSchema, request); identity(request.actor, request.reason);
      if (request.actor.type === 'human' && !request.operator) throw new OkfError('HUMAN_REVIEW_AUTHORIZATION', 'Human review requires deliberate operator acknowledgement.');
      const bundle = select(request.bundle); writable(bundle, request); await requireLibrary(bundle);
      return withLock(bundle.root, async () => {
        const history = await readHistory(bundle); await detectExternal(bundle, history);
        const proposal = history.proposals.find(item => item.id === request.id);
        if (!proposal) throw new OkfError('CHANGE_NOT_FOUND', 'The immutable change does not exist.');
        if (proposal.revisionHash !== request.expectedRevisionHash || history.proposals.findLast(item => item.path === proposal.path)?.id !== proposal.id) throw new OkfError('REVIEW_CONFLICT', 'Review must bind the latest exact proposed revision.');
        if (proposal.humanRequired && request.actor.type !== 'human') throw new OkfError('HUMAN_REVIEW_REQUIRED', 'This change requires a human decision because it changes procedural guidance, applicability, external bytes or removes evidence.');
        const sources = await sourcesFor(bundle, proposal.path, proposal.after?.raw ?? null, proposal.sources);
        const requested = await sourcesFor(bundle, proposal.path, null, request.sources);
        if (canonicalJson(sources) !== canonicalJson(requested)) throw new OkfError('SOURCE_CONFLICT', 'Review must include every exact supporting source revision.', { sources });
        if (request.decision === 'accept' && proposal.after !== null) {
          const acceptedByPath=accepted(history);
          const note=validLibraryNote(bundle.name,proposal.path,proposal.after.raw), memory=record(note.metadata.memory);
          if (!isControl(proposal.path)) {
            const first=history.proposals.find(item=>item.path===proposal.path && item.after && nonempty(record(parseConcept(bundle.name,item.path,item.after.raw).metadata.memory).id));
            if(first && record(parseConcept(bundle.name,first.path,first.after!.raw).metadata.memory).id!==memory.id)throw new OkfError('MEMORY_ID_CONFLICT','A memory keeps its first explicit stable identity.');
            for(const other of history.proposals)if(other.path!==proposal.path && other.after && acceptedByPath.get(other.path)?.after !== null && record(parseConcept(bundle.name,other.path,other.after.raw).metadata.memory).id===memory.id)throw new OkfError('DUPLICATE_MEMORY_ID','Another retained memory owns this stable identity.',{path:other.path});
          }
        }
        const review: ChangeReview = { actor: request.actor, reason: request.reason, at: (options.now?.() ?? new Date()).toISOString(), decision: request.decision, revisionHash: proposal.revisionHash, sources };
        const last = history.decisions.findLast(item => item.id === proposal.id)?.review;
        if (last && canonicalJson({ ...last, at: undefined }) === canonicalJson({ ...review, at: undefined })) return view(history, proposal);
        const priorAccepted = accepted(history).get(proposal.path);
        history.decisions.push({ id: proposal.id, review });
        if (view(history, proposal).status === 'rejected') {
          const baseline = priorAccepted?.id === proposal.id ? proposal.before?.raw ?? null : priorAccepted?.after?.raw ?? null;
          const actual = await current(bundle, proposal.path);
          history.publication = {id:proposal.id, expectedHash: actual === null ? null : hash(actual), raw: baseline};
        }
        if (view(history,proposal).status === 'accepted') {
          const actual=await current(bundle,proposal.path);
          history.publication={id:proposal.id,expectedHash:actual===null?null:hash(actual),raw:proposal.after?.raw ?? null};
        }
        await persist(bundle, history);
        if (history.publication) await finishPublication(bundle, history);
        return view(history, proposal);
      });
    }),
    undoChange: request => operation(async () => {
      request = decode(ChangeUndoSchema, request); const bundle = select(request.bundle); writable(bundle, request);
      const history = await load(bundle), proposal = history.proposals.find(item => item.id === request.id);
      if (!proposal || proposal.revisionHash !== request.expectedRevisionHash) throw new OkfError('REVIEW_CONFLICT', 'Undo requires the exact retained change revision.');
      const actual = await current(bundle, proposal.path);
      return propose({ bundle: request.bundle, path: proposal.path, raw: proposal.before?.raw ?? null, expectedHash: actual === null ? null : hash(actual), actor: request.actor, reason: request.reason, requestId: request.requestId, authorizePersonal: request.authorizePersonal });
    }),
    browse: request => operation(async () => {
      const bundle = select(request.bundle), directory = request.path ? cleanPath(request.path).replace(/\/$/, '') : '';
      const limit = Math.max(1, Math.min(100, Math.floor(request.limit ?? 30))), offset = Math.max(0, Math.floor(request.offset ?? 0));
      const documents = (await inspectLibrary(bundle)).status === 'current' ? await acceptedDocuments(bundle, request) : await Promise.all((await scan(bundle)).map(async file => parseConcept(bundle.name, file.path, (await current(bundle, file.path))!)));
      const prefix = directory ? directory + '/' : '', entries = new Map<string, { path: string; kind: 'directory' | 'memory'; title?: string; id?: string }>();
      for (const concept of documents) if (concept.path.startsWith(prefix)) {
        const suffix = concept.path.slice(prefix.length), slash = suffix.indexOf('/');
        if (slash >= 0) { const child = prefix + suffix.slice(0, slash); entries.set(child, { path: child, kind: 'directory' }); }
        else if (!isControl(concept.path)) entries.set(concept.path, { path: concept.path, kind: 'memory', title: concept.title, ...(concept.memory?.id ? { id: concept.memory.id } : {}) });
      }
      const ordered = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
      return { version: 1, bundle: bundle.name, path: directory, limit, offset, truncated: ordered.length > offset + limit, entries: ordered.slice(offset, offset + limit) };
    }),
  };
  return { methods, acceptedDocuments, propose, select, writable, load };
}

export async function initialLibraryFiles(name: string, controls: Array<{path: string; raw: string}> = []): Promise<Array<{ path: string; raw: string }>> {
  const manifest: Manifest = { formatVersion: SUPPORTED_FORMAT_VERSION, id: randomUUID(), name };
  const history = emptyHistory();
  for (const control of controls.filter(item => isControl(item.path))) {
    const bundle: Bundle = {name, root: '', kind: 'explicit', writable: true};
    const proposal = makeProposal(bundle, {bundle:name,path:control.path,raw:control.raw,expectedHash:null,actor:{type:'agent',id:'initializer'},reason:'Initialize the bundled authoring guide.'}, null, []);
    history.proposals.push(proposal); history.decisions.push({id:proposal.id,review:{actor:proposal.actor,reason:proposal.reason,at:proposal.createdAt,decision:'accept',revisionHash:proposal.revisionHash,sources:[]}});
  }
  return [{ path: HISTORY_PATH, raw: JSON.stringify(history, null, 2) + '\n' }, { path: MANIFEST_PATH, raw: JSON.stringify(manifest, null, 2) + '\n' }];
}

export function attachLibraryMigration(store: Store, context: MemoryContext, options: StoreOptions): void {
  const library = createLibrary(context, options);
  store.previewMigration = request => operation(async () => {
    request = decode(MigrationSchema, request); const bundle = library.select(request.bundle);
    const inspection = await inspectLibrary(bundle);
    if (inspection.status === 'newer' || inspection.status === 'invalid') await assertLibraryWrite(bundle);
    if (inspection.status === 'current') throw new OkfError('ALREADY_CURRENT', 'This bundle already uses the installed memory format.');
    const documents = await Promise.all((await scan(bundle)).map(async file => parseConcept(bundle.name, file.path, (await current(bundle, file.path))!)));
    if(documents.length>10000)throw new OkfError('MIGRATION_LIMIT','Migration supports at most 10,000 Markdown documents per bundle; partition the bundle explicitly before previewing.');
    const bundleId=inspection.id ?? randomUUID();
    const preview: MaintenancePreview = { version: 1, bundle: bundle.name, root: bundle.root, purpose: 'migration', reason: `Explicit migration to memory library format ${SUPPORTED_FORMAT_VERSION}.`, previewHash: '', changes: [], guards: documents.map(concept => ({ path: concept.path, expectedHash: concept.hash })), diagnostics: [], unresolved: [], allowNamespaceChange: false };
    const history = emptyHistory();
    for (const concept of documents) {
      const decision = request.decisions?.[concept.path] ?? {};
      let raw = decision.raw ?? concept.raw;
      const metadata = record(parseConcept(bundle.name, concept.path, raw).metadata.memory);
      for (const field of ['id', 'kind', 'stage', 'applicability'] as const) if (!isControl(concept.path) && decision[field] === undefined && metadata[field] === undefined) preview.unresolved.push({path: concept.path, field, message: `Supply an explicit ${field} migration decision.`});
      const syntaxError=concept.diagnostics.some(item=>item.code==='MALFORMED_FRONTMATTER');
      if (syntaxError && decision.raw === undefined) preview.unresolved.push({path: concept.path, field: 'frontmatter', message: 'Repair malformed YAML explicitly. Original bytes remain retained.'});
      const hasFrontmatter=/^(?:\uFEFF)?---\r?\n/.test(raw);
      if(decision.raw===undefined && !hasFrontmatter && !isControl(concept.path) && ['id','kind','stage','applicability'].every(field=>decision[field as keyof typeof decision]!==undefined))raw='---\ntype: Memory\nmemory: '+JSON.stringify({id:decision.id,kind:decision.kind,stage:decision.stage,applicability:decision.applicability})+'\n---\n'+concept.raw;
      if (decision.raw === undefined && !syntaxError && (hasFrontmatter || raw!==concept.raw)) raw = patchMetadata(raw, [...(['id', 'kind', 'stage', 'applicability'] as const).filter(field => decision[field] !== undefined).map(field => ({ path: ['memory', field], value: decision[field] }))]);
      if (decision.raw === undefined && !syntaxError && (hasFrontmatter || raw!==concept.raw)) {
        const fields: Array<{path: string[]; value: unknown}> = [];
        for (const [field, target] of [['actor',['generated','by']],['at',['generated','at']],['title',['title']],['description',['description']],['tags',['tags']],['sources',['sources']],['status',['status']],['occurredAt',['memory','occurred_at']],['task',['memory','task']],['retentionReason',['memory','retention_reason']],['expiresAt',['memory','expires_at']],['staleAfter',['stale_after']],['archivedAt',['memory','archived_at']],['prerequisites',['memory','prerequisites']],['replaces',['memory','replaces']],['replacedBy',['memory','replaced_by']],['derivedFrom',['memory','derived_from']]] as const) if (decision[field] !== undefined) fields.push({path: [...target], value: decision[field] === null ? undefined : decision[field]});
        if (fields.length) raw = patchMetadata(raw, fields);
      }
      try { validLibraryNote(bundle.name, concept.path, raw); } catch (error) { preview.unresolved.push({ path: concept.path, field: error instanceof OkfError ? error.code : 'raw', message: error instanceof Error ? error.message : String(error) }); }
      const candidate = makeProposal(bundle, { bundle: bundle.name, path: concept.path, raw, expectedHash: concept.hash, actor: { type: 'agent', id: 'migration' }, reason: 'Explicit classification migration; original bytes retained.' }, concept.raw, []);
      candidate.humanRequired = true; candidate.revisionHash = proposalDigest(candidate); history.proposals.push(candidate);
      if (raw !== concept.raw) preview.changes.push({ path: concept.path, expectedHash: concept.hash, before: concept.raw, raw, afterHash: hash(raw) });
    }
    const candidates=new Map(history.proposals.map(proposal=>[proposal.path,proposal]));
    for(const proposal of history.proposals) {
      const concept=parseConcept(bundle.name,proposal.path,proposal.after!.raw),metadataSources=Array.isArray(concept.metadata.sources)?concept.metadata.sources:[],derivations=record(concept.metadata.memory).derived_from,sources:SourceRevision[]=[];
      for(const citation of [...metadataSources,...(Array.isArray(derivations)?derivations:[])]) {
        const value=typeof citation==='string'?citation:record(citation).resource;if(typeof value!=='string'){preview.unresolved.push({path:proposal.path,field:'sources',message:'Supply explicit valid source references.'});continue;}
        const link=resolveLink(proposal.path,value);if(link.external)continue;
        const source=candidates.get(link.target),memory=source?.after?record(parseConcept(bundle.name,link.target,source.after.raw).metadata.memory):{};
        if(link.unsafe || link.target===proposal.path || !source?.after){preview.unresolved.push({path:proposal.path,field:'sources',message:`Resolve the local source ${link.target} in the migration candidate inventory.`});continue;}
        if(record(citation).content_hash!==undefined && record(citation).content_hash!==source.after.hash)preview.unresolved.push({path:proposal.path,field:'derivedFrom',message:`Bind ${link.target} to its explicit migrated raw revision ${source.after.hash}.`});
        let sourceApplicability:Applicability|undefined;try{sourceApplicability=applicability(memory.applicability);}catch{}
        sources.push({...(sourceApplicability?{applicability:sourceApplicability}:{}),bundle:bundleId,path:link.target,hash:source.after.hash,displayTitle:parseConcept(bundle.name,link.target,source.after.raw).title,...(nonempty(memory.id)?{id:memory.id}:{})});
      }
      proposal.sources=[...new Map(sources.map(source=>[sourceKey(source),source])).values()].sort((a,b)=>sourceKey(a).localeCompare(sourceKey(b)));proposal.revisionHash=proposalDigest(proposal);
    }
    const ids = new Set<string>();
    for (const proposal of history.proposals) { const memoryId = record(parseConcept(bundle.name, proposal.path, proposal.after!.raw).metadata.memory).id; if (typeof memoryId === 'string') { if (ids.has(memoryId)) preview.unresolved.push({ path: proposal.path, field: 'id', message: 'Each memory must have a unique stable ID.' }); ids.add(memoryId); } }
    for (const output of [{ path: HISTORY_PATH, raw: JSON.stringify(history, null, 2) + '\n' }, { path: MANIFEST_PATH, raw: JSON.stringify({ formatVersion: SUPPORTED_FORMAT_VERSION, id: bundleId, name: inspection.name }, null, 2) + '\n' }]) {
      const before = await current(bundle, output.path); if (before !== null) preview.guards.push({ path: output.path, expectedHash: hash(before) });
      preview.changes.push({ path: output.path, expectedHash: before === null ? null : hash(before), before, raw: output.raw, afterHash: hash(output.raw) });
    }
    preview.previewHash = previewDigest(preview); return preview;
  });
  store.applyMigration = request => operation(async () => {
    request = decode(ApplySchema, request); const bundle = library.select(request.preview.bundle); library.writable(bundle, request);
    if (request.preview.purpose !== 'migration' || request.preview.changes.at(-1)?.path !== MANIFEST_PATH || !request.preview.changes.some(change => change.path === HISTORY_PATH)) throw new OkfError('INVALID_PREVIEW', 'Library migration publishes portable history and the bundle marker last.');
    if (request.preview.unresolved.length || request.preview.diagnostics.some(item => item.level === 'error')) throw new OkfError('MIGRATION_DECISIONS_REQUIRED', 'Resolve every classification and applicability question before applying migration.', { unresolved: request.preview.unresolved });
    const inspection = await inspectLibrary(bundle); if (inspection.status === 'newer' || inspection.status === 'invalid') await assertLibraryWrite(bundle);
    const outputs = new Map(request.preview.changes.map(change => [change.path, change.raw]));
    const manifestRaw = outputs.get(MANIFEST_PATH), historyRaw = outputs.get(HISTORY_PATH);
    let marker: Record<string, unknown>, proposedHistory: History;
    try { marker = record(JSON.parse(manifestRaw!)); proposedHistory = JSON.parse(historyRaw!); } catch { throw new OkfError('INVALID_PREVIEW', 'Migration contains invalid marker or history JSON.'); }
    if (marker.formatVersion !== SUPPORTED_FORMAT_VERSION || !nonempty(marker.id) || !nonempty(marker.name) || proposedHistory.version !== 1 || !Array.isArray(proposedHistory.proposals) || !Array.isArray(proposedHistory.decisions) || proposedHistory.decisions.length || proposedHistory.publication) throw new OkfError('INVALID_PREVIEW', 'Migration cannot import accepted decisions or omit portable pending history.');
    const inventory = new Map(request.preview.guards.filter(guard => guard.path.endsWith('.md')).map(guard => [guard.path, outputs.has(guard.path) ? outputs.get(guard.path) : undefined]));
    for (const [file, value] of inventory) {
      const raw = value === undefined ? await current(bundle, file) : value;
      if (raw === null) throw new OkfError('INVALID_PREVIEW', 'Migration preserves all legacy memories.');
      validLibraryNote(bundle.name, file, raw);
      const proposal = proposedHistory.proposals.find(item => item.path === file);
      if (!proposal || proposal.after?.raw !== raw || proposal.revisionHash !== proposalDigest(proposal) || proposal.before?.hash !== request.preview.guards.find(item => item.path === file)?.expectedHash || proposal.before?.raw === undefined || hash(proposal.before.raw) !== proposal.before.hash || proposal.after.hash !== hash(raw) || !proposal.humanRequired) throw new OkfError('INVALID_PREVIEW', 'Migration history must retain each original and exact pending revision.');
    }
    if (proposedHistory.proposals.length !== inventory.size || new Set(proposedHistory.proposals.filter(item=>!isControl(item.path)).map(item => record(parseConcept(bundle.name,item.path,item.after!.raw).metadata.memory).id)).size !== proposedHistory.proposals.filter(item=>!isControl(item.path)).length) throw new OkfError('INVALID_PREVIEW', 'Migration memories and stable identities must be unique and match the inventory.');
    return applyJournal(bundle, request.preview, options.afterJournalWrite);
  });
}
