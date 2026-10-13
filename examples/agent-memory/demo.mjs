import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const executable = resolve(process.argv[2] ?? 'build/irudd-okf');
const scratch = await mkdtemp(join(tmpdir(), 'okf-memory-demo-'));
const root = process.argv[3] ? resolve(process.argv[3]) : join(scratch, '.okf');
let inputNumber = 0;
const now = new Date();
const timestamp = now.toISOString();
const occurred = new Date(now.getTime() - 31 * 86400000).toISOString();
const completed = new Date(Date.parse(occurred) + 2 * 3600000).toISOString();
const future = new Date(now.getTime() + 90 * 86400000).toISOString();
const call = (...args) => JSON.parse(execFileSync(executable, ['--bundle', `demo=${root}`, ...args], { cwd: dirname(root), encoding: 'utf8' }));
const fileCall = async (args, value) => {
  const file = join(scratch, `request-${++inputNumber}.json`);
  await writeFile(file, JSON.stringify(value, null, 2) + '\n');
  return call(...args, '--file', file);
};
const rawDocument = (metadata, body) => '---\n' + Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n') + '\n---\n\n' + body + '\n';
const save = async (path, raw) => {
  const file = join(scratch, `note-${++inputNumber}.md`);
  await writeFile(file, raw);
  return call('write', 'demo', path, '--file', file, '--expected', 'new');
};
const base = (type, title, description, kind, stage, extra = {}) => ({
  type, title, description, tags: ['testing'], status: 'stable',
  generated: { by: 'process:memory-demo', at: timestamp },
  sources: [{ id: 'demo', resource: 'https://example.invalid/synthetic-demo-definition' }],
  memory: { kind, stage, ...extra },
});

