import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Effect } from 'effect';
import { createStore, initializeBundle, BOT_CATALOG_PATH, type Applicability, type Bundle, type ChangeRecord, type MemoryContext } from '../src/index.ts';

// Synthetic bot library shared by core and CLI tests. It contains no real bot data.
const run = Effect.runPromise;
export const agent = { type: 'agent' as const, id: 'test-session-7' };
export const human = { type: 'human' as const, id: 'test-operator' };
export const game1 = { type: 'repository', id: 'game1' } as const, game2 = { type: 'repository', id: 'game2' } as const, global = { type: 'global' } as const;
export const botNote = (id: string, text: string, scope: Applicability) => `---\ntype: Memory\ntitle: ${id}\nmemory:\n  id: ${id}\n  kind: semantic\n  stage: bronze\n  applicability: ${JSON.stringify(scope)}\n---\n${text}\n`;
export const botDefinition = (id: string, bot: Record<string, unknown>) => `---\ntype: Bot definition\ntitle: ${JSON.stringify(bot.name ?? id)}\nmemory:\n  id: ${id}\n  kind: procedural\n  stage: bronze\n  applicability: {"type":"global"}\nbot: ${JSON.stringify(bot)}\n---\nHuman-readable summary of ${id}.\n`;
export const botCatalog = (entries: Array<{ id: string; definition: string }>) => `---\ntype: Bot catalog\ntitle: Bots\nmemory:\n  id: bot-catalog\n  kind: procedural\n  stage: bronze\n  applicability: {"type":"global"}\nbots: ${JSON.stringify(entries)}\n---\nRegistered bots.\n`;
export const target = (id: string, role: 'own' | 'shared', where: string, scope: Record<string, string> = {}, extra: Record<string, string> = {}) => ({ id, role, path: where, ...scope, read: `Read ${id} when activated and when asked to refresh.`, write: `Propose ${id} updates after a verified observation.`, ...extra });
export const bot = (name: string, purpose: string, memory: unknown[], collaborators: unknown[] = []) => ({ name, purpose, identity: `I am ${name}. SOUL-${name}`, instructions: `Work as ${name}.`, collaborators, memory });

