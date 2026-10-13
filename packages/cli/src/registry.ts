import { Schema } from 'effect';
import { MigrationSchema, PreviewSchema, ProposalSchema, TaskRequestSchema, TemplateSchema } from '../../core/src/schemas.ts';

export interface CommandDescription {
  command: string;
  description: string;
  usage: string;
  input: Record<string, unknown>;
  output: string;
  mutates: boolean;
  examples: string[];
  fileInput?: unknown;
}
const text = { type: 'string' };
const bundle = { ...text, description: 'Active bundle alias; inspect context first.' };
const path = { ...text, description: 'Path within that bundle. Never an absolute filesystem path.' };
const authorizePersonal = { type: 'boolean', default: false, description: 'Explicit authorization to write the selected personal bundle.' };
const recall = { namespace: { type: 'array', items: text, description: 'Repeat --namespace for OR selection plus shared; omission considers all namespaces.' }, includeExcluded: { type: 'boolean', default: false, description: 'Inspect expired, rejected, archived and deprecated records.' } };
const observed = { bundle, path, expected: { ...text, description: 'Current whole-file SHA-256 from read.' }, authorizePersonal };
const file = { ...text, description: 'JSON request file; inspect fileInput for its core request schema. Command arguments supply bundle, path and expectedHash where applicable.' };
const fileSchemas: Record<string, Schema.Constraint> = { template: TemplateSchema, task: TaskRequestSchema, 'maintenance preview': ProposalSchema, 'maintenance apply': PreviewSchema, 'migration preview': MigrationSchema, 'migration apply': PreviewSchema };
const entry = (command: string, description: string, usage: string, properties: Record<string, unknown>, output: string, mutates = false, examples: string[] = []): CommandDescription => ({
  command, description, usage: `irudd-okf ${usage}`, input: { type: 'object', properties, additionalProperties: false }, output, mutates, examples,
});
const required: Record<string, string[]> = {
  'bundle add': ['name', 'root'], 'bundle remove': ['name'], index: ['bundle'], search: ['query'], read: ['bundle', 'path'],
  write: ['bundle', 'path', 'file', 'expected'], delete: ['bundle', 'path', 'expected'], rename: ['bundle', 'path', 'newPath', 'expected'],
  'git status': ['bundle'], 'git preview': ['bundle', 'paths'], 'git pr': ['token', 'title'], 'skill install': ['directory'], 'cli search': ['query'], 'cli schema': ['command'],
  'instructions install': ['provider', 'bundle'], 'instructions status': ['provider'], 'instructions remove': ['provider'],
  profile: ['bundle'], namespaces: ['bundle'], bootstrap: ['bundle'], template: ['bundle', 'file'],
  review: ['bundle', 'path', 'expected', 'decision', 'actor', 'reason'], verify: ['bundle', 'path', 'expected', 'actor', 'method'], task: ['bundle', 'path', 'expected', 'file'], lifecycle: ['bundle', 'path', 'expected', 'action'],
  'maintenance preview': ['file'], 'maintenance apply': ['file'], 'maintenance inspect': ['bundle', 'previewHash'], 'maintenance recover': ['bundle', 'previewHash'], 'migration preview': ['bundle'], 'migration apply': ['file'],
};
export const commands: CommandDescription[] = [
  entry('context', 'Show selected bundles and current repository scope.', 'context [--config PATH] [--bundle NAME=ROOT]', {}, 'MemoryContext'),
  entry('init', 'Create an OKF memory-profile bundle without replacing existing files.', 'init [ROOT]', { root: text }, '{root}', true),
  entry('bundle list', 'Show active registered bundles.', 'bundle list', {}, 'MemoryContext'),
  entry('bundle add', 'Register and optionally activate a named personal bundle.', 'bundle add NAME ROOT [--activate]', { name: text, root: text, activate: { type: 'boolean', default: false } }, 'Registry', true),
  entry('bundle remove', 'Remove a runtime registration. Leaves memory files intact.', 'bundle remove NAME', { name: text }, 'Registry', true),
  entry('index', 'Read a directory map; synthesize one when absent using namespace and lifecycle selection.', 'index BUNDLE [PATH] [--namespace NAME] [--include-excluded]', { bundle, path, ...recall }, 'Concept'),
  entry('list', 'List eligible memories within selected bundles and namespaces.', 'list [--scope BUNDLE] [--namespace NAME] [--include-excluded]', { scope: bundle, ...recall }, '{version,concepts}'),
  entry('search', 'Recall relevant knowledge, rules and incident lessons using lexical search and namespace union.', 'search QUERY [--scope BUNDLE] [--namespace NAME] [--include-excluded] [--limit N] [--offset N]', { query: text, scope: bundle, ...recall, limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 }, offset: { type: 'integer', minimum: 0, default: 0 } }, 'SearchResult', false, ['irudd-okf search "migration tests" --scope repo --namespace payments --namespace platform --limit 5']),
  entry('read', 'Read one source concept including raw Markdown, links and diagnostics.', 'read BUNDLE PATH', { bundle, path }, 'Concept', false, ['irudd-okf read repo architecture/migrations.md']),
  entry('write', 'Save a raw file with optimistic hash protection and one explicit namespace destination.', 'write BUNDLE PATH --file SOURCE --expected HASH [--namespace NAME] [--authorize-personal]', { bundle, path, file: text, expected: { ...text, description: 'SHA-256 from read, or new for an exclusive create.' }, namespace: text, authorizePersonal }, 'MutationResult', true),
  entry('delete', 'Remove a concept only when its observed hash still matches.', 'delete BUNDLE PATH --expected HASH [--authorize-personal]', { bundle, path, expected: text, authorizePersonal: { type: 'boolean', default: false } }, 'MutationResult', true),
  entry('rename', 'Move a concept and optionally update incoming Markdown links.', 'rename BUNDLE PATH NEW_PATH --expected HASH [--update-links] [--authorize-personal]', { bundle, path, newPath: text, expected: text, updateLinks: { type: 'boolean' }, authorizePersonal: { type: 'boolean' } }, 'MutationResult', true),
  entry('validate', 'Check required OKF v0.2 conformance. Broken links remain allowed.', 'validate [--scope BUNDLE]', { scope: bundle }, 'ValidationResult'),
  entry('lint', 'Report optional quality guidance without inventing rule precedence.', 'lint [--scope BUNDLE]', { scope: bundle }, 'ValidationResult'),
  entry('graph', 'Return a bounded graph neighborhood including source lineage and selected namespaces.', 'graph [--scope BUNDLE] [--namespace NAME] [--include-excluded] [--path PATH] [--depth N] [--limit N]', { scope: bundle, path, ...recall, depth: { type: 'integer', minimum: 0, maximum: 3, default: 1 }, limit: { type: 'integer', maximum: 250, default: 80 } }, 'Graph'),
  entry('profile', 'Inspect the canonical memory policy, schema version and profile diagnostics.', 'profile BUNDLE', { bundle }, 'ProfileResult'),
  entry('namespaces', 'List explicit namespace registrations and shared eligibility.', 'namespaces BUNDLE', { bundle }, 'NamespaceResult'),
  entry('bootstrap', 'Load compact shared policy before namespace recall; legacy bundles return their root index.', 'bootstrap BUNDLE', { bundle }, 'BootstrapResult'),
  entry('template', 'Generate a memory-kind authoring template from an explicit JSON request; writes no bundle files.', 'template BUNDLE --file REQUEST.json', { bundle, file }, 'TemplateResult'),
  entry('review', 'Record an approve or reject decision for the observed revision. Human review requires explicit --operator; actor metadata does not authenticate identity.', 'review BUNDLE PATH --decision approve|reject --actor ACTOR --reason REASON --expected HASH [--at UTC] [--operator] [--authorize-personal]', { ...observed, decision: { type: 'string', enum: ['approve', 'reject'] }, actor: text, reason: text, at: text, operator: { type: 'boolean', default: false, description: 'Deliberate operator acknowledgment for a human review, without cryptographic identity assurance.' } }, 'MutationResult', true),
  entry('verify', 'Record an actual machine verification method against the current content digest.', 'verify BUNDLE PATH --actor ACTOR --method METHOD --expected HASH [--at UTC] [--authorize-personal]', { ...observed, actor: text, method: text, at: text }, 'MutationResult', true),
  entry('task', 'Record offline task state, retention settings or explicit null retention clearing from a JSON request.', 'task BUNDLE PATH --file TASK.json --expected HASH [--authorize-personal]', { ...observed, file }, 'MutationResult', true),
  entry('lifecycle', 'Archive, restore, expire, deprecate, clear expiration or renew a freshness deadline.', 'lifecycle BUNDLE PATH --action ACTION --expected HASH [--at UTC] [--replacement PATH] [--reason REASON] [--authorize-personal]', { ...observed, action: { type: 'string', enum: ['archive', 'restore', 'expire', 'deprecate', 'clear-expiration', 'recheck'] }, at: text, replacement: path, reason: text }, 'MutationResult', true),
  entry('audit', 'Inspect all lifecycle states, review status, sources and maintenance diagnostics.', 'audit [--scope BUNDLE] [--namespace NAME]', { scope: bundle, namespace: recall.namespace }, 'AuditResult'),
  entry('maintenance preview', 'Preview a maintenance or consolidation proposal with hashes, diff, diagnostics and recovery guards.', 'maintenance preview --file PROPOSAL.json', { file }, 'MaintenancePreview'),
  entry('maintenance apply', 'Apply an inspected preview with a durable journal; retry preserves completed paths and external edits.', 'maintenance apply --file PREVIEW.json [--authorize-personal]', { file, authorizePersonal }, 'MaintenanceResult', true),
  entry('maintenance inspect', 'Inspect retained journal and per-path recovery or conflict state without modifying files.', 'maintenance inspect BUNDLE PREVIEW_HASH', { bundle, previewHash: text }, 'MaintenanceJournalResult'),
  entry('maintenance recover', 'Explicitly recover a retained journal after verifying the recorded process has stopped; preserve external edits and lock recovery evidence.', 'maintenance recover BUNDLE PREVIEW_HASH [--authorize-personal]', { bundle, previewHash: text, authorizePersonal }, 'MaintenanceRecoveryResult', true),
  entry('migration preview', 'Preview explicit legacy classification and full metadata/raw candidate decisions; unresolved evidence stays visible.', 'migration preview BUNDLE [--file REQUEST.json]', { bundle, file }, 'MaintenancePreview'),
  entry('migration apply', 'Apply an inspected migration preview with exact hashes and resumable recovery.', 'migration apply --file PREVIEW.json [--authorize-personal]', { file, authorizePersonal }, 'MaintenanceResult', true),
  entry('serve', 'Serve separate wiki and graph views on loopback for this operator.', 'serve [--port N]', { port: { type: 'integer', minimum: 1024, maximum: 65535, default: 3210 } }, 'Local server address on stderr; runs until interrupted.'),
  entry('git status', 'Show Git metadata and changed memory paths.', 'git status BUNDLE', { bundle }, 'GitStatus'),
  entry('git preview', 'Prepare selected memory files in an isolated worktree and review the resulting diff.', 'git preview BUNDLE --paths PATH[,PATH] [--base REF]', { bundle, paths: { ...text, description: 'Comma-separated bundle-relative Markdown paths.' }, base: text }, 'GitPreview', true),
  entry('git pr', 'Publish a previously reviewed memory diff using git and authenticated gh.', 'git pr TOKEN --title TITLE [--body BODY]', { token: text, title: text, body: text }, 'PullRequestResult', true),
  entry('skill install', 'Install a portable retrieval, librarian or independent reviewer skill into a new directory.', 'skill install DIRECTORY [--name NAME]', { directory: text, name: { type: 'string', enum: ['okf', 'okf-librarian', 'okf-memory-reviewer'], default: 'okf' } }, '{directory,files}', true),
  entry('instructions install', 'Install or update the owned personal-memory section in one provider\'s global instructions.', 'instructions install PROVIDER BUNDLE [--dry-run]', { provider: { type: 'string', enum: ['codex', 'claude'] }, bundle, dryRun: { type: 'boolean', default: false } }, 'InstructionResult', true),
  entry('instructions status', 'Inspect the owned personal-memory section and whether Codex overrides hide it.', 'instructions status PROVIDER', { provider: { type: 'string', enum: ['codex', 'claude'] } }, 'InstructionStatus'),
  entry('instructions remove', 'Remove only the owned personal-memory section, preserving other global instructions.', 'instructions remove PROVIDER [--dry-run]', { provider: { type: 'string', enum: ['codex', 'claude'] }, dryRun: { type: 'boolean', default: false } }, 'InstructionResult', true),
  entry('cli search', 'Discover relevant commands before loading their full schemas.', 'cli search QUERY', { query: text }, '{version,results:{command,description,usage,mutates}[]}'),
  entry('cli schema', 'Inspect one command and its inputs, output and mutation behavior.', 'cli schema COMMAND', { command: text }, 'CommandDescription'),
  entry('doctor', 'Check runtime, active files and Git/gh availability.', 'doctor', {}, 'DoctorResult'),
  entry('licenses', 'Read included dependency and Node runtime license notices.', 'licenses', {}, '{version,text}'),
  entry('upgrade', 'Check main without changing the installation, or rebuild and install an update. Requires git; installation also requires vp.', 'upgrade [--check]', { check: { type: 'boolean', default: false, description: 'Report available updates without changing the installation or source clone.' } }, 'UpgradeCheckResult with --check; UpgradeResult otherwise', true),
].map(item => ({ ...item, input: { ...item.input, required: required[item.command] ?? [] }, ...(fileSchemas[item.command] ? { fileInput: Schema.toJsonSchemaDocument(fileSchemas[item.command]) } : {}) }));
export const discover = (query: string) => {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return commands.map(item => ({ item, score: terms.reduce((score, term) => score + (item.command.includes(term) ? 5 : 0) + (item.description.toLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.item.command.localeCompare(b.item.command)).slice(0, 5)
    .map(({ item: { command, description, usage, mutates } }) => ({ command, description, usage, mutates }));
};
