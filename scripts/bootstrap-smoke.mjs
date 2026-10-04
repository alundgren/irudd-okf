import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { addToShellPath } from './shell-path.mjs';

const directory = await realpath(await mkdtemp(join(tmpdir(), 'okf-bootstrap-')));
const upstream = join(directory, 'upstream');
const root = join(directory, 'managed installation');
const bin = join(directory, 'bin with spaces');
const tools = join(directory, 'tools');
const executable = join(bin, 'irudd-okf');
const metadata = `${executable}.install.json`;
const failure = join(directory, 'fail-build');
const calls = join(directory, 'calls.jsonl');
const installer = await readFile(resolve('install.sh'), 'utf8');
const env = {
  ...process.env, PATH: `${tools}${delimiter}/usr/bin${delimiter}/bin`, SHELL: '/bin/unsupported-test-shell',
  OKF_INSTALL_ROOT: root, OKF_INSTALL_DIR: bin, OKF_SMOKE_ARTIFACT: resolve('build/irudd-okf'),
  OKF_SMOKE_FAILURE: failure, OKF_SMOKE_CALLS: calls,
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${upstream}.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/alundgren/irudd-okf.git',
};
const git = (...args) => execFileSync('git', args, { cwd: upstream, encoding: 'utf8', env }).trim();
const install = (environment = env) => spawnSync('/bin/bash', [], { input: installer, cwd: directory, env: environment, encoding: 'utf8', timeout: 60_000 });
try {
  await mkdir(join(upstream, 'scripts'), { recursive: true });
  await mkdir(tools);
  for (const file of ['install-cli.mjs', 'shell-path.mjs']) await copyFile(resolve('scripts', file), join(upstream, 'scripts', file));
  await writeFile(join(upstream, 'package.json'), JSON.stringify({ version: '0.1.0', devDependencies: { 'vite-plus': '1.0.0' } }, null, 2));
  await writeFile(join(upstream, '.gitignore'), 'build/\n');
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Bootstrap smoke');
  git('config', 'user.email', 'smoke@example.invalid');
  git('add', '.');
  git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'initial');
  const vp = join(tools, 'vp');
  await writeFile(vp, `#!${process.execPath}\n` + `
import { appendFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
appendFileSync(process.env.OKF_SMOKE_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'install') process.exit(0);
if (args[0] !== 'run' || args[1] !== '--no-cache' || args[2] !== 'install:cli') process.exit(2);
if (existsSync(process.env.OKF_SMOKE_FAILURE)) { console.error('Simulated build failure'); process.exit(1); }
mkdirSync('build', { recursive: true });
copyFileSync(process.env.OKF_SMOKE_ARTIFACT, 'build/irudd-okf');
execFileSync(process.execPath, ['scripts/install-cli.mjs', ...args.slice(3)], { stdio: 'inherit' });
`);
  await chmod(vp, 0o755);
  let result = install();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Open a new terminal/);
  let record = JSON.parse(await readFile(metadata, 'utf8'));
  assert.equal(record.source, join(root, 'source'));
  assert.equal(record.vp, vp);
  const recorded = await readFile(metadata);
  result = install();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(metadata), recorded);
  await assert.rejects(access(join(root, '.install-lock')), { code: 'ENOENT' });

  await writeFile(join(upstream, 'new-main.txt'), 'Upgrade without vp on PATH.');
  git('add', '.');
  git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'next');
  const withoutVp = { ...env, PATH: '/usr/bin:/bin' };
  result = spawnSync(executable, ['upgrade'], { cwd: directory, encoding: 'utf8', env: withoutVp, timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).updated, true);
  record = JSON.parse(await readFile(metadata, 'utf8'));
  assert.equal(record.revision, git('rev-parse', 'HEAD'));
  assert.equal(record.vp, vp);
  const before = await readFile(executable);
  await writeFile(failure, 'fail');
  result = install();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Simulated build failure/);
  assert.deepEqual(await readFile(executable), before);
  await assert.rejects(access(join(root, '.install-lock')), { code: 'ENOENT' });
  await rm(failure);

  const missingRoot = join(directory, 'without-vp');
  const bootstrapTools = join(directory, 'bootstrap-tools');
  await mkdir(bootstrapTools);
  await writeFile(join(bootstrapTools, 'curl'), `#!/bin/sh
while [ "$1" != '-o' ]; do shift; done
cat > "$2" <<'INSTALL'
set -eu
[ "$VP_VERSION" = '1.0.0' ]
[ "$VP_NODE_MANAGER" = 'no' ]
mkdir -p "$VP_HOME/bin"
cp "$OKF_SMOKE_VP_TEMPLATE" "$VP_HOME/bin/vp"
chmod 755 "$VP_HOME/bin/vp"
INSTALL
`);
  await chmod(join(bootstrapTools, 'curl'), 0o755);
  result = install({ ...env, PATH: `${bootstrapTools}:/usr/bin:/bin`, OKF_INSTALL_ROOT: missingRoot, OKF_INSTALL_DIR: join(missingRoot, 'bin'), OKF_VP: join(missingRoot, 'not-installed'), VP_HOME: join(missingRoot, 'vite-plus'), OKF_SMOKE_VP_TEMPLATE: vp });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Installing Vite\+/);
  assert.equal(JSON.parse(await readFile(join(missingRoot, 'bin/irudd-okf.install.json'), 'utf8')).vp, join(missingRoot, 'vite-plus/bin/vp'));

  for (const [shell, profile] of [['/bin/bash', '.bash_profile'], ['/bin/zsh', '.zprofile']]) {
    const profileHome = join(directory, shell.slice(5));
    await mkdir(profileHome);
    const path = join(profileHome, profile);
    await writeFile(path, '# Existing configuration\nexport KEEP_ME=yes\n');
    const quotedBin = join(directory, "bin with spaces and 'quotes' and $literal");
    await addToShellPath(quotedBin, profileHome, shell);
    const once = await readFile(path, 'utf8');
    await addToShellPath(quotedBin, profileHome, shell);
    assert.equal(await readFile(path, 'utf8'), once);
    assert.match(once, /export KEEP_ME=yes/);
    const actual = execFileSync('/bin/bash', ['--noprofile', '--norc', '-c', '. "$1"; printf "%s" "$PATH"', 'path-check', path], { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } });
    assert.equal(actual, `${quotedBin}:/usr/bin:/bin`);
  }
  console.log(JSON.stringify({ version: 1, checks: ['piped-install', 'managed-separate-clone', 'vp-path-recorded', 'repeat-install', 'upgrade-without-vp-on-path', 'failed-build-preserves-cli', 'lock-cleanup', 'missing-vp-bootstrap', 'pinned-vp-version', 'shell-profile-preserved', 'path-configured-once', 'shell-quoting'], passed: true }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