try {
  await mkdir(dirname(root), { recursive: true });
  execFileSync(executable, ['init', root], { cwd: dirname(root), encoding: 'utf8' });
  const policy = call('read', 'demo', 'memory-policy.md');
  const policyFile = join(scratch, 'policy.md');
  await writeFile(policyFile, rawDocument({
    ...base('Memory policy', 'Synthetic demo memory policy', 'Vocabulary and lifetime defaults for this invented example.', 'procedural', 'silver'),
    memory_policy: { name: 'agent-memory', version: 1, namespaces: ['shared', 'payments', 'platform'], topics: ['memory', 'testing'], task_retention_days: 30, review_interval_days: 90, gold_review: 'any' },
  }, '# Synthetic demo\n\nAll observations and procedures in this bundle are invented examples, not production guidance.'));
  call('write', 'demo', 'memory-policy.md', '--file', policyFile, '--expected', policy.hash);

  const template = await fileCall(['template', 'demo'], {
    kind: 'episodic', stage: 'bronze', namespace: 'payments', title: 'Example migration attempt',
    description: 'An invented task episode demonstrates occurrence and retention metadata.', tags: ['testing'],
    actor: 'process:memory-demo', at: timestamp, occurredAt: occurred,
    sources: ['https://example.invalid/tasks/42'], task: { reference: 'https://example.invalid/tasks/42', state: 'open' },
  });
  await save('episodes/attempt.md', template.raw + '\nThis fictional task tried removing `client_id`. The example old client still sent it. The attempt failed, and retaining the field restored compatibility in the example.\n');
  let episode = call('read', 'demo', 'episodes/attempt.md');
  await fileCall(['task', 'demo', episode.path, '--expected', episode.hash], {
    task: { reference: 'https://example.invalid/tasks/42', state: 'completed', completed_at: completed }, retentionDays: 30,
  });
  episode = call('read', 'demo', 'episodes/attempt.md');
  assert.equal(episode.memory.freshness, 'expired');

  await save('facts/client-contract.md', rawDocument({
    ...base('Reference', 'Example old client contract', 'A synthetic contract records the example client request.', 'semantic', 'bronze', { namespace: 'payments' }),
    stale_after: future,
  }, '# Example contract\n\nThe invented old client sends `client_id`. This source describes only the synthetic client in this demo.'));
  const contract = call('read', 'demo', 'facts/client-contract.md');
  await save('facts/compatibility.md', rawDocument({
    ...base('Decision', 'Example compatibility requirement', 'The synthetic migration must account for its old client.', 'semantic', 'silver', {
      namespace: 'payments', derived_from: [{ resource: '/facts/client-contract.md', content_hash: contract.memory.contentHash }],
    }),
    sources: [{ id: 'contract', resource: '/facts/client-contract.md' }], stale_after: future,
  }, '# Applicability\n\nOnly the invented old client in this demo requires `client_id`. See the [example contract](client-contract.md).'));
  const fact = call('read', 'demo', 'facts/compatibility.md');
  await save('procedures/retire-field.md', rawDocument({
    ...base('Rule', 'Example field retirement procedure', 'An invented procedure demonstrates a reviewed synthesis.', 'procedural', 'gold', {
      namespace: 'payments', derived_from: [
        { resource: '/episodes/attempt.md', content_hash: episode.memory.contentHash },
        { resource: '/facts/compatibility.md', content_hash: fact.memory.contentHash },
      ], prerequisites: ['/facts/compatibility.md'],
    }),
    sources: [{ id: 'episode', resource: '/episodes/attempt.md' }, { id: 'fact', resource: '/facts/compatibility.md' }], stale_after: future,
  }, '# Trigger\n\nRetire `client_id` in the synthetic application.\n\n# Applicability\n\nThis procedure applies only to the invented client contract.\n\n# Prerequisites\n\nInspect the [example compatibility requirement](../facts/compatibility.md).\n\n# Steps\n\n1. Check whether the synthetic old client still sends the field.\n2. Keep the field while that client depends on it.\n3. Remove the field only after updating the example client.\n\n# Verification\n\nExercise both example client requests. Retain the [unsuccessful attempt](../episodes/attempt.md) as evidence.'));
  let procedure = call('read', 'demo', 'procedures/retire-field.md');
  call('verify', 'demo', procedure.path, '--actor', 'process:demo-check', '--method', 'Compared the invented procedure with its synthetic source files.', '--expected', procedure.hash);
  procedure = call('read', 'demo', procedure.path);
  call('review', 'demo', procedure.path, '--decision', 'approve', '--actor', 'process:demo-reviewer', '--reason', 'The synthetic example preserves its applicability and evidence.', '--expected', procedure.hash);
  procedure = call('read', 'demo', procedure.path);
  assert.equal(procedure.memory.review, 'approved');
  assert.equal(procedure.memory.humanReviewed, false);
  assert.equal(procedure.memory.dependency, 'valid');

  await save('facts/shared.md', rawDocument(base('Reference', 'Shared demo context', 'All demo agents should know the material is synthetic.', 'semantic', 'silver'), '# Applicability\n\nEvery memory in this bundle is an invented example. No claim is production guidance.'));
  const index = call('read', 'demo', 'index.md');
  const indexFile = join(scratch, 'index.md');
  await writeFile(indexFile, index.raw + '\n## Demo topics\n\n- [Episodes](episodes/index.md)\n- [Facts](facts/index.md)\n- [Procedures](procedures/index.md)\n');
  call('write', 'demo', 'index.md', '--file', indexFile, '--expected', index.hash);
  await save('episodes/index.md', '# Episodes\n\n- [Migration attempt](attempt.md)\n');
  await save('facts/index.md', '# Facts\n\n- [Client contract](client-contract.md)\n- [Compatibility](compatibility.md)\n- [Shared context](shared.md)\n');
  await save('procedures/index.md', '# Procedures\n\n- [Field retirement](retire-field.md)\n');
  const recall = call('search', '', '--scope', 'demo', '--namespace', 'payments', '--limit', '100');
  assert(recall.results.some(note => note.path === 'facts/shared.md'));
  assert(recall.results.some(note => note.path === procedure.path));
  assert(!recall.results.some(note => note.path === episode.path));
  assert.equal(call('validate', '--scope', 'demo').errors, 0);
  const audit = call('audit', '--scope', 'demo', '--namespace', 'payments');
  assert(audit.concepts.some(note => note.path === episode.path));
  const graph = call('graph', '--scope', 'demo', '--namespace', 'payments', '--include-excluded');
  assert(graph.edges.some(edge => edge.from.endsWith(procedure.path) && edge.to.endsWith(episode.path)));
  console.log(JSON.stringify({
    passed: true, retained: Boolean(process.argv[3]), root: process.argv[3] ? root : null,
    checks: ['all-memory-kinds', 'all-processing-stages', 'shared-plus-namespace', 'task-retention', 'expired-exact-read', 'machine-verification', 'independent-machine-review', 'source-revisions', 'historical-evidence', 'indexes', 'source-graph'],
  }, null, 2));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
