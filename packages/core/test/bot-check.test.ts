import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { BOT_CATALOG_PATH, createStore, type BotCheckRequest, type BotCheckResult, type Bundle, type ChangeRecord, type Store } from '../src/index.ts';
import { agent, bot, botCatalog, botDefinition, botNote, human, makeLibrary, target } from './bot-fixture.ts';

// Synthetic library: an accepted project coordinator a new bot collaborates with, and an unrelated accepted bot.
const run = Effect.runPromise;
const roots: string[] = [];
const project = { type: 'repository', id: 'proj' } as const;
const registered = [{ id: 'proj-coordinator', definition: 'proj-coordinator.md' }, { id: 'unrelated-bot', definition: 'unrelated-bot.md' }];
const coordinator = bot('proj: coordinator', 'Keeps proj direction.', [target('direction', 'shared', 'proj/shared/direction.md', { repository: 'proj' })]);
const tester = (overrides: Record<string, unknown> = {}) => ({
  ...bot('proj: tester', 'Plays proj builds and reports observations.', [target('own-notes', 'own', 'proj/tester', { repository: 'proj' }), target('direction', 'shared', 'proj/shared/direction.md', { repository: 'proj' })], [{ bot: 'proj-coordinator', handoff: 'Propose observations; the coordinator decides design direction.' }]),
  ...overrides,
});
const withTester = botCatalog([...registered, { id: 'proj-tester', definition: 'proj-tester.md' }]);
async function fixture(kind: Bundle['kind'] = 'explicit') {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'okf-bot-check-'))); roots.push(base);
  const library = await makeLibrary(path.join(base, 'library'), 'bots', [
    ['proj/shared/direction.md', botNote('proj-direction', 'DIRECTION-BODY-SENTINEL', project)],
    ['bots/proj-coordinator.md', botDefinition('proj-coordinator', coordinator)],
    ['bots/unrelated-bot.md', botDefinition('unrelated-bot', bot('other: helper', 'Unrelated helper.', [target('notes', 'own', 'other', {})]))],
    [BOT_CATALOG_PATH, botCatalog(registered)],
  ]);
  // A personal library is checked from an unrelated directory without Git.
  const store: Store = kind === 'explicit' ? library.store : createStore({ version: 1, cwd: base, gitRoot: null, configPath: path.join(base, 'unused-config.json'), bundles: [{ ...library.bundle, kind }] });
  const read = async (file: string) => run(store.read('bots', file, { allApplicability: true }));
  const propose = async (file: string, raw: string | null, expectedHash: string | null) => run(store.proposeChange({ bundle: 'bots', path: file, raw, expectedHash, actor: agent, reason: 'Creator proposal after the user confirmed the brief.', authorizePersonal: kind === 'personal' }));
  const accept = (change: ChangeRecord) => run(store.reviewChange({ bundle: 'bots', id: change.id, expectedRevisionHash: change.revisionHash, actor: human, operator: true, reason: 'Checked the bot.', decision: 'accept', sources: change.sources, authorizePersonal: kind === 'personal' }));
  return { store, read, propose, accept, check: (drafts?: Array<{ path: string; raw: string }>, id = 'proj-tester') => run(store.checkBots({ bundle: 'bots', id, ...(drafts ? { drafts } : {}) })) };
}
const codes = (value: { diagnostics: Array<{ code: string }> }) => value.diagnostics.map(item => item.code);
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe('bot check before acceptance', () => {
  it('passes a complete draft and lists the revisions a person must accept, without memory content', async () => {
    const f = await fixture();
    const result = await f.check([{ path: 'bots/proj-tester.md', raw: botDefinition('proj-tester', tester()) }, { path: BOT_CATALOG_PATH, raw: withTester }]);
    expect(result.ready).toBe(true);
    expect(result.bots).toMatchObject([{ id: 'proj-tester', name: 'proj: tester', path: 'bots/proj-tester.md', state: 'draft', registered: true, ready: true, requires: [BOT_CATALOG_PATH, 'bots/proj-tester.md'],
      collaborators: [{ bot: 'proj-coordinator', status: 'available' }], memory: [{ target: 'own-notes', status: 'empty', paths: [] }, { target: 'direction', status: 'available', paths: ['proj/shared/direction.md'] }] }]);
    expect(codes(result.bots[0])).toEqual(['BOT_MEMORY_EMPTY']);
    expect(result.candidates.map(item => [item.path, item.state])).toEqual([[BOT_CATALOG_PATH, 'draft'], ['bots/proj-tester.md', 'draft']]);
    expect(JSON.stringify(result)).not.toContain('DIRECTION-BODY-SENTINEL');
    // A draft is never published or resolvable.
    await expect(run(f.store.resolveBot({ name: 'proj: tester' }))).rejects.toMatchObject({ code: 'BOT_NOT_FOUND' });
    expect((await run(f.store.listChanges('bots', 'pending'))).total).toBe(0);
  });

  it('fails on an unknown collaborator, missing required memory, an unselected library and a duplicate name', async () => {
    const f = await fixture();
    const broken = tester({
      name: 'other: helper',
      collaborators: [{ bot: 'proj-designer', handoff: 'Ask the designer.' }],
      memory: [target('brief', 'shared', 'proj/shared/brief.md', { repository: 'proj' }), target('archive', 'shared', 'archive', {}, { bundle: 'library-not-selected' })],
    });
    const result = await f.check([{ path: 'bots/proj-tester.md', raw: botDefinition('proj-tester', broken) }, { path: BOT_CATALOG_PATH, raw: withTester }]);
    expect(result.ready).toBe(false);
    expect(codes(result.bots[0])).toEqual(['BOT_NAME_DUPLICATE', 'BOT_COLLABORATOR_UNAVAILABLE', 'BOT_MEMORY_UNAVAILABLE', 'BOT_MEMORY_BUNDLE_UNAVAILABLE']);
  });

  it('refuses incomplete and unregistered drafts so they cannot become usable bots', async () => {
    const f = await fixture();
    const { instructions: _, ...incomplete } = tester();
    const unregistered = await f.check([{ path: 'bots/proj-tester.md', raw: botDefinition('proj-tester', incomplete) }]);
    expect(unregistered.ready).toBe(false);
    expect(unregistered.bots).toMatchObject([{ id: 'proj-tester', registered: false, ready: false }]);
    expect(codes(unregistered.bots[0])).toEqual(['BOT_CHECK_UNREGISTERED', 'BOT_DEFINITION_INVALID']);
    expect(unregistered.bots[0].diagnostics[1].message).toContain('bot.instructions must be nonempty text.');
    const registeredIncomplete = await f.check([{ path: 'bots/proj-tester.md', raw: botDefinition('proj-tester', incomplete) }, { path: BOT_CATALOG_PATH, raw: withTester }]);
    expect(registeredIncomplete.bots.map(item => [item.id, item.ready, codes(item)])).toEqual([['proj-tester', false, ['BOT_DEFINITION_INVALID']]]);
    const mismatch = await f.check([{ path: 'bots/proj-tester.md', raw: botDefinition('proj-player', tester()) }, { path: BOT_CATALOG_PATH, raw: withTester }]);
    expect(mismatch.bots.map(item => [item.id, codes(item)])).toEqual([['proj-tester', ['BOT_ID_MISMATCH']]]);
    const notMemory = await f.check([{ path: 'bots/proj-tester.md', raw: '---\ntype: Bot definition\n---\nNo memory metadata.\n' }]);
    expect(codes(notMemory)).toContain('BOT_CHECK_CANDIDATE_INVALID');
    expect(notMemory.ready).toBe(false);
    await expect(f.check([{ path: '../outside.md', raw: 'x' }])).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(f.check([{ path: 'index.md', raw: 'x' }])).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(await f.check(undefined, 'nobody')).toMatchObject({ ready: false, bots: [], diagnostics: [{ code: 'BOT_CHECK_EMPTY' }] });
  });

  for (const kind of ['explicit', 'personal'] as const) it(`checks pending proposals by the creator's actual identity and keeps them inactive until a person accepts (${kind})`, async () => {
    const f = await fixture(kind);
    // Seeded knowledge is proposed too; it counts only as a requirement until accepted.
    const seed = await f.propose('proj/shared/playtest-focus.md', botNote('proj-playtest-focus', 'Focus agreed in the confirmed brief.', project), null);
    const definition = await f.propose('bots/proj-tester.md', botDefinition('proj-tester', tester({ memory: [...tester().memory as unknown[], target('focus', 'shared', 'proj/shared/playtest-focus.md', { repository: 'proj' })] })), null);
    const catalog = await f.propose(BOT_CATALOG_PATH, withTester, (await f.read(BOT_CATALOG_PATH)).hash);
    expect([definition.humanRequired, catalog.humanRequired]).toEqual([true, true]);
    const result = await f.check();
    expect(result.ready).toBe(true);
    expect(result.bots[0]).toMatchObject({ state: 'pending', requires: [BOT_CATALOG_PATH, 'bots/proj-tester.md', 'proj/shared/playtest-focus.md'] });
    expect(result.candidates.map(item => [item.path, item.changeId, item.actor])).toEqual([[BOT_CATALOG_PATH, catalog.id, agent], ['bots/proj-tester.md', definition.id, agent], ['proj/shared/playtest-focus.md', seed.id, agent]]);
    await expect(run(f.store.resolveBot({ name: 'proj: tester' }))).rejects.toMatchObject({ code: 'BOT_NOT_FOUND' });
    await expect(run(f.store.reviewChange({ bundle: 'bots', id: definition.id, expectedRevisionHash: definition.revisionHash, actor: agent, reason: 'Self-approval attempt.', decision: 'accept', sources: [], authorizePersonal: kind === 'personal' }))).rejects.toMatchObject({ code: 'HUMAN_REVIEW_REQUIRED' });
    for (const change of [definition, catalog]) await f.accept(change);
    const partial = await run(f.store.resolveBot({ name: 'proj: tester' }));
    expect(partial.complete).toBe(false);
    expect(partial.diagnostics.map(item => [item.code, item.target])).toEqual([['BOT_MEMORY_EMPTY', 'own-notes'], ['BOT_MEMORY_UNAVAILABLE', 'focus']]);
    await f.accept(seed);
    expect((await run(f.store.resolveBot({ name: 'proj: tester' }))).complete).toBe(true);
    expect((await f.check()).bots[0]).toMatchObject({ state: 'accepted', ready: true, requires: [] });
  });

  it('keeps the prior accepted definition in effect while an edit is pending', async () => {
    const f = await fixture();
    const current = await f.read('bots/proj-coordinator.md');
    const edit = await f.propose('bots/proj-coordinator.md', botDefinition('proj-coordinator', { ...coordinator, purpose: 'Keeps proj direction and synthesizes feedback.', collaborators: [{ bot: 'proj-tester', handoff: 'Ask for a focused playtest.' }] }), current.hash);
    const check = await f.check(undefined, 'proj-coordinator');
    expect(check.bots[0]).toMatchObject({ state: 'pending', ready: false, requires: ['bots/proj-coordinator.md'] });
    expect(codes(check.bots[0])).toEqual(['BOT_COLLABORATOR_UNAVAILABLE']);
    const resolved = await run(f.store.resolveBot({ name: 'proj: coordinator' }));
    expect(resolved).toMatchObject({ complete: true, bot: { revisionHash: current.hash }, definition: { purpose: 'Keeps proj direction.', collaborators: [] } });
    // The reciprocal collaborator edit passes once the new bot is drafted alongside it.
    const together = await f.check([{ path: 'bots/proj-tester.md', raw: botDefinition('proj-tester', tester()) }, { path: BOT_CATALOG_PATH, raw: withTester }], 'proj-coordinator');
    expect(together.bots[0]).toMatchObject({ ready: true, requires: [BOT_CATALOG_PATH, 'bots/proj-coordinator.md', 'bots/proj-tester.md'] });
    await f.accept(edit);
    expect((await run(f.store.resolveBot({ name: 'proj: coordinator' }))).definition.purpose).toBe('Keeps proj direction and synthesizes feedback.');
  });

  it('checks every registration in the library when no id is given', async () => {
    const f = await fixture();
    // An invalid outside edit becomes a pending revision; it is reported without blocking unrelated bots.
    await fs.writeFile(path.join(f.store.context.bundles[0].root, 'broken.md'), '---\ntitle: [unclosed\n---\nOutside edit.\n');
    const result = await run(f.store.checkBots({ bundle: 'bots' }));
    expect(result.bots.map(item => [item.id, item.state, item.ready])).toEqual([['proj-coordinator', 'accepted', true], ['unrelated-bot', 'accepted', true]]);
    expect(result.diagnostics).toMatchObject([{ level: 'warning', code: 'BOT_CHECK_CANDIDATE_INVALID', path: 'broken.md' }]);
    expect(result.ready).toBe(true);
  });
});

