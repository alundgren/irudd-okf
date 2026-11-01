import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { createStore, BOT_CATALOG_PATH, type Bundle, type ChangeRecord, type Store } from '../src/index.ts';
import { hash } from '../src/files.ts';
import { canonicalJson } from '../src/memory.ts';
import { agent, bot, botCatalog, botDefinition, botNote, global, human, makeLibrary, target } from './bot-fixture.ts';

const run = Effect.runPromise;
const roots: string[] = [];
const otherAgent = { type: 'agent' as const, id: 'second-session' };
async function base() { const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'okf-bot-rules-'))); roots.push(root); return root; }
const storeFor = (bundles: Bundle[]) => createStore({ version: 1, cwd: bundles[0].root, gitRoot: null, configPath: path.join(bundles[0].root, '..', 'unused-config.json'), bundles });
const agentReview = (store: Store, bundle: string, change: ChangeRecord) => run(store.reviewChange({ bundle, id: change.id, expectedRevisionHash: change.revisionHash, actor: otherAgent, reason: 'Routine check.', decision: 'accept', sources: change.sources }));
const humanReview = (store: Store, bundle: string, change: ChangeRecord) => run(store.reviewChange({ bundle, id: change.id, expectedRevisionHash: change.revisionHash, actor: human, operator: true, reason: 'Checked.', decision: 'accept', sources: change.sources }));
const propose = (store: Store, bundle: string, file: string, raw: string | null, expectedHash: string | null = null) => run(store.proposeChange({ bundle, path: file, raw, expectedHash, actor: agent, reason: 'Agent authoring.' }));
const single = (id: string, name: string, memory: unknown[] = [], collaborators: unknown[] = []) => botDefinition(id, bot(name, `Purpose of ${name}.`, memory, collaborators));
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe('bot authoring needs a person', () => {
  it('refuses agent decisions on creating, editing and removing catalogs and definitions, including a definition for an already registered entry', async () => {
    const root = await base();
    const lib = await makeLibrary(path.join(root, 'a'), 'a', [['secret.md', botNote('secret', 'SECRET-REPO-X fact.', { type: 'repository', id: 'repo-x' })]]);
    const spy = await propose(lib.store, 'a', 'bots/spy.md', single('spy', 'spy', [target('s', 'shared', 'secret.md', { repository: 'repo-x' })]));
    const catalog = await propose(lib.store, 'a', BOT_CATALOG_PATH, botCatalog([{ id: 'spy', definition: 'spy.md' }]));
    expect([spy.humanRequired, catalog.humanRequired]).toEqual([true, true]);
    for (const change of [spy, catalog]) await expect(agentReview(lib.store, 'a', change)).rejects.toMatchObject({ code: 'HUMAN_REVIEW_REQUIRED' });
    await expect(run(lib.store.resolveBot({ name: 'spy' }))).rejects.toMatchObject({ code: 'BOT_NOT_FOUND' });
    // The catalog is accepted by a person; the registered definition still cannot be accepted by an agent.
    await humanReview(lib.store, 'a', catalog);
    await expect(agentReview(lib.store, 'a', spy)).rejects.toMatchObject({ code: 'HUMAN_REVIEW_REQUIRED' });
    await expect(run(lib.store.resolveBot({ id: 'spy' }))).rejects.toMatchObject({ code: 'BOT_UNAVAILABLE' });
    const accepted = await humanReview(lib.store, 'a', spy);
    // A stage-only change is routine for other procedures but not for a bot definition.
    const stage = await propose(lib.store, 'a', 'bots/spy.md', accepted.after!.raw.replace('stage: bronze', 'stage: silver'), accepted.after!.hash);
    expect(stage.humanRequired).toBe(true);
    await expect(agentReview(lib.store, 'a', stage)).rejects.toMatchObject({ code: 'HUMAN_REVIEW_REQUIRED' });
    // Retyping the definition into ordinary memory is judged by its accepted type.
    const retyped = await propose(lib.store, 'a', 'bots/spy.md', accepted.after!.raw.replace('type: Bot definition', 'type: Memory').replace('kind: procedural', 'kind: semantic'), stage.after!.hash);
    expect(retyped.humanRequired).toBe(true);
    const removal = await propose(lib.store, 'a', 'bots/spy.md', null, retyped.after!.hash);
    expect(removal.humanRequired).toBe(true);
    await expect(agentReview(lib.store, 'a', removal)).rejects.toMatchObject({ code: 'HUMAN_REVIEW_REQUIRED' });
    const ghost = await propose(lib.store, 'a', 'bots/ghost.md', single('ghost', 'ghost'));
    const catalogRaw = (await run(lib.store.read('a', BOT_CATALOG_PATH))).raw;
    const catalogEdit = await propose(lib.store, 'a', BOT_CATALOG_PATH, catalogRaw.replace('Registered bots.', 'Registered bots, edited.'), hash(catalogRaw));
    expect([ghost.humanRequired, catalogEdit.humanRequired]).toEqual([true, true]);
  });

  it('treats any proposal at the catalog path as bot authoring, whatever its type or letter case', async () => {
    const root = await base();
    const lib = await makeLibrary(path.join(root, 'a'), 'a', []);
    const ordinary = await propose(lib.store, 'a', BOT_CATALOG_PATH, botNote('catalog-squat', 'Ordinary note.', global));
    expect(ordinary.humanRequired).toBe(true);
    await expect(agentReview(lib.store, 'a', ordinary)).rejects.toMatchObject({ code: 'HUMAN_REVIEW_REQUIRED' });
    const other = await makeLibrary(path.join(root, 'b'), 'b', []);
    const cased = await propose(other.store, 'b', 'Bots/Catalog.md', botNote('catalog-cased', 'Ordinary note.', global));
    expect(cased.humanRequired).toBe(true);
    const sibling = await propose(other.store, 'b', 'bots/notes.md', botNote('bot-notes', 'Ordinary note.', global));
    expect(sibling.humanRequired).toBe(false);
  });

  it('rechecks bot documents at review for proposals recorded before the rule', async () => {
    const root = await base();
    const lib = await makeLibrary(path.join(root, 'a'), 'a', []);
    const change = await propose(lib.store, 'a', 'bots/legacy.md', single('legacy', 'legacy'));
    const file = path.join(lib.bundle.root, 'memory-history.json');
    const history = JSON.parse(await fs.readFile(file, 'utf8'));
    const proposal = history.proposals.find((item: { id: string }) => item.id === change.id);
    proposal.humanRequired = false;
    const { revisionHash: _, ...payload } = proposal;
    proposal.revisionHash = hash(canonicalJson(payload));
    await fs.writeFile(file, JSON.stringify(history, null, 2) + '\n');
    await expect(agentReview(lib.store, 'a', { ...change, revisionHash: proposal.revisionHash, humanRequired: false })).rejects.toMatchObject({ code: 'HUMAN_REVIEW_REQUIRED' });
  });
});

