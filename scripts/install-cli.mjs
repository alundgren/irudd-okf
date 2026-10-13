import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addToShellPath } from './shell-path.mjs';

const source = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
if (resolve(git('rev-parse', '--show-toplevel')) !== source || git('branch', '--show-current') !== 'main' || git('status', '--porcelain')) {
  throw new Error('Install from a clean, separate clone on main. Commit or move local changes first.');
}
const installation = { version: 1, source, revision: git('rev-parse', 'HEAD'), productVersion: JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).version };
const vp = process.argv[3] ?? process.env.OKF_VP;
if (vp) {
  if (!isAbsolute(vp)) throw new Error('The Vite+ path must be absolute.');
  installation.vp = vp;
}
const name = process.platform === 'win32' ? 'irudd-okf.exe' : 'irudd-okf';
const directory = resolve(process.argv[2] ?? process.env.OKF_INSTALL_DIR ?? join(homedir(), '.local/bin'));
await mkdir(directory, { recursive: true });
const staging = await mkdtemp(join(directory, '.irudd-okf-'));
try {
  const executable = join(staging, name);
  await copyFile(join(source, 'build', name), executable);
  await chmod(executable, 0o755);
  execFileSync(executable, ['--version'], { stdio: 'ignore' });
  await writeFile(join(staging, 'irudd-okf.install.json'), `${JSON.stringify(installation)}\n`);
  const destination = join(directory, name);
  if (process.platform === 'win32') {
    // Windows cannot overwrite a running executable. Rename it first and retain
    // the previous file until the upgrading process exits.
    const previous = join(directory, 'irudd-okf.previous.exe');
    await rm(previous, { force: true });
    let moved = false;
    try { await rename(destination, previous); moved = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(executable, destination); }
    catch (error) { if (moved) await rename(previous, destination); throw error; }
    await rm(previous, { force: true }).catch(error => {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
    });
  } else {
    await rename(executable, destination);
  }
  await rename(join(staging, 'irudd-okf.install.json'), join(directory, 'irudd-okf.install.json'));
  if (process.env.OKF_SETUP_PATH === '1') await addToShellPath(directory);
  console.error(`Installed ${join(directory, name)} from ${source} at ${installation.revision}.`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
