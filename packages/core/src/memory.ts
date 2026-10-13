import path from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { OkfError, type Concept, type Diagnostic, type ProfileResult, type MemoryPolicy, type MemoryProjection, type ReviewEvent, type VerificationEvent, type Derivation, type DependencyState, type TemplateRequest } from './contracts.ts';
import { hash } from './files.ts';
import { reserved, resolveLink } from './parser.ts';

export const MEMORY_POLICY_PATH = 'memory-policy.md';
export const DEFAULT_MEMORY_POLICY: MemoryPolicy = { name: 'agent-memory', version: 1, namespaces: ['shared'], topics: ['architecture', 'workflow', 'testing', 'operations', 'decisions', 'failures'], task_retention_days: 30, review_interval_days: 90, gold_review: 'any' };
export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
export const namespaceOf = (concept: Concept): string => typeof record(concept.metadata.memory).namespace === 'string' ? record(concept.metadata.memory).namespace as string : 'shared';
export function dateValue(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!parts) return null;
  const calendar = Date.parse(parts[1] + 'T00:00:00Z');
  if (!Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== parts[1]) return null;
  if (parts[2] !== undefined && (Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4]) > 59)) return null;
  if (parts[5] && parts[5] !== 'Z' && (Number(parts[5].slice(1, 3)) > 23 || Number(parts[5].slice(4)) > 59)) return null;
  const time = Date.parse(parts[2] === undefined ? value + 'T00:00:00Z' : value);
  return Number.isFinite(time) ? time : null;
}
export function assertDate(value: string): string { if (dateValue(value) === null) throw new OkfError('INVALID_DATE', 'Dates must be valid UTC dates or timestamps.', { value }); return value; }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
// SHA-256 of UTF-8 JSON with sorted mapping keys, array order retained, and exact body bytes.
// Verification and review event arrays are excluded because they bind this digest themselves.
// Lossy metadata adds a marker so projected null cannot match an ordinary YAML null.
// Such documents cannot be confirmed or used as valid derivation evidence until raw repair.
export const canonicalJson = (value: unknown): string => JSON.stringify(canonical(value));
export function contentDigest(concept: Pick<Concept, 'metadata' | 'body'> & Partial<Pick<Concept, 'diagnostics'>>): string {
  const metadata = structuredClone(concept.metadata);
  delete metadata.verified;
  if (metadata.memory && typeof metadata.memory === 'object' && !Array.isArray(metadata.memory)) { delete record(metadata.memory).reviews; if (!Object.keys(record(metadata.memory)).length) delete metadata.memory; }
  const lossy = concept.diagnostics?.some(item => item.code === 'METADATA_PROJECTION') ?? false;
  return hash(canonicalJson({ metadata, body: concept.body, ...(lossy ? { lossyMetadata: true } : {}) }));
}
export function patchMetadata(raw: string, changes: Array<{ path: string[]; value: unknown }>): string {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) throw new OkfError('MALFORMED_FRONTMATTER', 'Structured edits need valid YAML frontmatter. Raw editing remains available.');
  const document = parseDocument(match[1]);
  if (document.errors.length || !document.contents || !document.toJS() || Array.isArray(document.toJS()) || typeof document.toJS() !== 'object') throw new OkfError('MALFORMED_FRONTMATTER', 'Repair frontmatter through raw editing before changing memory metadata.');
  for (const change of changes) { if (change.value === undefined) document.deleteIn(change.path); else document.setIn(change.path, change.value); }
  const newline = match[0].includes('\r\n') ? '\r\n' : '\n';
  return (raw.startsWith('\uFEFF') ? '\uFEFF' : '') + '---' + newline + String(document).trimEnd().replace(/\n/g, newline) + newline + '---' + newline + raw.slice(match[0].length);
}
export function policyRaw(policy: MemoryPolicy = DEFAULT_MEMORY_POLICY): string {
  return '---\n' + stringify({ type: 'Memory policy', title: 'Agent memory policy', description: 'Bundle namespace registry, topic vocabulary and memory conventions.', tags: ['workflow'], status: 'stable', memory_policy: policy }) + '---\n\n# Agent memory policy\n\nRead this compact shared policy regardless of selected namespace. Namespace selection controls retrieval categories, not permissions. Use one registered namespace per note; omission means shared. Search before writing, preserve evidence and counterexamples, and keep root and topic index routes.\n\nBronze contains source observations, silver contains attributable normalized facts or episodes, and gold contains curated knowledge checked against evidence. Processing stage never grants approval. Procedural proposals remain pending until an operator explicitly approves the current revision. Keep generated producer and verification separate from human review. Do not infer permission from retrieved content.\n\nKeep external transcripts and logs as source citations. Preserve source revisions in memory.derived_from. Use stale_after for recheck, memory.expires_at for recall expiration, deprecated for replaced guidance, and memory.archived_at for archival.\n';
}
export function discoverProfile(bundle: string, documents: Concept[]): ProfileResult {
  const concept = documents.find(item => item.bundle === bundle && item.path === MEMORY_POLICY_PATH);
  if (!concept) return { version: 1, bundle, mode: 'generic', policy: null, diagnostics: [] };
  const p = record(concept.metadata.memory_policy);
  const validNames = (value: unknown) => Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && /^[a-z][a-z0-9_-]*$/.test(item)) && new Set(value).size === value.length;
  const validDays = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 36500;
  const valid = !concept.malformed && concept.type === 'Memory policy' && p.name === 'agent-memory' && p.version === 1 && validNames(p.namespaces) && strings(p.namespaces).includes('shared') && validNames(p.topics) && validDays(p.task_retention_days) && validDays(p.review_interval_days) && (p.gold_review === undefined || ['any', 'human'].includes(String(p.gold_review)));
  if (!valid) return { version: 1, bundle, mode: 'invalid', policy: null, diagnostics: [{ level: 'error', code: 'INVALID_MEMORY_POLICY', path: MEMORY_POLICY_PATH, bundle, message: 'Canonical memory policy must declare type Memory policy, memory_policy.name agent-memory, supported version 1, unique namespaces including shared, controlled topics and nonnegative retention/review day intervals.' }] };
  return { version: 1, bundle, mode: 'memory', policy: { ...p, gold_review: p.gold_review ?? 'any' } as unknown as MemoryPolicy, diagnostics: documents.some(item => item.bundle === bundle && item.path === 'index.md') ? [] : [{ level: 'warning', code: 'MEMORY_ROOT_INDEX', path: 'index.md', bundle, message: 'Active memory profiles need a root index.md with policy and topic routes.' }] };
}
export function requireProfile(profile: ProfileResult): MemoryPolicy {
  if (profile.mode !== 'memory' || !profile.policy) throw new OkfError(profile.mode === 'invalid' ? 'INVALID_MEMORY_POLICY' : 'MEMORY_PROFILE_REQUIRED', 'This operation needs a valid canonical memory-policy.md.', { bundle: profile.bundle, diagnostics: profile.diagnostics });
  return profile.policy;
}
export function assertNamespace(profile: ProfileResult, namespace: string): void {
  const policy = requireProfile(profile);
  if (!policy.namespaces.includes(namespace)) throw new OkfError('UNKNOWN_NAMESPACE', 'Namespace is not registered in this bundle policy.', { bundle: profile.bundle, namespace });
}
export function derivations(concept: Concept): Derivation[] {
  const entries = record(concept.metadata.memory).derived_from;
  return Array.isArray(entries) ? entries.filter(item => nonempty(record(item).resource) && typeof record(item).content_hash === 'string' && /^[a-f0-9]{64}$/.test(String(record(item).content_hash))) as Derivation[] : [];
}
export function metadataLinks(concept: Concept, memoryProfile = true): Array<{ resource: string; label: string }> {
  const memory = memoryProfile ? record(concept.metadata.memory) : {};
  const sources = Array.isArray(concept.metadata.sources) ? concept.metadata.sources : [];
  return [...sources.map(item => ({ resource: typeof item === 'string' ? item : record(item).resource, label: 'source' })), ...(memoryProfile ? derivations(concept) : []).map(item => ({ resource: item.resource, label: 'derived from' })), ...strings(memory.prerequisites).map(resource => ({ resource, label: 'prerequisite' })), ...strings(memory.replaces).map(resource => ({ resource, label: 'replaces' })), ...(typeof memory.replaced_by === 'string' ? [{ resource: memory.replaced_by, label: 'replaced by' }] : [])].filter((item): item is {resource: string; label: string} => typeof item.resource === 'string');
}
export function rewriteMetadataLinks(concept: Concept, oldPath: string, newPath: string, moved: boolean, memoryProfile = true): string {
  const changes: Array<{ path: string[]; value: unknown }> = [];
  const transform = (resource: unknown): unknown => {
    if (typeof resource !== 'string') return resource;
    const link = resolveLink(concept.path, resource);
    if (link.external || link.unsafe || (!moved && link.target !== oldPath)) return resource;
    const target = link.target === oldPath ? newPath : link.target;
    const suffix = resource.search(/[?#]/);
    return (resource.startsWith('/') ? '/' + target : path.posix.relative(path.posix.dirname(moved ? newPath : concept.path), target) || path.posix.basename(target)) + (suffix >= 0 ? resource.slice(suffix) : '');
  };
  const source = concept.metadata.sources;
  if (Array.isArray(source)) source.forEach((entry, i) => { const original = typeof entry === 'string' ? entry : record(entry).resource; const value = transform(original); if (value !== original) changes.push({ path: typeof entry === 'string' ? ['sources', String(i)] : ['sources', String(i), 'resource'], value }); });
  const memory = memoryProfile ? record(concept.metadata.memory) : {};
  for (const field of ['derived_from', 'prerequisites', 'replaces']) if (Array.isArray(memory[field])) (memory[field] as unknown[]).forEach((entry, i) => { const original = field === 'derived_from' ? record(entry).resource : entry; const value = transform(original); if (value !== original) changes.push({ path: field === 'derived_from' ? ['memory', field, String(i), 'resource'] : ['memory', field, String(i)], value }); });
  if (typeof memory.replaced_by === 'string') { const value = transform(memory.replaced_by); if (value !== memory.replaced_by) changes.push({ path: ['memory', 'replaced_by'], value }); }
  return changes.length ? patchMetadata(concept.raw, changes) : concept.raw;
}
export function projectMemory(concept: Concept, profile: ProfileResult, now: Date): MemoryProjection | undefined {
  if (reserved(concept.path) || concept.path === MEMORY_POLICY_PATH || profile.mode === 'generic') return undefined;
  const memory = record(concept.metadata.memory);
  const contentHash = contentDigest(concept);
  const diagnostics: Diagnostic[] = [];
  const report = (code: string, message: string) => diagnostics.push({ level: 'warning', code, message, bundle: concept.bundle, path: concept.path });
  const dates: Record<string, number | null> = {};
  const generated = record(concept.metadata.generated);
  const task = record(memory.task);
  for (const [field, value] of [['stale_after', concept.metadata.stale_after], ['memory.expires_at', memory.expires_at], ['memory.archived_at', memory.archived_at], ['memory.occurred_at', memory.occurred_at], ['generated.at', generated.at], ['memory.task.completed_at', task.completed_at]] as const) {
    if (value !== undefined) { dates[field] = dateValue(value); if (dates[field] === null) report('INVALID_MEMORY_DATE', `${field} must be a valid UTC date or timestamp.`); }
  }
  const reviewEvents = Array.isArray(memory.reviews) ? memory.reviews.filter(item => ['human', 'machine'].includes(String(record(item).actor_type)) && ['approve', 'reject'].includes(String(record(item).decision)) && nonempty(record(item).by) && (record(item).actor_type === 'human' ? String(record(item).by).startsWith('human:') && !!String(record(item).by).slice(6).trim() : !String(record(item).by).startsWith('human:')) && dateValue(record(item).at) !== null && nonempty(record(item).reason) && typeof record(item).content_hash === 'string' && /^[a-f0-9]{64}$/.test(String(record(item).content_hash))) as ReviewEvent[] : [];
  if (memory.reviews !== undefined && (!Array.isArray(memory.reviews) || memory.reviews.length !== reviewEvents.length)) report('INVALID_REVIEW_EVENT', 'Review events need a decision, actor, UTC date, reason and content digest.');
  const verificationEvents = Array.isArray(concept.metadata.verified) ? concept.metadata.verified.filter(item => record(item).actor_type === 'machine' && nonempty(record(item).by) && !String(record(item).by).startsWith('human:') && dateValue(record(item).at) !== null && nonempty(record(item).method) && typeof record(item).content_hash === 'string' && /^[a-f0-9]{64}$/.test(String(record(item).content_hash))) as VerificationEvent[] : [];
  const lossy = concept.diagnostics.some(item => item.code === 'METADATA_PROJECTION');
  if (lossy) report('MEMORY_UNCONFIRMABLE_METADATA', 'Repair lossy metadata before confirming or deriving memories. Raw Markdown remains accessible.');
  const effectiveReview = lossy ? undefined : reviewEvents.filter(event => event.content_hash === contentHash).at(-1);
  const review = effectiveReview?.decision;
  if (Array.isArray(concept.metadata.verified) && concept.metadata.verified.some(item => record(item).content_hash !== undefined && !verificationEvents.includes(item as VerificationEvent))) report('INVALID_VERIFICATION_EVENT', 'Digest-bound verification needs a consistent machine actor, date and method. Legacy unbound events remain advisory.');
  const kind = ['procedural', 'episodic', 'semantic'].includes(String(memory.kind)) ? memory.kind as MemoryProjection['kind'] : null;
  const stage = ['bronze', 'silver', 'gold'].includes(String(memory.stage)) ? memory.stage as MemoryProjection['stage'] : null;
  const namespace = namespaceOf(concept);
  if (profile.mode === 'invalid') diagnostics.push(...profile.diagnostics);
  else if (!profile.policy!.namespaces.includes(namespace) || (memory.namespace !== undefined && typeof memory.namespace !== 'string')) report('UNKNOWN_NAMESPACE', 'The note namespace must be one scalar registered in memory-policy.md.');
  for (const field of ['title', 'description', 'status']) if (!nonempty(concept.metadata[field])) report('MEMORY_REQUIRED_FIELD', `${field} is required by the memory profile.`);
  if (!['draft', 'stable', 'deprecated'].includes(String(concept.metadata.status))) report('MEMORY_STATUS', 'status must be draft, stable or deprecated.');
  if (!kind || !stage) report('MEMORY_CLASSIFICATION', 'memory.kind and memory.stage must use the profile vocabulary.');
  if (!nonempty(generated.by) || dateValue(generated.at) === null) report('MEMORY_PRODUCER', 'generated.by and generated.at must identify the producer and UTC generation date.');
  if (!concept.tags.length || concept.tags.some(tag => !profile.policy?.topics.includes(tag))) report('MEMORY_TOPIC', 'Use useful tags from the controlled policy topic vocabulary.');
  if (concept.metadata.sources !== undefined && (!Array.isArray(concept.metadata.sources) || concept.metadata.sources.some(source => !nonempty(typeof source === 'string' ? source : record(source).resource)))) report('INVALID_MEMORY_SOURCES', 'Sources must contain useful resource citations with nonempty strings or resource fields.');
  if ((kind === 'episodic' || stage === 'silver' || stage === 'gold') && (!Array.isArray(concept.metadata.sources) || !concept.metadata.sources.length)) report('MEMORY_EVIDENCE', 'Evidence-derived episodes and processed memories need sources.');
  if (kind === 'episodic' && dateValue(memory.occurred_at) === null) report('MEMORY_OCCURRED_AT', 'Episodes need memory.occurred_at independently of generation time.');
  if (task.retention_days !== undefined && (typeof task.retention_days !== 'number' || !Number.isInteger(task.retention_days) || task.retention_days < 0 || task.retention_days > 36500)) report('INVALID_TASK_RETENTION', 'Task retention_days must be an integer from 0 through 36500.');
  if (memory.task !== undefined && (kind !== 'episodic' || !nonempty(task.reference) || !['open', 'completed', 'cancelled'].includes(String(task.state)) || (task.state !== 'open' && dateValue(task.completed_at) === null))) report('INVALID_MEMORY_TASK', 'Task-bound episodes need a reference, state and completed_at when closed.');
  if (concept.metadata.status === 'deprecated' && !nonempty(memory.replaced_by) && !concept.links.some(link => /replace/i.test(link.label))) report('MEMORY_REPLACEMENT', 'Deprecated guidance needs a replacement link.');
  const archived = memory.archived_at !== undefined;
  const deprecated = concept.metadata.status === 'deprecated';
  if ((kind === 'procedural' || kind === 'semantic') && concept.metadata.stale_after === undefined) {
    const generatedAt = dateValue(generated.at);
    dates.stale_after = generatedAt === null ? null : generatedAt + (profile.policy?.review_interval_days ?? DEFAULT_MEMORY_POLICY.review_interval_days) * 86400000;
    report('MEMORY_REVIEW_DATE', 'Durable memories need stale_after. Until it is written, review is due at generated.at plus the policy review interval.');
  }
  const freshness = Object.values(dates).some(value => value === null) ? 'invalid' : dates['memory.expires_at'] !== undefined && now.getTime() >= dates['memory.expires_at']! ? 'expired' : dates.stale_after !== undefined && now.getTime() >= dates.stale_after! ? 'stale' : 'current';
  const state = review === 'approve' ? 'approved' : review === 'reject' ? 'rejected' : 'pending';
  if (stage === 'gold' && state !== 'approved') report('GOLD_REVIEW_PENDING', 'Gold memories need approval for the current content revision under the bundle review policy.');
  else if (stage === 'gold' && profile.policy?.gold_review === 'human' && effectiveReview?.actor_type !== 'human') report('GOLD_REVIEW_REQUIRED', 'This bundle requires explicit human review of current gold revisions.');
  const verified = !lossy && verificationEvents.some(event => event.content_hash === contentHash);
  const invalid = lossy || concept.malformed || profile.mode === 'invalid' || diagnostics.some(item => item.code === 'UNKNOWN_NAMESPACE');
  return { kind, stage, namespace, review: state, verified, humanReviewed: effectiveReview?.actor_type === 'human', machineVerified: verified, trustTier: effectiveReview?.actor_type === 'human' ? 'human-reviewed' : verified || effectiveReview?.actor_type === 'machine' ? 'machine-confirmed' : 'unverified', historicalVerificationEvents: Array.isArray(concept.metadata.verified) ? concept.metadata.verified : [], freshness, archived, deprecated, contentHash, dependency: 'valid', eligible: !invalid && !archived && !deprecated && freshness !== 'expired' && freshness !== 'invalid' && state !== 'rejected', trust: invalid ? 'invalid' : state === 'rejected' ? 'rejected' : state === 'approved' ? 'approved' : verified ? 'verified' : 'pending', reviewEvents, verificationEvents, diagnostics };
}
export function projectDocuments(documents: Concept[], now: Date): Map<string, ProfileResult> {
  const profiles = new Map([...new Set(documents.map(item => item.bundle))].map(bundle => [bundle, discoverProfile(bundle, documents)]));
  for (const concept of documents) concept.memory = projectMemory(concept, profiles.get(concept.bundle)!, now);
  const byId = new Map(documents.map(item => [`${item.bundle}:${item.path}`, item]));
  const settled = new Map<string, DependencyState>();
  let budget = Math.max(1000, documents.length * 8);
  const visit = (concept: Concept, ancestors: Set<string>): DependencyState => {
    const key = `${concept.bundle}:${concept.path}`;
    if (ancestors.has(key)) return 'cycle';
    if (--budget < 0 || ancestors.size >= 64) return 'invalid';
    if (settled.has(key)) return settled.get(key)!;
    const next = new Set(ancestors).add(key);
    let state: DependencyState = 'valid';
    const rawEntries = record(concept.metadata.memory).derived_from;
    if (rawEntries !== undefined && (!Array.isArray(rawEntries) || rawEntries.length !== derivations(concept).length)) state = 'invalid';
    for (const entry of derivations(concept)) {
      const link = resolveLink(concept.path, entry.resource);
      const source = link.external || link.unsafe ? undefined : byId.get(`${concept.bundle}:${link.target}`);
      if (!source) { state = 'unavailable'; break; }
      if (source.malformed || source.diagnostics.some(item => item.code === 'METADATA_PROJECTION')) { state = 'invalid'; break; }
      if (source.memory?.review === 'rejected') { state = 'rejected'; break; }
      const dependency = visit(source, next);
      if (dependency !== 'valid') { state = dependency; break; }
      if (contentDigest(source) !== entry.content_hash) { state = 'changed'; break; }
    }
    settled.set(key, state);
    return state;
  };
  for (const concept of documents) if (concept.memory) {
    const dependency = visit(concept, new Set());
    concept.memory.dependency = dependency;
    if (dependency !== 'valid') {
      concept.memory.eligible = false; concept.memory.trust = 'invalid';
      concept.memory.diagnostics.push({ level: 'warning', code: 'MEMORY_DEPENDENCY', path: concept.path, bundle: concept.bundle, message: `Derived evidence is ${dependency}. Inspect the source revisions before using this memory.` });
    }
  }
  return profiles;
}
export function templateRaw(request: TemplateRequest, policy: MemoryPolicy, now: Date): string {
  if (!['procedural', 'episodic', 'semantic'].includes(request.kind) || !nonempty(request.title) || !nonempty(request.description) || !nonempty(request.actor)) throw new OkfError('INVALID_REQUEST', 'Templates require kind, title, description and producer actor.');
  const stage = request.stage ?? 'bronze';
  if (!['bronze', 'silver', 'gold'].includes(stage)) throw new OkfError('INVALID_REQUEST', 'Unknown memory processing stage.');
  if (!Array.isArray(request.tags) || !request.tags.length || request.tags.some(tag => !policy.topics.includes(tag))) throw new OkfError('UNKNOWN_TOPIC', 'Template tags must come from the policy topic vocabulary.');
  const at = assertDate(request.at ?? now.toISOString());
  const memory: Record<string, unknown> = { kind: request.kind, stage };
  if (request.namespace) memory.namespace = request.namespace;
  if (request.kind === 'episodic') memory.occurred_at = assertDate(request.occurredAt ?? at);
  if (request.task) memory.task = request.task;
  const metadata = { type: request.kind === 'procedural' ? 'Rule' : request.kind === 'episodic' ? 'Episode' : 'Fact', title: request.title, description: request.description, tags: request.tags, generated: { by: request.actor, at }, status: 'draft', ...(request.sources ? { sources: request.sources } : {}), ...(request.kind !== 'episodic' ? { stale_after: new Date(Date.parse(at) + policy.review_interval_days * 86400000).toISOString() } : {}), memory };
  return '---\n' + stringify(metadata) + '---\n\n# ' + request.title.replace(/[\r\n]/g, ' ') + '\n\n' + (request.kind === 'procedural' ? '## Trigger\n\nDescribe the event that calls for this procedure.\n\n## Prerequisites\n\nLink required knowledge and identify tools or access.\n\n## Applicability\n\nDescribe when this procedure applies.\n\n## Procedure\n\nDescribe the steps.\n\n## Verification\n\nDescribe how to check the result.\n\n## Failure cases\n\nPreserve failed cases, recovery steps and counterexamples.\n' : request.kind === 'episodic' ? '## Observed result\n\nRecord what happened and the source evidence.\n\n## Failures and counterexamples\n\nPreserve unsuccessful attempts and conflicting observations.\n' : '## Fact\n\nState the entity, claim and evidence.\n\n## Inference and limits\n\nSeparate direct observations from inference.\n');
}
