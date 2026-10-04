import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { concepts, generate, tasks } from '../corpus.mjs';
import { measure, pairedScaleRows, parseTrace } from '../metrics.mjs';
import { command, hash, inventory, outside, readJson } from '../lib.mjs';
import { run } from '../run.mjs';
import { verifyFreeze } from '../freeze.mjs';

test('growth adds distractors while task facts, random IDs and tasks stay fixed', () => {
  const small = concepts(100), medium = concepts(1000), large = concepts(10000);
  assert.deepEqual(medium.slice(0, 100), small);
  assert.deepEqual(large.slice(0, 1000), medium);
  assert.equal(new Set(large.map(c => c.text)).size, 10000);
  for (const task of tasks) for (const index of task.relevant) assert.deepEqual(large[index], small[index]);
  assert.equal(large.every(c => !/priority|authority/.test(Object.keys(c).join(' '))), true);
});

test('rendered arms contain exactly the same canonical text and keep evaluator files outside', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-equivalence-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const workspace = path.join(dir, 'workspaces'), evaluator = path.join(dir, 'hidden');
  const manifests = await generate({ workspace, evaluator });
  const canonicalById = new Map(concepts(100).map(c => [c.id, c]));
  assert.equal(new Set(manifests.map(m => m.canonical_hash)).size, 1);
  assert.equal(new Set(manifests.map(m => m.transformed_concept_hash)).size, 1);
  for (const manifest of manifests) {
    const root = path.join(workspace, manifest.arm);
    for (const mapping of manifest.source_map) {
      const text = await fs.readFile(path.join(root, mapping.file), 'utf8');
      const concept = canonicalById.get(mapping.id);
      assert.equal(text.includes(concept.text), true);
      assert.equal(text.includes(mapping.id), false);
    }
    const files = await inventory(root);
    assert.equal(files.some(f => /hidden|manifest|canonical|oracle/.test(f.path)), false);
    assert.equal(manifest.human_equivalence_review.status, 'pending');
  }
  assert.throws(() => outside(workspace, path.join(workspace, 'oracle')), /outside/);
});

test('usage stays separate from unavailable logical context; tool content is deduplicated', () => {
  const metric = measure([
    { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 40 } },
    { type: 'turn.completed', usage: { input_tokens: 80, output_tokens: 10, cached_input_tokens: 20 } },
    ...[1, 2].map(id => ({ type: 'item.completed', item: { id, type: 'command_execution', aggregated_output: 'same result', exit_code: 0 } })),
  ]);
  assert.equal(metric.recurring_input_tokens, 180);
  assert.equal(metric.uncached_input_tokens, 120);
  assert.equal(metric.cached_input_tokens, 60);
  assert.equal(metric.total_input_output_tokens, 210);
  assert.equal(metric.peak_logical_context_tokens, null);
  assert.equal(metric.unique_tool_content_hashes.length, 1);
  assert.equal(metric.tool_calls, 2);
  assert.equal(measure([{ type: 'request.context', logical_context_tokens: 71 }]).peak_logical_context_tokens, 71);
  assert.equal(measure([]).recurring_input_tokens, null);
});

function scaleRow(count, overrides = {}) {
  const runtime = { model: 'model-a', effort: 'high', runtime_version: 'runtime-1', code: 0 };
  const config = { repository_id: 'synthetic-checkout-fork', prompt_hash: 'prompt-a', rubric_hash: 'rubric-a', fixed_facts_hash: 'facts-a', opportunity_hash: 'tree-a', assigned_personal_hash: 'personal-a', applicable_concept_ids: ['same'], conflict_convention: 'repo-wins', personal: false, active_bundles: [{ name: 'repo' }], runtime_settings: { ...runtime, adapter_digest: 'adapter-a' }, ...overrides };
  return { id: `scale-${count}`, status: 'completed', timed_out: false, exit_code: 0, signal: null, failure: null, count, repository_id: config.repository_id, arm: 'okf-path', task_id: 'architecture', launch_cwd: 'packages/checkout', applicable_concept_ids: config.applicable_concept_ids, prompt_hash: config.prompt_hash, runtime, freeze_validation: { status: 'verified', freeze_sha256: `freeze-${count}` }, comparison_config: config, comparison_config_hash: hash(config), metrics: { recurring_input_tokens: count }, machine_grade: { coverage: 1 } };
}
test('scale comparison pairs only identical task, path and applicable concepts', () => {
  const result = pairedScaleRows([scaleRow(100), scaleRow(1000), scaleRow(10000, { applicable_concept_ids: ['different'] })]);
  assert.equal(result.filter(r => r.status === 'paired').length, 1);
  assert.equal(result.find(r => r.status === 'paired').input_change, 900);
});

