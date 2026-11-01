import type { Applicability, Bundle, BotCatalog, BotCheckBot, BotCheckCandidate, BotCheckRequest, BotCheckResult, BotRegistrationChange, BotCollaborator, BotDefinition, BotDiagnostic, BotMemoryDocument, BotMemoryTarget, BotResolveRequest, BotSelection, BotSummary, Concept, MemoryContext, RecallSelection, ResolvedBot, ResolvedBotCollaborator, ResolvedBotMemory, Store } from './contracts.ts';
import { BOT_CATALOG_PATH, BOT_CATALOG_TYPE, BOT_DEFINITION_TYPE, OkfError } from './contracts.ts';
import { cleanPath, hash, operation, readRaw } from './files.ts';
import { parseConcept, reserved, resolveLink } from './parser.ts';
import { record } from './memory.ts';
import { inspectLibrary, validLibraryNote, type ReviewMaterial } from './library.ts';

type AcceptedDocuments = (bundle: Bundle, selection: RecallSelection) => Promise<Concept[]>;
type ReviewMaterials = (bundle: Bundle) => Promise<ReviewMaterial>;
interface Entry { summary: BotSummary; definition: BotDefinition; bundle: Bundle; body: string }
// A rejected registration keeps its name when an accepted definition still declares one, so it can still block a name.
interface Rejected { id?: string; name?: string; bundle: Bundle; bundleId: string; path?: string; diagnostic: BotDiagnostic }
// Blocked libraries could not be enumerated at all, so they may hide a bot with any name or id.
interface Catalogs { entries: Entry[]; rejected: Rejected[]; blocked: BotDiagnostic[]; diagnostics: BotDiagnostic[]; catalogs: number }

const DOCUMENT_LIMIT = 100;
const line = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const block = (value: unknown, limit = 100_000): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
const identifier = (value: unknown): value is string => line(value, 2048);
const isControl = (file: string) => reserved(file) || file === 'memory-policy.md';
const isBotDocument = (concept: Concept) => concept.type === BOT_DEFINITION_TYPE || concept.type === BOT_CATALOG_TYPE;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const unknownFields = (value: Record<string, unknown>, known: string[]) => Object.keys(value).filter(key => !known.includes(key));
// A directory target is a path prefix; omitting the path targets the whole bundle.
function targetPath(value: string): string | null { try { const normalized = cleanPath(value.replace(/\/+$/, '')); return normalized === value.replace(/\/+$/, '') ? normalized : null; } catch { return null; } }

export function parseBotDefinition(value: unknown): { definition: BotDefinition | null; name?: string; problems: string[] } {
  const problems: string[] = [];
  const bot = record(value);
  if (!Object.keys(bot).length) return { definition: null, problems: ['Declare the definition in a bot mapping.'] };
  for (const key of unknownFields(bot, ['name', 'purpose', 'identity', 'instructions', 'collaborators', 'memory', 'workspace', 'tests'])) problems.push(`Unknown field bot.${key}.`);
  if (!line(bot.name, 200)) problems.push('bot.name must be one nonempty line without surrounding spaces, at most 200 characters.');
  if (!line(bot.purpose, 500)) problems.push('bot.purpose must be one short nonempty line, at most 500 characters.');
  for (const field of ['identity', 'instructions'] as const) if (!block(bot[field])) problems.push(`bot.${field} must be nonempty text.`);
  for (const field of ['workspace', 'tests'] as const) if (bot[field] !== undefined && !block(bot[field])) problems.push(`bot.${field} must be nonempty text when present.`);
  const collaborators: BotCollaborator[] = [];
  if (!Array.isArray(bot.collaborators)) problems.push('bot.collaborators must be a list; use [] for a bot without collaborators.');
  else bot.collaborators.forEach((item, index) => {
    const entry = record(item);
    if (unknownFields(entry, ['bot', 'bundle', 'handoff']).length || !identifier(entry.bot) || !block(entry.handoff, 10_000) || entry.bundle !== undefined && !identifier(entry.bundle)) problems.push(`bot.collaborators[${index}] needs a stable bot ID, a handoff description and optionally a stable bundle ID.`);
    else collaborators.push({ bot: entry.bot, ...(entry.bundle !== undefined ? { bundle: entry.bundle as string } : {}), handoff: entry.handoff });
  });
  const memory: BotMemoryTarget[] = [];
  if (!Array.isArray(bot.memory)) problems.push('bot.memory must be a list of explicit memory targets; use [] for a bot without memory.');
  else bot.memory.forEach((item, index) => {
    const entry = record(item);
    const extra = unknownFields(entry, ['id', 'role', 'bundle', 'path', 'repository', 'machine', 'read', 'write']);
    const valid = !extra.length && identifier(entry.id) && (entry.role === 'own' || entry.role === 'shared') && block(entry.read, 10_000) && block(entry.write, 10_000)
      && (entry.bundle === undefined || identifier(entry.bundle)) && (entry.repository === undefined || identifier(entry.repository)) && (entry.machine === undefined || identifier(entry.machine))
      && (entry.path === undefined || typeof entry.path === 'string' && targetPath(entry.path) !== null);
    if (!valid) { problems.push(`bot.memory[${index}] needs an id, role own or shared, read and write rules, and optionally a stable bundle ID, a safe relative path and repository or machine applicability.`); return; }
    if (memory.some(target => target.id === entry.id)) { problems.push(`bot.memory[${index}] repeats the target id ${String(entry.id)}.`); return; }
    memory.push({ id: entry.id as string, role: entry.role as 'own' | 'shared', ...(['bundle', 'path', 'repository', 'machine'] as const).reduce((fields, key) => entry[key] === undefined ? fields : { ...fields, [key]: entry[key] }, {}), read: entry.read as string, write: entry.write as string });
  });
  const name = line(bot.name, 200) ? bot.name : undefined;
  if (problems.length) return { definition: null, ...(name ? { name } : {}), problems };
  return { definition: { name: bot.name as string, purpose: bot.purpose as string, identity: bot.identity as string, instructions: bot.instructions as string, collaborators, memory, ...(bot.workspace !== undefined ? { workspace: bot.workspace as string } : {}), ...(bot.tests !== undefined ? { tests: bot.tests as string } : {}) }, name: bot.name as string, problems };
}