describe('namesakes and unreadable libraries', () => {
  const valid = (root: string) => makeLibrary(path.join(root, 'b'), 'b', [['bots/same.md', single('same-b', 'same: name')], [BOT_CATALOG_PATH, botCatalog([{ id: 'same-b', definition: 'same.md' }])]]);
  it('does not let an unavailable registration with the same name yield to another library', async () => {
    const root = await base();
    const b = await valid(root);
    const broken = {
      excluded: single('same', 'same: name').replace('type: Bot definition\n', 'type: Bot definition\nstatus: deprecated\n'),
      invalid: botDefinition('same', { name: 'same: name', purpose: 'No instructions.', identity: 'x', collaborators: [], memory: [] }),
      mismatch: single('other-id', 'same: name'),
    };
    const codes = { excluded: 'BOT_DEFINITION_EXCLUDED', invalid: 'BOT_DEFINITION_INVALID', mismatch: 'BOT_ID_MISMATCH' };
    for (const [kind, raw] of Object.entries(broken) as Array<[keyof typeof broken, string]>) {
      const a = await makeLibrary(path.join(root, kind), kind, [['bots/same.md', raw], [BOT_CATALOG_PATH, botCatalog([{ id: 'same', definition: 'same.md' }])]]);
      const store = storeFor([a.bundle, b.bundle]);
      await expect(run(store.resolveBot({ name: 'same: name' }))).rejects.toMatchObject({ code: 'BOT_NAME_AMBIGUOUS', details: { candidates: [{ id: 'same-b', bundle: 'b', available: true }, { bundle: kind, available: false, diagnostic: { code: codes[kind] } }] } });
      const catalog = await run(store.botCatalog());
      expect(catalog.bots).toMatchObject([{ id: 'same-b', duplicateName: true }]);
      expect(catalog.diagnostics.map(item => item.code)).toEqual([codes[kind]]);
      expect((await run(store.resolveBot({ name: 'same: name', bundle: 'b' }))).bot.id).toBe('same-b');
      await expect(run(store.resolveBot({ name: 'same: name', bundle: kind }))).rejects.toMatchObject({ code: 'BOT_UNAVAILABLE' });
    }
  });

  it('reports unnamed registrations that could make resolution incomplete', async () => {
    const root = await base();
    const b = await valid(root);
    const c = await makeLibrary(path.join(root, 'c'), 'c', [[BOT_CATALOG_PATH, botCatalog([{ id: 'ghost', definition: 'ghost.md' }, { id: 'loose' } as never])]]);
    const store = storeFor([b.bundle, c.bundle]);
    const resolved = await run(store.resolveBot({ name: 'same: name' }));
    expect(resolved.complete).toBe(true);
    expect(resolved.diagnostics).toMatchObject([{ level: 'warning', code: 'BOT_UNNAMED_REGISTRATIONS', message: expect.stringContaining('2 other registrations') }]);
    const error = await run(store.resolveBot({ name: 'nobody' })).catch(error => error);
    expect(error).toMatchObject({ code: 'BOT_NOT_FOUND', message: expect.stringContaining('2 registrations have no accepted definition name'), details: { unnamed: [{ code: 'BOT_DEFINITION_UNAVAILABLE', bot: 'ghost' }, { code: 'BOT_CATALOG_INVALID' }] } });
  });

  it('reads only the scoped library and its references, and reports unreadable libraries instead of failing every command', async () => {
    const root = await base();
    const b = await makeLibrary(path.join(root, 'b'), 'b', [['shared/fact.md', botNote('fact', 'B-FACT.', global)], ['bots/helper.md', single('helper', 'b: helper')], [BOT_CATALOG_PATH, botCatalog([{ id: 'helper', definition: 'helper.md' }])]]);
    const a = await makeLibrary(path.join(root, 'a'), 'a', [
      ['bots/alpha.md', single('alpha', 'a: alpha', [target('shared', 'shared', 'shared', {}, { bundle: b.id })], [{ bot: 'helper', bundle: b.id, handoff: 'Ask the helper.' }])],
      ['bots/beta.md', single('beta', 'a: beta')],
      [BOT_CATALOG_PATH, botCatalog([{ id: 'alpha', definition: 'alpha.md' }, { id: 'beta', definition: 'beta.md' }])],
    ]);
    const store = storeFor([a.bundle, b.bundle]);
    expect((await run(store.resolveBot({ name: 'a: alpha', bundle: 'a' }))).complete).toBe(true);
    // Reads take no lock, so another command's write lock blocks nothing.
    await fs.mkdir(path.join(b.bundle.root, '.irudd-okf'), { recursive: true });
    await fs.writeFile(path.join(b.bundle.root, '.irudd-okf', 'write.lock'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    expect((await run(store.resolveBot({ name: 'a: alpha' }))).complete).toBe(true);
    expect((await run(store.botCatalog())).diagnostics).toEqual([]);
    await fs.writeFile(path.join(b.bundle.root, 'memory-history.json'), '{"version":1,');
    expect(await run(store.resolveBot({ name: 'a: beta', bundle: 'a' }))).toMatchObject({ complete: true, diagnostics: [] });
    const alpha = await run(store.resolveBot({ name: 'a: alpha', bundle: 'a' }));
    expect(alpha.complete).toBe(false);
    expect(alpha.diagnostics.map(item => [item.code, item.message.includes('INVALID_MEMORY_HISTORY')])).toEqual([['BOT_COLLABORATOR_UNAVAILABLE', true], ['BOT_MEMORY_BUNDLE_UNAVAILABLE', true]]);
    const catalog = await run(store.botCatalog());
    expect(catalog.bots.map(item => item.id)).toEqual(['alpha', 'beta']);
    expect(catalog.diagnostics).toMatchObject([{ code: 'BOT_LIBRARY_UNREADABLE', bundle: 'b' }]);
    await expect(run(store.resolveBot({ name: 'a: beta' }))).rejects.toMatchObject({ code: 'BOT_CATALOG_INCOMPLETE', details: { diagnostics: [{ code: 'BOT_LIBRARY_UNREADABLE', bundle: 'b' }] } });
    await expect(run(store.resolveBot({ id: 'beta' }))).rejects.toMatchObject({ code: 'BOT_CATALOG_INCOMPLETE' });
  });

  it('blocks unscoped resolution on invalid or unsupported catalogs and reports ambiguous ids', async () => {
    const root = await base();
    const b = await valid(root);
    const semantic = await makeLibrary(path.join(root, 'semantic'), 'semantic', [[BOT_CATALOG_PATH, botCatalog([]).replace('kind: procedural', 'kind: semantic')]]);
    const generic = path.join(root, 'generic'); await fs.mkdir(path.join(generic, 'bots'), { recursive: true });
    await fs.writeFile(path.join(generic, BOT_CATALOG_PATH), botCatalog([{ id: 'same-b', definition: 'same.md' }]));
    const genericBundle: Bundle = { name: 'generic', root: await fs.realpath(generic), kind: 'explicit', writable: true };
    for (const [bundle, code] of [[semantic.bundle, 'BOT_CATALOG_INVALID'], [genericBundle, 'BOT_CATALOG_UNAVAILABLE']] as const) {
      const store = storeFor([b.bundle, bundle]);
      expect((await run(store.botCatalog())).diagnostics.map(item => item.code)).toEqual([code]);
      await expect(run(store.resolveBot({ name: 'same: name' }))).rejects.toMatchObject({ code: 'BOT_CATALOG_INCOMPLETE', details: { diagnostics: [{ code }] } });
      expect((await run(store.resolveBot({ name: 'same: name', bundle: 'b' }))).bot.id).toBe('same-b');
    }
    const twin = await makeLibrary(path.join(root, 'twin'), 'twin', [['bots/same.md', single('same-b', 'twin: other')], [BOT_CATALOG_PATH, botCatalog([{ id: 'same-b', definition: 'same.md' }])]]);
    const store = storeFor([b.bundle, twin.bundle]);
    await expect(run(store.resolveBot({ id: 'same-b' }))).rejects.toMatchObject({ code: 'BOT_ID_AMBIGUOUS', details: { candidates: [{ bundle: 'b' }, { bundle: 'twin' }] } });
    expect((await run(store.resolveBot({ id: 'same-b', bundle: 'twin' }))).bot.name).toBe('twin: other');
  });
});

describe('definition and reference validation', () => {
  it('reports invalid and unavailable references, invalid registrations and truncation', async () => {
    const root = await base();
    const many: Array<[string, string]> = Array.from({ length: 101 }, (_, index) => [`many/note-${String(index).padStart(3, '0')}.md`, botNote(`many-${index}`, `Fact ${index}.`, global)]);
    const lib = await makeLibrary(path.join(root, 'cov'), 'cov', [
      ...many,
      ['note.md', botNote('note', 'Repository X fact.', { type: 'repository', id: 'repo-x' })],
      ['bots/other.md', single('other', 'cov: other')],
      ['bots/refs.md', single('refs', 'cov: refs', [target('bot-doc', 'shared', 'bots/other.md'), target('control', 'shared', 'index.md'), target('wrong-scope', 'shared', 'note.md', { repository: 'repo-y' })], [{ bot: 'nobody', handoff: 'Nobody answers.' }])],
      ['bots/badref.md', single('badref', 'cov: badref', [target('escape', 'shared', '../outside')])],
      ['bots/archived.md', single('archived', 'cov: archived').replace('  stage: bronze\n', '  stage: bronze\n  archived_at: "2020-01-01T00:00:00Z"\n')],
      ['bots/mismatch.md', single('not-mismatch', 'cov: mismatch')],
      ['bots/many.md', single('many', 'cov: many', [target('many', 'shared', 'many')])],
      [BOT_CATALOG_PATH, botCatalog([...['other', 'refs', 'badref', 'archived', 'mismatch', 'many'].map(id => ({ id, definition: `${id}.md` })), { id: 'other', definition: 'other.md' }, { id: 'outside', definition: '../../escape.md' }])],
    ]);
    const catalog = await run(lib.store.botCatalog());
    expect(catalog.bots.map(item => item.id)).toEqual(['many', 'other', 'refs']);
    expect(catalog.diagnostics.map(item => [item.code, item.bot])).toEqual([['BOT_DEFINITION_INVALID', 'badref'], ['BOT_DEFINITION_EXCLUDED', 'archived'], ['BOT_ID_MISMATCH', 'mismatch'], ['BOT_CATALOG_INVALID', 'other'], ['BOT_CATALOG_INVALID', 'outside']]);
    expect(catalog.diagnostics[0].message).toContain('bot.memory[0]');
    const refs = await run(lib.store.resolveBot({ name: 'cov: refs' }));
    expect(refs.complete).toBe(false);
    expect(refs.diagnostics.map(item => [item.code, item.target ?? null])).toEqual([['BOT_UNNAMED_REGISTRATIONS', null], ['BOT_COLLABORATOR_UNAVAILABLE', null], ['BOT_MEMORY_INVALID', 'bot-doc'], ['BOT_MEMORY_INVALID', 'control'], ['BOT_MEMORY_UNAVAILABLE', 'wrong-scope']]);
    expect(refs.diagnostics[3].message).toContain('control file');
    expect(refs.diagnostics[4].message).toContain('"repository","id":"repo-x"');
    expect(refs.memory.every(item => item.status === 'unavailable' && !item.documents.length)).toBe(true);
    const manyBot = await run(lib.store.resolveBot({ id: 'many' }));
    expect(manyBot.memory[0]).toMatchObject({ status: 'available', truncated: true });
    expect(manyBot.memory[0].documents).toHaveLength(100);
    expect(manyBot.memory[0].documents.at(-1)!.path).toBe('many/note-099.md');
    expect(manyBot.diagnostics.map(item => item.code)).toEqual(['BOT_MEMORY_TRUNCATED']);
    expect(manyBot.complete).toBe(true);
  }, 120_000);
});