test('scale comparison rejects changed runtime, prompt, convention, facts, opportunity, failures and duplicates', () => {
  const pair = rows => pairedScaleRows(rows).find(r => r.from === 100 && r.to === 1000);
  for (const override of [{ prompt_hash: 'new-prompt' }, { conflict_convention: 'ask-on-conflict' }, { fixed_facts_hash: 'changed-fact-text' }, { opportunity_hash: 'changed-source' }, { assigned_personal_hash: 'changed-personal-fact' }, { runtime_settings: { model: 'model-b', effort: 'low', runtime_version: 'runtime-2', adapter_digest: 'adapter-b' } }]) {
    const result = pair([scaleRow(100), scaleRow(1000, override)]);
    assert.equal(result.status, 'rejected_mismatch'); assert.equal(result.input_change, null); assert.equal(result.coverage_change, null);
  }
  const failed = pair([scaleRow(100), { ...scaleRow(1000), status: 'failed' }]);
  assert.equal(failed.status, 'rejected_failed_cell'); assert.equal(failed.input_change, null);
  assert.equal(pair([scaleRow(100), { ...scaleRow(1000), runtime: { ...scaleRow(1000).runtime, code: 7 } }]).status, 'rejected_failed_cell');
  const duplicate = pair([scaleRow(100), scaleRow(100), scaleRow(1000)]);
  assert.equal(duplicate.status, 'rejected_duplicate_cells'); assert.equal(duplicate.input_change, null);
  assert.equal(pair([{ ...scaleRow(100), freeze_validation: undefined }, scaleRow(1000)]).status, 'rejected_unverified_freeze');
});

test('external adapter receives no oracle; fresh runs contain only assigned scopes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-adapter-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const workspace = path.join(dir, 'workspaces'), evaluator = path.join(dir, 'hidden'), artifacts = path.join(dir, 'artifacts');
  await generate({ workspace, evaluator, methods: ['nested', 'okf-path'] });
  const executable = path.join(dir, 'adapter.mjs');
  await fs.writeFile(executable, `#!/usr/bin/env node\nimport fs from 'node:fs';\nlet input='';for await(const c of process.stdin)input+=c;const request=JSON.parse(input);if(Object.keys(request).some(k=>/oracle|relevant|checks|applicable/.test(k)))process.exit(3);if(fs.existsSync(request.workspace+'/assigned-personal'))process.exit(4);console.log(JSON.stringify({version:1,code:0,stdout:JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'payments/port.ts original idempotency key reconcile status'}})+'\\n'+JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:3,cached_input_tokens:0}})+'\\n',runtime_version:'fake-test-only',wall_time_ms:1}));\n`);
  await fs.chmod(executable, 0o700);
  const result = await run({ workspace, evaluator, artifacts, adapter: executable, taskIds: ['architecture'] });
  assert.equal(result.length, 2);
  assert.equal(new Set(result.map(r => r.prompt_hash)).size, 1);
  assert.equal(result.every(r => r.isolation.oracle_supplied_to_adapter === false), true);
  assert.equal(result.every(r => r.changed_files.length === 0), true);
  assert.equal((await readJson(path.join(artifacts, 'results.json'))).length, 2);
  await fs.appendFile(path.join(workspace, 'nested/AGENTS.md'), '\nUnexpected post-freeze instruction.\n');
  await assert.rejects(run({ workspace, evaluator, artifacts, adapter: executable, methods: ['nested'], taskIds: ['architecture'] }), /Frozen workspace changed/);
});

