import { execFileSync } from 'node:child_process';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const executableName = process.platform === 'win32' ? 'irudd-okf.exe' : 'irudd-okf';
export async function writeVpMock(directory, script) {
  const vp = join(directory, process.platform === 'win32' ? 'vp.exe' : 'vp');
  if (process.platform === 'win32') {
    const main = join(directory, 'vp.mjs');
    const config = join(directory, 'vp-sea.json');
    await writeFile(main, script);
    await writeFile(config, JSON.stringify({ main, mainFormat: 'module', output: vp, disableExperimentalSEAWarning: true }));
    execFileSync(process.execPath, ['--build-sea', config], { stdio: 'pipe' });
  } else {
    await writeFile(vp, `#!${process.execPath}\n${script}`);
    await chmod(vp, 0o755);
  }
  return vp;
}