// Projects an unaccepted revision as if a person accepted it, so a check applies the resolver's own rules to it.
function candidateConcept(bundle: Bundle, file: string, raw: string): Concept {
  const concept = validLibraryNote(bundle.name, file, raw);
  if (isControl(file)) return concept;
  const memory = record(concept.metadata.memory), declared = record(memory.applicability);
  const applicability: Applicability = declared.type === 'global' ? { type: 'global' } : { type: declared.type as 'machine' | 'repository', id: String(declared.id) };
  const expired = typeof memory.expires_at === 'string' && Date.parse(memory.expires_at) <= Date.now(), archived = Boolean(memory.archived_at), deprecated = concept.metadata.status === 'deprecated';
  concept.memory = { id: String(memory.id), applicability, revisionHash: hash(raw), kind: memory.kind as 'procedural' | 'semantic' | 'episodic', stage: memory.stage as 'bronze' | 'silver' | 'gold', namespace: 'shared', review: 'pending', verified: false, humanReviewed: false, machineVerified: false, trustTier: 'unverified', historicalVerificationEvents: [], freshness: 'current', archived, deprecated, contentHash: hash(raw), dependency: 'valid', eligible: !expired && !archived && !deprecated, trust: 'pending', reviewEvents: [], verificationEvents: [], diagnostics: [] };
  return concept;
}
// Valid catalog entries as stable id -> definition path; malformed entries are left to the catalog rules.
function registrations(concept: Concept | null | undefined): Map<string, string> {
  const output = new Map<string, string>();
  for (const item of Array.isArray(concept?.metadata.bots) ? concept.metadata.bots as unknown[] : []) {
    const entry = record(item), link = typeof entry.definition === 'string' ? resolveLink(BOT_CATALOG_PATH, entry.definition) : null;
    if (identifier(entry.id) && link && !link.external && !link.unsafe && !output.has(entry.id)) output.set(entry.id, link.target);
  }
  return output;
}
function selects(concept: Concept, selection: RecallSelection): boolean {
  if (!concept.memory) return true;
  const scope = concept.memory.applicability!;
  if (!selection.allApplicability && (scope.type === 'machine' && scope.id !== selection.machine || scope.type === 'repository' && scope.id !== selection.repository)) return false;
  return Boolean(selection.includeExcluded) || concept.memory.eligible;
}

