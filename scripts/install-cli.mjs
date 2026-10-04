import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
if (git('rev-parse', '--show-toplevel') !== source || git('branch', '--show-current') !== 'main' || git('status', '--porcelain')) {
  throw new Error('Install from a clean, separate clone on main. Commit or move local changes first.');
}
const installation = { version: 1, source, revision: git('rev-parse', 'HEAD'), productVersion: JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).version };
const directory = resolve(process.argv[2] ?? process.env.OKF_INSTALL_DIR ?? join(homedir(), '.local/bin'));
await mkdir(directory, { recursive: true });
const staging = await mkdtemp(join(directory, '.irudd-okf-'));
try {
  const executable = join(staging, 'irudd-okf');
  await copyFile(join(source, 'build/irudd-okf'), executable);
  await chmod(executable, 0o755);
  execFileSync(executable, ['--version'], { stdio: 'ignore' });
  await writeFile(join(staging, 'irudd-okf.install.json'), `${JSON.stringify(installation)}\n`);
  await rename(executable, join(directory, 'irudd-okf'));
  await rename(join(staging, 'irudd-okf.install.json'), join(directory, 'irudd-okf.install.json'));
  console.error(`Installed ${join(directory, 'irudd-okf')} from ${source} at ${installation.revision}.`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
