import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { executableName, writeVpMock } from './smoke-tools.mjs';

assert.equal(process.platform, 'win32');
const directory = await realpath(await mkdtemp(join(tmpdir(), 'okf-windows-bootstrap-')));
const upstream = join(directory, 'upstream');
const root = join(directory, 'managed installation');
const bin = join(directory, 'bin with spaces');
const tools = join(directory, 'tools');
const executable = join(bin, executableName);
const failure = join(directory, 'fail-build');
const env = {
  ...process.env, PATH: `${tools}${delimiter}${process.env.PATH}`,
  OKF_INSTALL_ROOT: root, OKF_INSTALL_DIR: bin, OKF_SMOKE_ARTIFACT: resolve('build', executableName),
  OKF_SMOKE_FAILURE: failure,
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${upstream.replaceAll('\\', '/')}.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/alundgren/irudd-okf.git',
};
const git = (...args) => execFileSync('git', args, { cwd: upstream, encoding: 'utf8', env }).trim();
const powershell = (...args) => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { encoding: 'utf8' });
const originalPath = JSON.parse(powershell('-Command', "ConvertTo-Json -InputObject ([Environment]::GetEnvironmentVariable('Path', 'User')) -Compress"));
const install = () => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('install.ps1')], { cwd: directory, env, encoding: 'utf8', timeout: 60_000 });
try {
  await mkdir(join(upstream, 'scripts'), { recursive: true });
  await mkdir(tools);
  for (const file of ['install-cli.mjs', 'shell-path.mjs', 'windows-path.ps1']) await copyFile(resolve('scripts', file), join(upstream, 'scripts', file));
  await writeFile(join(upstream, 'package.json'), JSON.stringify({ version: '0.1.0', devDependencies: { 'vite-plus': '1.0.0' } }));
  await writeFile(join(upstream, '.gitignore'), 'build/\n');
  git('init', '--initial-branch=main');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Windows bootstrap smoke');
  git('config', 'user.email', 'smoke@example.invalid');
  git('add', '.'); git('-c', 'core.hooksPath=NUL', '-c', 'commit.gpgsign=false', 'commit', '-m', 'initial');
  env.OKF_VP = await writeVpMock(tools, `
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args[0] === 'install') process.exit(0);
if (args[0] !== 'run' || args[1] !== '--no-cache' || args[2] !== 'install:cli') process.exit(2);
if (existsSync(process.env.OKF_SMOKE_FAILURE)) { console.error('Simulated build failure'); process.exit(1); }
mkdirSync('build', { recursive: true });
copyFileSync(process.env.OKF_SMOKE_ARTIFACT, 'build/irudd-okf.exe');
execFileSync(${JSON.stringify(process.execPath)}, ['scripts/install-cli.mjs', ...args.slice(3)], { stdio: 'inherit' });
`);
  let result = install();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Open a new terminal/);
  const metadata = join(bin, 'irudd-okf.install.json');
  const installed = await readFile(metadata);
  const record = JSON.parse(installed);
  assert.equal(record.source, join(root, 'source'));
  assert.equal(record.vp, env.OKF_VP);
  assert.equal(execFileSync(executable, ['context'], { cwd: directory, env, encoding: 'utf8' }).includes('bundles'), true);
  result = install();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(metadata), installed);
  const userPath = JSON.parse(powershell('-Command', "ConvertTo-Json -InputObject ([Environment]::GetEnvironmentVariable('Path', 'User')) -Compress"));
  assert.equal(userPath.split(';').filter(entry => entry === bin).length, 1);
  assert(userPath.startsWith(originalPath ?? ''));

  await writeFile(join(upstream, 'next.txt'), 'Upgrade using the recorded Vite+ executable.');
  git('add', '.'); git('-c', 'core.hooksPath=NUL', '-c', 'commit.gpgsign=false', 'commit', '-m', 'next');
  const withoutVp = { ...env, PATH: process.env.PATH };
  result = spawnSync(executable, ['upgrade'], { cwd: directory, env: withoutVp, encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).updated, true);
  assert.equal(JSON.parse(await readFile(metadata, 'utf8')).revision, git('rev-parse', 'HEAD'));
  assert.match(execFileSync(executable, ['--version'], { encoding: 'utf8' }), /irudd-okf v/);
  const before = await readFile(executable);
  await writeFile(failure, 'fail');
  result = install();
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readFile(executable), before);
  await assert.rejects(readFile(join(root, '.install-lock', 'vite-plus.ps1')), { code: 'ENOENT' });
  await rm(failure);
  await mkdir(join(root, '.install-lock'));
  result = install();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Another installation may be running/);
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, checks: ['powershell-installer', 'install-path-spaces', 'repeat-install', 'user-path-preserved', 'recorded-vp-upgrade', 'running-executable-replaced', 'build-failure-preserves-install', 'installation-lock'], passed: true }));
} finally {
  powershell('-Command', `[Environment]::SetEnvironmentVariable('Path', ${originalPath === null ? '$null' : "'" + originalPath.replaceAll("'", "''") + "'"}, 'User')`);
  await rm(directory, { recursive: true, force: true });
}
