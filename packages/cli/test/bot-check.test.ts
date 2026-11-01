import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';
import { BOT_CATALOG_PATH } from '../../core/src/index.ts';
import { bot, botCatalog, botDefinition, makeLibrary, target } from '../../core/test/bot-fixture.ts';

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const loader = import.meta.resolve('tsx');

describe('bot check CLI', () => {
  it('checks drafts and pending proposals in an explicitly selected library from a directory without Git', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'okf-bot-check-cli-')));
    try {
      const library = join(base, 'library'), generic = join(base, 'generic');
      const coordinator = bot('proj: coordinator', 'Keeps proj direction.', []);
      await makeLibrary(library, 'bots', [['bots/proj-coordinator.md', botDefinition('proj-coordinator', coordinator)], [BOT_CATALOG_PATH, botCatalog([{ id: 'proj-coordinator', definition: 'proj-coordinator.md' }])]]);
      await mkdir(generic);
      const execute = (...args: string[]) => spawnSync(process.execPath, ['--import', loader, main, '--bundle', `bots=${library}`, ...args], { cwd: generic, encoding: 'utf8', env: { ...process.env, TSX_DISABLE_CACHE: '1', NODE_NO_WARNINGS: '1', XDG_CONFIG_HOME: join(base, 'config'), XDG_STATE_HOME: join(base, 'state') }, timeout: 60000 });
      const run = (...args: string[]) => { const result = execute(...args); expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout); };
      const file = async (name: string, value: unknown) => { const target = join(base, name); await writeFile(target, JSON.stringify(value)); return target; };
      const tester = (collaborator: string) => botDefinition('proj-tester', bot('proj: tester', 'Plays proj builds.', [target('own-notes', 'own', 'proj/tester', { repository: 'proj' })], [{ bot: collaborator, handoff: 'Propose observations to the coordinator.' }]));
      const catalog = botCatalog([{ id: 'proj-coordinator', definition: 'proj-coordinator.md' }, { id: 'proj-tester', definition: 'proj-tester.md' }]);

      const unknown = run('bot', 'check', 'bots', '--id', 'proj-tester', '--file', await file('unknown.json', { drafts: [{ path: 'bots/proj-tester.md', raw: tester('proj-designer') }, { path: BOT_CATALOG_PATH, raw: catalog }] }));
      expect(unknown).toMatchObject({ ready: false, bots: [{ id: 'proj-tester', state: 'draft', ready: false }] });
      expect(unknown.bots[0].diagnostics.map((item: { code: string }) => item.code)).toEqual(['BOT_COLLABORATOR_UNAVAILABLE', 'BOT_MEMORY_EMPTY']);

      const actor = { type: 'agent', id: 'creator-session-1' };
      const definition = run('change', 'propose', 'bots', '--file', await file('definition.json', { path: 'bots/proj-tester.md', raw: tester('proj-coordinator'), expectedHash: null, actor, reason: 'Brief confirmed by the user.' }));
      const current = run('read', 'bots', BOT_CATALOG_PATH);
      run('change', 'propose', 'bots', '--file', await file('catalog.json', { path: BOT_CATALOG_PATH, raw: catalog, expectedHash: current.hash, actor, reason: 'Register proj: tester.' }));
      const pending = run('bot', 'check', 'bots', '--id', 'proj-tester');
      expect(pending).toMatchObject({ ready: true, bots: [{ state: 'pending', requires: [BOT_CATALOG_PATH, 'bots/proj-tester.md'] }] });
      expect(pending.candidates.find((item: { path: string }) => item.path === 'bots/proj-tester.md')).toMatchObject({ changeId: definition.id, actor });
      expect(JSON.parse(execute('bot', 'resolve', 'proj: tester').stderr).error.code).toBe('BOT_NOT_FOUND');
      expect(run('bot', 'check', 'bots', '--id', 'proj-tester', '--file', await file('confirm.json', { confirmedRegistrationChanges: [] })).ready).toBe(true);

      const schema = run('cli', 'schema', 'bot', 'check');
      expect(schema).toMatchObject({ command: 'bot check', mutates: false, input: { required: ['bundle'] } });
      expect(schema.fileInput).toBeDefined(); expect(schema.outputSchema).toBeDefined();
      expect(JSON.stringify(schema.fileInput)).toMatch(/confirmedRegistrationChanges.*"path"/);
      expect(schema.errors.map((item: { code: string }) => item.code)).toContain('MIGRATION_REQUIRED');
      expect(run('cli', 'search', 'validate pending bot definition').results[0].command).toBe('bot check');
    } finally { await rm(base, { recursive: true, force: true }); }
  }, 240000);
});