export const SENTINELS = { g1Playtester: 'SENTINEL-G1-PLAYTESTER', g1Coordinator: 'SENTINEL-G1-COORDINATOR', g1Shared: 'SENTINEL-G1-SHARED-v1', g2Playtester: 'SENTINEL-G2-PLAYTESTER', g2Shared: 'SENTINEL-G2-SHARED', coach: 'SENTINEL-COACH', unrelated: 'SENTINEL-UNRELATED-GLOBAL', project: 'SENTINEL-PROJECT-LOCAL' };
// Builds the synthetic bot library used by core and CLI tests. Every accepted change is reviewed through the real change flow.
export async function buildBotLibrary(root: string) {
  await run(initializeBundle(root));
  const context: MemoryContext = { version: 1, cwd: root, gitRoot: null, configPath: path.join(root, '..', 'unused-config.json'), bundles: [{ name: 'bots', root: await fs.realpath(root), kind: 'explicit', writable: true }] };
  const store = createStore(context);
  const propose = (file: string, raw: string | null, expectedHash: string | null = null) => run(store.proposeChange({ bundle: 'bots', path: file, raw, expectedHash, actor: agent, reason: 'Synthetic bot fixture.' }));
  const accept = (change: ChangeRecord) => run(store.reviewChange({ bundle: 'bots', id: change.id, expectedRevisionHash: change.revisionHash, actor: human, operator: true, reason: 'Checked the synthetic fixture.', decision: 'accept', sources: change.sources }));
  const accepted = async (file: string, raw: string) => accept(await propose(file, raw));
  const notes: Array<[string, string, Applicability]> = [
    ['game1/playtester/notes.md', SENTINELS.g1Playtester, game1], ['game1/coordinator/notes.md', SENTINELS.g1Coordinator, game1], ['game1/shared/direction.md', SENTINELS.g1Shared, game1],
    ['game2/playtester/notes.md', SENTINELS.g2Playtester, game2], ['game2/shared/direction.md', SENTINELS.g2Shared, game2], ['coach/notes.md', SENTINELS.coach, global], ['unrelated.md', SENTINELS.unrelated, global],
  ];
  for (const [file, text, scope] of notes) await accepted(file, botNote(file.replace(/\W+/g, '-').replace(/-md$/, ''), `${text} fact.`, scope));
  const definitions: Array<[string, string, Record<string, unknown>]> = [
    ['game1-playtester', 'bots/game1-playtester.md', bot('game1: playtester', 'Plays game1 and turns observations into feedback.', [target('own-notes', 'own', 'game1/playtester', { repository: 'game1' }), target('game1-shared', 'shared', 'game1/shared', { repository: 'game1' })], [{ bot: 'game1-coordinator', handoff: 'Send accepted feedback to the coordinator.' }])],
    ['game1-coordinator', 'bots/game1-coordinator.md', bot('game1: coordinator', 'Keeps game1 direction and priorities.', [target('own-notes', 'own', 'game1/coordinator', { repository: 'game1' }), target('game1-shared', 'shared', 'game1/shared', { repository: 'game1' }), target('missing-brief', 'shared', 'game1/shared/missing.md', { repository: 'game1' }), target('archive', 'shared', 'archive', {}, { bundle: 'library-not-selected' })], [{ bot: 'game1-playtester', handoff: 'Ask the playtester for a focused session.' }])],
    ['game2-playtester', 'bots/game2-playtester.md', bot('game2: playtester', 'Plays game2.', [target('own-notes', 'own', 'game2/playtester', { repository: 'game2' }), target('game2-shared', 'shared', 'game2/shared', { repository: 'game2' })])],
    ['personal-coach', 'bots/personal-coach.md', bot('personal: coach', 'Personal coaching outside any repository.', [target('own-notes', 'own', 'coach')])],
    ['dup-a', 'bots/dup-a.md', bot('shared: reviewer', 'First reviewer.', [])],
    ['dup-b', 'bots/dup-b.md', bot('shared: reviewer', 'Second reviewer.', [])],
    ['broken-def', 'bots/broken.md', { name: 'broken: invalid', purpose: 'Missing instructions and memory.', identity: 'x', collaborators: [] }],
  ];
  for (const [id, file, value] of definitions) await accepted(file, botDefinition(id, value));
  const catalog = await accepted(BOT_CATALOG_PATH, botCatalog([...definitions.map(([id, file]) => ({ id, definition: file.slice('bots/'.length) })), { id: 'pending-bot', definition: 'pending.md' }, { id: 'ghost', definition: 'ghost.md' }]));
  // A pending definition reuses an accepted name; it must neither override nor make the name ambiguous.
  const pending = await propose('bots/pending.md', botDefinition('pending-bot', bot('game1: playtester', 'PENDING purpose override.', [target('own-notes', 'own', 'game2/playtester', { repository: 'game2' })])));
  const playtester = await run(store.read('bots', 'bots/game1-playtester.md'));
  const pendingEdit = await propose('bots/game1-playtester.md', botDefinition('game1-playtester', bot('game1: playtester', 'PENDING edited purpose.', [])), playtester.hash);
  const pendingCatalog = await propose(BOT_CATALOG_PATH, botCatalog([{ id: 'later-bot', definition: 'later.md' }]), catalog.after!.hash);
  return { context, store, propose, accept, pending, pendingEdit, pendingCatalog };
}


// A small explicitly selected library whose files are all accepted by a person.
export async function makeLibrary(root: string, name: string, files: Array<[string, string]>) {
  await run(initializeBundle(root));
  const bundle: Bundle = { name, root: await fs.realpath(root), kind: 'explicit', writable: true };
  const store = createStore({ version: 1, cwd: bundle.root, gitRoot: null, configPath: path.join(bundle.root, '..', 'unused-config.json'), bundles: [bundle] });
  for (const [file, raw] of files) {
    const change = await run(store.proposeChange({ bundle: name, path: file, raw, expectedHash: null, actor: agent, reason: 'Synthetic fixture.' }));
    await run(store.reviewChange({ bundle: name, id: change.id, expectedRevisionHash: change.revisionHash, actor: human, operator: true, reason: 'Checked the synthetic fixture.', decision: 'accept', sources: change.sources }));
  }
  return { bundle, store, id: (await run(store.inspectBundle(name))).id! };
}