test('synthetic commits disable inherited detached maintenance and remove every completed checkout', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-git-maintenance-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const workspace = path.join(dir, 'workspaces'), evaluator = path.join(dir, 'hidden'), artifacts = path.join(dir, 'artifacts');
  await generate({ workspace, evaluator, methods: ['nested', 'okf-path'] });
  const globalConfig = path.join(dir, 'gitconfig'), controlTrace = path.join(dir, 'control-trace.jsonl'), trace = path.join(dir, 'trace.jsonl');
  await fs.writeFile(globalConfig, '[maintenance]\n auto = true\n autoDetach = true\n[gc]\n auto = 1\n autoDetach = true\n');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_TRACE2_EVENT: trace };
  const control = path.join(dir, 'control');
  for (const args of [['init', '--quiet', control], ['-C', control, '-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@example.invalid', '-c', 'maintenance.autoDetach=false', '-c', 'gc.autoDetach=false', 'commit', '--quiet', '--allow-empty', '-m', 'Trace control']]) {
    const result = await command('git', args, { env: { ...env, GIT_TRACE2_EVENT: controlTrace } });
    assert.equal(result.code, 0, result.stderr);
  }
  const automatic = event => event.event === 'child_start' && event.argv?.includes('--auto') && event.argv.some(arg => arg === 'maintenance' || arg === 'gc');
  assert.equal((await fs.readFile(controlTrace, 'utf8')).trim().split('\n').map(JSON.parse).some(automatic), true, 'control commit must prove the trace observes automatic maintenance');
  const adapter = path.join(dir, 'adapter.mjs');
  await fs.writeFile(adapter, `#!/usr/bin/env node\nimport {execFileSync} from 'node:child_process';let input='';for await(const c of process.stdin)input+=c;const request=JSON.parse(input);const git=args=>execFileSync('git',['-C',request.workspace,...args],{encoding:'utf8'}).trim();if(git(['config','--local','--bool','maintenance.auto'])!=='false'||git(['config','--local','--int','gc.auto'])!=='0'||git(['rev-list','--count','HEAD'])!=='1')process.exit(3);console.log(JSON.stringify({version:1,code:0,stdout:JSON.stringify({type:'item.completed',item:{type:'agent_message',text:request.workspace}})+'\\n'+JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1,cached_input_tokens:0}})+'\\n',runtime_version:'fake-test-only'}));\n`);
  await fs.chmod(adapter, 0o700);
  const cli = await command(process.execPath, [fileURLToPath(new URL('../main.mjs', import.meta.url)), 'run', '--workspace', workspace, '--evaluator', evaluator, '--artifacts', artifacts, '--adapter', adapter, '--tasks', 'architecture'], { env, timeoutMs: 30000 });
  assert.equal(cli.code, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).failed_cells, 0);
  const rows = await readJson(path.join(artifacts, 'results.json'));
  assert.equal(rows.length, 2);
  assert.equal(rows.every(row => row.status === 'completed'), true);
  for (const row of rows) {
    const checkout = (await fs.readFile(path.join(artifacts, row.id, 'answer.txt'), 'utf8')).trim();
    await assert.rejects(fs.stat(checkout), { code: 'ENOENT' });
  }
  const events = (await fs.readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(event => event.event === 'start' && event.argv?.includes('commit')).length, 2);
  assert.equal(events.some(automatic), false, 'synthetic commits must not launch maintenance or automatic GC');
});

