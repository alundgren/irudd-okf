export interface CommandDescription {
  command: string;
  description: string;
  usage: string;
  input: Record<string, unknown>;
  output: string;
  mutates: boolean;
  examples: string[];
}
const text = { type: 'string' };
const bundle = { ...text, description: 'Active bundle alias; inspect context first.' };
const path = { ...text, description: 'Path within that bundle. Never an absolute filesystem path.' };
const entry = (command: string, description: string, usage: string, properties: Record<string, unknown>, output: string, mutates = false, examples: string[] = []): CommandDescription => ({
  command, description, usage: `irudd-okf ${usage}`, input: { type: 'object', properties, additionalProperties: false }, output, mutates, examples,
});
const required: Record<string, string[]> = {
  'bundle add': ['name', 'root'], 'bundle remove': ['name'], index: ['bundle'], search: ['query'], read: ['bundle', 'path'],
  write: ['bundle', 'path', 'file', 'expected'], delete: ['bundle', 'path', 'expected'], rename: ['bundle', 'path', 'newPath', 'expected'],
  'git status': ['bundle'], 'git preview': ['bundle', 'paths'], 'git pr': ['token', 'title'], 'skill install': ['directory'], 'cli search': ['query'], 'cli schema': ['command'],
};
export const commands: CommandDescription[] = [
  entry('context', 'Show selected bundles and current repository scope.', 'context [--config PATH] [--bundle NAME=ROOT]', {}, 'MemoryContext'),
  entry('init', 'Create an ordinary OKF bundle without replacing files.', 'init [ROOT]', { root: text }, '{root}', true),
  entry('bundle list', 'Show active registered bundles.', 'bundle list', {}, 'MemoryContext'),
  entry('bundle add', 'Register and optionally activate a named personal bundle.', 'bundle add NAME ROOT [--activate]', { name: text, root: text, activate: { type: 'boolean', default: false } }, 'Registry', true),
  entry('bundle remove', 'Remove a runtime registration. Leaves memory files intact.', 'bundle remove NAME', { name: text }, 'Registry', true),
  entry('index', 'Read a directory map; synthesize one when absent.', 'index BUNDLE [PATH]', { bundle, path }, 'Concept'),
  entry('search', 'Find relevant knowledge, project rules, architecture decisions and incident lessons using lexical search.', 'search QUERY [--scope BUNDLE] [--limit N] [--offset N]', { query: text, scope: bundle, limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 }, offset: { type: 'integer', minimum: 0, default: 0 } }, 'SearchResult', false, ['irudd-okf search "migration tests" --scope repo --limit 5']),
  entry('read', 'Read one source concept including raw Markdown, links and diagnostics.', 'read BUNDLE PATH', { bundle, path }, 'Concept', false, ['irudd-okf read repo architecture/migrations.md']),
  entry('write', 'Save a reviewed raw file with optimistic hash protection.', 'write BUNDLE PATH --file SOURCE --expected HASH [--authorize-personal]', { bundle, path, file: text, expected: { ...text, description: 'SHA-256 from read, or new for an exclusive create.' }, authorizePersonal: { type: 'boolean', default: false } }, 'MutationResult', true),
  entry('delete', 'Remove a concept only when its observed hash still matches.', 'delete BUNDLE PATH --expected HASH [--authorize-personal]', { bundle, path, expected: text, authorizePersonal: { type: 'boolean', default: false } }, 'MutationResult', true),
  entry('rename', 'Move a concept and optionally update incoming Markdown links.', 'rename BUNDLE PATH NEW_PATH --expected HASH [--update-links] [--authorize-personal]', { bundle, path, newPath: text, expected: text, updateLinks: { type: 'boolean' }, authorizePersonal: { type: 'boolean' } }, 'MutationResult', true),
  entry('validate', 'Check required OKF v0.2 conformance. Broken links remain allowed.', 'validate [--scope BUNDLE]', { scope: bundle }, 'ValidationResult'),
  entry('lint', 'Report optional quality guidance without inventing rule precedence.', 'lint [--scope BUNDLE]', { scope: bundle }, 'ValidationResult'),
  entry('graph', 'Return a bounded graph neighborhood with a text-friendly node list.', 'graph [--scope BUNDLE] [--path PATH] [--depth N] [--limit N]', { scope: bundle, path, depth: { type: 'integer', minimum: 0, maximum: 3, default: 1 }, limit: { type: 'integer', maximum: 250, default: 80 } }, 'Graph'),
  entry('serve', 'Serve separate wiki and graph views on loopback for this operator.', 'serve [--port N]', { port: { type: 'integer', minimum: 1024, maximum: 65535, default: 3210 } }, 'Local server address on stderr; runs until interrupted.'),
  entry('git status', 'Show Git metadata and changed memory paths.', 'git status BUNDLE', { bundle }, 'GitStatus'),
  entry('git preview', 'Prepare selected memory files in an isolated worktree and review the resulting diff.', 'git preview BUNDLE --paths PATH[,PATH] [--base REF]', { bundle, paths: { ...text, description: 'Comma-separated bundle-relative Markdown paths.' }, base: text }, 'GitPreview', true),
  entry('git pr', 'Publish a previously reviewed memory diff using git and authenticated gh.', 'git pr TOKEN --title TITLE [--body BODY]', { token: text, title: text, body: text }, 'PullRequestResult', true),
  entry('skill install', 'Install the small agent skill into an explicitly selected directory.', 'skill install DIRECTORY', { directory: text }, '{directory,files}', true),
  entry('cli search', 'Discover relevant commands before loading their full schemas.', 'cli search QUERY', { query: text }, '{version,results:{command,description,usage,mutates}[]}'),
  entry('cli schema', 'Inspect one command and its inputs, output and mutation behavior.', 'cli schema COMMAND', { command: text }, 'CommandDescription'),
  entry('doctor', 'Check runtime, active files and Git/gh availability.', 'doctor', {}, 'DoctorResult'),
  entry('licenses', 'Read included dependency and Node runtime license notices.', 'licenses', {}, '{version,text}'),
].map(item => ({ ...item, input: { ...item.input, required: required[item.command] ?? [] } }));
export const discover = (query: string) => {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return commands.map(item => ({ item, score: terms.reduce((score, term) => score + (item.command.includes(term) ? 5 : 0) + (item.description.toLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.item.command.localeCompare(b.item.command)).slice(0, 5)
    .map(({ item: { command, description, usage, mutates } }) => ({ command, description, usage, mutates }));
};
