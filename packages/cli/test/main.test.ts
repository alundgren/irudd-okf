import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';
import { VERSION } from '../../core/src/contracts.ts';

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', main, ...args], {
  encoding: 'utf8',
  env: { ...process.env, TSX_DISABLE_CACHE: '1', NODE_NO_WARNINGS: '1' },
  timeout: 15_000,
});

describe('CLI help and errors', () => {
  it.each([[], ['--help'], ['-h'], ['bundle'], ['search', '--help']].map(args => ({ args })))('prints help and exits successfully for $args', ({ args }) => {
    const result = run(...args);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('USAGE');
    expect(result.stdout).toContain('irudd-okf');
    expect(result.stderr).toBe('');
  });

  it('prints the version and exits successfully', () => {
    const result = run('--version');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`irudd-okf v${VERSION}`);
    expect(result.stderr).toBe('');
  });

  it.each([
    { args: ['--unknown'], message: 'Unrecognized flag: --unknown' },
    { args: ['search'], message: 'Missing required argument: query' },
  ])('reports invalid arguments for $args', ({ args, message }) => {
    const result = run(...args);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({ version: 1, error: { code: 'INVALID_ARGUMENTS', message: expect.stringContaining(message) } });
  });

  it('preserves command errors', () => {
    const result = run('cli', 'schema', 'unknown');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({ version: 1, error: { code: 'COMMAND_NOT_FOUND' } });
  });
});
