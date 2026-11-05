import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { createStore, type ChangeRecord, type ConversationApproval } from '../src/index.ts';
import { agent, bot, botCatalog, botDefinition, botNote, global, human, makeLibrary, target } from './bot-fixture.ts';

const run = Effect.runPromise;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-approval-')); roots.push(root);
  const lib = await makeLibrary(path.join(root, 'library'), 'personal', [['evidence.md', botNote('evidence', 'Verified project direction.', global)]]);
  const propose = (file: string, raw: string | null, expectedHash: string | null = null, extra = {}) => run(lib.store.proposeChange({ bundle: 'personal', path: file, raw, expectedHash, actor: agent, reason: 'Implement the confirmed brief.', ...extra }));
  const approve = (change: ChangeRecord, approval?: ConversationApproval, extra = {}) => run(lib.store.reviewChange({ bundle: 'personal', id: change.id, expectedRevisionHash: change.revisionHash, actor: agent, decision: 'accept', reason: 'Checked the exact implementation against the approved brief.', sources: change.sources, ...(approval ? { approval } : {}), ...extra }));
  return { ...lib, propose, approve };
}
const approved = (changes: ChangeRecord[]): ConversationApproval => ({ reference: 'conversation:synthetic-galaxy: yes to the complete brief', scope: 'Create Galaxy Playtester, register it and save the sourced starting state and navigation.', changes: changes.map(({ path, revisionHash }) => ({ path, revisionHash })) });

