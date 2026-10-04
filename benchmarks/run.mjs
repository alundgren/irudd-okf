import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { command, hash, inventory, json, outside, readJson, shuffle, write } from './lib.mjs';
import { measure, parseTrace, grade } from './metrics.mjs';

export async function codexAdapter(request) {
  const authSource = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'auth.json');
  const privateHome = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-private-codex-'));
  await fs.chmod(privateHome, 0o700);
  try {
    try { await fs.copyFile(authSource, path.join(privateHome, 'auth.json')); await fs.chmod(path.join(privateHome, 'auth.json'), 0o600); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.writeFile(path.join(privateHome, 'AGENTS.md'), '');
    const version = await command('codex', ['--version']);
    const args = ['exec', '--json', '--ignore-user-config', '--ignore-rules', '--ephemeral', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="high"', '-c', 'project_doc_max_bytes=32768', ...(request.unsafe_pilot ? ['--dangerously-bypass-approvals-and-sandbox'] : ['--sandbox', request.writable ? 'workspace-write' : 'read-only']), '--skip-git-repo-check', '-'];
    const start = performance.now();
    const result = await command('codex', args, { cwd: request.cwd, env: { ...process.env, CODEX_HOME: privateHome }, input: request.prompt, timeoutMs: request.timeout_ms });
    return { version: 1, ...result, runtime_version: version.stdout.trim(), runtime_command: ['codex', ...args], model: 'gpt-6.1-sol', effort: 'high', wall_time_ms: performance.now() - start, exact_model_release: null, exact_model_release_reason: 'Runtime exposes the requested model ID, not a dated underlying release.', context_limit_tokens: null, context_limit_reason: 'Codex exec JSONL did not report selected model context capacity.', private_home_policy: 'Fresh directory; blank global AGENTS; auth only; removed after run.' };
  } finally { await fs.rm(privateHome, { recursive: true, force: true }); }
}
export async function externalAdapter(executable, request) {
  const result = await command(path.resolve(executable), [], { cwd: request.cwd, input: JSON.stringify(request) + '\n', timeoutMs: request.timeout_ms });
  if (result.code !== 0) throw new Error(`Adapter failed with exit ${result.code}: ${result.stderr}`);
  const response = JSON.parse(result.stdout);
  if (response.version !== 1 || typeof response.stdout !== 'string' || !Number.isInteger(response.code)) throw new Error('Adapter response must include version 1, stdout JSONL, and integer code.');
  return response;
}
function startupInventory(files, cwd) {
  const parts = cwd.split('/'), candidates = ['AGENTS.md'];
  for (let i = 1; i <= parts.length; i++) candidates.push(parts.slice(0, i).join('/') + '/AGENTS.md');
  let budget = 32768;
  return candidates.flatMap(file => {
    const item = files.find(entry => entry.path === file);
    if (!item) return [];
    const expectedBytes = Math.min(item.bytes, budget); budget -= expectedBytes;
    return [{ ...item, expected_loaded_bytes: expectedBytes, expected_truncated: item.bytes > expectedBytes, evidence: 'file inventory and configured limit; actual prompt capture unavailable' }];
  });
}
export async function run({ workspace, evaluator, artifacts, methods, taskIds = ['architecture', 'ux-gotcha'], adapter, seed = 20261004, timeoutMs = 180000, unsafePilot = false }) {
  outside(workspace, artifacts); outside(workspace, evaluator);
  const hiddenTasks = await readJson(path.join(evaluator, 'tasks.hidden.json'));
  const frozen = await readJson(path.join(evaluator, 'freeze.json'));
  const tasks = taskIds.map(id => { const task = hiddenTasks.find(t => t.id === id); if (!task) throw new Error(`Unknown task ${id}`); return task; });
  if (unsafePilot && tasks.some(task => task.id === 'memory-update')) throw new Error('Unsandboxed instrumentation pilot supports answer-only tasks only.');
  const order = tasks.flatMap((task, index) => shuffle(methods ?? frozen.methods, seed + index).map(arm => ({ task, arm })));
  await json(path.join(artifacts, 'randomization.json'), { seed, order: order.map(({ task, arm }) => ({ task_id: task.id, arm })), pair_by: ['task_id', 'concept_count', 'launch_cwd', 'applicable_concept_ids'], feasibility_only: true });
  const results = [];
  for (const [index, { task, arm }] of order.entries()) {
    const manifest = await readJson(path.join(evaluator, `${arm}.manifest.json`));
    if (hash(await inventory(path.join(workspace, arm))) !== hash(manifest.generated_inventory)) throw new Error(`Frozen workspace changed before run: ${arm}`);
    const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-agent-run-'));
    try {
    const root = path.join(fresh, 'repository');
    const dir = path.join(artifacts, `run-${String(index).padStart(3, '0')}`);
    await fs.cp(path.join(workspace, arm), root, { recursive: true });
    await command('git', ['init', '--quiet', root]);
    await command('git', ['-C', root, 'add', '.']);
    await command('git', ['-C', root, '-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@example.invalid', 'commit', '--quiet', '-m', 'Frozen synthetic fixture']);
    const before = await inventory(root);
    const personal = frozen.personal ? '\nAssigned personal guidance is in ../../assigned-personal/index.md. ' + (frozen.convention === 'repo-wins' ? 'Follow repository facts for repository behavior and personal preferences where compatible.' : 'Ask before acting when personal preferences conflict with repository guidance.') : '';
    const request = { version: 1, cwd: path.join(root, task.cwd), workspace: root, prompt: task.prompt + personal, writable: task.id === 'memory-update', timeout_ms: timeoutMs, unsafe_pilot: unsafePilot };
    const response = adapter ? await externalAdapter(adapter, request) : await codexAdapter(request);
    const trace = parseTrace(response.stdout);
    const answer = trace.events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message').map(e => e.item.text).join('\n');
    const trackedDiff = await command('git', ['-C', root, 'diff', '--no-ext-diff', 'HEAD']);
    const after = await inventory(root);
    const changed = after.filter(file => !before.some(b => b.path === file.path && b.hash === file.hash));
    const deleted = before.filter(file => !after.some(a => a.path === file.path));
    const addedFiles = changed.filter(file => !before.some(b => b.path === file.path));
    const untracked = await Promise.all(addedFiles.map(async file => ({ path: file.path, content: await fs.readFile(path.join(root, file.path), 'utf8') })));
    const metrics = measure(trace.events);
    const environmentFailure = /mount.registry lock|mount.lock permission|sandbox.*(?:failed|could not)|every (?:file.read command|filesystem read) failed/i.test(answer + (response.stderr ?? ''));
    const result = { version: 1, id: `run-${String(index).padStart(3, '0')}`, study: 'synthetic_instrumentation_pilot', task_id: task.id, arm, count: manifest.count, launch_cwd: task.cwd, applicable_concept_ids: task.applicable_concept_ids, canonical_hash: manifest.canonical_hash, prompt_hash: hash(request.prompt), initial_tree_hash: hash(before), treatment_tree_differences: 'Guidance layouts differ intentionally; task source files match.', status: environmentFailure ? 'environment_blocked' : response.code === 0 && trace.events.some(e => e.type === 'turn.completed') ? 'completed' : 'failed', exit_code: response.code, metrics, machine_grade: grade(task, answer, trackedDiff.stdout + JSON.stringify(untracked)), human_grade: { rater_one: null, rater_two: null, adjudication: null, status: 'pending' }, runtime: { ...response, stdout: undefined, stderr: undefined }, startup_instruction_inventory: startupInventory(before, task.cwd), changed_files: changed, deleted_files: deleted, raw_trace_parse_errors: trace.malformed, isolation: { fresh_worktree: true, repository_history: 'Only synthetic initial commit, no remotes.', oracle_supplied_to_adapter: false, os_read_isolation: 'Codex read-only permits reads outside cwd. Oracle stored outside workspace; this pilot does not establish a security boundary.', unexpected_remote_tools: trace.events.some(e => e.item?.type === 'mcp_tool_call') } };
    await write(dir, 'trace.jsonl', response.stdout);
    await write(dir, 'stderr.txt', response.stderr ?? '');
    await write(dir, 'answer.txt', answer);
    await write(dir, 'patch.diff', trackedDiff.stdout);
    await json(path.join(dir, 'untracked-files.json'), untracked);
    await json(path.join(dir, 'result.json'), result);
    await json(path.join(dir, 'request.json'), { ...request, cwd: task.cwd, workspace: 'fresh isolated synthetic repository' });
    // Blinded packets remove arm names and source-path citations. Raw artifacts stay available to the adjudicator.
    const anonymized = answer.replace(/\.okf\/[^\s)]+|guidance\/[^\s)]+|\.agents\/skills\/[^\s)]+|AGENTS\.md/g, '[guidance citation]');
    await json(path.join(artifacts, 'human-raters', `${hash(`${seed}:${index}`).slice(0, 16)}.json`), { task_prompt: task.prompt, answer: anonymized, patch: trackedDiff.stdout, rubric: task.checks, reviewers: [{ id: 'rater-one', grade: null }, { id: 'rater-two', grade: null }], adjudication: null, status: 'pending', blinding_limit: 'Answer wording can reveal treatment; document guesses before rating.' });
    results.push(result);
    process.stderr.write(`${result.id} ${task.id} ${arm}: ${result.status}\n`);
    } finally { await fs.rm(fresh, { recursive: true, force: true }); }
  }
  await json(path.join(artifacts, 'results.json'), results);
  return results;
}
