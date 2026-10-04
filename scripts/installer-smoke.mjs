import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const directory = await realpath(await mkdtemp(join(tmpdir(), 'okf-installer-')));
const upstream = join(directory, 'upstream');
const source = join(directory, 'separate clone');
const installDirectory = join(directory, 'path with spaces', 'bin');
const executable = join(installDirectory, 'irudd-okf');
const metadata = `${executable}.install.json`;
const tools = join(directory, 'tools');
const calls = join(directory, 'vp-calls.jsonl');
const failure = join(directory, 'fail-build');
const artifact = resolve('build/irudd-okf');
const environment = { ...process.env, PATH: `${tools}${delimiter}${process.env.PATH}`, OKF_SMOKE_ARTIFACT: artifact, OKF_SMOKE_CALLS: calls, OKF_SMOKE_FAILURE: failure };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: environment }).trim();
const run = (...args) => spawnSync(executable, ['upgrade', ...args], { cwd: directory, encoding: 'utf8', env: environment, timeout: 60_000 });
const upgrade = () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const record = async () => JSON.parse(await readFile(metadata, 'utf8'));
const commit = async (text) => {
  await writeFile(join(upstream, 'revision.txt'), text);
  git(upstream, 'add', '.');
  git(upstream, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', text);
  return git(upstream, 'rev-parse', 'HEAD');
};
try {
  await mkdir(join(upstream, 'scripts'), { recursive: true });
  await mkdir(tools);
  await copyFile(resolve('scripts/install-cli.mjs'), join(upstream, 'scripts/install-cli.mjs'));
  await copyFile(resolve('scripts/shell-path.mjs'), join(upstream, 'scripts/shell-path.mjs'));
  await writeFile(join(upstream, '.gitignore'), 'build/\n');
  git(directory, 'init', '--initial-branch=main', upstream);
  git(upstream, 'config', 'user.name', 'Installer smoke');
  git(upstream, 'config', 'user.email', 'smoke@example.invalid');
  await writeFile(join(upstream, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  const initial = await commit('initial');
  git(directory, 'clone', '--branch', 'main', '--single-branch', upstream, source);
  await mkdir(join(source, 'build'));
  await copyFile(artifact, join(source, 'build/irudd-okf'));
  execFileSync(process.execPath, [join(source, 'scripts/install-cli.mjs'), installDirectory], { cwd: directory, env: environment, stdio: 'pipe' });
  assert.equal((await record()).source, source);
  assert.equal((await record()).revision, initial);
  assert.match(execFileSync(executable, ['--version'], { encoding: 'utf8' }), /irudd-okf v/);
  assert.equal(JSON.parse(execFileSync(executable, ['cli', 'schema', 'upgrade'], { encoding: 'utf8' })).mutates, true);

  // Use the real installed executable and installer. Only the expensive Vite+
  // dependency and build commands are replaced in this local Git fixture.
  await writeFile(join(tools, 'vp'), `#!${process.execPath}\n` + `
import { appendFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
appendFileSync(process.env.OKF_SMOKE_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'install') process.exit(0);
if (args[0] !== 'run' || args[1] !== '--no-cache' || args[2] !== 'install:cli') process.exit(2);
if (existsSync(process.env.OKF_SMOKE_FAILURE)) { console.error('Simulated build failure'); process.exit(1); }
mkdirSync('build', { recursive: true });
copyFileSync(process.env.OKF_SMOKE_ARTIFACT, 'build/irudd-okf');
execFileSync(process.execPath, ['scripts/install-cli.mjs', args[3]], { stdio: 'inherit' });
`);
  await chmod(join(tools, 'vp'), 0o755);
  assert.deepEqual(JSON.parse(run('--check').stdout), { current: '0.1.0', latest: '0.1.0', updateAvailable: false });
  assert.equal(upgrade().updated, false);
  await assert.rejects(readFile(calls), { code: 'ENOENT' });

  await writeFile(join(upstream, 'package.json'), JSON.stringify({ version: '0.2.0' }));
  const next = await commit('next');
  const refsBefore = git(source, 'for-each-ref');
  const metadataBefore = await readFile(metadata);
  const binaryBefore = await readFile(executable);
  const check = run('--check');
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual(JSON.parse(check.stdout), { current: '0.1.0', latest: '0.2.0', updateAvailable: true });
  assert.equal(git(source, 'for-each-ref'), refsBefore);
  assert.equal(git(source, 'status', '--porcelain'), '');
  assert.equal(git(source, 'rev-parse', 'HEAD'), initial);
  assert.deepEqual(await readFile(metadata), metadataBefore);
  assert.deepEqual(await readFile(executable), binaryBefore);
  await assert.rejects(readFile(calls), { code: 'ENOENT' });
  assert.deepEqual(upgrade(), { previous: '0.1.0', current: '0.2.0', updated: true });
  assert.equal((await record()).revision, next);
  assert.equal(git(source, 'rev-parse', 'HEAD'), next);
  const buildCalls = await readFile(calls, 'utf8');
  assert.deepEqual(buildCalls.trim().split('\n').map(JSON.parse), [['install', '--frozen-lockfile'], ['run', '--no-cache', 'install:cli', installDirectory]]);
  assert.equal(upgrade().updated, false);
  assert.equal(await readFile(calls, 'utf8'), buildCalls);

  await writeFile(join(source, 'revision.txt'), 'local edit');
  let result = run();
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stderr).error.code, 'UPGRADE_SOURCE_CHANGED');
  assert.equal(await readFile(join(source, 'revision.txt'), 'utf8'), 'local edit');
  git(source, 'restore', 'revision.txt');
  git(source, 'switch', '-c', 'development');
  result = run();
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stderr).error.code, 'UPGRADE_SOURCE_CHANGED');
  git(source, 'switch', 'main');

  const before = await readFile(executable);
  const retryRevision = await commit('retry');
  await writeFile(failure, 'fail');
  result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Simulated build failure/);
  assert.deepEqual(await readFile(executable), before);
  assert.equal((await record()).revision, next);
  assert.equal(git(source, 'rev-parse', 'HEAD'), retryRevision);
  await rm(failure);
  assert.deepEqual(upgrade(), { previous: '0.2.0', current: '0.2.0', updated: true });
  assert.equal((await record()).revision, retryRevision);

  git(source, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '--allow-empty', '-m', 'local only');
  result = run();
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stderr).error.code, 'UPGRADE_SOURCE_CHANGED');
  assert.equal((await record()).revision, retryRevision);

  git(source, 'remote', 'set-url', 'origin', join(directory, 'missing-remote'));
  result = run();
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stderr).error.code, 'PROCESS_FAILED');
  assert.deepEqual(await readFile(executable), before);
  await rm(metadata);
  result = run();
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stderr).error.code, 'INSTALLATION_NOT_FOUND');
  console.log(JSON.stringify({ version: 1, checks: ['separate-clone', 'install-path-spaces', 'executable-runs', 'upgrade-discovery', 'check-json-contract', 'check-leaves-clone-refs-and-install-untouched', 'unchanged-main-skips-build', 'changed-main-reinstalls', 'local-edits-preserved', 'other-branch-rejected', 'build-failure-preserves-install', 'failed-build-retry', 'local-commits-rejected', 'fetch-failure-preserves-install', 'missing-installation-record'], passed: true }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
