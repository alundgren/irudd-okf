import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { command, hash, inventory, json, outside, shuffle, write } from './lib.mjs';
import { verifyFreeze } from './freeze.mjs';
import { measure, parseTrace, grade } from './metrics.mjs';

export async function codexAdapter(request, persistRaw = async () => {}) {
  const authSource = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'auth.json');
  const privateHome = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-private-codex-'));
  await fs.chmod(privateHome, 0o700);
  try {
    try { await fs.copyFile(authSource, path.join(privateHome, 'auth.json')); await fs.chmod(path.join(privateHome, 'auth.json'), 0o600); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.writeFile(path.join(privateHome, 'AGENTS.md'), '');
    const version = await command('codex', ['--version']);
    const args = ['exec', '--json', '--ignore-user-config', '--ignore-rules', '--ephemeral', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="high"', '-c', 'project_doc_max_bytes=32768', ...(request.unsafe_pilot ? ['--dangerously-bypass-approvals-and-sandbox'] : ['--sandbox', request.writable ? 'workspace-write' : 'read-only']), '--skip-git-repo-check', '-'];
    const result = await command('codex', args, { cwd: request.cwd, env: { ...process.env, CODEX_HOME: privateHome }, input: request.prompt, timeoutMs: request.timeout_ms });
    await persistRaw(result);
    return { version: 1, ...result, runtime_version: version.code === 0 ? version.stdout.trim() : null, runtime_command: ['codex', ...args], model: 'gpt-6.1-sol', effort: 'high', exact_model_release: null, exact_model_release_reason: 'Runtime exposes the requested model ID, not a dated underlying release.', context_limit_tokens: null, context_limit_reason: 'Codex exec JSONL did not report selected model context capacity.', private_home_policy: 'Fresh directory; blank global AGENTS; auth only; removed after run.' };
  } finally { await fs.rm(privateHome, { recursive: true, force: true }); }
}
export async function externalAdapter(executable, request, persistRaw = async () => {}) {
  const transport = await command(path.resolve(executable), [], { cwd: request.cwd, input: JSON.stringify(request) + '\n', timeoutMs: request.timeout_ms });
  await persistRaw(transport);
  const failed = message => ({ version: 1, ...transport, adapter_transport: transport, adapter_error: message });
  if (transport.code !== 0 || transport.timed_out || transport.error) return failed(transport.error?.message ?? (transport.timed_out ? 'Adapter timed out.' : `Adapter exited ${transport.code}.`));
  try {
    const response = JSON.parse(transport.stdout);
    if (response.version !== 1 || typeof response.stdout !== 'string' || !Number.isInteger(response.code) || response.stderr !== undefined && typeof response.stderr !== 'string') return failed('Adapter response must include version 1, string stdout and optional stderr, and integer code.');
    return { ...response, wall_time_ms: response.wall_time_ms ?? transport.wall_time_ms, timed_out: transport.timed_out || response.timed_out === true, signal: response.signal ?? transport.signal, adapter_transport: transport };
  } catch (error) { return failed(`Invalid adapter JSON: ${error.message}`); }
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
function personalPrompt(frozen) {
  return frozen.personal ? '\nAssigned personal guidance is in ../../assigned-personal/index.md. ' + (frozen.convention === 'repo-wins' ? 'Follow repository facts for repository behavior and personal preferences where compatible.' : 'Ask before acting when personal preferences conflict with repository guidance.') : '';
}
function runtimeSettings(response, adapterDigest, request) {
  return { adapter_digest: adapterDigest, model: response.model ?? null, effort: response.effort ?? null, runtime_version: response.runtime_version ?? null, exact_model_release: response.exact_model_release ?? null, context_limit_tokens: response.context_limit_tokens ?? null, runtime_command: response.runtime_command ?? null, timeout_ms: request.timeout_ms, unsafe_pilot: request.unsafe_pilot, writable: request.writable, project_doc_max_bytes: 32768 };
}
export async function run({ workspace, evaluator, artifacts, methods, taskIds = ['architecture', 'ux-gotcha'], adapter, seed = 20261004, timeoutMs = 180000, unsafePilot = false, expectedFreezeHash }) {
  outside(workspace, artifacts); outside(workspace, evaluator);
  // Verify every evaluator file and selected tree before any launch or attempt ledger is written.
  const verified = await verifyFreeze({ workspace, evaluator, methods, expectedFreezeHash });
  const { frozen, manifests } = verified;
  const tasks = taskIds.map(id => { const task = verified.tasks.find(t => t.id === id); if (!task) throw new Error(`Unknown task ${id}`); return task; });
  if (new Set(taskIds).size !== taskIds.length || new Set(methods ?? frozen.methods).size !== (methods ?? frozen.methods).length) throw new Error('Duplicate tasks or arms are not allowed.');
  if (unsafePilot && tasks.some(task => task.id === 'memory-update')) throw new Error('Unsandboxed instrumentation pilot supports answer-only tasks only.');
  const order = tasks.flatMap((task, index) => shuffle(methods ?? frozen.methods, seed + index).map(arm => ({ task, arm })));
  let adapterDigest;
  try { adapterDigest = adapter ? hash(await fs.readFile(path.resolve(adapter))) : hash({ run: hash(await fs.readFile(new URL('./run.mjs', import.meta.url))), process: hash(await fs.readFile(new URL('./lib.mjs', import.meta.url))) }); }
  catch { adapterDigest = null; }
  await fs.mkdir(path.dirname(path.resolve(artifacts)), { recursive: true });
  await fs.mkdir(artifacts, { recursive: false });
  await json(path.join(artifacts, 'randomization.json'), { seed, freeze_sha256: verified.digest, order: order.map(({ task, arm }) => ({ task_id: task.id, arm })), pair_by: ['task_id', 'concept_count', 'launch_cwd', 'comparison_config_hash'], feasibility_only: true, failure_policy: 'Persist every attempted cell and continue remaining cells.' });
  const results = order.map(({ task, arm }, index) => ({ version: 2, id: `run-${String(index).padStart(3, '0')}`, task_id: task.id, arm, count: frozen.count, status: 'planned' }));
  const ledger = () => json(path.join(artifacts, 'results.json'), results);
  await ledger();
  for (const [index, { task, arm }] of order.entries()) {
    const manifest = manifests.get(arm), id = results[index].id, dir = path.join(artifacts, id);
    let fresh = null, root = null, stage = 'prepare', before = [], changed = [], deleted = [], untracked = [], diff = '', failure = null;
    let response = { version: 1, code: null, signal: null, stdout: '', stderr: '', timed_out: false };
    const request = { version: 1, cwd: task.cwd, workspace: 'fresh isolated synthetic repository', prompt: task.prompt + personalPrompt(frozen), writable: task.id === 'memory-update', timeout_ms: timeoutMs, unsafe_pilot: unsafePilot };
    results[index].status = 'running'; await ledger();
    await json(path.join(dir, 'request.json'), request);
    try {
      fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-agent-run-')); root = path.join(fresh, 'repository');
      await fs.cp(path.join(workspace, arm), root, { recursive: true });
      before = await inventory(root);
      if (hash(before) !== hash(manifest.generated_inventory)) throw new Error('Copied workspace differs from the verified freeze.');
      for (const args of [['init', '--quiet', root], ['-C', root, 'add', '.'], ['-C', root, '-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@example.invalid', 'commit', '--quiet', '-m', 'Frozen synthetic fixture']]) {
        const git = await command('git', args);
        if (git.code !== 0 || git.error || git.timed_out) { response = { ...response, ...git }; throw new Error('Preparing the synthetic Git tree failed.'); }
      }
      stage = 'adapter';
      const liveRequest = { ...request, cwd: path.join(root, task.cwd), workspace: root };
      const persistRaw = async transport => { await write(dir, 'adapter-stdout.txt', transport.stdout); await write(dir, 'adapter-stderr.txt', transport.stderr); };
      response = adapter ? await externalAdapter(adapter, liveRequest, persistRaw) : await codexAdapter(liveRequest, persistRaw);
      await write(dir, 'trace.jsonl', response.stdout ?? ''); await write(dir, 'stderr.txt', response.stderr ?? '');
      stage = 'capture-diff';
      const tracked = await command('git', ['-C', root, 'diff', '--no-ext-diff', 'HEAD']);
      if (tracked.code !== 0 || tracked.error || tracked.timed_out) throw new Error('Capturing the post-run Git diff failed.');
      diff = tracked.stdout;
      const after = await inventory(root);
      changed = after.filter(file => !before.some(b => b.path === file.path && b.hash === file.hash));
      deleted = before.filter(file => !after.some(a => a.path === file.path));
      untracked = await Promise.all(changed.filter(file => !before.some(b => b.path === file.path)).map(async file => ({ path: file.path, content: await fs.readFile(path.join(root, file.path), 'utf8') })));
    } catch (error) { failure = { stage, code: error.code ?? null, message: error.message }; }
    try {
      const trace = parseTrace(response.stdout ?? '');
      const metrics = measure(trace.events);
      const answer = trace.events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message').map(e => e.item.text).join('\n');
      const environmentFailure = /mount.registry lock|mount.lock permission|sandbox.*(?:failed|could not)|every (?:file.read command|filesystem read) failed/i.test(answer + (response.stderr ?? ''));
      const executionFailed = failure || response.adapter_error || response.error || response.timed_out || response.code !== 0 || trace.malformed.length || !trace.events.some(e => e.type === 'turn.completed');
      const status = executionFailed ? 'failed' : environmentFailure ? 'environment_blocked' : 'completed';
      const settings = runtimeSettings(response, adapterDigest, request);
      const comparison = { repository_id: 'synthetic-checkout-fork', prompt_hash: hash(request.prompt), rubric_hash: hash(task.checks), fixed_facts_hash: task.fixed_facts_hash, opportunity_hash: hash(before.filter(f => f.path.startsWith(task.cwd + '/') && !f.path.endsWith('/AGENTS.md'))), assigned_personal_hash: hash(before.filter(f => f.path.startsWith('assigned-personal/'))), applicable_concept_ids: task.applicable_concept_ids, conflict_convention: frozen.convention, personal: frozen.personal, active_bundles: manifest.active_bundles, runtime_settings: settings };
      const result = {
        version: 2, id, study: 'synthetic_instrumentation_pilot', repository_id: comparison.repository_id, task_id: task.id, arm, count: manifest.count, launch_cwd: task.cwd,
        applicable_concept_ids: task.applicable_concept_ids, canonical_hash: manifest.canonical_hash, prompt_hash: comparison.prompt_hash, initial_tree_hash: hash(before), comparison_config: comparison, comparison_config_hash: hash(comparison),
        freeze_validation: { status: 'verified', freeze_sha256: verified.digest, externally_pinned: expectedFreezeHash !== undefined }, status, exit_code: response.code, signal: response.signal ?? null, timed_out: response.timed_out === true,
        failure: failure ?? response.adapter_error ?? response.error ?? (status === 'failed' ? 'Runtime did not complete a valid turn.' : null), metrics,
        machine_grade: status === 'completed' ? grade(task, answer, diff + JSON.stringify(untracked)) : { kind: 'not_scored_failed_run', coverage: null, task_correctness: null }, human_grade: { rater_one: null, rater_two: null, adjudication: null, status: 'pending' },
        runtime: { ...response, stdout: undefined, stderr: undefined, adapter_transport: response.adapter_transport ? { ...response.adapter_transport, stdout: undefined, stderr: undefined } : undefined },
        startup_instruction_inventory: startupInventory(before, task.cwd), changed_files: changed, deleted_files: deleted, raw_trace_parse_errors: trace.malformed,
        isolation: { fresh_worktree: true, repository_history: 'Only synthetic initial commit, no remotes.', oracle_supplied_to_adapter: false, os_read_isolation: 'Evaluator stored outside workspace. Read-only and unsandboxed pilots do not establish a physical read boundary.', unexpected_remote_tools: trace.events.some(e => e.item?.type === 'mcp_tool_call') },
      };
      await write(dir, 'trace.jsonl', response.stdout ?? ''); await write(dir, 'stderr.txt', response.stderr ?? '');
      await write(dir, 'adapter-stdout.txt', response.adapter_transport?.stdout ?? response.stdout ?? '');
      await write(dir, 'adapter-stderr.txt', response.adapter_transport?.stderr ?? response.stderr ?? '');
      await write(dir, 'answer.txt', answer); await write(dir, 'patch.diff', diff); await json(path.join(dir, 'untracked-files.json'), untracked);
      await json(path.join(dir, 'result.json'), result); await json(path.join(dir, 'failure.json'), result.failure);
      const anonymized = answer.replace(/\.okf\/[^\s)]+|guidance\/[^\s)]+|\.agents\/skills\/[^\s)]+|AGENTS\.md/g, '[guidance citation]');
      await json(path.join(artifacts, 'human-raters', `${hash(`rater:${seed}:${index}`).slice(0, 16)}.json`), { task_prompt: task.prompt, answer: anonymized, patch: diff, rubric: task.checks, execution_status: status, reviewers: [{ id: 'rater-one', grade: null }, { id: 'rater-two', grade: null }], adjudication: null, status: 'pending', blinding_limit: 'Answer wording can reveal treatment; document guesses before rating.' });
      results[index] = result; await ledger();
      process.stderr.write(`${id} ${task.id} ${arm}: ${status}\n`);
    } catch (error) {
      const result = {
        ...results[index], repository_id: 'synthetic-checkout-fork', launch_cwd: task.cwd, applicable_concept_ids: task.applicable_concept_ids, canonical_hash: manifest.canonical_hash, prompt_hash: hash(request.prompt), status: 'failed', exit_code: response.code, signal: response.signal ?? null, timed_out: response.timed_out === true,
        failure: { stage: 'processing', code: error.code ?? null, message: error.message, preceding_failure: failure },
        freeze_validation: { status: 'verified', freeze_sha256: verified.digest, externally_pinned: expectedFreezeHash !== undefined },
        metrics: { ...measure([]), usage_reason: 'Unavailable because runtime trace processing failed.', processing_error: error.message },
        machine_grade: { kind: 'not_scored_failed_run', coverage: null, task_correctness: null }, human_grade: { rater_one: null, rater_two: null, adjudication: null, status: 'pending' },
        runtime: { ...response, stdout: undefined, stderr: undefined, adapter_transport: response.adapter_transport ? { ...response.adapter_transport, stdout: undefined, stderr: undefined } : undefined }, changed_files: changed, deleted_files: deleted,
      };
      await write(dir, 'trace.jsonl', response.stdout ?? ''); await write(dir, 'stderr.txt', response.stderr ?? '');
      await write(dir, 'patch.diff', diff); await json(path.join(dir, 'untracked-files.json'), untracked);
      await json(path.join(dir, 'result.json'), result); await json(path.join(dir, 'failure.json'), result.failure);
      results[index] = result; await ledger();
      process.stderr.write(`${id} ${task.id} ${arm}: failed during processing\n`);
    } finally { if (fresh) await fs.rm(fresh, { recursive: true, force: true }); }
  }
  return results;
}