test('checkout removal failure retains raw evidence, fails only that cell and gives a failing CLI status', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-cleanup-failure-test-'));
  const retainedFile = path.join(dir, 'retained-directory.txt');
  t.after(async () => {
    const retained = await fs.readFile(retainedFile, 'utf8').catch(() => null);
    if (retained) await fs.rm(retained, { recursive: true, force: true });
    await fs.rm(dir, { recursive: true, force: true });
  });
  const workspace = path.join(dir, 'workspaces'), evaluator = path.join(dir, 'hidden'), artifacts = path.join(dir, 'artifacts');
  await generate({ workspace, evaluator, methods: ['nested', 'okf-path'] });
  const preload = path.join(dir, 'inject-cleanup-failure.mjs');
  await fs.writeFile(preload, `import fs from 'node:fs/promises';import path from 'node:path';const remove=fs.rm;let injected=false;fs.rm=async(target,options)=>{if(!injected&&path.basename(target).startsWith('okf-agent-run-')){injected=true;await fs.writeFile(${JSON.stringify(retainedFile)},target);throw Object.assign(new Error('Injected removal failure'),{code:'ENOTEMPTY'});}return remove(target,options);};\n`);
  const trace = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'test-only completed answer' } }) + '\n' + JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 3, cached_input_tokens: 0 } }) + '\n';
  const raw = JSON.stringify({ version: 1, code: 0, stdout: trace, runtime_version: 'fake-test-only' }) + '\n';
  const adapter = path.join(dir, 'adapter.mjs');
  await fs.writeFile(adapter, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(raw)});process.stderr.write('raw-transport-error-stream\\n');\n`);
  await fs.chmod(adapter, 0o700);
  const cli = await command(process.execPath, ['--import', preload, fileURLToPath(new URL('../main.mjs', import.meta.url)), 'run', '--workspace', workspace, '--evaluator', evaluator, '--artifacts', artifacts, '--adapter', adapter, '--tasks', 'architecture'], { timeoutMs: 30000 });
  assert.equal(cli.code, 1, cli.stderr); assert.equal(JSON.parse(cli.stdout).failed_cells, 1);
  const rows = await readJson(path.join(artifacts, 'results.json'));
  assert.equal(rows.length, 2); assert.equal(rows[0].status, 'failed'); assert.equal(rows[1].status, 'completed');
  assert.equal(rows[0].failure.stage, 'cleanup'); assert.equal(rows[0].failure.code, 'ENOTEMPTY'); assert.equal(rows[0].machine_grade.coverage, null);
  assert.equal(rows[0].metrics.recurring_input_tokens, 10);
  const retained = await fs.readFile(retainedFile, 'utf8');
  assert.equal(rows[0].failure.directory, retained); assert.equal((await fs.stat(retained)).isDirectory(), true);
  for (const row of rows) {
    const cell = path.join(artifacts, row.id);
    assert.equal(await fs.readFile(path.join(cell, 'adapter-stdout.txt'), 'utf8'), raw);
    assert.equal(await fs.readFile(path.join(cell, 'adapter-stderr.txt'), 'utf8'), 'raw-transport-error-stream\n');
    assert.equal(await fs.readFile(path.join(cell, 'trace.jsonl'), 'utf8'), trace);
    assert.equal((await readJson(path.join(cell, 'result.json'))).status, row.status);
  }
  assert.equal((await readJson(path.join(artifacts, rows[0].id, 'failure.json'))).stage, 'cleanup');
  const packets = await fs.readdir(path.join(artifacts, 'human-raters'));
  assert.deepEqual((await Promise.all(packets.map(file => readJson(path.join(artifacts, 'human-raters', file))))).map(packet => packet.execution_status).sort(), ['completed', 'failed']);
});

test('personal exposure is explicit, scoped and adds no product precedence field', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-personal-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const result = await generate({ workspace: path.join(dir, 'workspace'), evaluator: path.join(dir, 'hidden'), methods: ['okf-path'], personal: true, convention: 'ask-on-conflict' });
  assert.deepEqual(result[0].active_bundles.map(b => b.name), ['repo', 'personal']);
  const text = await fs.readFile(path.join(dir, 'workspace/okf-path/assigned-personal/package-manager.md'), 'utf8');
  assert.equal(text.includes('pnpm'), true);
  assert.equal(/precedence:|priority:|authority:/.test(text), false);
});

test('flat overflow keeps original facts while reporting expected loading separately', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-flat-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const manifests = await generate({ workspace: path.join(dir, 'workspace'), evaluator: path.join(dir, 'hidden'), methods: ['flat'], count: 1000 });
  const text = await fs.readFile(path.join(dir, 'workspace/flat/AGENTS.md'), 'utf8');
  assert.equal(Buffer.byteLength(text) > 32768, true);
  assert.equal(text.includes(concepts(1000)[999].text), true);
  assert.equal(manifests[0].source_map.length, 1000);
  assert.equal(measure([]).actual_loaded_instruction_chain, null);
});

test('timeout captures partial streams and kills a process group that ignores SIGTERM', async () => {
  const source = `import {spawn} from 'node:child_process'; process.on('SIGTERM',()=>{}); console.log('parent-ready'); console.error('partial-error'); const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'}); console.log('descendant-pid:'+child.pid);setInterval(()=>{},1000);`;
  // Allow cold Node startup under the full suite before testing the installed signal handler.
  const result = await command(process.execPath, ['--input-type=module', '-e', source], { timeoutMs: 2000, killGraceMs: 50 });
  assert.equal(result.timed_out, true); assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.stdout.includes('parent-ready'), true); assert.equal(result.stderr.includes('partial-error'), true);
  assert.equal(result.wall_time_ms < 5000, true);
  if (process.platform === 'linux') {
    const pid = /descendant-pid:(\d+)/.exec(result.stdout)[1];
    const state = await fs.readFile(`/proc/${pid}/stat`, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    assert.equal(state === null || state.split(' ')[2] === 'Z', true);
  }
});