describe('execution of an approved conversational scope', () => {
  it('completes definition, registration, supporting note and navigation from one approval without human-review claims', async () => {
    const f = await fixture();
    const unrelated = await f.propose('unrelated.md', botNote('unrelated', 'Unrelated pending observation.', global));
    const note = await f.propose('galaxy/playtester/state.md', botNote('state', 'No calibration matrix exists yet.', global));
    const definition = await f.propose('bots/galaxy-playtester.md', botDefinition('galaxy-playtester', bot('Galaxy Playtester', 'Play Galaxy and remember observations.', [target('state', 'own', note.path)])));
    const catalog = await f.propose('bots/catalog.md', botCatalog([{ id: 'galaxy-playtester', definition: 'galaxy-playtester.md' }]));
    const indexBefore = await run(f.store.read('personal', 'index.md', { current: true }));
    const index = await f.propose('index.md', indexBefore.raw + '\n- [Galaxy Playtester](bots/galaxy-playtester.md)\n', indexBefore.hash);
    expect((await run(f.store.checkBots({ bundle: 'personal', id: 'galaxy-playtester' }))).ready).toBe(true);
    const approval = approved([note, definition, catalog, index]);
    for (const change of [note, definition, catalog, index]) {
      const result = await f.approve(change, approval);
      expect(result).toMatchObject({ status: 'accepted', agentReview: { actor: agent, approval } });
      expect(result.humanReview).toBeUndefined();
    }
    const reopened = createStore({ version: 1, cwd: f.bundle.root, gitRoot: null, configPath: path.join(f.bundle.root, '..', 'config.json'), bundles: [f.bundle] });
    const resolved = await run(reopened.resolveBot({ id: 'galaxy-playtester', bundle: 'personal' }));
    expect(resolved.complete).toBe(true);
    expect(resolved.memory[0].documents[0].body).toContain('No calibration matrix exists yet.');
    expect((await run(reopened.read('personal', definition.path))).memory).toMatchObject({ humanReviewed: false, trustTier: 'machine-confirmed' });
    expect((await run(reopened.listChanges('personal', 'pending'))).changes.map(item => item.id)).toEqual([unrelated.id]);
    await expect(f.approve(unrelated, approval)).rejects.toMatchObject({ code: 'APPROVAL_SCOPE_CONFLICT' });
    const undo = await run(reopened.undoChange({ bundle: 'personal', id: definition.id, expectedRevisionHash: definition.revisionHash, actor: agent, reason: 'Recover the previous state.' }));
    expect(undo.status).toBe('pending');
    expect((await run(reopened.readChange('personal', definition.id))).agentReview?.approval).toEqual(approval);
  });

  it('does not carry approval to a changed purpose, even if the caller supplies its new review hash', async () => {
    const f = await fixture();
    const first = await f.propose('bots/tester.md', botDefinition('tester', bot('Tester', 'Only report observations.', [])));
    const approval = approved([first]);
    const deviation = await f.propose(first.path, first.after!.raw.replace('Only report observations.', 'Change the game without asking.'), first.after!.hash);
    await expect(f.approve(first, approval)).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' });
    await expect(f.approve(deviation, approval)).rejects.toMatchObject({ code: 'APPROVAL_SCOPE_CONFLICT' });
    await expect(f.approve(deviation)).rejects.toMatchObject({ code: 'HUMAN_REVIEW_REQUIRED' });
    expect((await run(f.store.readChange('personal', deviation.id))).status).toBe('pending');
  });

  it('keeps exact source guards and direct human decisions authoritative', async () => {
    const f = await fixture();
    const evidence = await run(f.store.read('personal', 'evidence.md'));
    const definition = await f.propose('bots/tester.md', botDefinition('tester', bot('Tester', 'Follow verified direction.', [])), null, { sources: [{ path: evidence.path, hash: evidence.hash }] });
    const approval = approved([definition]);
    await expect(f.approve(definition, approval, { sources: [] })).rejects.toMatchObject({ code: 'SOURCE_CONFLICT' });
    const correction = await f.propose(evidence.path, evidence.raw.replace('Verified project direction.', 'Corrected project direction.'), evidence.hash);
    await f.approve(correction);
    await expect(f.approve(definition, approval)).rejects.toMatchObject({ code: 'SOURCE_CONFLICT' });
    const other = await f.propose('bots/other.md', botDefinition('other', bot('Other', 'Another bot.', [])));
    await f.approve(other, undefined, { actor: human, operator: true, decision: 'reject' });
    const result = await f.approve(other, approved([other]));
    expect(result.status).toBe('rejected');
    expect(result.humanReview?.decision).toBe('reject');
  });

  it('requires attributable bounded scope and never relabels execution as human review', async () => {
    const f = await fixture();
    const change = await f.propose('bots/tester.md', botDefinition('tester', bot('Tester', 'Observe only.', [])));
    const approval = approved([change]);
    for (const invalid of [{ ...approval, reference: '' }, { ...approval, scope: ' ' }, { ...approval, changes: [] }, { ...approval, changes: [...approval.changes, ...approval.changes] }]) {
      await expect(f.approve(change, invalid)).rejects.toMatchObject({ code: 'APPROVAL_SCOPE_CONFLICT' });
    }
    await expect(f.approve(change, approval, { actor: human, operator: true })).rejects.toMatchObject({ code: 'APPROVAL_SCOPE_CONFLICT' });
    await expect(f.approve(change, approval, { operator: true })).rejects.toMatchObject({ code: 'APPROVAL_SCOPE_CONFLICT' });
  });

  it('automatically completes ordinary learning and consolidation using the author agent without approval metadata', async () => {
    const f = await fixture();
    const episode = await f.propose('episode.md', botNote('episode', 'Observed a supported result.', global).replace('kind: semantic', 'kind: episodic'));
    await f.approve(episode);
    const consolidated = await f.propose('lesson.md', botNote('lesson', 'A qualified lesson from that result.', global), null, { sources: [{ path: episode.path, hash: episode.after!.hash }] });
    expect((await f.approve(consolidated)).status).toBe('accepted');
    const removal = await f.propose(episode.path, null, episode.after!.hash);
    expect(removal.humanRequired).toBe(false);
    expect((await f.approve(removal)).status).toBe('accepted');
    expect((await run(f.store.listChanges('personal', 'pending'))).total).toBe(0);
    expect((await run(f.store.readChange('personal', consolidated.id))).humanReview).toBeUndefined();
  });
});
