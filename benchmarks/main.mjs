#!/usr/bin/env node
import { Effect } from 'effect';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generate } from './corpus.mjs';
import { run } from './run.mjs';
import { operation, json, readJson } from './lib.mjs';
import { pairedScaleRows } from './metrics.mjs';
import { audit, download } from './audit.mjs';

const [action, ...args] = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const required = name => { const result = value(name); if (!result) throw new Error(`Missing --${name}`); return path.resolve(result); };
const execute = operation(async () => {
  if (action === 'generate') return generate({ workspace: required('workspace'), evaluator: required('evaluator'), count: Number(value('count', 100)), seed: Number(value('seed', 20261004)), methods: value('arms')?.split(','), personal: args.includes('--personal'), convention: value('convention', 'repo-wins') });
  if (action === 'run') return run({ workspace: required('workspace'), evaluator: required('evaluator'), artifacts: required('artifacts'), methods: value('arms')?.split(','), taskIds: value('tasks', 'architecture,ux-gotcha').split(','), adapter: value('adapter'), timeoutMs: Number(value('timeout-ms', 180000)), unsafePilot: args.includes('--unsafe-pilot'), expectedFreezeHash: value('freeze-hash') });
  if (action === 'download') return download({ repository: value('repository'), destination: required('destination') });
  if (action === 'audit') return audit({ source: required('source'), output: required('output') });
  if (action === 'analyze') {
    const results = (await Promise.all(value('inputs').split(',').map(file => readJson(file)))).flat();
    const output = { status: 'descriptive_only', results: results.map(r => ({ id: r.id, arm: r.arm, count: r.count, task_id: r.task_id, status: r.status, metrics: r.metrics, machine_grade: r.machine_grade, human_grade: r.human_grade })), within_arm_scale_pairs: pairedScaleRows(results), causal_claims: null, reason: 'Feasibility results cannot establish efficacy. Human equivalence review, blinded ratings, full context traces and confirmatory sample remain pending.' };
    await json(required('output'), output); return { runs: results.length };
  }
  throw new Error('Use generate, run, or analyze. See docs/experiments/README.md.');
});
try {
  const result = await Effect.runPromise(execute);
  const failed = action === 'run' ? result.filter(r => r.status !== 'completed').length : 0;
  const summary = { status: failed ? 'completed_with_failed_cells' : 'ok', records: Array.isArray(result) ? result.length : result };
  if (action === 'generate') summary.freeze_sha256 = (await fs.readFile(path.join(required('evaluator'), 'freeze.sha256'), 'utf8')).trim();
  if (action === 'run') { summary.failed_cells = failed; if (failed) process.exitCode = 1; }
  console.log(JSON.stringify(summary));
}
catch (error) { console.error(error.message); process.exitCode = 1; }
