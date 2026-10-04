import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Effect } from 'effect';
import { createStore, resolveContext } from '../packages/core/src/index.ts';
// @ts-expect-error The synthetic corpus generator is a standalone JS command.
import { generate } from './corpus.mjs';

const destination = process.argv[2];
if (!destination) throw new Error('Pass an output JSON path. Run with node --import tsx benchmarks/engineering.ts OUTPUT.');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-engineering-'));
try {
  await Effect.runPromise(Effect.tryPromise({ try: () => generate({ workspace: path.join(temporary, 'workspace'), evaluator: path.join(temporary, 'evaluator'), count: 10000, methods: ['okf-path'] }), catch: error => error }));
  const context = await Effect.runPromise(resolveContext({ cwd: temporary, explicitBundles: [{ name: 'repo', root: path.join(temporary, 'workspace/okf-path/.okf') }] }));
  const store = createStore(context);
  const start = performance.now();
  const scan = await Effect.runPromise(store.list());
  const scanMs = performance.now() - start;
  const samples: number[] = [];
  let resultBytes = 0;
  for (let i = 0; i < 25; i++) {
    const before = performance.now();
    const result = await Effect.runPromise(store.search('checkout payment retry', { limit: 10 }));
    samples.push(performance.now() - before); resultBytes = Buffer.byteLength(JSON.stringify(result));
  }
  samples.sort((a, b) => a - b);
  const output = { study: 'synthetic_engineering_retrieval', count: scan.length, node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, full_scan_ms: scanMs, search_median_ms: samples[12], search_p95_ms: samples[23], samples_ms: samples, result_bytes: resultBytes, rss_bytes: process.memoryUsage().rss, peak_rss_bytes: process.resourceUsage().maxRSS * 1024, native_binary_bytes: null, native_binary_reason: 'Source-runtime engineering measurement; packaged executable not measured.', claims: 'Local engineering measurements only. This does not measure model context, causal task quality, or human memory quality.' };
  await fs.mkdir(path.dirname(path.resolve(destination)), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output));
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