test('exact augmented tasks, canonical text, manifests and freeze bytes reject tampering before any cell', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-freeze-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const workspace = path.join(dir, 'workspace'), evaluator = path.join(dir, 'hidden');
  await generate({ workspace, evaluator, methods: ['nested'] });
  const pinned = (await fs.readFile(path.join(evaluator, 'freeze.sha256'), 'utf8')).trim();
  const files = ['tasks.hidden.json', 'canonical.json', 'nested.manifest.json', 'freeze.json'];
  for (const file of files) {
    const target = path.join(evaluator, file), original = await fs.readFile(target, 'utf8');
    const data = JSON.parse(original);
    if (file === 'tasks.hidden.json') { data[0].prompt = 'Tampered prompt'; data[0].checks = [['anything']]; data[0].applicable_concept_ids = ['changed']; }
    else if (file === 'canonical.json') data[0].text = 'Changed source text';
    else if (file === 'nested.manifest.json') data.active_bundles = [];
    else data.convention = 'ask-on-conflict';
    await fs.writeFile(target, JSON.stringify(data));
    const artifacts = path.join(dir, `artifacts-${file}`);
    await assert.rejects(run({ workspace, evaluator, artifacts, methods: ['nested'], adapter: '/missing-adapter', expectedFreezeHash: pinned }), /Frozen/);
    assert.equal(await fs.stat(artifacts).then(() => true, () => false), false);
    await fs.writeFile(target, original);
  }
  const sealed = await verifyFreeze({ workspace, evaluator, expectedFreezeHash: pinned });
  assert.equal(sealed.frozen.task_hash, hash(sealed.tasks));
  const changedFreeze = JSON.stringify({ ...sealed.frozen, convention: 'ask-on-conflict' });
  await fs.writeFile(path.join(evaluator, 'freeze.json'), changedFreeze);
  await fs.writeFile(path.join(evaluator, 'freeze.sha256'), hash(changedFreeze));
  await assert.rejects(verifyFreeze({ workspace, evaluator, expectedFreezeHash: pinned }), /digest/);
  await fs.writeFile(path.join(evaluator, 'freeze.sha256'), '0'.repeat(64));
  await assert.rejects(verifyFreeze({ workspace, evaluator, expectedFreezeHash: pinned }), /digest/);
});

test('adapter exits, invalid JSON, spawn failure and timeout preserve all attempted cells and raw evidence', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-failure-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const workspace = path.join(dir, 'workspace'), evaluator = path.join(dir, 'hidden');
  await generate({ workspace, evaluator, methods: ['nested', 'okf-path'] });
  for (const [kind, source] of [['exit', "console.log('partial-output');console.error('partial-error');process.exit(7)"], ['json', "console.log('invalid-json')"], ['timeout', "process.on('SIGTERM',()=>{});console.log('partial-output');setInterval(()=>{},1000)"], ['spawn', null]]) {
    const adapter = path.join(dir, `${kind}.mjs`);
    if (source) { await fs.writeFile(adapter, '#!/usr/bin/env node\n' + source + '\n'); await fs.chmod(adapter, 0o700); }
    const artifacts = path.join(dir, `artifacts-${kind}`);
    const result = await run({ workspace, evaluator, artifacts, adapter, taskIds: ['architecture'], timeoutMs: 2000 });
    assert.equal(result.length, 2); assert.equal(result.every(r => r.status === 'failed' && r.machine_grade.coverage === null), true);
    assert.equal((await readJson(path.join(artifacts, 'results.json'))).length, 2);
    for (const r of result) {
      const cell = path.join(artifacts, r.id);
      assert.equal((await readJson(path.join(cell, 'request.json'))).prompt.length > 0, true);
      assert.equal(await fs.stat(path.join(cell, 'adapter-stdout.txt')).then(() => true), true);
      assert.equal(await fs.stat(path.join(cell, 'adapter-stderr.txt')).then(() => true), true);
      assert.equal(r.failure !== null, true);
      if (kind === 'exit') { assert.equal(r.exit_code, 7); assert.equal((await fs.readFile(path.join(cell, 'adapter-stderr.txt'), 'utf8')).includes('partial-error'), true); }
      if (kind === 'timeout') { assert.equal(r.timed_out, true); assert.equal(r.signal, 'SIGKILL'); assert.equal((await fs.readFile(path.join(cell, 'adapter-stdout.txt'), 'utf8')).includes('partial-output'), true); }
    }
  }
});

