import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vite-plus/test';

it('runs the standalone experiment suite through the standard repository test command', async () => {
  const file = fileURLToPath(new URL('./experiments.test.mjs', import.meta.url));
  const result = await promisify(execFile)(process.execPath, ['--test', file], { timeout: 55000 }).catch((error: Error & { stdout?: string; stderr?: string }) => {
    throw new Error(`${error.message}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
  });
  expect(result.stdout).toContain('fail 0');
}, 60000);
