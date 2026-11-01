import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createStore, type Diagnostic, type Store, type StoreOptions } from '../src/index.ts';
import { hash } from '../src/files.ts';
import { agent, botNote, buildBotLibrary, global, human, SENTINELS } from './bot-fixture.ts';
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof fs>() }));

// Reads take no lock and write nothing: they must work in a read-only sandbox, beside a running writer and beside each other.
const run = Effect.runPromise;
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) { await writableAgain(root); await fs.rm(root, { recursive: true, force: true }); } });

async function library(options: StoreOptions = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'okf-reads-'))); roots.push(root);
  const built = await buildBotLibrary(path.join(root, 'bots'));
  const bundle = built.context.bundles[0].root;
  // An accepted note, then an outside edit of another accepted note.
  const note = await built.accept(await built.propose('notes/accepted.md', botNote('accepted-note', 'ACCEPTED-ONLY text.', global)));
  await fs.writeFile(path.join(bundle, 'unrelated.md'), botNote('unrelated', 'OUTSIDE-EDIT text.', global));
  const warnings: Diagnostic[] = [];
  const store = createStore(built.context, { ...options, onWarning: diagnostic => { warnings.push(diagnostic); } });
  return { ...built, root, bundle, note, store, warnings };
}
// Every path with its bytes and modification time, so a rewrite with identical bytes also counts as a write.
async function tree(root: string): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  const visit = async (directory: string, prefix: string) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name), relative = prefix + entry.name;
      if (entry.isDirectory()) { output[relative + '/'] = 'directory'; await visit(absolute, relative + '/'); }
      else output[relative] = `${hash(await fs.readFile(absolute, 'utf8'))}:${(await fs.stat(absolute)).mtimeMs}`;
    }
  };
  await visit(root, '');
  return output;
}
const reads = (store: Store, changeId: string) => [
  () => store.search('SENTINEL', { bundle: 'bots', allApplicability: true, limit: 100 }),
  () => store.search('ACCEPTED-ONLY'),
  () => store.search('OUTSIDE-EDIT'),
  () => store.list('bots', { allApplicability: true }),
  () => store.read('bots', 'unrelated.md'),
  () => store.read('bots', 'unrelated.md', { current: true }),
  () => store.index('bots', 'notes'),
  () => store.browse({ bundle: 'bots', allApplicability: true }),
  () => store.graph({ bundle: 'bots', allApplicability: true }),
  () => store.validate({ bundle: 'bots' }),
  () => store.validate({ bundle: 'bots', lint: true }),
  () => store.inspectBundle('bots'),
  () => store.migrationGuide('bots'),
  () => store.profile('bots'),
  () => store.bootstrap('bots'),
  () => store.listChanges('bots', 'pending'),
  () => store.readChange('bots', changeId),
  () => store.inspectChanges('bots'),
  () => store.botCatalog(),
  () => store.resolveBot({ name: 'game1: playtester' }),
  () => store.resolveBot({ id: 'personal-coach', bundle: 'bots' }),
  () => store.checkBots({ bundle: 'bots' }),
] as Array<() => Effect.Effect<unknown, unknown>>;
const readAll = (store: Store, changeId: string) => Promise.all(reads(store, changeId).map(read => run(read())));
const mutating = ['writeFile', 'appendFile', 'rename', 'unlink', 'rm', 'rmdir', 'mkdir', 'mkdtemp', 'link', 'symlink', 'copyFile', 'cp', 'chmod', 'truncate', 'utimes', 'lutimes', 'chown', 'lchown'] as const;
// The closest portable stand-in for a read-only sandbox: every mutating file call fails with EPERM, files carry the
// read-only attribute (Windows) or mode, and on POSIX directories also lose write permission.
async function readOnly(root: string) {
  await setModes(root, false);
  const denied = () => Promise.reject(Object.assign(new Error('EPERM: operation not permitted (read-only sandbox)'), { code: 'EPERM' }));
  for (const name of mutating) vi.spyOn(fs, name).mockImplementation(denied as never);
  const open = fs.open;
  vi.spyOn(fs, 'open').mockImplementation(((file: string, flags?: string | number, mode?: number) => {
    const writes = typeof flags === 'string' ? /[wa+]/.test(flags) : typeof flags === 'number' && (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0;
    return writes ? denied() : open(file, flags as never, mode);
  }) as never);
}
async function setModes(root: string, writable: boolean) {
  const visit = async (directory: string) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute); else await fs.chmod(absolute, writable ? 0o644 : 0o444);
    }
    if (process.platform !== 'win32') await fs.chmod(directory, writable ? 0o755 : 0o555);
  };
  await visit(root);
}
async function writableAgain(root: string) { vi.restoreAllMocks(); await setModes(root, true).catch(() => undefined); }