test('valid adapter JSON with invalid command output fields preserves raw streams, fails both cells and returns a failing CLI status', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-trace-fields-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const workspace = path.join(dir, 'workspace'), evaluator = path.join(dir, 'hidden');
  await generate({ workspace, evaluator, methods: ['nested', 'okf-path'] });
  const trace = [
    { type: 'item.completed', item: { type: 'command_execution', aggregated_output: { unexpected: 'object-output' }, exit_code: 0 } },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 3, cached_input_tokens: 0 } },
  ].map(event => JSON.stringify(event)).join('\n') + '\n';
  assert.equal(parseTrace(trace).malformed.length, 0);
  assert.throws(() => measure(parseTrace(trace).events), /item.aggregated_output/);
  assert.throws(() => measure([{ type: 'item.completed', item: { type: 'mcp_tool_call', aggregated_output: { unexpected: 'object-output' } } }]), /item.aggregated_output/);
  const wrapper = { version: 1, code: 0, stdout: trace, stderr: 'runtime-error-stream\n', model: 'fake-test-only', effort: 'high', runtime_version: 'test-1' };
  const raw = JSON.stringify(wrapper) + '\n', adapter = path.join(dir, 'adapter.mjs');
  await fs.writeFile(adapter, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(raw)});process.stderr.write('transport-error-stream\\n');\n`);
  await fs.chmod(adapter, 0o700);
  const artifacts = path.join(dir, 'artifacts');
  const rows = await run({ workspace, evaluator, artifacts, adapter, taskIds: ['architecture'] });
  assert.equal(rows.length, 2);
  assert.equal(rows.every(row => row.status === 'failed' && row.failure.stage === 'processing' && row.failure.code === 'INVALID_TRACE_FIELDS'), true);
  for (const row of rows) {
    const cell = path.join(artifacts, row.id);
    assert.equal(await fs.readFile(path.join(cell, 'adapter-stdout.txt'), 'utf8'), raw);
    assert.equal(await fs.readFile(path.join(cell, 'adapter-stderr.txt'), 'utf8'), 'transport-error-stream\n');
    assert.equal(await fs.readFile(path.join(cell, 'trace.jsonl'), 'utf8'), trace);
    assert.equal(await fs.readFile(path.join(cell, 'stderr.txt'), 'utf8'), wrapper.stderr);
    assert.equal((await readJson(path.join(cell, 'result.json'))).machine_grade.coverage, null);
    assert.equal((await readJson(path.join(cell, 'failure.json'))).code, 'INVALID_TRACE_FIELDS');
    assert.equal(row.metrics.recurring_input_tokens, null);
  }
  assert.equal((await readJson(path.join(artifacts, 'results.json'))).every(row => row.status === 'failed'), true);
  const cliArtifacts = path.join(dir, 'cli-artifacts');
  const cli = await command(process.execPath, [fileURLToPath(new URL('../main.mjs', import.meta.url)), 'run', '--workspace', workspace, '--evaluator', evaluator, '--artifacts', cliArtifacts, '--adapter', adapter, '--tasks', 'architecture'], { timeoutMs: 30000 });
  assert.equal(cli.code, 1); assert.equal(JSON.parse(cli.stdout).failed_cells, 2);
  assert.equal((await readJson(path.join(cliArtifacts, 'results.json'))).every(row => row.status === 'failed'), true);
});
