import { Effect } from 'effect';
import type { Bundle, Concept, ConceptSummary, Store, StoreOptions, WriteRequest, MutationResult, MemoryPolicy, MaintenanceProposal, MaintenancePreview, MigrationIssue } from './contracts.ts';
import { OkfError } from './contracts.ts';
import { operation, hash, canonicalDirectory, cleanPath } from './files.ts';
import { parseConcept, reserved, resolveLink } from './parser.ts';
import { decode, TemplateSchema, ReviewSchema, VerifySchema, TaskRequestSchema, LifecycleSchema, ProposalSchema, ApplySchema, MigrationSchema, InspectSchema, RecoverySchema } from './schemas.ts';
import { assertDate, assertNamespace, contentDigest, dateValue, DEFAULT_MEMORY_POLICY, discoverProfile, derivations, metadataLinks, namespaceOf, patchMetadata, policyRaw, record, requireProfile, strings, templateRaw, projectDocuments } from './memory.ts';
import { applyJournal, previewDigest, inspectJournal, recoverJournalLock } from './maintenance.ts';

export interface MemoryOperations {
  load(bundle?: string, detailed?: boolean): Promise<Concept[]>;
  read(bundle: string, path: string): Promise<Concept>;
  save(request: WriteRequest): Promise<MutationResult>;
  select(name: string): Bundle;
  writable(bundle: Bundle, request: { authorizePersonal?: boolean }): void;
  now(): Date; options: StoreOptions; summary(concept: Concept): ConceptSummary;
}
const text = (value: string, field: string) => { if (!value.trim() || value.length > 2048) throw new OkfError('INVALID_REQUEST', `${field} must be nonempty and at most 2048 characters.`); return value; };
const digest = (value: string | null) => { if (value !== null && !/^[a-f0-9]{64}$/.test(value)) throw new OkfError('INVALID_REQUEST', 'Expected hashes must be SHA-256 hex digests.'); };
export function attachMemoryOperations(store: Store, runtime: MemoryOperations): void {
  const profile = async (bundle: string) => { runtime.select(bundle); return discoverProfile(bundle, await runtime.load(bundle, false)); };
  const editable = async (request: { bundle: string; path: string; expectedHash: string; authorizePersonal?: boolean }) => {
    digest(request.expectedHash);
    runtime.writable(runtime.select(request.bundle), request);
    requireProfile(await profile(request.bundle));
    const concept = await runtime.read(request.bundle, request.path);
    if (reserved(concept.path) || concept.path === 'memory-policy.md') throw new OkfError('INVALID_REQUEST', 'This operation applies to memory concepts.');
    if (concept.hash !== request.expectedHash) throw new OkfError('CONFLICT', 'The concept changed since it was read.', { expectedHash: request.expectedHash, actualHash: concept.hash });
    if (concept.malformed) throw new OkfError('MALFORMED_FRONTMATTER', 'Repair the raw document before structured memory operations.');
    return concept;
  };
  const persist = (request: { bundle: string; path: string; expectedHash: string; authorizePersonal?: boolean }, raw: string) => runtime.save({ ...request, raw });
  store.profile = bundle => operation(() => profile(bundle));
  store.namespaces = bundle => operation(async () => { const result = await profile(bundle); if (result.mode === 'invalid') requireProfile(result); return { version: 1, bundle, namespaces: result.policy?.namespaces ?? ['shared'], shared: 'shared', mode: result.mode }; });
  store.bootstrap = bundle => operation(async () => {
    const result = await profile(bundle);
    const documents = await runtime.load(bundle, false);
    const file = result.mode === 'generic' ? 'index.md' : 'memory-policy.md';
    return { version: 1, bundle, path: file, raw: documents.find(item => item.path === file)?.raw ?? null, profile: result };
  });
  store.template = request => operation(async () => {
    decode(TemplateSchema, request);
    const result = await profile(request.bundle);
    assertNamespace(result, request.namespace ?? 'shared');
    if (request.task && (request.kind !== 'episodic' || !request.task.reference.trim() || request.task.state !== 'open' && dateValue(request.task.completed_at) === null)) throw new OkfError('INVALID_REQUEST', 'Task-bound episodes require reference and a completed UTC timestamp when closed.');
    return { version: 1, bundle: request.bundle, raw: templateRaw(request, requireProfile(result), runtime.now()) };
  });
  store.review = request => operation(async () => {
    decode(ReviewSchema, request);
    text(request.actor, 'actor'); text(request.reason, 'reason');
    const human = request.actor.startsWith('human:');
    if (human && (!request.operator || !request.actor.slice(6).trim())) throw new OkfError('HUMAN_REVIEW_AUTHORIZATION', 'A human: actor requires explicit operator acknowledgement and a nonempty identity.');
    const concept = await editable(request);
    if (concept.diagnostics.some(item => item.code === 'METADATA_PROJECTION')) throw new OkfError('LOSSY_METADATA', 'Repair projected YAML metadata before reviewing this revision.');
    const existing = record(concept.metadata.memory).reviews;
    const event = { decision: request.decision, actor_type: human ? 'human' : 'machine', by: request.actor, at: assertDate(request.at ?? runtime.now().toISOString()), reason: request.reason, content_hash: contentDigest(concept) };
    const events = Array.isArray(existing) ? existing : [];
    if (JSON.stringify(events.at(-1)) === JSON.stringify(event)) return persist(request, concept.raw);
    return persist(request, patchMetadata(concept.raw, [{ path: ['memory', 'reviews'], value: [...events, event] }]));
  });
  store.verify = request => operation(async () => {
    decode(VerifySchema, request);
    text(request.actor, 'actor'); text(request.method, 'method');
    if (request.actor.startsWith('human:')) throw new OkfError('HUMAN_REVIEW_AUTHORIZATION', 'Machine verification cannot manufacture a human confirmation. Use explicit operator review.');
    const concept = await editable(request);
    if (concept.diagnostics.some(item => item.code === 'METADATA_PROJECTION')) throw new OkfError('LOSSY_METADATA', 'Repair projected YAML metadata before verifying this revision.');
    const existing = concept.metadata.verified;
    const events = Array.isArray(existing) ? existing : existing === undefined ? [] : [existing];
    const event = { actor_type: 'machine', by: request.actor, at: assertDate(request.at ?? runtime.now().toISOString()), method: request.method, content_hash: contentDigest(concept) };
    if (JSON.stringify(events.at(-1)) === JSON.stringify(event)) return persist(request, concept.raw);
    return persist(request, patchMetadata(concept.raw, [{ path: ['verified'], value: [...events, event] }]));
  });
  store.updateTask = request => operation(async () => {
    decode(TaskRequestSchema, request);
    text(request.task.reference, 'task.reference');
    if (request.retentionDays !== undefined && request.retentionDays !== null && (!Number.isInteger(request.retentionDays) || request.retentionDays < 0 || request.retentionDays > 36500)) throw new OkfError('INVALID_REQUEST', 'Task retention days must be an integer from 0 through 36500.');
    const concept = await editable(request);
    if (record(concept.metadata.memory).kind !== 'episodic') throw new OkfError('INVALID_REQUEST', 'Task lifecycle belongs to episodic memories.');
    const memory = record(concept.metadata.memory);
    const task: Record<string, unknown> = { ...record(memory.task), ...request.task };
    if (request.task.state !== 'open') task.completed_at = assertDate(request.task.completed_at ?? runtime.now().toISOString());
    else delete task.completed_at;
    if (request.retentionDays === null) delete task.retention_days;
    else if (request.retentionDays !== undefined) task.retention_days = request.retentionDays;
    if (task.retention_days !== undefined && (typeof task.retention_days !== 'number' || !Number.isInteger(task.retention_days) || task.retention_days < 0 || task.retention_days > 36500)) throw new OkfError('INVALID_REQUEST', 'The existing task retention override is invalid. Reset it with retentionDays:null.');
    const retentionReason = request.retentionReason === null ? undefined : request.retentionReason ?? memory.retention_reason;
    if (retentionReason !== undefined && (typeof retentionReason !== 'string' || !retentionReason.trim())) throw new OkfError('INVALID_REQUEST', 'A historical retention reason must be nonempty.');
    const policy = requireProfile(await profile(request.bundle));
    const days = typeof task.retention_days === 'number' ? task.retention_days : policy.task_retention_days;
    const expires = request.task.state === 'open' || retentionReason ? undefined : new Date(Date.parse(task.completed_at as string) + days * 86400000).toISOString();
    return persist(request, patchMetadata(concept.raw, [{ path: ['memory', 'task'], value: task }, { path: ['memory', 'retention_reason'], value: retentionReason }, { path: ['memory', 'expires_at'], value: expires }]));
  });
  store.lifecycle = request => operation(async () => {
    decode(LifecycleSchema, request);
    const concept = await editable(request);
    const changes: Array<{path: string[]; value: unknown}> = [];
    const at = assertDate(request.at ?? runtime.now().toISOString());
    if (request.action === 'archive') changes.push({ path: ['memory', 'archived_at'], value: at });
    if (request.action === 'restore') changes.push({ path: ['memory', 'archived_at'], value: undefined });
    if (request.action === 'expire') changes.push({ path: ['memory', 'expires_at'], value: at });
    if (request.action === 'clear-expiration') changes.push({ path: ['memory', 'expires_at'], value: undefined });
    if (request.action === 'recheck') { const policy = requireProfile(await profile(request.bundle)); changes.push({ path: ['stale_after'], value: request.at === undefined ? new Date(runtime.now().getTime() + policy.review_interval_days * 86400000).toISOString() : at }); }
    if (request.action === 'deprecate') {
      if (!request.replacement?.trim()) throw new OkfError('REPLACEMENT_REQUIRED', 'Deprecating guidance requires an explicit replacement.');
      changes.push({ path: ['status'], value: 'deprecated' }, { path: ['memory', 'replaced_by'], value: request.replacement });
    }
    if (request.reason !== undefined) changes.push({ path: ['memory', 'lifecycle_reason'], value: text(request.reason, 'reason') });
    return persist(request, patchMetadata(concept.raw, changes));
  });
  store.audit = (options = {}) => operation(async () => {
    if (!options || typeof options !== 'object' || options.bundle !== undefined && typeof options.bundle !== 'string' || options.namespaces !== undefined && (!Array.isArray(options.namespaces) || options.namespaces.some(item => typeof item !== 'string'))) throw new OkfError('INVALID_REQUEST', 'Audit options require a bundle and optional namespace list.');
    const documents = await runtime.load(options.bundle);
    const registered = new Set(['shared', ...(options.bundle ? [runtime.select(options.bundle)] : store.context.bundles).flatMap(bundle => discoverProfile(bundle.name, documents).policy?.namespaces ?? [])]);
    for (const namespace of options.namespaces ?? []) if (!registered.has(namespace)) throw new OkfError('UNKNOWN_NAMESPACE', 'Namespace is not registered in any selected bundle.', { namespace });
    const selected = documents.filter(item => !reserved(item.path) && (!options.namespaces?.length || (item.memory?.namespace ?? 'shared') === 'shared' || options.namespaces.includes(item.memory?.namespace ?? 'shared')));
    return { version: 1, concepts: selected.map(runtime.summary), diagnostics: [...documents.flatMap(item => [...item.diagnostics, ...(item.memory?.diagnostics ?? [])]), ...store.context.bundles.filter(item => !options.bundle || item.name === options.bundle).flatMap(item => discoverProfile(item.name, documents).diagnostics)] };
  });
  store.previewMaintenance = proposal => operation(async () => {
    decode(ProposalSchema, proposal);
    text(proposal.reason, 'reason');
    const bundle = runtime.select(proposal.bundle);
    const documents = await runtime.load(bundle.name);
    if (proposal.purpose !== 'migration') requireProfile(discoverProfile(bundle.name, documents));
    if (proposal.changes.length > 100) throw new OkfError('BATCH_LIMIT', 'Maintenance proposals are limited to 100 document changes.');
    const changes = proposal.changes.map(change => {
      digest(change.expectedHash);
      if (cleanPath(change.path) !== change.path) throw new OkfError('INVALID_PATH', 'Proposal paths must be canonical bundle-relative paths.');
      if (!change.path.endsWith('.md')) throw new OkfError('INVALID_PATH', 'Proposal changes require Markdown documents.');
      const concept = documents.find(item => item.path === change.path);
      const before = concept?.raw ?? null;
      if ((concept?.hash ?? null) !== change.expectedHash) throw new OkfError('CONFLICT', 'A proposal input changed.', { path: change.path, expectedHash: change.expectedHash, actualHash: concept?.hash ?? null });
      if (change.raw === null && !concept) throw new OkfError('NOT_FOUND', 'Cannot delete a missing document.', { path: change.path });
      return { ...change, before, afterHash: change.raw === null ? null : hash(change.raw) };
    });
    if (new Set(changes.map(change => change.path)).size !== changes.length) throw new OkfError('INVALID_REQUEST', 'A proposal may change each document only once.');
    const preview: MaintenancePreview = { version: 1, bundle: bundle.name, root: await canonicalDirectory(bundle.root), purpose: proposal.purpose, reason: proposal.reason, previewHash: '', changes, guards: documents.map(item => ({ path: item.path, expectedHash: item.hash })), diagnostics: [], unresolved: [], allowNamespaceChange: proposal.allowNamespaceChange ?? false };
    validateProposal(preview, documents, runtime.now());
    preview.previewHash = previewDigest(preview);
    return preview;
  });
  store.recoverMaintenance = request => operation(async () => { decode(RecoverySchema, request); digest(request.previewHash); const bundle = runtime.select(request.bundle); runtime.writable(bundle, request); return recoverJournalLock(bundle, request.previewHash); });
  store.inspectMaintenance = request => operation(async () => { decode(InspectSchema, request); digest(request.previewHash); return inspectJournal(runtime.select(request.bundle), request.previewHash); });
  store.applyMaintenance = request => operation(async () => {
    decode(ApplySchema, request);
    const bundle = runtime.select(request.preview.bundle);
    runtime.writable(bundle, request);
    if (request.preview.previewHash !== previewDigest(request.preview)) throw new OkfError('INVALID_PREVIEW', 'The preview payload changed. Generate a fresh preview.');
    if (request.preview.unresolved.length || request.preview.diagnostics.some(item => item.level === 'error')) throw new OkfError('UNRESOLVED_PROPOSAL', 'Resolve all proposal conflicts and migration decisions before applying.', { unresolved: request.preview.unresolved, diagnostics: request.preview.diagnostics });
    const current = await runtime.load(bundle.name);
    const originals = current.filter(item => request.preview.guards.some(guard => guard.path === item.path) && !request.preview.changes.some(change => change.path === item.path));
    originals.push(...request.preview.changes.filter(change => change.before !== null).map(change => parseConcept(bundle.name, change.path, change.before!)));
    const checked: MaintenancePreview = { ...request.preview, diagnostics: [] };
    return applyJournal(bundle, request.preview, runtime.options.afterJournalWrite, async () => {
      validateProposal(checked, originals, runtime.now());
      if (checked.diagnostics.some(item => item.level === 'error')) throw new OkfError('UNRESOLVED_PROPOSAL', 'Proposal semantic checks failed.', { diagnostics: checked.diagnostics });
    });
  });
  store.previewMigration = request => operation(async () => {
    decode(MigrationSchema, request);
    const bundle = runtime.select(request.bundle);
    const documents = await runtime.load(bundle.name);
    const existingProfile = discoverProfile(bundle.name, documents);
    const originalPolicy = record(documents.find(item => item.path === 'memory-policy.md')?.metadata.memory_policy);
    const policy: MemoryPolicy = { ...DEFAULT_MEMORY_POLICY, ...originalPolicy, ...(existingProfile.policy ?? {}), ...(request.policy ?? {}), name: 'agent-memory', version: 1 };
    const policyConcept = parseConcept(bundle.name, 'memory-policy.md', policyRaw(policy));
    requireProfile(discoverProfile(bundle.name, [policyConcept]));
    const changes: MaintenanceProposal['changes'] = [];
    const unresolved: MigrationIssue[] = [];
    const oldPolicy = documents.find(item => item.path === 'memory-policy.md');
    if (!oldPolicy) changes.push({ path: 'memory-policy.md', expectedHash: null, raw: policyConcept.raw });
    else if (existingProfile.mode !== 'memory' || request.policy) changes.push({ path: oldPolicy.path, expectedHash: oldPolicy.hash, raw: patchMetadata(oldPolicy.raw, [{ path: ['type'], value: 'Memory policy' }, ...Object.entries(policy).map(([key, value]) => ({ path: ['memory_policy', key], value }))]) });
    const root = documents.find(item => item.path === 'index.md');
    if (!root) changes.push({ path: 'index.md', expectedHash: null, raw: '---\nokf_version: "0.2"\n---\n\n# Knowledge\n\n- [Agent memory policy](memory-policy.md)\n' });
    else if (!root.links.some(link => !link.external && link.target === 'memory-policy.md')) changes.push({ path: root.path, expectedHash: root.hash, raw: root.raw.trimEnd() + '\n\n## Memory policy\n\n- [Agent memory policy](memory-policy.md)\n' });
    for (const concept of documents.filter(item => !reserved(item.path) && item.path !== 'memory-policy.md')) {
      const decision = request.decisions?.[concept.path] ?? {};
      if (decision.raw !== undefined) {
        const candidate = parseConcept(bundle.name, concept.path, decision.raw);
        if (candidate.malformed) unresolved.push({ path: concept.path, field: 'raw', message: 'The supplied raw migration candidate has invalid frontmatter.' });
        if (decision.raw !== concept.raw) changes.push({ path: concept.path, expectedHash: concept.hash, raw: decision.raw });
        continue;
      }
      if (concept.malformed) { unresolved.push({ path: concept.path, field: 'frontmatter', message: 'Repair malformed source explicitly; migration preserves its raw bytes.' }); continue; }
      const memory = record(concept.metadata.memory);
      const fields: Array<{path: string[]; value: unknown}> = [];
      const requireField = (field: string, value: unknown, existing: unknown, target: string[]) => {
        if (value !== undefined) fields.push({ path: target, value });
        else if (existing === undefined || existing === null || existing === '' || Array.isArray(existing) && !existing.length) unresolved.push({ path: concept.path, field, message: `Supply an explicit ${field} migration decision.` });
      };
      requireField('kind', decision.kind, memory.kind, ['memory', 'kind']);
      requireField('stage', decision.stage, memory.stage, ['memory', 'stage']);
      requireField('generated.by', decision.actor, record(concept.metadata.generated).by, ['generated', 'by']);
      requireField('generated.at', decision.at, record(concept.metadata.generated).at, ['generated', 'at']);
      requireField('title', decision.title, concept.metadata.title, ['title']);
      requireField('description', decision.description, concept.metadata.description, ['description']);
      requireField('tags', decision.tags, concept.metadata.tags, ['tags']);
      requireField('status', decision.status, concept.metadata.status, ['status']);
      if ((decision.kind ?? memory.kind) === 'episodic' || ['silver', 'gold'].includes(String(decision.stage ?? memory.stage))) requireField('sources', decision.sources, concept.metadata.sources, ['sources']);
      if ((decision.kind ?? memory.kind) === 'episodic') requireField('occurred_at', decision.occurredAt, memory.occurred_at, ['memory', 'occurred_at']);
      for (const [field, target] of [['task', ['memory', 'task']], ['retentionReason', ['memory', 'retention_reason']], ['expiresAt', ['memory', 'expires_at']], ['staleAfter', ['stale_after']], ['archivedAt', ['memory', 'archived_at']], ['prerequisites', ['memory', 'prerequisites']], ['replaces', ['memory', 'replaces']], ['replacedBy', ['memory', 'replaced_by']], ['derivedFrom', ['memory', 'derived_from']]] as const) {
        const value = decision[field];
        if (value !== undefined) fields.push({ path: [...target], value: value === null ? undefined : field === 'task' ? { ...record(memory.task), ...record(value) } : value });
      }
      if (['procedural', 'semantic'].includes(String(decision.kind ?? memory.kind)) && concept.metadata.stale_after === undefined && decision.staleAfter === undefined) {
        const producedAt = dateValue(decision.at ?? record(concept.metadata.generated).at);
        if (producedAt !== null) fields.push({ path: ['stale_after'], value: new Date(producedAt + policy.review_interval_days * 86400000).toISOString() });
      }
      if (decision.namespace !== undefined) fields.push({ path: ['memory', 'namespace'], value: decision.namespace });
      const namespace = decision.namespace ?? memory.namespace ?? 'shared';
      if (typeof namespace !== 'string' || !policy.namespaces.includes(namespace)) unresolved.push({ path: concept.path, field: 'namespace', message: 'Resolve the unknown namespace against the registry.' });
      const raw = fields.length ? patchMetadata(concept.raw, fields) : concept.raw;
      if (raw !== concept.raw) changes.push({ path: concept.path, expectedHash: concept.hash, raw });
    }
    const preview = await Effect.runPromise(store.previewMaintenance({ version: 1, bundle: bundle.name, purpose: 'migration', changes, reason: 'Explicit migration to the agent memory profile.', allowNamespaceChange: true }));
    const after = documents.filter(item => !changes.some(change => change.path === item.path));
    after.push(...changes.filter(change => change.raw !== null).map(change => parseConcept(bundle.name, change.path, change.raw!)));
    projectDocuments(after, runtime.now());
    for (const concept of after) for (const diagnostic of (concept.memory?.diagnostics ?? []).filter(item => !item.code.startsWith('GOLD_REVIEW'))) unresolved.push({ path: concept.path, field: diagnostic.code, message: diagnostic.message });
    preview.unresolved = unresolved;
    preview.previewHash = previewDigest(preview);
    return preview;
  });
  store.applyMigration = request => operation(async () => { decode(ApplySchema, request); if (request.preview.purpose !== 'migration') throw new OkfError('INVALID_REQUEST', 'Migration apply requires a migration preview.'); return Effect.runPromise(store.applyMaintenance(request)); });
}

