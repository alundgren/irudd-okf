import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { describe, expect, it } from 'vite-plus/test';
import { buildBotLibrary, botNote, global, agent } from '../../core/test/bot-fixture.ts';
import { createStore } from '../../core/src/index.ts';

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const loader = import.meta.resolve('tsx');
const execute = (base: string, library: string, ...args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
  const child = spawn(process.execPath, ['--import', loader, main, '--bundle', `bots=${library}`, ...args], { cwd: base, env: { ...process.env, TSX_DISABLE_CACHE: '1', NODE_NO_WARNINGS: '1', XDG_CONFIG_HOME: join(base, 'config') } });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject); child.once('close', status => resolve({ status, stdout, stderr }));
});
async function files(root: string, prefix = ''): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) output.push(relative + '/', ...await files(root, relative + '/'));
    else output.push(`${relative}:${(await stat(join(root, relative))).mtimeMs}:${(await readFile(join(root, relative), 'utf8')).length}`);
  }
  return output;
}

describe('lock-free CLI reads', () => {
  it('run as concurrent processes against read-only files while a writer holds the lock, and report unfinished publications on stderr', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'okf-reads-cli-')));
    const library = join(base, 'library');
    const paths: string[] = [];
    try {
      const built = await buildBotLibrary(library);
      await mkdir(join(library, '.irudd-okf'), { recursive: true });
      await writeFile(join(library, '.irudd-okf', 'write.lock'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      for (const entry of await files(library)) if (!entry.endsWith('/')) { const file = join(library, entry.split(':')[0]); paths.push(file); await chmod(file, 0o444); }
      const before = await files(library);
      const commands = [['search', 'SENTINEL', '--all-applicability'], ['bot', 'list'], ['bot', 'resolve', 'game1: playtester'], ['change', 'list', 'bots'], ['bot', 'check', 'bots'], ['read', 'bots', 'unrelated.md']];
      const results = await Promise.all(commands.map(args => execute(base, library, ...args)));
      for (const [index, result] of results.entries()) { expect(result.status, `${commands[index].join(' ')}: ${result.stderr}`).toBe(0); expect(result.stderr).toBe(''); }
      expect(JSON.parse(results[2].stdout)).toMatchObject({ bot: { id: 'game1-playtester' } });
      expect(await files(library)).toEqual(before);
      for (const file of paths) await chmod(file, 0o644);
      await rm(join(library, '.irudd-okf', 'write.lock'));

      // A writer that stopped after recording its intent: reads succeed, print one warning line and repair nothing.
      const stopped = createStore(built.context, { afterChangeWrite: async phase => { if (phase === 'prepared') throw new Error('Writer stopped'); } });
      await expect(Effect.runPromise(stopped.proposeChange({ bundle: 'bots', path: 'notes/stopped.md', raw: botNote('stopped', 'Stopped.', global), expectedHash: null, actor: agent, reason: 'Interrupted.' }))).rejects.toThrow();
      const intent = await readFile(join(library, 'memory-history.json'), 'utf8');
      const read = await execute(base, library, 'search', 'SENTINEL', '--all-applicability');
      expect(read.status, read.stderr).toBe(0);
      expect(JSON.parse(read.stderr)).toMatchObject({ version: 1, warnings: [{ code: 'PUBLICATION_INCOMPLETE', path: 'notes/stopped.md' }] });
      expect(await readFile(join(library, 'memory-history.json'), 'utf8')).toBe(intent);
      // A failing command prints only its error, so callers can parse stderr as one JSON object.
      const failed = await execute(base, library, 'bot', 'resolve', 'nobody');
      expect(failed.status).toBe(2);
      expect(JSON.parse(failed.stderr)).toMatchObject({ error: { code: 'BOT_NOT_FOUND' } });
    } finally {
      for (const file of paths) await chmod(file, 0o644).catch(() => undefined);
      await rm(base, { recursive: true, force: true });
    }
  }, 120_000);
});
