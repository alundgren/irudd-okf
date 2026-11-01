import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { createStore, initializeBundle, type Bundle, type Store } from '../src/index.ts';
import { agent, botNote, buildBotLibrary, global, human, SENTINELS } from './bot-fixture.ts';

const run = Effect.runPromise;
const roots: string[] = [];
async function fixture() {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'okf-bots-'))); roots.push(base);
  const library = await buildBotLibrary(path.join(base, 'bots-library'));
  const project = path.join(base, 'project', '.okf'); await run(initializeBundle(project));
  const projectBundle: Bundle = { name: 'repo', root: await fs.realpath(project), kind: 'repository', writable: true };
  const projectWriter = createStore({ ...library.context, bundles: [projectBundle] });
  const local = await run(projectWriter.proposeChange({ bundle: 'repo', path: 'local.md', raw: botNote('local', `${SENTINELS.project} fact.`, global), expectedHash: null, actor: agent, reason: 'Project note.' }));
  await run(projectWriter.reviewChange({ bundle: 'repo', id: local.id, expectedRevisionHash: local.revisionHash, actor: human, operator: true, reason: 'Checked.', decision: 'accept', sources: local.sources }));
  const personal: Bundle = { ...library.context.bundles[0], kind: 'personal' };
  const projectStore = createStore({ version: 1, cwd: path.dirname(project), gitRoot: path.dirname(project), configPath: library.context.configPath, bundles: [projectBundle, personal] });
  const genericStore = createStore({ version: 1, cwd: base, gitRoot: null, configPath: library.context.configPath, bundles: [personal] });
  return { ...library, projectStore, genericStore };
}
const facts = (value: unknown) => Object.values(SENTINELS).filter(sentinel => JSON.stringify(value).includes(sentinel));
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe('bot catalog and exact resolution', () => {
  it('lists registered accepted names and purposes identically from project and generic contexts without recalling memory', async () => {
    const f = await fixture();
    for (const store of [f.projectStore, f.genericStore] as Store[]) {
      const catalog = await run(store.botCatalog());
      expect(catalog.bots.map(item => [item.name, item.purpose, item.bundle])).toEqual([
        ['game1: coordinator', 'Keeps game1 direction and priorities.', 'bots'], ['game1: playtester', 'Plays game1 and turns observations into feedback.', 'bots'], ['game2: playtester', 'Plays game2.', 'bots'],
        ['personal: coach', 'Personal coaching outside any repository.', 'bots'], ['shared: reviewer', 'First reviewer.', 'bots'], ['shared: reviewer', 'Second reviewer.', 'bots'],
      ]);
      expect(catalog.bots.filter(item => item.duplicateName).map(item => item.id)).toEqual(['dup-a', 'dup-b']);
      const playtester = catalog.bots.find(item => item.id === 'game1-playtester')!;
      expect(playtester.revisionHash).toBe((await run(store.read('bots', playtester.path))).hash);
      expect(catalog.diagnostics.map(item => [item.code, item.bot])).toEqual([['BOT_DEFINITION_INVALID', 'broken-def'], ['BOT_DEFINITION_UNAVAILABLE', 'pending-bot'], ['BOT_DEFINITION_UNAVAILABLE', 'ghost']]);
      expect(facts(catalog)).toEqual([]);
      expect(JSON.stringify(catalog)).not.toContain('PENDING');
      expect(JSON.stringify(catalog)).not.toContain('later-bot');
    }
  });

  it('resolves one exact name to its accepted definition and only its declared accepted memory', async () => {
    const f = await fixture();
    const project = await run(f.projectStore.resolveBot({ name: 'game1: playtester' }));
    const generic = await run(f.genericStore.resolveBot({ name: 'game1: playtester' }));
    expect(generic).toEqual(project);
    expect(project.complete).toBe(true);
    expect(project.definition).toMatchObject({ name: 'game1: playtester', purpose: 'Plays game1 and turns observations into feedback.', identity: 'I am game1: playtester. SOUL-game1: playtester', instructions: 'Work as game1: playtester.' });
    expect(facts(project).sort()).toEqual([SENTINELS.g1Playtester, SENTINELS.g1Shared].sort());
    expect(project.memory.map(item => [item.target.id, item.status, item.documents.map(doc => doc.path)])).toEqual([['own-notes', 'available', ['game1/playtester/notes.md']], ['game1-shared', 'available', ['game1/shared/direction.md']]]);
    const shared = project.memory[1].documents[0];
    expect(shared.revisionHash).toBe((await run(f.projectStore.read('bots', shared.path, { repository: 'game1' }))).hash);
    expect(project.collaborators).toMatchObject([{ status: 'available', bot: { id: 'game1-coordinator', name: 'game1: coordinator' } }]);
    const unrelated = await run(f.genericStore.resolveBot({ name: 'game2: playtester' }));
    expect(facts(unrelated).sort()).toEqual([SENTINELS.g2Playtester, SENTINELS.g2Shared].sort());
    const coach = await run(f.genericStore.resolveBot({ name: 'personal: coach' }));
    expect(coach.complete).toBe(true); expect(facts(coach)).toEqual([SENTINELS.coach]);
    expect((await run(f.genericStore.search('SENTINEL'))).results.map(item => item.path).sort()).toEqual(['coach/notes.md', 'unrelated.md']);
  });

  it('reports unknown, near-miss, duplicate, pending and unavailable definitions without guessing', async () => {
    const f = await fixture();
    for (const name of ['game3: playtester', 'game1:playtester', 'Game1: Playtester', ' game1: playtester']) {
      const error = await run(f.genericStore.resolveBot({ name })).catch(error => error);
      expect(error).toMatchObject({ code: 'BOT_NOT_FOUND', details: { name, available: expect.arrayContaining(['game1: playtester']) } });
    }
    await expect(run(f.genericStore.resolveBot({ name: 'shared: reviewer' }))).rejects.toMatchObject({ code: 'BOT_NAME_AMBIGUOUS', details: { candidates: [{ id: 'dup-a' }, { id: 'dup-b' }] } });
    expect((await run(f.genericStore.resolveBot({ id: 'dup-b' }))).definition.purpose).toBe('Second reviewer.');
    for (const id of ['ghost', 'pending-bot']) await expect(run(f.genericStore.resolveBot({ id }))).rejects.toMatchObject({ code: 'BOT_UNAVAILABLE', details: { diagnostics: [{ code: 'BOT_DEFINITION_UNAVAILABLE', bot: id }] } });
    await expect(run(f.genericStore.resolveBot({ name: 'broken: invalid' }))).rejects.toMatchObject({ code: 'BOT_UNAVAILABLE', details: { diagnostics: [{ code: 'BOT_DEFINITION_INVALID' }] } });
    await expect(run(f.genericStore.resolveBot({ name: 'x', id: 'y' }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const accepted = await run(f.genericStore.resolveBot({ name: 'game1: playtester' }));
    expect(accepted.bot.id).toBe('game1-playtester');
    expect(accepted.definition.purpose).not.toContain('PENDING');
    expect(accepted.bot.revisionHash).toBe(f.pendingEdit.before!.hash);
    const empty = createStore({ ...f.context, bundles: [] });
    await expect(run(empty.resolveBot({ name: 'game1: playtester' }))).rejects.toMatchObject({ code: 'BOT_NOT_FOUND', message: expect.stringContaining('never inferred from the working directory') });
  });

  it('reports broken references instead of substituting other memory', async () => {
    const f = await fixture();
    const coordinator = await run(f.projectStore.resolveBot({ name: 'game1: coordinator' }));
    expect(coordinator.complete).toBe(false);
    expect(coordinator.diagnostics.map(item => [item.code, item.target])).toEqual([['BOT_UNNAMED_REGISTRATIONS', undefined], ['BOT_MEMORY_UNAVAILABLE', 'missing-brief'], ['BOT_MEMORY_BUNDLE_UNAVAILABLE', 'archive']]);
    expect(coordinator.memory.map(item => item.status)).toEqual(['available', 'available', 'unavailable', 'unavailable']);
    expect(facts(coordinator).sort()).toEqual([SENTINELS.g1Coordinator, SENTINELS.g1Shared].sort());
  });

  it('refreshes fixed memory targets to the current accepted revision while the definition stays discoverable', async () => {
    const f = await fixture();
    const before = await run(f.genericStore.resolveBot({ name: 'game1: playtester' }));
    const note = await run(f.store.read('bots', 'game1/shared/direction.md', { repository: 'game1' }));
    const update = await f.propose('game1/shared/direction.md', note.raw.replace('SENTINEL-G1-SHARED-v1', 'SENTINEL-G1-SHARED-v2'), note.hash);
    const pending = await run(f.genericStore.resolveBot({ name: 'game1: playtester' }));
    expect(pending.memory[1].documents[0].revisionHash).toBe(note.hash);
    expect(JSON.stringify(pending)).not.toContain('SENTINEL-G1-SHARED-v2');
    await f.accept(update);
    expect((await run(f.genericStore.botCatalog())).bots.some(item => item.name === 'game1: playtester')).toBe(true);
    const after = await run(f.genericStore.resolveBot({ name: 'game1: playtester' }));
    expect(after.bot.revisionHash).toBe(before.bot.revisionHash);
    expect(after.memory[1].documents[0]).toMatchObject({ revisionHash: update.after!.hash, body: expect.stringContaining('SENTINEL-G1-SHARED-v2') });
    expect(after.complete).toBe(true);
  });
});
