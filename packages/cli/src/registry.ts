import {OkfError} from '../../core/src/contracts.ts';
import { Schema } from 'effect';
import { BundleInspectionSchema, BrowseResultSchema, ChangeRecordSchema, ChangeListSchema, ChangeRecoverySchema, ChangeSchema, ChangeReviewSchema, ChangeUndoSchema, MigrationSchema, PreviewSchema, ProposalSchema, TaskRequestSchema, TemplateSchema } from '../../core/src/schemas.ts';

export interface CommandDescription {
  command: string;
  description: string;
  usage: string;
  input: Record<string, unknown>;
  output: string;
  mutates: boolean;
  examples: string[];
  fileInput?: unknown;
  outputSchema?: unknown;
  errors?: Array<{code:string;description:string}>;
  navigation?: string[];
}
const text = { type: 'string' };
const bundle = { ...text, description: 'Active bundle alias; inspect context first.' };
const path = { ...text, description: 'Path within that bundle. Never an absolute filesystem path.' };
const authorizePersonal = { type: 'boolean', default: false, description: 'Explicit authorization to write the selected personal bundle.' };
const recall = { allApplicability:{type:'boolean',default:false,description:'Explicit accepted-only catalog inspection across applicability.'}, machine: text, repository: text, namespace: { type: 'array', items: text, description: 'Repeat --namespace for OR selection plus shared; omission considers all namespaces.' }, includeExcluded: { type: 'boolean', default: false, description: 'Inspect expired, rejected, archived and deprecated records.' } };
const observed = { bundle, path, expected: { ...text, description: 'Current whole-file SHA-256 from read.' }, authorizePersonal };
const file = { ...text, description: 'JSON request file; inspect fileInput for its core request schema. Command arguments supply bundle, path and expectedHash where applicable.' };
const fileSchemas: Record<string, Schema.Constraint> = { 'change propose': ChangeSchema, 'change review': ChangeReviewSchema, 'change undo': ChangeUndoSchema, template: TemplateSchema, task: TaskRequestSchema, 'maintenance preview': ProposalSchema, 'maintenance apply': PreviewSchema, 'migration preview': MigrationSchema, 'migration apply': PreviewSchema };
const entry = (command: string, description: string, usage: string, properties: Record<string, unknown>, output: string, mutates = false, examples: string[] = []): CommandDescription => ({
  command, description, usage: `irudd-okf ${usage}`, input: { type: 'object', properties, additionalProperties: false }, output, mutates, examples,
});
const required: Record<string, string[]> = {
  'bundle inspect': ['bundle'], browse: ['bundle'], 'migration guide': ['bundle'], 'change inspect':['bundle'], 'change recover':['bundle'], 'change propose': ['bundle', 'file'], 'change list': ['bundle'], 'change read': ['bundle', 'id'], 'change review': ['bundle', 'id', 'file'], 'change undo': ['bundle', 'id', 'file'],
  'bundle add': ['name', 'root'], 'bundle remove': ['name'], index: ['bundle'], search: ['query'], read: ['bundle', 'path'],
  write: ['bundle', 'path', 'file', 'expected'], delete: ['bundle', 'path', 'expected'], rename: ['bundle', 'path', 'newPath', 'expected'],
  'git status': ['bundle'], 'git preview': ['bundle', 'paths'], 'git pr': ['token', 'title'], 'skill install': ['directory'], 'cli search': ['query'], 'cli schema': ['command'],
  'instructions install': ['provider', 'bundle'], 'instructions status': ['provider'], 'instructions remove': ['provider'],
  profile: ['bundle'], namespaces: ['bundle'], bootstrap: ['bundle'], template: ['bundle', 'file'],
  review: ['bundle', 'path', 'expected', 'decision', 'actor', 'reason'], verify: ['bundle', 'path', 'expected', 'actor', 'method'], task: ['bundle', 'path', 'expected', 'file'], lifecycle: ['bundle', 'path', 'expected', 'action'],
  'maintenance preview': ['file'], 'maintenance apply': ['file'], 'maintenance inspect': ['bundle', 'previewHash'], 'maintenance recover': ['bundle', 'previewHash'], 'migration preview': ['bundle'], 'migration apply': ['file'],
};
const outputSchemas:Record<string,Schema.Constraint>={'bundle inspect':BundleInspectionSchema,'browse':BrowseResultSchema,'change list':ChangeListSchema,'change propose':ChangeRecordSchema,'change read':ChangeRecordSchema,'change review':ChangeRecordSchema,'change undo':ChangeRecordSchema,'change inspect':ChangeRecoverySchema,'change recover':ChangeRecoverySchema};
const commandErrors=(command:string,mutates:boolean)=>[
  {code:'INVALID_REQUEST',description:'Required fields, types or exact request schema do not match.'},
  {code:'BUNDLE_NOT_FOUND',description:'Select this bundle in context.'},
  ...(mutates?[{code:'CONFLICT',description:'Observed bytes changed; read the current proposal and revise.'},{code:'PERSONAL_AUTHORIZATION',description:'A selected personal mutation needs standing or task authorization and --authorize-personal.'},{code:'NEWER_BUNDLE_FORMAT',description:'Upgrade CLI before writing a newer bundle format.'}]:[]),
  ...(command==='change review'?[{code:'REVIEW_CONFLICT',description:'Proposal is stale or superseded.'},{code:'SOURCE_CONFLICT',description:'Supporting accepted evidence changed or was omitted.'},{code:'HUMAN_REVIEW_REQUIRED',description:'A deliberate operator decision is required.'},{code:'HUMAN_REVIEW_AUTHORIZATION',description:'Declared human review needs operator:true.'}]:[]),
  ...(command==='change recover'?[{code:'LOCK_OWNER_RUNNING',description:'The writer is still active; its lock stays intact.'},{code:'LOCK_OWNER_UNKNOWN',description:'Unknown ownership needs manual inspection.'}]:[])
];
const relatedCommands=(command:string)=>command.startsWith('change')?['change list','change read','change propose','change review','change undo','change inspect','change recover']:command.startsWith('migration')||command==='bundle inspect'?['bundle inspect','migration guide','migration preview','migration apply']:['context','bundle inspect','browse','search','read','cli browse'];
export const commands: CommandDescription[] = [
  entry('context', 'Show selected bundles and current repository scope.', 'context [--config PATH] [--bundle NAME=ROOT]', {}, 'MemoryContext'),
  entry('init', 'Create a versioned memory library without replacing existing files.', 'init [ROOT]', { root: text }, '{root}', true),
  entry('bundle inspect', 'Check bundle identity and format compatibility before any memory work.', 'bundle inspect BUNDLE', {bundle}, 'BundleInspection', false, ['irudd-okf bundle inspect repo']),
  entry('bundle list', 'Show active registered bundles.', 'bundle list', {}, 'MemoryContext'),
  entry('bundle add', 'Register and optionally activate a named personal bundle.', 'bundle add NAME ROOT [--activate]', { name: text, root: text, activate: { type: 'boolean', default: false } }, 'Registry', true),
  entry('bundle remove', 'Remove a runtime registration. Leaves memory files intact.', 'bundle remove NAME', { name: text }, 'Registry', true),
  entry('index', 'Read an accepted directory map or synthesize one from accepted applicability matches.', 'index BUNDLE [PATH] [--namespace NAME] [--include-excluded]', { bundle, path, ...recall }, 'Concept'),
  entry('list', 'List accepted memories matching explicit applicability; legacy namespaces apply only to generic profiles.', 'list [--scope BUNDLE] [--namespace NAME] [--include-excluded]', { scope: bundle, ...recall }, '{version,concepts}'),
  entry('search', 'Search accepted memory with explicit machine/repository context or all-applicability catalog inspection.', 'search QUERY [--scope BUNDLE] [--machine ID] [--repository ID] [--all-applicability] [--namespace NAME] [--include-excluded] [--limit N] [--offset N]', { query: text, scope: bundle, ...recall, limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 }, offset: { type: 'integer', minimum: 0, default: 0 } }, 'SearchResult', false, ['irudd-okf search "migration tests" --scope repo --namespace payments --namespace platform --limit 5']),
  entry('read', 'Read accepted memory bytes; --current explicitly inspects the current unaccepted draft.', 'read BUNDLE PATH [--machine ID] [--repository ID] [--all-applicability] [--current]', { bundle, path, machine:text,repository:text,allApplicability:recall.allApplicability,current: {type:'boolean',default:false} }, 'Concept', false, ['irudd-okf read repo architecture/migrations.md']),
  entry('write', 'Save generic raw files; library writes require explicit actor/reason and create pending proposals.', 'write BUNDLE PATH --file SOURCE --expected HASH [--actor ID] [--actor-type agent|human] [--reason TEXT] [--namespace NAME] [--authorize-personal]', { bundle, path, actor:text,actorType:{type:'string',enum:['agent','human'],default:'agent'},reason:text,file: text, expected: { ...text, description: 'SHA-256 from read, or new for an exclusive create.' }, namespace: text, authorizePersonal }, 'MutationResult', true),
  entry('delete', 'Remove generic files; library removals require explicit actor/reason and create reversible pending proposals.', 'delete BUNDLE PATH --expected HASH [--actor ID] [--actor-type agent|human] [--reason TEXT] [--authorize-personal]', { bundle, path, actor:text,actorType:{type:'string',enum:['agent','human'],default:'agent'},reason:text,expected: text, authorizePersonal: { type: 'boolean', default: false } }, 'MutationResult', true),
  entry('rename', 'Move a concept and optionally update incoming Markdown links.', 'rename BUNDLE PATH NEW_PATH --expected HASH [--update-links] [--authorize-personal]', { bundle, path, newPath: text, expected: text, updateLinks: { type: 'boolean' }, authorizePersonal: { type: 'boolean' } }, 'MutationResult', true),
  entry('validate', 'Check required OKF v0.2 conformance. Broken links remain allowed.', 'validate [--scope BUNDLE]', { scope: bundle }, 'ValidationResult'),
  entry('lint', 'Report optional quality guidance without inventing rule precedence.', 'lint [--scope BUNDLE]', { scope: bundle }, 'ValidationResult'),
  entry('graph', 'Return a bounded graph neighborhood including source lineage and selected namespaces.', 'graph [--scope BUNDLE] [--namespace NAME] [--include-excluded] [--path PATH] [--depth N] [--limit N]', { scope: bundle, path, ...recall, depth: { type: 'integer', minimum: 0, maximum: 3, default: 1 }, limit: { type: 'integer', maximum: 250, default: 80 } }, 'Graph'),
  entry('profile', 'Inspect the canonical memory policy, schema version and profile diagnostics.', 'profile BUNDLE', { bundle }, 'ProfileResult'),
  entry('namespaces', 'List explicit namespace registrations and shared eligibility.', 'namespaces BUNDLE', { bundle }, 'NamespaceResult'),
  entry('bootstrap', 'Read the accepted authoring policy; inspect bundle format and discover retrieval commands first.', 'bootstrap BUNDLE', { bundle }, 'BootstrapResult'),
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
  entry('migration guide', 'Get installed-version migration instructions and explicit classification questions.', 'migration guide BUNDLE', {bundle}, 'MigrationGuide', false, ['irudd-okf migration guide repo']),
  entry('change inspect','Inspect retained proposal publication intent without acquiring the write lock.','change inspect BUNDLE',{bundle},'ChangeRecoveryResult'),
  entry('change recover','Recover a stopped writer lock, retain recovery evidence and resume portable proposal publication; preserves external edits.','change recover BUNDLE [--authorize-personal]',{bundle,authorizePersonal},'ChangeRecoveryResult',true),
  entry('change propose', 'Propose a tracked create, update or reversible removal; accepted retrieval remains unchanged until review.', 'change propose BUNDLE --file REQUEST.json [--authorize-personal]', {bundle, file, authorizePersonal}, 'ChangeRecord', true, ['irudd-okf change propose repo --file request.json']),
  entry('change list', 'Browse pending or reviewed changes with bounded pages; inspect exact raw revisions with change read.', 'change list BUNDLE [--status pending|accepted|rejected|superseded] [--limit N] [--offset N]', {bundle, status: {type:'string',enum:['pending','accepted','rejected','superseded']}, limit:{type:'integer',default:30,maximum:100}, offset:{type:'integer',default:0}}, 'PagedChangeRecords'),
  entry('change read', 'Inspect immutable before and proposed raw revisions, exact sources and review history.', 'change read BUNDLE ID', {bundle,id:text}, 'ChangeRecord', false, ['irudd-okf change read repo CHANGE_ID']),
  entry('change review', 'Accept or reject the exact latest proposal and source revisions; human decisions require operator:true. Agent decisions record the actual agent identity.', 'change review BUNDLE ID --file REQUEST.json [--authorize-personal]', {bundle,id:text,file,authorizePersonal}, 'ChangeRecord', true, ['irudd-okf change review repo CHANGE_ID --file decision.json']),
  entry('change undo', 'Restore a retained before revision as a new pending proposal, including accepted removals.', 'change undo BUNDLE ID --file REQUEST.json [--authorize-personal]', {bundle,id:text,file,authorizePersonal}, 'ChangeRecord', true, ['irudd-okf change undo repo CHANGE_ID --file undo.json']),
  entry('browse', 'Browse accepted directory entries with bounded pages and explicit applicability context.', 'browse BUNDLE [--path DIRECTORY] [--all-applicability] [--machine ID] [--repository ID] [--limit N] [--offset N]', {bundle,path,allApplicability:recall.allApplicability,machine:text,repository:text,limit:{type:'integer',default:30,maximum:100},offset:{type:'integer',default:0}}, 'BrowseResult', false, ['irudd-okf browse repo --limit 20']),
  entry('git status', 'Show Git metadata and changed memory paths.', 'git status BUNDLE', { bundle }, 'GitStatus'),
  entry('git preview', 'Prepare selected generic Markdown files in an isolated worktree. Versioned libraries require complete history+marker sync and refuse selective publication.', 'git preview BUNDLE --paths PATH[,PATH] [--base REF]', { bundle, paths: { ...text, description: 'Comma-separated bundle-relative Markdown paths.' }, base: text }, 'GitPreview', true),
  entry('git pr', 'Publish a previously reviewed memory diff using git and authenticated gh.', 'git pr TOKEN --title TITLE [--body BODY]', { token: text, title: text, body: text }, 'PullRequestResult', true),
  entry('skill install', 'Install a portable retrieval, librarian or independent reviewer skill into a new directory.', 'skill install DIRECTORY [--name NAME]', { directory: text, name: { type: 'string', enum: ['okf', 'okf-librarian', 'okf-memory-reviewer'], default: 'okf' } }, '{directory,files}', true),
  entry('instructions install', 'Install or update the owned personal-memory section in one provider\'s global instructions.', 'instructions install PROVIDER BUNDLE [--dry-run]', { provider: { type: 'string', enum: ['codex', 'claude'] }, bundle, dryRun: { type: 'boolean', default: false } }, 'InstructionResult', true),
  entry('instructions status', 'Inspect the owned personal-memory section and whether Codex overrides hide it.', 'instructions status PROVIDER', { provider: { type: 'string', enum: ['codex', 'claude'] } }, 'InstructionStatus'),
  entry('instructions remove', 'Remove only the owned personal-memory section, preserving other global instructions.', 'instructions remove PROVIDER [--dry-run]', { provider: { type: 'string', enum: ['codex', 'claude'] }, dryRun: { type: 'boolean', default: false } }, 'InstructionResult', true),
  entry('cli browse','Navigate command groups and related operations before loading a command schema.','cli browse [COMMAND...] [--limit N] [--offset N]',{command:text,limit:{type:'integer',default:30},offset:{type:'integer',default:0}},'CommandNavigation',false,['irudd-okf cli browse','irudd-okf cli browse change']),
  entry('cli search', 'Discover relevant commands before loading their full schemas.', 'cli search QUERY', { query: text }, '{version,results:{command,description,usage,mutates}[]}'),
  entry('cli schema', 'Inspect one command and its inputs, output and mutation behavior.', 'cli schema COMMAND', { command: text }, 'CommandDescription'),
  entry('doctor', 'Check runtime, active files and Git/gh availability.', 'doctor', {}, 'DoctorResult'),
  entry('licenses', 'Read included dependency and Node runtime license notices.', 'licenses', {}, '{version,text}'),
  entry('upgrade', 'Check main without changing the installation, or rebuild and install an update. Requires git; installation also requires vp.', 'upgrade [--check]', { check: { type: 'boolean', default: false, description: 'Report available updates without changing the installation or source clone.' } }, 'UpgradeCheckResult with --check; UpgradeResult otherwise', true),
].map(item => ({ ...item, input: { ...item.input, required: required[item.command] ?? [] }, ...(fileSchemas[item.command] ? { fileInput: Schema.toJsonSchemaDocument(fileSchemas[item.command], { onExcessProperty: 'error' }) } : {}),
  ...(outputSchemas[item.command]?{outputSchema:Schema.toJsonSchemaDocument(outputSchemas[item.command],{onExcessProperty:'error'})}:{}),
  errors:commandErrors(item.command,item.mutates),navigation:relatedCommands(item.command)
}));
export const discover = (query: string) => {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return commands.map(item => ({ item, score: terms.reduce((score, term) => score + (item.command.includes(term) ? 5 : 0) + (item.description.toLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.item.command.localeCompare(b.item.command)).slice(0, 5)
    .map(({ item: { command, description, usage, mutates } }) => ({ command, description, usage, mutates }));
};

export function navigate(prefix='',limit=30,offset=0) {
  limit=Math.max(1,Math.min(100,Math.floor(limit)));offset=Math.max(0,Math.floor(offset));
  const root=prefix.trim(),entries=new Map<string,{command:string;group:boolean;description:string}>();
  for(const item of commands)if(!root || item.command.startsWith(root+' ')) {
    const remainder=root?item.command.slice(root.length+1):item.command,first=remainder.split(' ')[0],command=root?root+' '+first:first;
    const group=command!==item.command;entries.set(command,{command,group,description:group?'Browse related '+command+' commands.':item.description});
  }
  if(root && !entries.size) {
    const item=commands.find(item=>item.command===root);if(!item)throw new OkfError('COMMAND_NOT_FOUND','Unknown command group. Use cli browse.');
    for(const command of item.navigation ?? []) {const related=commands.find(item=>item.command===command);if(related)entries.set(command,{command,group:false,description:related.description});}
  }
  const ordered=[...entries.values()].sort((a,b)=>a.command.localeCompare(b.command));
  return {version:1,path:root,entries:ordered.slice(offset,offset+limit),total:ordered.length,limit,offset,truncated:ordered.length>offset+limit};
}
