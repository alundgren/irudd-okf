import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'okf-release-check-'));
const input = join(directory, 'artifacts');
const output = join(directory, 'release');
const assemble = resolve('scripts/assemble-release.mjs');
const run = () => execFileSync(process.execPath, [assemble, input, output], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await mkdir(input);
  const names = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'].map(platform => `irudd-okf-${platform}.tar.gz`);
  for (const name of names.slice(0, 3)) {
    const bytes = Buffer.from(name); await writeFile(join(input, name), bytes);
    await writeFile(join(input, `${name}.sha256`), `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
  }
  assert.throws(run, /Missing native archives/);
  const last = names[3]; const bytes = Buffer.from(last); await writeFile(join(input, last), bytes);
  await writeFile(join(input, `${last}.sha256`), `${'0'.repeat(64)}  ${last}\n`);
  assert.throws(run, /Artifact checksum mismatch/);
  await assert.rejects(readFile(join(output, 'SHA256SUMS')));
  await writeFile(join(input, `${last}.sha256`), `${createHash('sha256').update(bytes).digest('hex')}  ${last}\n`);
  assert.equal(JSON.parse(run()).verified, true);
  const manifest = await readFile(join(output, 'SHA256SUMS'), 'utf8');
  assert.equal(manifest.trim().split('\n').length, 4);
  for (const name of names) assert(manifest.includes(`  ${name}\n`));
  assert.equal(JSON.parse(run()).verified, true);
  await writeFile(join(input, last), 'corrupt'); assert.throws(run, /Artifact checksum mismatch/);
  assert.equal(await readFile(join(output, 'SHA256SUMS'), 'utf8'), manifest);
  console.log(JSON.stringify({ version: 1, checks: ['four-architectures-required', 'checksum-verification-before-output', 'installer-manifest', 'repeatable-assembly', 'corrupt-input-rejection'], passed: true }));
} finally { await rm(directory, { recursive: true, force: true }); }