export function createBotOperations(context: MemoryContext, acceptedDocuments: AcceptedDocuments, reviewMaterial: ReviewMaterials): Pick<Store, 'botCatalog' | 'resolveBot' | 'checkBots'> {
  const select = (name: string) => { const bundle = context.bundles.find(item => item.name === name); if (!bundle) throw new OkfError('BUNDLE_NOT_FOUND', 'Select an active bundle.', { bundle: name }); return bundle; };
  const documents = (source: AcceptedDocuments = acceptedDocuments) => {
    const cache = new Map<string, Promise<Concept[]>>();
    return (bundle: Bundle, selection: RecallSelection) => {
      const key = `${bundle.name}\n${JSON.stringify(selection)}`;
      let value = cache.get(key);
      if (!value) { value = source(bundle, selection); cache.set(key, value); }
      return value;
    };
  };
  const failure = (error: unknown) => error instanceof OkfError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
  // Stable library IDs come from manifests.
  async function libraryIds(): Promise<Map<string, Bundle>> {
    const output = new Map<string, Bundle>();
    for (const bundle of context.bundles) { try { const inspection = await inspectLibrary(bundle); if (inspection.status === 'current' && inspection.id && !output.has(inspection.id)) output.set(inspection.id, bundle); } catch { /* Reported when a target or catalog read needs this library. */ } }
    return output;
  }
  async function readCatalog(read: AcceptedDocuments, bundle: Bundle, output: Catalogs): Promise<void> {
    const report = (diagnostic: BotDiagnostic) => { output.diagnostics.push(diagnostic); return diagnostic; };
    const block = (diagnostic: BotDiagnostic) => { output.blocked.push(report(diagnostic)); };
    let bundleId: string, onDisk: boolean, accepted: Map<string, Concept>;
    try {
      const inspection = await inspectLibrary(bundle);
      onDisk = await readRaw(bundle, BOT_CATALOG_PATH).then(() => true, () => false);
      if (inspection.status !== 'current' || !inspection.id) {
        if (onDisk) block({ level: 'error', code: 'BOT_CATALOG_UNAVAILABLE', bundle: bundle.name, path: BOT_CATALOG_PATH, message: `Bundle format status is ${inspection.status}. Bot definitions need a current-format library with accepted revisions.` });
        return;
      }
      bundleId = inspection.id;
      accepted = new Map((await read(bundle, { allApplicability: true, includeExcluded: true })).map(concept => [concept.path, concept]));
    } catch (error) {
      block({ level: 'error', code: 'BOT_LIBRARY_UNREADABLE', bundle: bundle.name, message: `The library could not be read, so its bots are unknown (${failure(error)}).` });
      return;
    }
    const catalog = accepted.get(BOT_CATALOG_PATH);
    if (!catalog) {
      if (onDisk) report({ level: 'warning', code: 'BOT_CATALOG_PENDING', bundle: bundle.name, path: BOT_CATALOG_PATH, message: 'The bot catalog has no accepted revision. Pending catalog changes are not used until reviewed.' });
      return;
    }
    if (catalog.type !== BOT_CATALOG_TYPE || catalog.memory?.kind !== 'procedural' || !catalog.memory.eligible || !Array.isArray(catalog.metadata.bots)) {
      block({ level: 'error', code: 'BOT_CATALOG_INVALID', bundle: bundle.name, path: BOT_CATALOG_PATH, message: `The accepted catalog needs type ${BOT_CATALOG_TYPE}, procedural kind, a bots list, and must not be archived, expired, deprecated or bound to changed evidence. Its registrations are unknown.` });
      return;
    }
    output.catalogs++;
    const seen = new Set<string>();
    const nameAt = (file: string | undefined) => { const concept = file ? accepted.get(file) : undefined; return concept?.type === BOT_DEFINITION_TYPE ? parseBotDefinition(concept.metadata.bot).name : undefined; };
    for (const [index, item] of (catalog.metadata.bots as unknown[]).entries()) {
      const entry = record(item);
      const link = typeof entry.definition === 'string' ? resolveLink(BOT_CATALOG_PATH, entry.definition) : null;
      const linked = link && !link.external && !link.unsafe && link.target.endsWith('.md') && !isControl(link.target) && link.target !== BOT_CATALOG_PATH ? link.target : undefined;
      const knownId = identifier(entry.id) ? entry.id : undefined;
      const reject = (code: string, message: string) => { const name = nameAt(linked); output.rejected.push({ ...(knownId ? { id: knownId } : {}), ...(name ? { name } : {}), bundle, bundleId, ...(linked ? { path: linked } : {}), diagnostic: report({ level: 'error', code, bundle: bundle.name, path: linked ?? BOT_CATALOG_PATH, ...(knownId ? { bot: knownId } : {}), message }) }); };
      if (unknownFields(entry, ['id', 'definition']).length || !knownId || !linked) { reject('BOT_CATALOG_INVALID', `Catalog entry ${index} needs a stable id and a relative definition path within this bundle.`); continue; }
      if (seen.has(knownId)) { reject('BOT_CATALOG_INVALID', `The catalog registers bot ${knownId} more than once.`); continue; }
      seen.add(knownId);
      const concept = accepted.get(linked);
      if (!concept) { reject('BOT_DEFINITION_UNAVAILABLE', `Registered bot ${knownId} has no accepted definition at ${linked}, so its name is unknown. Pending definitions are not used until accepted.`); continue; }
      const parsed = parseBotDefinition(concept.metadata.bot);
      if (concept.memory?.id !== knownId) { reject('BOT_ID_MISMATCH', `The definition at ${linked} has memory id ${String(concept.memory?.id)}, not the registered id ${knownId}.`); continue; }
      if (concept.type !== BOT_DEFINITION_TYPE || concept.memory.kind !== 'procedural') { reject('BOT_DEFINITION_INVALID', `Bot definitions need type ${BOT_DEFINITION_TYPE} and procedural kind.`); continue; }
      if (!concept.memory.eligible) { reject('BOT_DEFINITION_EXCLUDED', 'The accepted definition is archived, expired, deprecated or bound to changed evidence.'); continue; }
      if (!parsed.definition) { reject('BOT_DEFINITION_INVALID', parsed.problems.join(' ')); continue; }
      output.entries.push({ bundle, body: concept.body, definition: parsed.definition, summary: { id: knownId, name: parsed.definition.name, purpose: parsed.definition.purpose, bundle: bundle.name, bundleId, path: concept.path, revisionHash: concept.memory.revisionHash!, catalogRevisionHash: catalog.memory.revisionHash!, duplicateName: false } });
    }
  }
  async function catalogs(read: AcceptedDocuments, bundles: readonly Bundle[]): Promise<Catalogs> {
    const output: Catalogs = { entries: [], rejected: [], blocked: [], diagnostics: [], catalogs: 0 };
    for (const bundle of bundles) await readCatalog(read, bundle, output);
    // Unavailable registrations that still declare a name count, so a broken bot never silently yields to a namesake.
    const counts = new Map<string, number>();
    for (const name of [...output.entries.map(entry => entry.summary.name), ...output.rejected.flatMap(item => item.name ? [item.name] : [])]) counts.set(name, (counts.get(name) ?? 0) + 1);
    for (const entry of output.entries) entry.summary.duplicateName = counts.get(entry.summary.name)! > 1;
    output.entries.sort((a, b) => compare(a.summary.name, b.summary.name) || compare(a.summary.bundle, b.summary.bundle) || compare(a.summary.id, b.summary.id));
    return output;
  }
  async function memoryTarget(read: AcceptedDocuments, entry: Entry, target: BotMemoryTarget, libraries: Map<string, Bundle>, report: (diagnostic: BotDiagnostic) => void): Promise<ResolvedBotMemory> {
    const bundleId = target.bundle ?? entry.summary.bundleId;
    const bundle = libraries.get(bundleId);
    const unavailable = (code: string, message: string, level: 'error' | 'warning' = 'error') => report({ level, code, bundle: bundle?.name ?? entry.summary.bundle, ...(target.path ? { path: target.path } : {}), bot: entry.summary.id, target: target.id, message });
    const none = (name: string | null): ResolvedBotMemory => ({ target, bundle: name, bundleId, status: 'unavailable', documents: [], truncated: false });
    if (!bundle) {
      unavailable('BOT_MEMORY_BUNDLE_UNAVAILABLE', `Memory target ${target.id} names bundle ID ${bundleId}, which is not selected as a current-format library. Register or select that library explicitly; no other bundle is substituted.`);
      return none(null);
    }
    const file = target.path === undefined ? '' : targetPath(target.path)!;
    if (file.endsWith('.md') && isControl(file)) { unavailable('BOT_MEMORY_INVALID', `Memory target ${target.id} points at ${file}, a navigation or policy control file rather than a memory. Target a memory note or a directory.`); return none(bundle.name); }
    const selection = { ...(target.repository ? { repository: target.repository } : {}), ...(target.machine ? { machine: target.machine } : {}) };
    let eligible: Concept[], everything: () => Promise<Concept[]>;
    try {
      eligible = (await read(bundle, selection)).filter(concept => !isControl(concept.path) && concept.memory?.id && concept.memory.revisionHash && concept.memory.applicability);
      everything = () => read(bundle, { allApplicability: true, includeExcluded: true });
    } catch (error) { unavailable('BOT_MEMORY_BUNDLE_UNAVAILABLE', `Memory target ${target.id} could not read library ${bundle.name} (${failure(error)}). No other bundle is substituted.`); return none(bundle.name); }
    let matches: Concept[];
    if (file.endsWith('.md')) {
      const match = eligible.find(concept => concept.path === file);
      if (match && isBotDocument(match)) { unavailable('BOT_MEMORY_INVALID', `Memory target ${target.id} points at a bot catalog or definition. Reference other bots through bot.collaborators.`); return none(bundle.name); }
      if (!match) {
        let any: Concept | undefined, checked = true;
        try { any = (await everything()).find(concept => concept.path === file); } catch { checked = false; }
        const reason = !checked ? 'could not be checked because the library became unreadable' : !any ? 'has no accepted revision' : !any.memory?.eligible ? 'is archived, expired, deprecated or bound to changed evidence' : `has applicability ${JSON.stringify(any.memory.applicability)}, which the target's declared repository and machine do not select`;
        unavailable('BOT_MEMORY_UNAVAILABLE', `Memory target ${target.id}: ${file} ${reason}. No other memory is substituted.`);
        return none(bundle.name);
      }
      matches = [match];
    } else matches = eligible.filter(concept => !isBotDocument(concept) && (!file || concept.path.startsWith(file + '/')));
    matches.sort((a, b) => compare(a.path, b.path));
    if (!matches.length) unavailable('BOT_MEMORY_EMPTY', `Memory target ${target.id} currently has no accepted memories for its declared applicability.`, 'warning');
    if (matches.length > DOCUMENT_LIMIT) unavailable('BOT_MEMORY_TRUNCATED', `Memory target ${target.id} has ${matches.length} accepted memories; the first ${DOCUMENT_LIMIT} by path are returned. Narrow the target path.`, 'warning');
    const documents: BotMemoryDocument[] = matches.slice(0, DOCUMENT_LIMIT).map(concept => ({ bundle: bundle.name, path: concept.path, id: concept.memory!.id!, title: concept.title, description: concept.description, revisionHash: concept.memory!.revisionHash!, applicability: concept.memory!.applicability!, body: concept.body }));
    return { target, bundle: bundle.name, bundleId, status: documents.length ? 'available' : 'empty', documents, truncated: matches.length > DOCUMENT_LIMIT };
  }
  // Collaborators and memory targets are evaluated identically for resolution and checks.
  async function references(read: AcceptedDocuments, all: Catalogs, entry: Entry, scope: string | undefined, libraries: Map<string, Bundle>): Promise<{ collaborators: ResolvedBotCollaborator[]; memory: ResolvedBotMemory[]; diagnostics: BotDiagnostic[] }> {
    const diagnostics: BotDiagnostic[] = [];
    const other = new Map<string, Promise<Catalogs>>();
    const collaborators: ResolvedBotCollaborator[] = [];
    for (const reference of entry.definition.collaborators) {
      const bundleId = reference.bundle ?? entry.summary.bundleId;
      const enumerated = all.entries.some(item => item.summary.bundleId === bundleId) || all.rejected.some(item => item.bundleId === bundleId) || scope === undefined || libraries.get(bundleId)?.name === scope;
      let source = all;
      if (!enumerated && libraries.has(bundleId)) {
        let pending = other.get(bundleId);
        if (!pending) { pending = catalogs(read, [libraries.get(bundleId)!]); other.set(bundleId, pending); }
        source = await pending;
      }
      const found = source.entries.find(item => item.summary.id === reference.bot && item.summary.bundleId === bundleId);
      const reason = found ? '' : !libraries.has(bundleId) ? ' That library is not selected.' : source !== all && source.blocked.length ? ` Its library could not be read: ${source.blocked[0].message}` : source.rejected.some(item => item.id === reference.bot && item.bundleId === bundleId) ? ' The registration exists but its definition is unavailable.' : '';
      if (!found) diagnostics.push({ level: 'error', code: 'BOT_COLLABORATOR_UNAVAILABLE', bundle: entry.summary.bundle, path: entry.summary.path, bot: entry.summary.id, message: `Collaborator ${reference.bot} in bundle ID ${bundleId} is not a registered accepted bot in the selected libraries.${reason}` });
      collaborators.push({ reference, status: found ? 'available' : 'unavailable', bot: found ? structuredClone(found.summary) : null });
    }
    const memory: ResolvedBotMemory[] = [];
    for (const target of entry.definition.memory) memory.push(await memoryTarget(read, entry, target, libraries, diagnostic => diagnostics.push(diagnostic)));
    return { collaborators, memory, diagnostics };
  }
  return {
    botCatalog: (selection: BotSelection = {}) => operation(async () => {
      if (selection.bundle !== undefined && typeof selection.bundle !== 'string') throw new OkfError('INVALID_REQUEST', 'Select a bundle by its active alias.');
      const result = await catalogs(documents(), selection.bundle !== undefined ? [select(selection.bundle)] : context.bundles);
      return { version: 1, bots: result.entries.map(entry => structuredClone(entry.summary)), diagnostics: result.diagnostics } satisfies BotCatalog;
    }),
    resolveBot: (request: BotResolveRequest) => operation(async () => {
      const { name, id } = request;
      if ((name === undefined) === (id === undefined) || name !== undefined && typeof name !== 'string' || id !== undefined && typeof id !== 'string' || request.bundle !== undefined && typeof request.bundle !== 'string') throw new OkfError('INVALID_REQUEST', 'Resolve a bot by exactly one exact name or stable id.');
      const read = documents();
      // With --scope only that library is enumerated; other libraries are read only when a reference names them.
      const all = await catalogs(read, request.bundle !== undefined ? [select(request.bundle)] : context.bundles);
      const label = name !== undefined ? `name ${JSON.stringify(name)}` : `id ${JSON.stringify(id)}`;
      if (all.blocked.length) throw new OkfError('BOT_CATALOG_INCOMPLETE', `${all.blocked.length} selected ${all.blocked.length === 1 ? 'library has' : 'libraries have'} no readable bot catalog, so a bot with the ${label} could exist there. Repair ${all.blocked.map(item => item.bundle).join(', ')}, or resolve within one readable library with --scope.`, { diagnostics: all.blocked });
      const matches = (item: { id?: string; name?: string }) => name !== undefined ? item.name === name : item.id === id;
      const valid = all.entries.filter(entry => matches(entry.summary));
      const rejected = all.rejected.filter(matches);
      const unnamed = all.rejected.filter(item => !item.name).map(item => item.diagnostic);
      if (valid.length + rejected.length > 1) throw new OkfError(name !== undefined ? 'BOT_NAME_AMBIGUOUS' : 'BOT_ID_AMBIGUOUS', `More than one registration has the ${label}${rejected.length ? ', including unavailable ones' : ''}. Rename, repair or unregister one definition${name !== undefined ? ', or resolve an available one by stable id' : ', or add --scope'}.`, { candidates: [...valid.map(entry => ({ id: entry.summary.id, name: entry.summary.name, bundle: entry.summary.bundle, path: entry.summary.path, available: true })), ...rejected.map(item => ({ ...(item.id ? { id: item.id } : {}), ...(item.name ? { name: item.name } : {}), bundle: item.bundle.name, ...(item.path ? { path: item.path } : {}), available: false, diagnostic: item.diagnostic }))] });
      if (rejected.length) throw new OkfError('BOT_UNAVAILABLE', `The registered bot with the ${label} cannot be used. Repair or accept its definition; no other bot is substituted.`, { diagnostics: rejected.map(item => item.diagnostic) });
      if (!valid.length) {
        const unknown = unnamed.length ? ` ${unnamed.length} ${unnamed.length === 1 ? 'registration has' : 'registrations have'} no accepted definition name and cannot be matched by name; see details.unnamed.` : '';
        throw new OkfError('BOT_NOT_FOUND', all.catalogs ? `No registered accepted bot has the exact ${label}. Names are matched literally; run bot list to choose one.${unknown}` : `No selected library has an accepted ${BOT_CATALOG_PATH}. Register the library with bundle add or select it with --bundle; bots are never inferred from the working directory.${unknown}`, { [name !== undefined ? 'name' : 'id']: name ?? id, available: all.entries.map(entry => entry.summary.name), unavailable: all.diagnostics.filter(item => item.level === 'error'), unnamed });
      }
      const entry = valid[0];
      const diagnostics: BotDiagnostic[] = [];
      if (name !== undefined && unnamed.length) diagnostics.push({ level: 'warning', code: 'BOT_UNNAMED_REGISTRATIONS', bundle: entry.summary.bundle, bot: entry.summary.id, message: `${unnamed.length} other ${unnamed.length === 1 ? 'registration has' : 'registrations have'} no accepted definition name. If one is later accepted with this name, resolution becomes ambiguous.` });
      const found = await references(read, all, entry, request.bundle, await libraryIds());
      diagnostics.push(...found.diagnostics);
      const { collaborators, memory } = found;
      return { version: 1, bot: structuredClone(entry.summary), definition: structuredClone(entry.definition), collaborators, memory, diagnostics, complete: !diagnostics.some(item => item.level === 'error') } satisfies ResolvedBot;
    }),
    checkBots: (request: BotCheckRequest) => operation(async () => {
      const drafts = request?.drafts ?? [], intended = request?.confirmedRegistrationChanges ?? [];
      if (typeof request?.bundle !== 'string' || request.id !== undefined && !identifier(request.id) || !Array.isArray(drafts) || drafts.some(item => typeof item?.path !== 'string' || typeof item.raw !== 'string') || !Array.isArray(intended) || !intended.every(item => identifier(item?.id) && (item.path === null || typeof item.path === 'string' && targetPath(item.path) === item.path && item.path.endsWith('.md')))) throw new OkfError('INVALID_REQUEST', 'Check one bundle, optionally one stable bot id, drafts given as {path, raw} pairs, and confirmed registration changes as {id, path} with the new definition path in the bundle, or null for a removal.');
      const bundle = select(request.bundle), inspection = await inspectLibrary(bundle);
      if (inspection.status !== 'current' || !inspection.id) throw new OkfError('MIGRATION_REQUIRED', 'Bot checks need a current-format library with accepted revisions.', { inspection });
      const bundleId = inspection.id;
      // Drafts take precedence over a pending proposal at the same path; both stay unaccepted.
      const candidates = new Map<string, BotCheckCandidate & { raw: string | null }>();
      const material = await reviewMaterial(bundle);
      for (const item of material.pending) candidates.set(item.path, { path: item.path, state: 'pending', hash: item.hash, changeId: item.id, actor: item.actor, raw: item.raw });
      const drafted = new Set<string>();
      for (const draft of drafts) {
        let file: string | null = null;
        try { file = cleanPath(draft.path); } catch { /* reported below */ }
        if (file !== draft.path || !file.endsWith('.md') || isControl(file) || drafted.has(file)) throw new OkfError('INVALID_REQUEST', `Draft path ${JSON.stringify(draft.path)} must be a distinct safe relative .md memory path in the bundle, not a navigation or policy file.`);
        drafted.add(file);
        candidates.set(file, { path: file, state: 'draft', hash: hash(draft.raw), raw: draft.raw });
      }
      const diagnostics: BotDiagnostic[] = [];
      const projected = new Map<string, Concept | null>();
      for (const [file, item] of candidates) {
        if (item.raw === null) { projected.set(file, null); continue; }
        try { projected.set(file, candidateConcept(bundle, file, item.raw)); }
        // A supplied draft must be valid; an invalid pending revision, such as an outside edit, keeps its accepted bytes here.
        catch (error) { diagnostics.push({ level: item.state === 'draft' ? 'error' : 'warning', code: 'BOT_CHECK_CANDIDATE_INVALID', bundle: bundle.name, path: file, message: `The ${item.state} revision is not a valid library memory (${failure(error)}), so this check ${item.state === 'draft' ? 'leaves it out' : 'uses the accepted revision instead'}.` }); }
      }
      // Acceptance applies identity rules the note format cannot show; a refused candidate is not projected.
      for (const [file, conflict] of material.identity([...candidates.values()].flatMap(item => item.raw !== null && projected.get(item.path) ? [{ path: item.path, raw: item.raw }] : []))) {
        const item = candidates.get(file)!;
        projected.delete(file);
        diagnostics.push({ level: item.state === 'draft' ? 'error' : 'warning', code: conflict.code, bundle: bundle.name, path: file, message: `Acceptance would refuse the ${item.state} revision: ${conflict.message}${typeof conflict.details.path === 'string' ? ` (${conflict.details.path})` : ''} This check ${item.state === 'draft' ? 'leaves it out' : 'uses the accepted revision instead'}.` });
      }
      const overlay: AcceptedDocuments = async (target, selection) => {
        const accepted = await acceptedDocuments(target, selection);
        if (target.name !== bundle.name) return accepted;
        return [...accepted.filter(concept => !projected.has(concept.path)), ...[...projected.values()].filter((concept): concept is Concept => concept !== null && selects(concept, selection)).map(concept => structuredClone(concept))];
      };
      const read = documents(overlay);
      const all = await catalogs(read, context.bundles);
      const libraries = await libraryIds();
      const acceptedAll = await acceptedDocuments(bundle, { allApplicability: true, includeExcluded: true }), acceptedPaths = new Set(acceptedAll.map(concept => concept.path));
      const before = registrations(acceptedAll.find(concept => concept.path === BOT_CATALOG_PATH));
      const stateOf = (file: string) => candidates.get(file)?.state ?? (acceptedPaths.has(file) ? 'accepted' : 'missing');
      // A registration needs the catalog candidate when the accepted catalog does not already register it at that path.
      const needs = (id: string, file: string, output: Set<string>) => { if (projected.has(file)) output.add(file); if (projected.has(BOT_CATALOG_PATH) && before.get(id) !== file) output.add(BOT_CATALOG_PATH); };
      // A catalog candidate must keep every registration that is accepted or still awaiting a decision, unless the user confirmed changing it.
      // These diagnostics are reported whatever --id selects, because the dropped bot is not the one being checked.
      const catalogCandidate = candidates.get(BOT_CATALOG_PATH), catalogChecked = catalogCandidate !== undefined && projected.has(BOT_CATALOG_PATH);
      // Ids whose registration the candidate adds, removes or re-points; other bots that depend on them are checked below.
      const touched = new Set<string>();
      if (catalogCandidate && catalogChecked) {
        const next = registrations(projected.get(BOT_CATALOG_PATH)), reported = new Set<string>(), matched = new Set<BotRegistrationChange>();
        for (const [id, file] of next) if (before.get(id) !== file) touched.add(id);
        // A confirmation covers only the exact change it names, never other changes to the same entry.
        const confirmation = (id: string, now: string | undefined) => intended.find(item => item.id === id && item.path === (now ?? null));
        const open = material.openCatalog.filter(item => item.raw !== null && item.id !== catalogCandidate.changeId).map(item => { let concept: Concept | undefined; try { concept = parseConcept(bundle.name, BOT_CATALOG_PATH, item.raw!); } catch { /* unreadable revisions register nothing */ } return { label: `${item.status} change ${item.id}`, entries: registrations(concept) }; });
        for (const baseline of [{ label: 'the accepted catalog', entries: before }, ...open]) for (const [id, file] of baseline.entries) {
          const now = next.get(id);
          if (now === file || reported.has(`${id}\n${file}`)) continue;
          reported.add(`${id}\n${file}`); touched.add(id);
          const change = now === undefined ? `no longer registers ${id}, which ${baseline.label} registers at ${file}` : `registers ${id} at ${now} instead of ${file} as in ${baseline.label}`;
          const confirmed = confirmation(id, now);
          if (confirmed) matched.add(confirmed);
          diagnostics.push({ level: confirmed ? 'warning' : 'error', code: now === undefined ? 'BOT_CATALOG_REGISTRATION_REMOVED' : 'BOT_CATALOG_REGISTRATION_CHANGED', bundle: bundle.name, path: BOT_CATALOG_PATH, bot: id,
            message: confirmed ? `Confirmed change: the ${catalogCandidate.state} catalog ${change}.` : `The ${catalogCandidate.state} catalog ${change}. Build catalog edits from the current bytes (read --current) so no entry is lost; list ${JSON.stringify({ id, path: now ?? null })} in confirmedRegistrationChanges only after the user confirms exactly this change.` });
        }
        for (const item of intended) if (!matched.has(item)) diagnostics.push({ level: 'warning', code: 'BOT_CATALOG_CONFIRMATION_UNUSED', bundle: bundle.name, path: BOT_CATALOG_PATH, bot: item.id, message: `The confirmed change ${JSON.stringify(item)} does not match what the ${catalogCandidate.state} catalog does to ${item.id}, so it confirms nothing.` });
      } else for (const item of intended) diagnostics.push({ level: 'warning', code: 'BOT_CATALOG_CONFIRMATION_UNUSED', bundle: bundle.name, path: BOT_CATALOG_PATH, bot: item.id, message: `No catalog candidate is checked, so the confirmed change ${JSON.stringify(item)} confirms nothing.` });
      const bots: BotCheckBot[] = [];
      for (const entry of all.entries.filter(item => item.bundle.name === bundle.name)) {
        const found = await references(read, all, entry, undefined, libraries);
        if (entry.summary.duplicateName) found.diagnostics.unshift({ level: 'error', code: 'BOT_NAME_DUPLICATE', bundle: bundle.name, path: entry.summary.path, bot: entry.summary.id, message: `Another registration in the selected libraries also has the name ${JSON.stringify(entry.summary.name)}, so resolving that name would be ambiguous. Choose a distinct literal name.` });
        const requires = new Set<string>();
        needs(entry.summary.id, entry.summary.path, requires);
        for (const item of found.collaborators) if (item.bot && item.bot.bundle === bundle.name) needs(item.bot.id, item.bot.path, requires);
        for (const item of found.memory) for (const document of item.documents) if (document.bundle === bundle.name && projected.has(document.path)) requires.add(document.path);
        bots.push({ id: entry.summary.id, name: entry.summary.name, path: entry.summary.path, state: stateOf(entry.summary.path), registered: true, ready: !found.diagnostics.some(item => item.level === 'error'), requires: [...requires].sort(compare),
          collaborators: found.collaborators.map(item => ({ bot: item.reference.bot, bundleId: item.reference.bundle ?? bundleId, status: item.status })),
          memory: found.memory.map(item => ({ target: item.target.id, bundleId: item.bundleId, status: item.status, paths: item.documents.map(document => document.path) })), diagnostics: found.diagnostics });
      }
      const rejected = all.rejected.filter(item => item.bundle.name === bundle.name);
      for (const item of rejected) {
        const file = item.path ?? BOT_CATALOG_PATH, state = stateOf(file), candidate = candidates.get(file);
        // The resolver's wording assumes accepted reads; say what the check actually found at the path.
        const unavailable = item.diagnostic.code === 'BOT_DEFINITION_UNAVAILABLE' ? (state === 'missing' ? `Registered bot ${item.id} has no accepted, pending or draft definition at ${file}. Draft or propose the definition, or remove the entry.` : candidate && candidate.raw === null ? `Pending change ${candidate.changeId} removes the definition at ${file} that registers ${item.id}.` : `The ${state} definition at ${file} for ${item.id} cannot be used; see the top-level diagnostics for that path.`) : null;
        bots.push({ id: item.id ?? null, name: item.name ?? null, path: file, state, registered: true, ready: false, requires: [], collaborators: [], memory: [], diagnostics: [unavailable ? { ...item.diagnostic, message: unavailable } : item.diagnostic] });
      }
      // A definition no catalog entry registers can never be resolved, so report it with every problem found at once.
      const linked = new Set(bots.map(item => item.path));
      for (const [file, concept] of projected) {
        if (concept?.type !== BOT_DEFINITION_TYPE || linked.has(file)) continue;
        const parsed = parseBotDefinition(concept.metadata.bot), id = concept.memory?.id ?? null;
        bots.push({ id, name: parsed.name ?? null, path: file, state: stateOf(file), registered: false, ready: false, requires: [file], collaborators: [], memory: [], diagnostics: [
          { level: 'error', code: 'BOT_CHECK_UNREGISTERED', bundle: bundle.name, path: file, ...(id ? { bot: id } : {}), message: `No catalog entry in ${BOT_CATALOG_PATH} registers this definition, so it cannot be resolved. Add an entry whose id equals the definition's memory id.` },
          ...(parsed.problems.length || concept.memory?.kind !== 'procedural' ? [{ level: 'error' as const, code: 'BOT_DEFINITION_INVALID', bundle: bundle.name, path: file, message: [...(concept.memory?.kind !== 'procedural' ? [`Bot definitions need procedural kind.`] : []), ...parsed.problems].join(' ') }] : []),
        ] });
      }
      const attached = new Set(rejected.map(item => item.diagnostic));
      diagnostics.push(...all.diagnostics.filter(item => item.bundle === bundle.name && !attached.has(item)));
      for (const item of all.blocked.filter(item => item.bundle !== bundle.name)) diagnostics.push({ level: 'warning', code: 'BOT_CHECK_NAME_UNCONFIRMED', bundle: item.bundle, message: `Library ${item.bundle} has no readable bot catalog (${item.code}), so names there could not be compared. An unscoped bot resolve fails until it is repaired.` });
      const selected = request.id === undefined ? bots : bots.filter(item => item.id === request.id);
      selected.sort((a, b) => compare(a.path, b.path) || compare(a.id ?? '', b.id ?? ''));
      // A catalog candidate can break bots outside the selection: report those at top level so --id cannot hide them.
      if (catalogChecked) for (const item of [...bots].sort((a, b) => compare(a.path, b.path) || compare(a.id ?? '', b.id ?? ''))) {
        if (selected.includes(item)) continue;
        const reasons = [
          ...(item.id && touched.has(item.id) ? item.diagnostics.filter(diagnostic => diagnostic.level === 'error').map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`) : []),
          ...item.collaborators.filter(collaborator => collaborator.status === 'unavailable' && collaborator.bundleId === bundleId && touched.has(collaborator.bot)).map(collaborator => `its collaborator ${collaborator.bot} is no longer a registered usable bot`),
        ];
        if (reasons.length) diagnostics.push({ level: 'error', code: 'BOT_CATALOG_BREAKS_BOT', bundle: bundle.name, path: item.path, ...(item.id ? { bot: item.id } : {}), message: `The ${catalogCandidate!.state} catalog leaves ${item.id ?? item.path} unusable: ${reasons.join(' ')} Repair that bot through its own confirmed proposal, or keep its registrations.` });
      }
      if (!selected.length) diagnostics.push({ level: 'error', code: 'BOT_CHECK_EMPTY', bundle: bundle.name, ...(request.id ? { bot: request.id } : {}), message: request.id ? `No accepted, pending or draft definition or registration has id ${request.id} in this library.` : `No accepted, pending or draft bot is registered in ${BOT_CATALOG_PATH} of this library.` });
      const used = new Set(selected.flatMap(item => [item.path, ...item.requires]));
      const listed = [...candidates.values()].filter(item => used.has(item.path) || item.path === BOT_CATALOG_PATH).map(({ raw: _, ...item }) => item).sort((a, b) => compare(a.path, b.path));
      return { version: 1, bundle: bundle.name, bundleId, ready: selected.length > 0 && selected.every(item => item.ready) && !diagnostics.some(item => item.level === 'error'), candidates: listed, bots: selected, diagnostics } satisfies BotCheckResult;
    }),
  };
}