function validateProposal(preview: MaintenancePreview, documents: Concept[], now: Date, checkLinks = true): void {
  if (preview.changes.some(change => change.path === 'memory-policy.md' && change.raw === null)) throw new OkfError('MEMORY_POLICY_PROTECTED', 'The canonical memory policy cannot be deleted or moved through a proposal. Repair its raw contents in place.');
  const diagnostics = preview.diagnostics;
  const report = (path: string, code: string, message: string) => diagnostics.push({ level: 'error', code, path, bundle: preview.bundle, message });
  const changed = new Map(preview.changes.map(change => [change.path, change]));
  const updated = documents.filter(item => !changed.has(item.path));
  const candidates = preview.changes.filter(change => change.raw !== null).map(change => parseConcept(preview.bundle, change.path, change.raw!));
  updated.push(...candidates);
  const profile = discoverProfile(preview.bundle, updated);
  requireProfile(profile);
  let durable = false;
  for (const concept of candidates) {
    const before = changed.get(concept.path)!.before;
    const old = before === null ? undefined : parseConcept(preview.bundle, concept.path, before);
    for (const diagnostic of concept.diagnostics.filter(item => item.level === 'error')) diagnostics.push(diagnostic);
    if (reserved(concept.path) || concept.path === 'memory-policy.md') continue;
    const namespace = namespaceOf(concept);
    if (profile.policy && !profile.policy.namespaces.includes(namespace)) report(concept.path, 'UNKNOWN_NAMESPACE', 'Proposal note namespace is not registered.');
    if (!preview.allowNamespaceChange && old && namespaceOf(old) !== namespace) report(concept.path, 'NAMESPACE_PROMOTION_REQUIRED', 'Namespace changes require explicit reviewed publication authorization.');
    if (preview.purpose === 'consolidation') {
      if (record(old?.metadata.memory).kind === 'episodic' && record(concept.metadata.memory).kind !== 'episodic') report(concept.path, 'SOURCE_RECLASSIFICATION', 'Consolidation must create or update a separate durable memory instead of reclassifying an episode.');
      if (['semantic', 'procedural'].includes(String(record(concept.metadata.memory).kind)) && derivations(concept).length) durable = true;
      if (before !== concept.raw && record(concept.metadata.memory).reviews !== undefined && JSON.stringify(record(concept.metadata.memory).reviews) !== JSON.stringify(record(old?.metadata.memory).reviews)) report(concept.path, 'INHERITED_REVIEW', 'Consolidation cannot import approval events; review the resulting revision separately.');
      for (const entry of derivations(concept)) {
        const citation = (Array.isArray(concept.metadata.sources) ? concept.metadata.sources : []).some(item => { const value = typeof item === 'string' ? item : record(item).resource; return typeof value === 'string' && resolveLink(concept.path, value).target === resolveLink(concept.path, entry.resource).target; });
        if (!citation) report(concept.path, 'CONSOLIDATION_CITATION_REQUIRED', 'Keep standard source citations alongside each local derivation revision.');
        const source = metadataLinks(concept).find(item => item.resource === entry.resource);
        if (!source) continue;
        const local = resolveLink(concept.path, entry.resource).target;
        const target = updated.find(item => item.path === local);
        if (target && !preview.allowNamespaceChange && namespaceOf(target) !== namespace) report(concept.path, 'NAMESPACE_PROMOTION_REQUIRED', 'Cross-namespace consolidation requires explicit reviewed publication authorization.');
      }
    }
  }
  projectDocuments(updated, now);
  if (preview.purpose === 'migration') for (const concept of updated) {
    diagnostics.push(...concept.diagnostics.filter(item => item.level === 'error'));
    for (const diagnostic of (concept.memory?.diagnostics ?? []).filter(item => !item.code.startsWith('GOLD_REVIEW'))) diagnostics.push({ ...diagnostic, level: 'error', code: 'MIGRATION_DECISION_REQUIRED' });
  }
  for (const concept of candidates) diagnostics.push(...(concept.memory?.diagnostics ?? []));
  for (const concept of candidates) if (concept.memory?.dependency !== undefined && concept.memory.dependency !== 'valid') report(concept.path, 'INVALID_DERIVATION', 'Source revision lineage is changed, rejected, unavailable or cyclic.');
  if (preview.purpose === 'consolidation' && !durable) report('', 'CONSOLIDATION_LINEAGE_REQUIRED', 'Consolidation needs a separate procedural or semantic note with source revision lineage.');
  if (checkLinks) for (const item of documents) for (const link of [...item.links, ...metadataLinks(item).map(source => { const resolved = resolveLink(item.path, source.resource); return { target: resolved.target, external: resolved.external }; })]) {
    if (!link.external && changed.get(link.target)?.raw === null) {
      const replacement = updated.find(candidate => candidate.path === item.path);
      if (replacement && (replacement.links.some(candidate => !candidate.external && candidate.target === link.target) || metadataLinks(replacement).some(source => resolveLink(replacement.path, source.resource).target === link.target))) report(item.path, 'PROTECTED_EVIDENCE_LINK', `Deleting ${link.target} would remove an index, backlink or evidence reference. Update affected references explicitly or keep the source as stable evidence.`);
    }
  }
}
