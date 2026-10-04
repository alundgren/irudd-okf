import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { concepts, generate, tasks } from '../corpus.mjs';
import { measure, pairedScaleRows } from '../metrics.mjs';
import { inventory, outside, readJson } from '../lib.mjs';
import { run } from '../run.mjs';

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
  assert.equal(new Set(manifests.map(m => m.canonical_hash)).size, 1);
  assert.equal(new Set(manifests.map(m => m.transformed_concept_hash)).size, 1);
  for (const manifest of manifests) {
    const root = path.join(workspace, manifest.arm);
    for (const mapping of manifest.source_map) {
      const text = await fs.readFile(path.join(root, mapping.file), 'utf8');
      const concept = concepts(100).find(c => c.id === mapping.id);
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

test('scale comparison pairs only identical task, path and applicable concepts', () => {
  const row = count => ({ count, arm: 'okf-path', task_id: 'architecture', launch_cwd: 'packages/checkout', applicable_concept_ids: ['same'], metrics: { recurring_input_tokens: count }, machine_grade: { coverage: 1 } });
  const result = pairedScaleRows([row(100), row(1000), { ...row(10000), applicable_concept_ids: ['different'] }]);
  assert.equal(result.filter(r => r.status === 'paired').length, 1);
  assert.equal(result.find(r => r.status === 'paired').input_change, 900);
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
