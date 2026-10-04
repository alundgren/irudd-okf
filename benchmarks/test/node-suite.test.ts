import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vite-plus/test';

it('runs the standalone experiment suite through the standard repository test command', async () => {
  const files = ['experiments.test.mjs', 'personal.test.mjs', 'personal-bounded.test.mjs'].map((name) => fileURLToPath(new URL(name, import.meta.url)));
  const result = await promisify(execFile)(process.execPath, ['--test', ...files], { timeout: 90000 }).catch((error: Error & { stdout?: string; stderr?: string }) => {
    throw new Error(`${error.message}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
  });
  expect(result.stdout).toContain('fail 0');
}, 95000);
