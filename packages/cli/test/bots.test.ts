import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';
import { buildBotLibrary, SENTINELS } from '../../core/test/bot-fixture.ts';

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const loader = import.meta.resolve('tsx');

describe('bot catalog CLI', () => {
  it('discovers and resolves the registered library identically from project and generic directories', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'okf-bots-cli-')));
    try {
      const library = join(base, 'library');
      await buildBotLibrary(library);
      const project = join(base, 'project'), generic = join(base, 'generic');
      await mkdir(project); await mkdir(generic);
      expect(spawnSync('git', ['init', '-q'], { cwd: project }).status).toBe(0);
      const execute = (cwd: string, ...args: string[]) => spawnSync(process.execPath, ['--import', loader, main, ...args], { cwd, encoding: 'utf8', env: { ...process.env, TSX_DISABLE_CACHE: '1', NODE_NO_WARNINGS: '1', XDG_CONFIG_HOME: join(base, 'config'), XDG_STATE_HOME: join(base, 'state') }, timeout: 60000 });
      const run = (cwd: string, ...args: string[]) => { const result = execute(cwd, ...args); expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout); };
      const fail = (cwd: string, ...args: string[]) => { const result = execute(cwd, ...args); expect(result.status).toBe(2); return JSON.parse(result.stderr).error; };
      // The project has its own repository bundle with an unrelated fact; bots must not pick it up from the working directory.
      run(project, 'init');
      const note = join(base, 'local.json');
      await writeFile(note, JSON.stringify({ path: 'local.md', raw: `---\ntype: Memory\ntitle: Local\nmemory:\n  id: local\n  kind: semantic\n  stage: bronze\n  applicability: {"type":"global"}\n---\n${SENTINELS.project} fact.\n`, expectedHash: null, actor: { type: 'agent', id: 'cli-test' }, reason: 'Project note.' }));
      const local = run(project, 'change', 'propose', 'repo', '--file', note);
      const localReview = join(base, 'local-review.json');
      await writeFile(localReview, JSON.stringify({ expectedRevisionHash: local.revisionHash, decision: 'accept', actor: { type: 'human', id: 'operator' }, operator: true, reason: 'Checked.', sources: [] }));
      run(project, 'change', 'review', 'repo', local.id, '--file', localReview);
      run(generic, 'bundle', 'add', 'bots', library, '--activate');
      expect(run(project, 'context').bundles.map((item: { name: string }) => item.name)).toEqual(['repo', 'bots']);
      expect(run(generic, 'context')).toMatchObject({ gitRoot: null, bundles: [{ name: 'bots', kind: 'personal' }] });

      const catalog = run(project, 'bot', 'list');
      expect(run(generic, 'bot', 'list')).toEqual(catalog);
      expect(catalog.bots.map((item: { name: string }) => item.name)).toEqual(['game1: coordinator', 'game1: playtester', 'game2: playtester', 'personal: coach', 'shared: reviewer', 'shared: reviewer']);
      expect(Object.values(SENTINELS).filter(sentinel => JSON.stringify(catalog).includes(sentinel))).toEqual([]);

      const resolved = run(project, 'bot', 'resolve', 'game1: playtester');
      expect(run(generic, 'bot', 'resolve', 'game1: playtester')).toEqual(resolved);
      expect(resolved).toMatchObject({ complete: true, bot: { id: 'game1-playtester', revisionHash: catalog.bots[1].revisionHash } });
      const text = JSON.stringify(resolved);
      expect([SENTINELS.g1Playtester, SENTINELS.g1Shared].every(sentinel => text.includes(sentinel))).toBe(true);
      expect([SENTINELS.g2Playtester, SENTINELS.g2Shared, SENTINELS.project, SENTINELS.coach, SENTINELS.unrelated].some(sentinel => text.includes(sentinel))).toBe(false);
      expect(run(generic, 'bot', 'resolve', 'personal: coach')).toMatchObject({ complete: true, memory: [{ documents: [{ path: 'coach/notes.md' }] }] });
      expect(run(generic, 'bot', 'resolve', '--id', 'dup-a').definition.purpose).toBe('First reviewer.');

      expect(fail(generic, 'bot', 'resolve', 'game1:playtester')).toMatchObject({ code: 'BOT_NOT_FOUND', details: { name: 'game1:playtester' } });
      expect(fail(project, 'bot', 'resolve', 'shared: reviewer')).toMatchObject({ code: 'BOT_NAME_AMBIGUOUS' });
      expect(fail(project, 'bot', 'resolve', '--id', 'ghost')).toMatchObject({ code: 'BOT_UNAVAILABLE' });
      expect(fail(project, 'bot', 'resolve', '--id', 'pending-bot')).toMatchObject({ code: 'BOT_UNAVAILABLE' });
      expect(fail(project, 'bot', 'resolve', 'game1: playtester', '--scope', 'repo')).toMatchObject({ code: 'BOT_NOT_FOUND' });
      const coordinator = run(generic, 'bot', 'resolve', 'game1: coordinator');
      expect(coordinator.complete).toBe(false);
      expect(coordinator.diagnostics.map((item: { code: string }) => item.code)).toEqual(['BOT_UNNAMED_REGISTRATIONS', 'BOT_MEMORY_UNAVAILABLE', 'BOT_MEMORY_BUNDLE_UNAVAILABLE']);

      // Update and accept a linked shared note through the real change commands, then resolve again.
      const current = run(generic, 'read', 'bots', 'game1/shared/direction.md', '--repository', 'game1');
      const update = join(base, 'update.json');
      await writeFile(update, JSON.stringify({ path: current.path, raw: current.raw.replace('SENTINEL-G1-SHARED-v1', 'SENTINEL-G1-SHARED-v2'), expectedHash: current.hash, actor: { type: 'agent', id: 'cli-test' }, reason: 'Refreshed shared direction.' }));
      const change = run(generic, 'change', 'propose', 'bots', '--file', update, '--authorize-personal');
      expect(JSON.stringify(run(project, 'bot', 'resolve', 'game1: playtester'))).toContain('SENTINEL-G1-SHARED-v1');
      const review = join(base, 'review.json');
      await writeFile(review, JSON.stringify({ expectedRevisionHash: change.revisionHash, decision: 'accept', actor: { type: 'human', id: 'operator' }, operator: true, reason: 'Checked.', sources: change.sources }));
      run(generic, 'change', 'review', 'bots', change.id, '--file', review, '--authorize-personal');
      expect(run(generic, 'bot', 'list').bots.some((item: { id: string }) => item.id === 'game1-playtester')).toBe(true);
      const refreshed = run(project, 'bot', 'resolve', 'game1: playtester');
      expect(refreshed.bot.revisionHash).toBe(resolved.bot.revisionHash);
      expect(refreshed.memory[1].documents[0]).toMatchObject({ revisionHash: change.after.hash, body: expect.stringContaining('SENTINEL-G1-SHARED-v2') });

      const schema = run(generic, 'cli', 'schema', 'bot', 'resolve');
      expect(schema.outputSchema).toBeDefined();
      expect(schema.errors.map((item: { code: string }) => item.code)).toContain('BOT_NAME_AMBIGUOUS');
      expect(run(generic, 'cli', 'search', 'resolve bot name').results[0].command).toBe('bot resolve');
    } finally { await rm(base, { recursive: true, force: true }); }
  }, 240000);
});
