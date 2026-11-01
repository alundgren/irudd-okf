import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { createStore, type ChangeRecord } from '../src/index.ts';
import { buildBotLibrary, game1, human, SENTINELS } from './bot-fixture.ts';

// Memory handoff between bots: a proposal, then a person's acceptance, then explicit recall by resolve.
const run = Effect.runPromise;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
// The actual agent runs writing for each bot persona; neither is the bot itself.
const playtesterRun = { type: 'agent' as const, id: 'claude-code:session-playtester' };
const coordinatorRun = { type: 'agent' as const, id: 'codex:session-coordinator' };
const direction = (text: string, persona: string) => `---\ntype: Memory\ntitle: game1-shared-direction\npersona: {bot: ${persona}}\nmemory:\n  id: game1-shared-direction\n  kind: semantic\n  stage: bronze\n  applicability: ${JSON.stringify(game1)}\n---\n${text}\n`;

async function library() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'okf-bot-memory-'))); roots.push(root);
  const built = await buildBotLibrary(path.join(root, 'bots'));
  // Each conversation is a fresh store: nothing is shared between them except the library files.
  const fresh = () => createStore(built.context);
  const shared = async (name: string) => {
    const resolved = await run(fresh().resolveBot({ name }));
    return resolved.memory.find(item => item.target.path === 'game1/shared')?.documents.map(document => document.body).join('') ?? null;
  };
  const propose = (actor: typeof playtesterRun, raw: string, expectedHash: string | null) => run(fresh().proposeChange({ bundle: 'bots', path: 'game1/shared/direction.md', raw, expectedHash, actor, reason: 'Verified playtest feedback for the shared direction.' }));
  const accept = (change: ChangeRecord) => run(fresh().reviewChange({ bundle: 'bots', id: change.id, expectedRevisionHash: change.revisionHash, actor: human, operator: true, reason: 'Checked the feedback.', decision: 'accept', sources: change.sources }));
  return { ...built, fresh, shared, propose, accept };
}

describe('bot memory handoff', () => {
  it('keeps the accepted revision until a person accepts, then the other bot sees it while an unrelated bot never does', async () => {
    const f = await library();
    expect(await f.shared('game1: coordinator')).toContain(SENTINELS.g1Shared);
    const accepted = await run(f.fresh().read('bots', 'game1/shared/direction.md', { repository: 'game1' }));
    const change = await f.propose(playtesterRun, direction('SHARED-v2: the save menu crashes on load.', 'game1-playtester'), accepted.hash);
    // Attribution: the actual run is the actor, the bot persona is recorded in the note, separately.
    expect(change).toMatchObject({ status: 'pending', actor: playtesterRun, humanRequired: false });
    expect(change.after?.raw).toContain('persona: {bot: game1-playtester}');
    // Before acceptance both bots, and ordinary recall, keep the previous accepted revision.
    for (const name of ['game1: coordinator', 'game1: playtester']) { const text = await f.shared(name); expect(text).toContain(SENTINELS.g1Shared); expect(text).not.toContain('SHARED-v2'); }
    expect((await run(f.fresh().search('SHARED-v2', { repository: 'game1' }))).total).toBe(0);
    // Acceptance is a separate authorized review, here by the operator, never by the proposing run.
    await f.accept(change);
    expect(await f.shared('game1: coordinator')).toContain('SHARED-v2');
    expect(await f.shared('game1: playtester')).toContain('SHARED-v2');
    const reread = await run(f.fresh().read('bots', 'game1/shared/direction.md', { repository: 'game1' }));
    expect(reread.metadata.persona).toEqual({ bot: 'game1-playtester' });
    expect((await run(f.fresh().readChange('bots', change.id))).actor).toEqual(playtesterRun);
    // The unrelated bot's declared memory never includes game1's shared area.
    const other = await run(f.fresh().resolveBot({ name: 'game2: playtester' }));
    expect(JSON.stringify(other.memory)).not.toContain('SHARED-v2');
    expect(other.memory.flatMap(item => item.documents.map(document => document.path)).every(file => file.startsWith('game2/'))).toBe(true);
  });

  it('turns two proposals based on the same revision into a recoverable conflict that keeps both contributions', async () => {
    const f = await library();
    const base = await run(f.fresh().read('bots', 'game1/shared/direction.md', { repository: 'game1' }));
    const first = await f.propose(playtesterRun, direction(`${SENTINELS.g1Shared} fact.\nPLAYTESTER: the tutorial is too long.`, 'game1-playtester'), base.hash);
    // The coordinator also started from the accepted bytes; its proposal is refused, not silently merged or dropped.
    const second = direction(`${SENTINELS.g1Shared} fact.\nCOORDINATOR: prioritize the save system.`, 'game1-coordinator');
    await expect(f.propose(coordinatorRun, second, base.hash)).rejects.toMatchObject({ code: 'CONFLICT', details: { expectedHash: base.hash, actualHash: first.after!.hash } });
    expect((await run(f.fresh().readChange('bots', first.id))).status).toBe('pending');
    // Recovery: read the current draft, merge both contributions and propose against its hash.
    const current = await run(f.fresh().read('bots', 'game1/shared/direction.md', { current: true }));
    expect(current.raw).toContain('PLAYTESTER');
    const merged = await f.propose(coordinatorRun, direction(`${SENTINELS.g1Shared} fact.\nPLAYTESTER: the tutorial is too long.\nCOORDINATOR: prioritize the save system.`, 'game1-coordinator'), current.hash);
    // The earlier proposal stays in history, superseded by the merge, with its exact bytes and actor.
    const earlier = await run(f.fresh().readChange('bots', first.id));
    expect(earlier).toMatchObject({ status: 'superseded', replacementChangeId: merged.id, actor: playtesterRun });
    expect(earlier.after?.raw).toContain('PLAYTESTER');
    await expect(f.accept(first)).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' });
    await f.accept(merged);
    const text = await f.shared('game1: playtester');
    expect(text).toContain('PLAYTESTER: the tutorial is too long.');
    expect(text).toContain('COORDINATOR: prioritize the save system.');
  });
});