describe('bot check protects other registrations and identities', () => {
  const definitionDraft = { path: 'bots/proj-tester.md', raw: botDefinition('proj-tester', tester()) };
  const check = (f: Awaited<ReturnType<typeof fixture>>, request: Omit<BotCheckRequest, 'bundle'>) => run(f.store.checkBots({ bundle: 'bots', ...request }));
  const top = (result: BotCheckResult) => result.diagnostics.map(item => [item.level, item.code, item.bot]);

  it('fails when a candidate catalog drops or re-points another accepted registration, whatever --id selects, unless the user confirmed it', async () => {
    const f = await fixture();
    // Built from scratch instead of the current catalog: unrelated-bot silently disappears.
    const dropped = botCatalog([registered[0], { id: 'proj-tester', definition: 'proj-tester.md' }]);
    for (const id of ['proj-tester', undefined]) {
      const result = await check(f, { ...(id ? { id } : {}), drafts: [definitionDraft, { path: BOT_CATALOG_PATH, raw: dropped }] });
      expect(result.ready).toBe(false);
      expect(top(result)).toEqual([['error', 'BOT_CATALOG_REGISTRATION_REMOVED', 'unrelated-bot']]);
      expect(result.diagnostics[0].message).toContain('the accepted catalog registers at bots/unrelated-bot.md');
    }
    const confirmed = await check(f, { id: 'proj-tester', drafts: [definitionDraft, { path: BOT_CATALOG_PATH, raw: dropped }], confirmedRegistrationChanges: [{ id: 'unrelated-bot', path: null }] });
    expect(confirmed.ready).toBe(true);
    expect(top(confirmed)).toEqual([['warning', 'BOT_CATALOG_REGISTRATION_REMOVED', 'unrelated-bot']]);
    const repointed = await check(f, { id: 'proj-tester', drafts: [definitionDraft, { path: BOT_CATALOG_PATH, raw: botCatalog([registered[0], { id: 'unrelated-bot', definition: 'proj-tester.md' }, { id: 'proj-tester', definition: 'proj-tester.md' }]) }] });
    // The re-pointed entry would also leave unrelated-bot unusable, which --id must not hide.
    expect(top(repointed)).toEqual([['error', 'BOT_CATALOG_REGISTRATION_CHANGED', 'unrelated-bot'], ['error', 'BOT_CATALOG_BREAKS_BOT', 'unrelated-bot']]);
    expect(repointed.ready).toBe(false);
  });

  it('fails when a catalog proposal built from accepted bytes supersedes another creator\'s pending registration', async () => {
    const f = await fixture();
    const accepted = await f.read(BOT_CATALOG_PATH);
    await f.propose('bots/proj-tester.md', definitionDraft.raw, null);
    const first = await f.propose(BOT_CATALOG_PATH, withTester, accepted.hash);
    // A second creator reads accepted bytes and adds only its own bot.
    await f.propose('bots/proj-helper.md', botDefinition('proj-helper', bot('proj: helper', 'Second bot.', [])), null);
    const current = await run(f.store.read('bots', BOT_CATALOG_PATH, { current: true }));
    const second = await f.propose(BOT_CATALOG_PATH, botCatalog([...registered, { id: 'proj-helper', definition: 'proj-helper.md' }]), current.hash);
    expect((await run(f.store.readChange('bots', first.id))).status).toBe('superseded');
    const result = await check(f, { id: 'proj-helper' });
    expect(result.ready).toBe(false);
    // The first creator's pending bot loses its registration, which --id proj-helper must not hide.
    expect(top(result)).toEqual([['error', 'BOT_CATALOG_REGISTRATION_REMOVED', 'proj-tester'], ['error', 'BOT_CATALOG_BREAKS_BOT', 'proj-tester']]);
    expect(result.diagnostics[0].message).toContain(`superseded change ${first.id}`);
    // Building the edit from the current bytes keeps the first creator's entry.
    const fromCurrent = await check(f, { id: 'proj-helper', drafts: [{ path: BOT_CATALOG_PATH, raw: botCatalog([...registered, { id: 'proj-tester', definition: 'proj-tester.md' }, { id: 'proj-helper', definition: 'proj-helper.md' }]) }] });
    expect(fromCurrent.ready).toBe(true);
    expect(second.status).toBe('pending');
  });

  it('applies the identity rules acceptance enforces', async () => {
    const f = await fixture();
    const renamed = await check(f, { id: 'coord2', drafts: [{ path: 'bots/proj-coordinator.md', raw: botDefinition('coord2', coordinator) }, { path: BOT_CATALOG_PATH, raw: botCatalog([{ id: 'coord2', definition: 'proj-coordinator.md' }, registered[1]]) }], confirmedRegistrationChanges: [{ id: 'proj-coordinator', path: null }] });
    expect(renamed.ready).toBe(false);
    expect(top(renamed)).toContainEqual(['error', 'MEMORY_ID_CONFLICT', undefined]);
    await expect(f.propose('bots/proj-coordinator.md', botDefinition('coord2', coordinator), (await f.read('bots/proj-coordinator.md')).hash)).rejects.toMatchObject({ code: 'MEMORY_ID_CONFLICT' });
    const taken = await check(f, { id: 'proj-coordinator', drafts: [{ path: 'bots/proj-tester.md', raw: botDefinition('proj-coordinator', tester()) }] });
    expect(top(taken)).toContainEqual(['error', 'DUPLICATE_MEMORY_ID', undefined]);
    expect(taken.diagnostics.find(item => item.code === 'DUPLICATE_MEMORY_ID')?.message).toContain('bots/proj-coordinator.md');
    const twice = await check(f, { drafts: [definitionDraft, { path: 'bots/proj-tester-2.md', raw: botDefinition('proj-tester', tester()) }] });
    expect(twice.diagnostics.filter(item => item.code === 'DUPLICATE_MEMORY_ID').map(item => item.path).sort()).toEqual(['bots/proj-tester-2.md', 'bots/proj-tester.md']);
    expect(twice.ready).toBe(false);
  });

  it('matches a confirmation only to the exact change it names', async () => {
    const f = await fixture();
    const dropped = botCatalog([registered[0]]);
    const other = await check(f, { id: 'proj-coordinator', drafts: [{ path: BOT_CATALOG_PATH, raw: dropped }], confirmedRegistrationChanges: [{ id: 'unrelated-bot', path: 'bots/elsewhere.md' }] });
    expect(other.ready).toBe(false);
    expect(top(other)).toEqual([['error', 'BOT_CATALOG_REGISTRATION_REMOVED', 'unrelated-bot'], ['warning', 'BOT_CATALOG_CONFIRMATION_UNUSED', 'unrelated-bot']]);
    await expect(check(f, { confirmedRegistrationChanges: ['unrelated-bot' as never] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('reports other bots a catalog candidate breaks even when the change itself is confirmed', async () => {
    const f = await fixture();
    // proj-tester is accepted and names proj-coordinator as its collaborator.
    for (const change of [await f.propose('bots/proj-tester.md', definitionDraft.raw, null), await f.propose(BOT_CATALOG_PATH, withTester, (await f.read(BOT_CATALOG_PATH)).hash)]) await f.accept(change);
    const removal = await check(f, { id: 'unrelated-bot', drafts: [{ path: BOT_CATALOG_PATH, raw: botCatalog([registered[1], { id: 'proj-tester', definition: 'proj-tester.md' }]) }], confirmedRegistrationChanges: [{ id: 'proj-coordinator', path: null }] });
    expect(removal.ready).toBe(false);
    expect(top(removal)).toEqual([['warning', 'BOT_CATALOG_REGISTRATION_REMOVED', 'proj-coordinator'], ['error', 'BOT_CATALOG_BREAKS_BOT', 'proj-tester']]);
    expect(removal.diagnostics[1].message).toContain('its collaborator proj-coordinator is no longer a registered usable bot');
    const repoint = await check(f, { id: 'unrelated-bot', drafts: [{ path: BOT_CATALOG_PATH, raw: botCatalog([{ id: 'proj-coordinator', definition: 'coord-v2.md' }, ...registered.slice(1), { id: 'proj-tester', definition: 'proj-tester.md' }]) }], confirmedRegistrationChanges: [{ id: 'proj-coordinator', path: 'bots/coord-v2.md' }] });
    expect(repoint.ready).toBe(false);
    expect(top(repoint)).toEqual([['warning', 'BOT_CATALOG_REGISTRATION_CHANGED', 'proj-coordinator'], ['error', 'BOT_CATALOG_BREAKS_BOT', 'proj-coordinator'], ['error', 'BOT_CATALOG_BREAKS_BOT', 'proj-tester']]);
    expect(repoint.diagnostics[1].message).toContain('BOT_DEFINITION_UNAVAILABLE');
  });

  it('keeps a confirmed removal confirmed when the pending proposal is checked again', async () => {
    const f = await fixture();
    const removal = { id: 'unrelated-bot', path: null };
    await f.propose(BOT_CATALOG_PATH, botCatalog([registered[0]]), (await f.read(BOT_CATALOG_PATH)).hash);
    expect((await check(f, { id: 'proj-coordinator' })).ready).toBe(false);
    const confirmed = await check(f, { id: 'proj-coordinator', confirmedRegistrationChanges: [removal] });
    expect(confirmed.ready).toBe(true);
    expect(top(confirmed)).toEqual([['warning', 'BOT_CATALOG_REGISTRATION_REMOVED', 'unrelated-bot']]);
  });

  it('reports a registration whose definition exists nowhere as missing', async () => {
    const f = await fixture();
    const result = await check(f, { id: 'proj-tester', drafts: [{ path: BOT_CATALOG_PATH, raw: withTester }] });
    expect(result.bots).toMatchObject([{ id: 'proj-tester', state: 'missing', ready: false, diagnostics: [{ code: 'BOT_DEFINITION_UNAVAILABLE' }] }]);
    expect(result.bots[0].diagnostics[0].message).toBe('Registered bot proj-tester has no accepted, pending or draft definition at bots/proj-tester.md. Draft or propose the definition, or remove the entry.');
  });
});