describe('lock-free accepted reads', () => {
  it('leave the library byte-identical, return only accepted content and show outside edits the next write records identically', async () => {
    const f = await library();
    const pending = (await run(f.store.listChanges('bots', 'pending'))).changes;
    const outside = pending.find(change => change.path === 'unrelated.md')!;
    expect(outside).toMatchObject({ actor: { type: 'agent', id: 'external-edit' }, humanRequired: true, status: 'pending' });
    const before = await tree(f.root);
    const results = await readAll(f.store, outside.id);
    expect(await tree(f.root)).toEqual(before);
    // Only accepted text: neither the outside edit nor pending definitions reach recall.
    expect(results[1]).toMatchObject({ total: 1, results: [{ path: 'notes/accepted.md' }] });
    expect(results[2]).toMatchObject({ total: 0 });
    expect((results[4] as { raw: string }).raw).toContain(SENTINELS.unrelated);
    expect(JSON.stringify(results.slice(0, 5))).not.toContain('OUTSIDE-EDIT text');
    expect(JSON.stringify(results.slice(18, 21))).not.toMatch(/PENDING (purpose|edited)/);
    expect((await run(f.store.read('bots', 'unrelated.md', { current: true }))).raw).toContain('OUTSIDE-EDIT');
    // Repeated reads name the same outside edit, and the next write records exactly that proposal.
    expect((await run(f.store.readChange('bots', outside.id))).revisionHash).toBe(outside.revisionHash);
    const history = await fs.readFile(path.join(f.bundle, 'memory-history.json'), 'utf8');
    expect(history).not.toContain(outside.id);
    await run(f.store.proposeChange({ bundle: 'bots', path: 'notes/next.md', raw: botNote('next-note', 'Next write.', global), expectedHash: null, actor: agent, reason: 'A later write.' }));
    expect(await fs.readFile(path.join(f.bundle, 'memory-history.json'), 'utf8')).toContain(outside.id);
    const recorded = await run(f.store.readChange('bots', outside.id));
    expect(recorded.revisionHash).toBe(outside.revisionHash);
    expect(recorded.after?.raw).toContain('OUTSIDE-EDIT');
    expect(f.warnings).toEqual([]);
  });

  it('succeed in a simulated read-only sandbox while another process holds the write lock', async () => {
    const f = await library();
    const changeId = (await run(f.store.listChanges('bots', 'pending'))).changes[0].id;
    await fs.mkdir(path.join(f.bundle, '.irudd-okf'), { recursive: true });
    // A live owner: this process stands in for a writer that is still running.
    await fs.writeFile(path.join(f.bundle, '.irudd-okf', 'write.lock'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const before = await tree(f.root);
    await readOnly(f.root);
    const fresh = createStore(f.context);
    const results = await readAll(fresh, changeId);
    expect(results).toHaveLength(reads(fresh, changeId).length);
    expect(results[19]).toMatchObject({ bot: { id: 'game1-playtester' } });
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.rename).not.toHaveBeenCalled();
    expect(fs.mkdir).not.toHaveBeenCalled();
    // The simulation does deny writes: a proposal cannot even prepare its lock directory.
    await expect(run(fresh.proposeChange({ bundle: 'bots', path: 'notes/x.md', raw: botNote('x', 'x', global), expectedHash: null, actor: agent, reason: 'Denied by the sandbox.' }))).rejects.toMatchObject({ code: 'IO_ERROR', message: expect.stringContaining('EPERM') });
    await writableAgain(f.root);
    expect(await tree(f.root)).toEqual(before);
    // Writes still respect the lock.
    await expect(run(fresh.proposeChange({ bundle: 'bots', path: 'notes/x.md', raw: botNote('x', 'x', global), expectedHash: null, actor: agent, reason: 'Blocked by the lock.' }))).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('run in parallel with each other and with a write that is publishing', async () => {
    let release!: () => void, paused!: () => void;
    const reached = new Promise<void>(resolve => { paused = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const f = await library();
    const writer = createStore(f.context, { afterChangeWrite: async phase => { if (phase === 'prepared') { paused(); await gate; } } });
    const writing = run(writer.proposeChange({ bundle: 'bots', path: 'notes/accepted.md', raw: botNote('accepted-note', 'IN-FLIGHT update.', global), expectedHash: f.note.after!.hash, actor: agent, reason: 'Paused mid-publication.' }));
    await reached;
    // The writer holds the lock and its publication intent is durable, but the Markdown file still has its old bytes.
    expect((await run(f.store.inspectChanges('bots'))).publication).toMatchObject({ path: 'notes/accepted.md', state: 'untouched' });
    const changeId = (await run(f.store.listChanges('bots', 'pending'))).changes[0].id;
    const results = await Promise.all(Array.from({ length: 4 }, () => readAll(f.store, changeId)));
    for (const result of results) expect(JSON.stringify(result[0])).not.toContain('IN-FLIGHT');
    const listed = (await run(f.store.listChanges('bots', 'pending'))).changes.filter(change => change.path === 'notes/accepted.md');
    // The paused proposal is listed; its unpublished file is not mistaken for an outside edit.
    expect(listed.map(change => change.actor.id)).toEqual([agent.id]);
    expect(f.warnings).toEqual([]);
    release();
    await writing;
    expect((await run(f.store.inspectChanges('bots'))).publication).toBeNull();
    expect(await fs.readFile(path.join(f.bundle, 'notes/accepted.md'), 'utf8')).toContain('IN-FLIGHT');
  });

  it('never see a torn history while writes replace it', async () => {
    const f = await library();
    let done = false, reads = 0;
    const errors: unknown[] = [];
    const reader = async () => { while (!done) { try { await run(f.store.search('SENTINEL', { allApplicability: true })); await run(f.store.listChanges('bots')); await run(f.store.botCatalog()); reads++; } catch (error) { errors.push(error); } } };
    const readers = Array.from({ length: 3 }, reader);
    for (let index = 0; index < 8; index++) await run(f.store.proposeChange({ bundle: 'bots', path: `notes/w${index}.md`, raw: botNote(`w${index}`, 'Concurrent write.', global), expectedHash: null, actor: agent, reason: 'Concurrent write.' }));
    done = true; await Promise.all(readers);
    expect(errors).toEqual([]);
    expect(reads).toBeGreaterThan(0);
    expect((await run(f.store.listChanges('bots', 'pending'))).changes.filter(change => change.path.startsWith('notes/w'))).toHaveLength(8);
  });
});

describe('unfinished publications', () => {
  it('are reported by reads, which neither complete nor read past them; the next write completes them', async () => {
    const f = await library();
    const stopped = createStore(f.context, { afterChangeWrite: async phase => { if (phase === 'prepared') throw new Error('Writer stopped'); } });
    await expect(run(stopped.proposeChange({ bundle: 'bots', path: 'notes/accepted.md', raw: botNote('accepted-note', 'UNPUBLISHED update.', global), expectedHash: f.note.after!.hash, actor: agent, reason: 'Interrupted.' }))).rejects.toThrow();
    const before = await tree(f.root);
    const changeId = (await run(f.store.listChanges('bots', 'pending'))).changes[0].id;
    await readAll(f.store, changeId);
    expect(await tree(f.root)).toEqual(before);
    expect((await run(f.store.inspectChanges('bots'))).publication).toMatchObject({ path: 'notes/accepted.md', state: 'untouched' });
    expect(f.warnings).toMatchObject([{ level: 'warning', code: 'PUBLICATION_INCOMPLETE', bundle: 'bots', path: 'notes/accepted.md', message: expect.stringContaining('The next library write completes it') }]);
    // Accepted recall is exact: the old accepted bytes, while the change list shows the stopped proposal and no false outside edit.
    expect((await run(f.store.read('bots', 'notes/accepted.md'))).raw).toContain('ACCEPTED-ONLY');
    const listed = (await run(f.store.listChanges('bots', 'pending'))).changes.filter(change => change.path === 'notes/accepted.md');
    expect(listed.map(change => [change.actor.id, change.after?.raw.includes('UNPUBLISHED')])).toEqual([[agent.id, true]]);
    await run(f.store.proposeChange({ bundle: 'bots', path: 'notes/later.md', raw: botNote('later-note', 'Later.', global), expectedHash: null, actor: agent, reason: 'The next write.' }));
    expect((await run(f.store.inspectChanges('bots'))).publication).toBeNull();
    expect(await fs.readFile(path.join(f.bundle, 'notes/accepted.md'), 'utf8')).toContain('UNPUBLISHED');
  });

  it('keep accepted recall during an interrupted rejection and stop outside-edit classification when the file holds other bytes', async () => {
    const f = await library();
    const draft = await f.propose('notes/accepted.md', botNote('accepted-note', 'REJECTED-DRAFT text.', global), f.note.after!.hash);
    // Rejection records the decision in history, then restores the accepted bytes to the Markdown file; stop before the restore.
    const rename = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => { if (String(to).endsWith('accepted.md')) throw new Error('Writer stopped'); return rename(from, to); });
    await expect(run(f.store.reviewChange({ bundle: 'bots', id: draft.id, expectedRevisionHash: draft.revisionHash, actor: human, operator: true, reason: 'Not wanted.', decision: 'reject', sources: draft.sources }))).rejects.toThrow();
    vi.restoreAllMocks();
    // A stale lock from a writer that died while publishing.
    await fs.writeFile(path.join(f.bundle, '.irudd-okf', 'write.lock'), JSON.stringify({ pid: 999999, startedAt: '2026-01-01T00:00:00.000Z' }));
    expect(await fs.readFile(path.join(f.bundle, 'notes/accepted.md'), 'utf8')).toContain('REJECTED-DRAFT');
    expect((await run(f.store.read('bots', 'notes/accepted.md'))).raw).toContain('ACCEPTED-ONLY');
    expect((await run(f.store.search('REJECTED-DRAFT'))).total).toBe(0);
    expect((await run(f.store.readChange('bots', draft.id))).status).toBe('rejected');
    expect(f.warnings).toMatchObject([{ code: 'PUBLICATION_INCOMPLETE', message: expect.stringContaining('stale write lock') }]);
    await fs.writeFile(path.join(f.bundle, 'notes/accepted.md'), botNote('accepted-note', 'THIRD bytes.', global));
    const before = await tree(f.root);
    expect((await run(f.store.search('ACCEPTED-ONLY'))).total).toBe(1);
    await expect(run(f.store.listChanges('bots'))).rejects.toMatchObject({ code: 'PUBLICATION_INCOMPLETE', details: { path: 'notes/accepted.md', state: 'externally-changed', writer: 'stopped' } });
    await expect(run(f.store.checkBots({ bundle: 'bots' }))).rejects.toMatchObject({ code: 'PUBLICATION_INCOMPLETE' });
    expect(await tree(f.root)).toEqual(before);
    expect(f.warnings.at(-1)).toMatchObject({ code: 'PUBLICATION_INCOMPLETE', message: expect.stringContaining('change recover') });
    // Recovery is an explicit write: it keeps the other bytes as a pending outside edit.
    await run(f.store.recoverChanges('bots'));
    const outside = (await run(f.store.listChanges('bots', 'pending'))).changes.filter(change => change.path === 'notes/accepted.md');
    expect(outside.map(change => [change.actor.id, change.after?.raw.includes('THIRD')])).toEqual([['external-edit', true]]);
    expect((await run(f.store.read('bots', 'notes/accepted.md'))).raw).toContain('ACCEPTED-ONLY');
  });
});

describe('reads racing healthy writes', () => {
  // Runs the given writes at the moment a read inspects the write lock, between its two history reads.
  function duringLockCheck(writes: () => Promise<unknown>) {
    const readFile = fs.readFile;
    let armed = true;
    vi.spyOn(fs, 'readFile').mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
      if (armed && String(args[0]).endsWith('write.lock')) { armed = false; await writes(); }
      return readFile(...args);
    }) as never);
    return () => armed;
  }
  async function pausedWriter(f: Awaited<ReturnType<typeof library>>, raw: string, expectedHash: string | null) {
    let release!: () => void, paused!: () => void;
    const reached = new Promise<void>(resolve => { paused = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const writer = createStore(f.context, { afterChangeWrite: async phase => { if (phase === 'prepared') { paused(); await gate; } } });
    const writing = run(writer.proposeChange({ bundle: 'bots', path: 'notes/accepted.md', raw, expectedHash, actor: agent, reason: 'Healthy write.' }));
    await reached;
    return { finish: async () => { release(); await writing; } };
  }

  it('do not report a publication that finished between reading history and the lock', async () => {
    const f = await library();
    const writer = await pausedWriter(f, botNote('accepted-note', 'FINISHED update.', global), f.note.after!.hash);
    const pending = duringLockCheck(writer.finish);
    expect((await run(f.store.read('bots', 'notes/accepted.md'))).raw).toContain('ACCEPTED-ONLY');
    expect(pending()).toBe(false);
    expect(f.warnings).toEqual([]);
  });

  it('do not mistake two writes to one file finishing during a listing for an outside edit', async () => {
    const f = await library();
    const first = await pausedWriter(f, botNote('accepted-note', 'FIRST update.', global), f.note.after!.hash);
    const pending = duringLockCheck(async () => {
      await first.finish();
      const current = await run(createStore(f.context).read('bots', 'notes/accepted.md', { current: true }));
      await run(createStore(f.context).proposeChange({ bundle: 'bots', path: 'notes/accepted.md', raw: botNote('accepted-note', 'SECOND update.', global), expectedHash: current.hash, actor: agent, reason: 'Second healthy write.' }));
    });
    const listed = (await run(f.store.listChanges('bots', 'pending', { limit: 100 }))).changes.filter(change => change.path === 'notes/accepted.md');
    expect(pending()).toBe(false);
    expect(listed.map(change => [change.actor.id, change.after?.raw.includes('SECOND')])).toEqual([[agent.id, true]]);
    expect((await run(f.store.checkBots({ bundle: 'bots' }))).bundle).toBe('bots');
    expect(f.warnings).toEqual([]);
  });

  it('treat a lock without a process ID as a starting writer, and report it only if it stays that way', async () => {
    const f = await library();
    const stopped = createStore(f.context, { afterChangeWrite: async phase => { if (phase === 'prepared') throw new Error('Writer stopped'); } });
    await expect(run(stopped.proposeChange({ bundle: 'bots', path: 'notes/accepted.md', raw: botNote('accepted-note', 'STOPPED update.', global), expectedHash: f.note.after!.hash, actor: agent, reason: 'Interrupted.' }))).rejects.toThrow();
    const lock = path.join(f.bundle, '.irudd-okf', 'write.lock');
    await fs.writeFile(lock, '');
    const starting = setTimeout(() => { void fs.writeFile(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); }, 30);
    await run(f.store.search('ACCEPTED-ONLY'));
    clearTimeout(starting);
    expect(f.warnings).toEqual([]);
    await fs.writeFile(lock, '');
    await run(createStore(f.context, { onWarning: diagnostic => { f.warnings.push(diagnostic); } }).search('ACCEPTED-ONLY'));
    expect(f.warnings).toMatchObject([{ code: 'PUBLICATION_INCOMPLETE', message: expect.stringContaining('stale write lock') }]);
  });

  it('keep a listed outside removal reviewable after a sibling changes, and never date an edit before its last proposal', async () => {
    const f = await library();
    await f.accept(await f.propose('notes/y.md', botNote('y-note', 'Y.', global)));
    await fs.unlink(path.join(f.bundle, 'notes/y.md'));
    const removal = (await run(f.store.listChanges('bots', 'pending', { limit: 100 }))).changes.find(change => change.path === 'notes/y.md')!;
    expect(removal).toMatchObject({ action: 'delete', actor: { id: 'external-edit' } });
    await fs.writeFile(path.join(f.bundle, 'notes/z.md'), botNote('z-note', 'Z.', global));
    const again = (await run(f.store.listChanges('bots', 'pending', { limit: 100 }))).changes.find(change => change.path === 'notes/y.md')!;
    expect([again.id, again.revisionHash]).toEqual([removal.id, removal.revisionHash]);
    expect((await run(f.store.reviewChange({ bundle: 'bots', id: removal.id, expectedRevisionHash: removal.revisionHash, actor: human, operator: true, reason: 'Removed on purpose.', decision: 'accept', sources: removal.sources }))).status).toBe('accepted');
    // A copy that keeps an old modification time.
    const file = path.join(f.bundle, 'notes/accepted.md'), latest = (await run(f.store.listChanges('bots', undefined, { limit: 100 }))).changes.filter(change => change.path === 'notes/accepted.md').at(-1)!;
    await fs.writeFile(file, botNote('accepted-note', 'COPIED bytes.', global));
    await fs.utimes(file, new Date('2001-01-01T00:00:00Z'), new Date('2001-01-01T00:00:00Z'));
    const copied = (await run(f.store.listChanges('bots', 'pending', { limit: 100 }))).changes.find(change => change.path === 'notes/accepted.md' && change.actor.id === 'external-edit')!;
    expect(copied.createdAt >= latest.createdAt).toBe(true);
  });
});

describe('path checks racing an atomic replace', () => {
  it.skipIf(process.platform !== 'win32')('validate the new file again instead of reporting UNSAFE_PATH', async () => {
    const f = await library();
    const file = path.join(f.bundle, 'notes', 'accepted.md'), realpath = fs.realpath;
    let replaced = false;
    vi.spyOn(fs, 'realpath').mockImplementation((async (...args: Parameters<typeof fs.realpath>) => {
      // A writer publishes new bytes under the same name between the two lstat calls of the check.
      if (!replaced && String(args[0]) === file) { replaced = true; await fs.writeFile(file + '.tmp', botNote('accepted-note', 'REPLACED bytes.', global)); await fs.rename(file + '.tmp', file); }
      return realpath(...args);
    }) as never);
    expect((await run(f.store.read('bots', 'notes/accepted.md', { current: true }))).raw).toContain('REPLACED');
    expect(replaced).toBe(true);
    // Links are still refused at once.
    vi.restoreAllMocks();
    await fs.symlink(path.join(f.bundle, 'notes'), path.join(f.bundle, 'linked'), 'junction');
    await expect(run(f.store.read('bots', 'linked/accepted.md', { current: true }))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  });
});
