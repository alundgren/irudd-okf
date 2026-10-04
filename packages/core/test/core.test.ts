import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Effect } from 'effect';
import { createStore, resolveContext, initializeBundle, registerBundle, unregisterBundle, type MemoryContext } from '../src/index.ts';

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));
const directories: string[] = [];
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'okf-core-'))); directories.push(root);
  const configPath = path.join(root, 'config.json');
  const bundle = path.join(root, '.okf'); await fs.mkdir(bundle);
  const context: MemoryContext = { version: 1, cwd: root, gitRoot: null, configPath, bundles: [{ name: 'repo', root: bundle, kind: 'repository', writable: true }] };
  return { root, bundle, configPath, context, store: createStore(context), write: async (file: string, raw: string) => { await fs.mkdir(path.dirname(path.join(bundle, file)), { recursive: true }); await fs.writeFile(path.join(bundle, file), raw); } };
}
const run = Effect.runPromise;
const document = (title: string, body = '') => `---\ntype: Rule\ntitle: ${title}\n---\n${body}`;
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe('OKF parsing and retrieval', () => {
  it('accepts minimal and unknown metadata while reserving index and log at every level', async () => {
    const f = await fixture();
    await f.write('.hidden.md', '---\ntype: Rule\n---\n');
    await f.write('minimal.md', '---\ntype: Future Type\nproducer: { nested: [1, 2] } # keep this comment\nverified: { by: "human:ada" }\n---\nHello\n');
    await f.write('index.md', '---\nokf_version: "9.2"\n---\n# Knowledge\n');
    await f.write('nested/index.md', '# Nested\n'); await f.write('nested/log.md', '# Changes\n\n## 2026-10-04\n- Created\n');
    expect((await run(f.store.list())).map(item => item.path)).toEqual(['.hidden.md', 'minimal.md']);
    const concept = await run(f.store.read('repo', 'minimal.md'));
    expect(concept.metadata.producer).toEqual({ nested: [1, 2] }); expect(concept.metadata.verified).toEqual([{ by: 'human:ada' }]);
    expect((await run(f.store.validate())).errors).toBe(0);
    expect((await run(f.store.index('repo', 'nested'))).path).toBe('nested/index.md');
    expect((await run(f.store.index('repo', 'absent'))).body).toContain('# Knowledge');
  });
  it('projects cyclic YAML metadata to JSON without rejecting the concept or changing raw bytes', async () => {
    const f = await fixture(); const raw = '---\ntype: Future Type\nproducer: &self { child: *self } # preserve alias\n---\nReadable body\n';
    await f.write('cyclic.md', raw);
    const concept = await run(f.store.read('repo', 'cyclic.md'));
    expect(concept.malformed).toBe(false); expect(concept.metadata.producer).toEqual({ child: null });
    expect(concept.diagnostics).toContainEqual(expect.objectContaining({ code: 'METADATA_PROJECTION', level: 'warning' }));
    expect(JSON.parse(JSON.stringify(concept)).raw).toBe(raw);
    expect((await run(f.store.validate())).errors).toBe(0);
    expect((await run(f.store.validate({ lint: true }))).warnings).toBe(1);
    await run(f.store.save({ bundle: 'repo', path: 'cyclic.md', raw: raw.replace('Readable body', 'Changed body'), expectedHash: concept.hash }));
    expect((await run(f.store.read('repo', 'cyclic.md'))).raw).toContain('producer: &self { child: *self } # preserve alias');
  });
  it('encodes synthetic index destinations and creates an authored index from the empty hash', async () => {
    const f = await fixture(); await f.write('a#fragment.md', document('Hash filename')); await f.write('nested/a?query.md', document('Query filename'));
    const index = await run(f.store.index('repo'));
    expect(index.hash).toBe(''); expect(index.raw).toContain('(a%23fragment.md)'); expect(index.raw).toContain('(nested/a%3Fquery.md)');
    expect(index.links.map(link => link.target)).toEqual(['a#fragment.md', 'nested/a?query.md']);
    const saved = await run(f.store.save({ bundle: 'repo', path: index.path, raw: index.raw, expectedHash: index.hash || null }));
    expect(saved.hash).not.toBe(''); expect((await run(f.store.index('repo'))).hash).toBe(saved.hash);
  });
  it('reads malformed documents raw and separates conformance from lint', async () => {
    const f = await fixture();
    await f.write('bad.md', '---\ntype: [broken\n---\nReadable raw'); await f.write('plain.md', 'No metadata');
    await f.write('runtime.md', '---\ntype: Attested Computation\n---\n');
    await f.write('optional.md', '---\ntype: Unknown\ntitle: 3\ntags: 4\n---\n[missing](gone.md)');
    await f.write('nested/index.md', '---\nokf_version: "0.2"\n---\n');
    const raw = await run(f.store.read('repo', 'bad.md')); expect(raw.raw).toContain('Readable raw'); expect(raw.malformed).toBe(true);
    const result = await run(f.store.validate()); expect(result.errors).toBe(6); expect(result.warnings).toBe(0);
    expect((await run(f.store.validate({ lint: true }))).warnings).toBe(3);
  });
  it('parses references, titles, escaped filenames, bundle paths, assets and external URLs', async () => {
    const f = await fixture();
    await f.write('folder/from.md', document('From', '[relative](../target.md?x=1#part "title")\n[reference][shared]\n[escaped](../space%20file.md)\n[absolute](/target.md)\n[escape](../../outside.md)\n[external](https://example.invalid/no-fetch)\n[asset](../asset.txt)\n\n[shared]: ../target.md "Reference title"\n\n```md\n[code](missing.md)\n```'));
    await f.write('target.md', document('Target')); await f.write('space file.md', document('Space')); await fs.writeFile(path.join(f.bundle, 'asset.txt'), 'asset');
    const concept = await run(f.store.read('repo', 'folder/from.md'));
    expect(concept.links).toHaveLength(7); expect(concept.links[0]).toMatchObject({ target: 'target.md', fragment: 'part', broken: false });
    expect(concept.links.find(link => link.label === 'escape')?.broken).toBe(true); expect(concept.links.find(link => link.label === 'asset')?.broken).toBe(false);
    expect((await run(f.store.read('repo', 'target.md'))).backlinks).toEqual([{ bundle: 'repo', path: 'folder/from.md', title: 'From' }]);
  });
  it('ranks metadata, filters sources, paginates stably and notices external edits', async () => {
    const f = await fixture();
    await f.write('a.md', document('Cleanup', 'other')); await f.write('b.md', document('Body', 'cleanup cleanup'));
    await f.write('c.md', '---\ntype: Rule\ntitle: Tagged\ntags: [cleanup]\n---\n');
    const result = await run(f.store.search('cleanup', { limit: 2 })); expect(result.results.map(item => item.path)).toEqual(['a.md', 'c.md']); expect(result.truncated).toBe(true);
    expect((await run(f.store.search('tag:cleanup type:Rule'))).results.map(item => item.path)).toEqual(['c.md']);
    expect((await run(f.store.search('cleanup', { offset: 2 }))).results[0].path).toBe('b.md');
    await f.write('a.md', document('Changed', 'unrelated'));
    expect((await run(f.store.search('cleanup'))).results.map(item => item.path)).toEqual(['c.md', 'b.md']);
    await fs.unlink(path.join(f.bundle, 'c.md')); expect((await run(f.store.list())).length).toBe(2);
    await expect(run(f.store.search('a '.repeat(1100)))).rejects.toMatchObject({ code: 'QUERY_LIMIT' });
  });
  it('bounds graph traversal, keeps source aliases, and includes incoming links', async () => {
    const f = await fixture();
    for (let i = 0; i < 90; i++) await f.write(`${String(i).padStart(3, '0')}.md`, document(`Node ${i}`, i ? '[root](/000.md)' : ''));
    const graph = await run(f.store.graph({ bundle: 'repo', path: '000.md', limit: 12, depth: 9 }));
    expect(graph.nodes.length).toBe(12); expect(graph.truncated).toBe(true); expect(graph.edges.every(edge => edge.from.startsWith('repo:') && edge.to.startsWith('repo:'))).toBe(true);
    expect((await run(f.store.graph())).nodes.length).toBe(80); expect((await run(f.store.graph({ limit: 900 }))).limit).toBe(250);
    expect((await run(f.store.graph({ bundle: 'repo', path: '000.md', depth: 0 }))).nodes.length).toBe(1);
  });
});

describe('scope and safe mutations', () => {
  it('discovers only the current Git root and rejects repository config escapes', async () => {
    const f = await fixture(); execFileSync('git', ['init', '-q', f.root]); await fs.mkdir(path.join(f.root, 'child'));
    const global = path.join(f.root, 'global.json'); await fs.writeFile(global, JSON.stringify({ version: 1, bundles: [], active: [] }));
    const resolved = await run(resolveContext({ cwd: path.join(f.root, 'child'), configPath: global })); expect(resolved.bundles.map(bundle => bundle.root)).toEqual([f.bundle]);
    await fs.writeFile(path.join(f.root, '.irudd-okf.json'), JSON.stringify({ version: 1, bundles: [{ name: 'outside', path: os.tmpdir() }], active: ['outside'] }));
    await expect(run(resolveContext({ cwd: f.root, configPath: global }))).rejects.toMatchObject({ code: 'UNSAFE_CONFIG' });
    const explicit = await run(resolveContext({ cwd: f.root, configPath: global, explicitBundles: [{ name: 'chosen', root: f.bundle }] })); expect(explicit.bundles.map(bundle => bundle.name)).toEqual(['chosen']);
  });
  it('requires opt-in personal mounts and authorization for personal edits', async () => {
    const f = await fixture();
    await run(registerBundle('me', f.bundle, { configPath: f.configPath }));
    expect((await run(resolveContext({ cwd: f.root, configPath: f.configPath }))).bundles.map(bundle => bundle.name)).toEqual(['repo']);
    await run(unregisterBundle('me', { configPath: f.configPath })); await run(registerBundle('me', f.bundle, { configPath: f.configPath, activate: true }));
    const context = await run(resolveContext({ cwd: f.root, configPath: f.configPath })); const store = createStore(context);
    await expect(run(store.save({ bundle: 'me', path: 'new.md', raw: document('New'), expectedHash: null }))).rejects.toMatchObject({ code: 'PERSONAL_AUTHORIZATION' });
    await run(store.save({ bundle: 'me', path: 'new.md', raw: document('New'), expectedHash: null, authorizePersonal: true }));
    expect((await run(store.search('New', { bundle: 'me' }))).results[0].bundle).toBe('me');
  });
  it('preserves raw bytes on no-op and body edits, detects stale writes, and recovers deletion', async () => {
    const f = await fixture(); const raw = '---\r\ntype: Rule # comment\r\nproducer: { arbitrary: true }\r\n---\r\nBody\r\n'; await f.write('raw.md', raw);
    const concept = await run(f.store.read('repo', 'raw.md')); expect((await run(f.store.save({ bundle: 'repo', path: 'raw.md', raw, expectedHash: concept.hash }))).changedPaths).toEqual([]);
    const saved = await run(f.store.save({ bundle: 'repo', path: 'raw.md', raw: raw.replace('Body', 'New body'), expectedHash: concept.hash }));
    expect(await fs.readFile(saved.recoveryPath!, 'utf8')).toBe(raw); expect((await run(f.store.read('repo', 'raw.md'))).raw).toContain('type: Rule # comment\r\n');
    await expect(run(f.store.save({ bundle: 'repo', path: 'raw.md', raw, expectedHash: concept.hash }))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(run(f.store.save({ bundle: 'repo', path: 'raw.md', raw, expectedHash: null }))).rejects.toMatchObject({ code: 'CONFLICT' });
    const removed = await run(f.store.remove({ bundle: 'repo', path: 'raw.md', expectedHash: saved.hash! })); expect(await fs.readFile(removed.recoveryPath!, 'utf8')).toContain('New body');
    await expect(run(f.store.read('repo', 'raw.md'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('rejects escaping paths and symlinks for reads, writes and recovery', async () => {
    const f = await fixture(); await f.write('target.md', document('Target')); await fs.symlink(path.join(f.bundle, 'target.md'), path.join(f.bundle, 'link.md'));
    await expect(run(f.store.read('repo', 'link.md'))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(run(f.store.save({ bundle: 'repo', path: '../outside.md', raw: '', expectedHash: null }))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await fs.symlink(os.tmpdir(), path.join(f.bundle, 'linked'));
    await expect(run(f.store.save({ bundle: 'repo', path: 'linked/new.md', raw: '', expectedHash: null }))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await fs.symlink(os.tmpdir(), path.join(f.bundle, '.irudd-okf'));
    await expect(run(f.store.save({ bundle: 'repo', path: 'new.md', raw: '', expectedHash: null }))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  });
  it('renames links and reference definitions without rewriting prose, code or metadata', async () => {
    const f = await fixture();
    await f.write('old.md', document('Old', '[other](other.md)')); await f.write('other.md', document('Other'));
    await f.write('from.md', '---\ntype: Rule\nproducer: "[metadata](old.md)"\n---\nPlain old.md\n[inline](old.md#part "title")\n[ref][a]\n[multiline][b]\n\n[a]: old.md "ref title"\n[b]:\n  old.md "multiline title"\n\n```md\n[code](old.md)\n```\n');
    const original = await run(f.store.read('repo', 'old.md'));
    const result = await run(f.store.rename({ bundle: 'repo', path: 'old.md', newPath: 'nested/new.md', expectedHash: original.hash, updateLinks: true }));
    expect(result.changedPaths).toEqual(['old.md', 'nested/new.md', 'from.md']);
    const from = await run(f.store.read('repo', 'from.md')); expect(from.raw).toContain('[inline](nested/new.md#part "title")'); expect(from.raw).toContain('[a]: nested/new.md "ref title"'); expect(from.raw).toContain('[b]:\n  nested/new.md "multiline title"');
    expect(from.raw).toContain('producer: "[metadata](old.md)"'); expect(from.raw).toContain('Plain old.md'); expect(from.raw).toContain('[code](old.md)');
    expect((await run(f.store.read('repo', 'nested/new.md'))).raw).toContain('[other](../other.md)');
  });
  it('updates accepted Markdown links while preserving incomplete link syntax', async () => {
    const f = await fixture(); await f.write('old.md', document('Old'));
    const body = '[valid](old.md "title")\n[plain](old.md "unterminated)\n[second](old.md#section)\n[unfinished](old.md';
    await f.write('from.md', document('From', body));
    expect((await run(f.store.read('repo', 'from.md'))).links).toHaveLength(2);
    const source = await run(f.store.read('repo', 'old.md'));
    await run(f.store.rename({ bundle: 'repo', path: 'old.md', newPath: 'new.md', expectedHash: source.hash, updateLinks: true }));
    const updated = await run(f.store.read('repo', 'from.md'));
    expect(updated.body).toBe('[valid](new.md "title")\n[plain](old.md "unterminated)\n[second](new.md#section)\n[unfinished](old.md');
    expect(updated.links.every(link => link.target === 'new.md')).toBe(true);
  });
  it('cleans partial staged writes and allows a rename retry', async () => {
    const f = await fixture(); await f.write('old.md', document('Old')); const source = await run(f.store.read('repo', 'old.md'));
    const open = fs.open; let injectFailure = true;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (injectFailure && String(file).startsWith(path.join(f.bundle, '.okf-')) && String(file).endsWith('.tmp')) {
        injectFailure = false; const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementationOnce(async data => {
          await write(String(data).slice(0, 5));
          throw Object.assign(new Error('Injected partial write failure'), { code: 'ENOSPC' });
        });
      }
      return handle;
    });
    await expect(run(f.store.rename({ bundle: 'repo', path: 'old.md', newPath: 'new.md', expectedHash: source.hash }))).rejects.toMatchObject({ code: 'IO_ERROR' });
    expect(await fs.readFile(path.join(f.bundle, 'old.md'), 'utf8')).toBe(source.raw);
    await expect(fs.stat(path.join(f.bundle, 'new.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(f.bundle)).some(file => file.endsWith('.tmp'))).toBe(false);
    await run(f.store.rename({ bundle: 'repo', path: 'old.md', newPath: 'new.md', expectedHash: source.hash }));
    expect(await fs.readFile(path.join(f.bundle, 'new.md'), 'utf8')).toBe(source.raw);
  });
  it('preserves an external destination created during exclusive rename publication', async () => {
    const f = await fixture(); await f.write('old.md', document('Old')); const source = await run(f.store.read('repo', 'old.md'));
    const link = fs.link; const destination = path.join(f.bundle, 'new.md'); const external = document('External writer');
    vi.spyOn(fs, 'link').mockImplementation(async (existing, target) => {
      if (String(target) === destination) await fs.writeFile(destination, external, { flag: 'wx' });
      return link(existing, target);
    });
    await expect(run(f.store.rename({ bundle: 'repo', path: 'old.md', newPath: 'new.md', expectedHash: source.hash }))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await fs.readFile(destination, 'utf8')).toBe(external); expect(await fs.readFile(path.join(f.bundle, 'old.md'), 'utf8')).toBe(source.raw);
    expect((await fs.readdir(f.bundle)).some(file => file.endsWith('.tmp'))).toBe(false);
  });
  it('rolls a failed rename back and preserves conflicting external changes', async () => {
    const f = await fixture(); await f.write('old.md', document('Old')); await f.write('from.md', document('From', '[old](old.md)'));
    const original = await run(f.store.read('repo', 'old.md')); const from = await run(f.store.read('repo', 'from.md'));
    const unlink = fs.unlink;
    let externalChange = false;
    vi.spyOn(fs, 'unlink').mockImplementation(async file => {
      if (String(file) === path.join(f.bundle, 'old.md')) {
        if (externalChange) await fs.writeFile(path.join(f.bundle, 'from.md'), document('External edit'));
        throw Object.assign(new Error('Injected delete failure'), { code: 'EIO' });
      }
      return unlink(file);
    });
    await expect(run(f.store.rename({ bundle: 'repo', path: 'old.md', newPath: 'new.md', expectedHash: original.hash, updateLinks: true }))).rejects.toMatchObject({ code: 'IO_ERROR' });
    expect(await fs.readFile(path.join(f.bundle, 'from.md'), 'utf8')).toBe(from.raw);
    expect(await fs.readFile(path.join(f.bundle, 'old.md'), 'utf8')).toBe(original.raw);
    await expect(fs.stat(path.join(f.bundle, 'new.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    externalChange = true;
    await expect(run(f.store.rename({ bundle: 'repo', path: 'old.md', newPath: 'new.md', expectedHash: original.hash, updateLinks: true }))).rejects.toMatchObject({ code: 'ROLLBACK_INCOMPLETE' });
    expect(await fs.readFile(path.join(f.bundle, 'from.md'), 'utf8')).toBe(document('External edit'));
    expect((await fs.readdir(path.join(f.bundle, '.irudd-okf', 'recovery'))).length).toBeGreaterThanOrEqual(4);
  });
  it('does not overwrite rename destinations and reports active write locks', async () => {
    const f = await fixture(); await f.write('old.md', document('Old')); await f.write('new.md', document('New')); const old = await run(f.store.read('repo', 'old.md'));
    await expect(run(f.store.rename({ bundle: 'repo', path: 'old.md', newPath: 'new.md', expectedHash: old.hash }))).rejects.toMatchObject({ code: 'CONFLICT' });
    await fs.mkdir(path.join(f.bundle, '.irudd-okf'), { recursive: true }); await fs.writeFile(path.join(f.bundle, '.irudd-okf', 'write.lock'), 'active');
    await expect(run(f.store.save({ bundle: 'repo', path: 'created.md', raw: document('Created'), expectedHash: null }))).rejects.toMatchObject({ code: 'LOCKED' });
  });
  it('rejects symlinked initialization parents before creating folders', async () => {
    const f = await fixture(); const outside = path.join(f.root, 'outside'); await fs.mkdir(outside);
    const link = path.join(f.root, 'link'); await fs.symlink(outside, link);
    await expect(run(initializeBundle(path.join(link, 'created')))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(fs.stat(path.join(outside, 'created'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('initializes exclusively and never alters existing files', async () => {
    const f = await fixture(); await run(initializeBundle(f.bundle)); const raw = await fs.readFile(path.join(f.bundle, 'index.md'), 'utf8');
    expect(raw).toContain('Read this index and the relevant topic index before writing');
    expect(raw).toContain('rather than\nlisting every note');
    expect((await run(f.store.validate())).errors).toBe(0);
    await expect(run(initializeBundle(f.bundle))).rejects.toMatchObject({ code: 'ALREADY_EXISTS' }); expect(await fs.readFile(path.join(f.bundle, 'index.md'), 'utf8')).toBe(raw);
  });
});

describe('optional navigation lint', () => {
  it('finds disconnected concepts but follows topic maps, related notes and replacement cycles', async () => {
    const f = await fixture();
    await f.write('index.md', '# Knowledge\n[topic](topic/)\n');
    await f.write('topic/index.md', '# Topic\n[current](current.md)\n');
    await f.write('topic/current.md', document('Current', '[old](old.md)\n'));
    await f.write('topic/old.md', document('Old', '[replacement](current.md)\n'));
    await f.write('forgotten.md', document('Forgotten'));
    expect((await run(f.store.validate())).diagnostics).toEqual([]);
    const lint = await run(f.store.validate({ lint: true }));
    expect(lint.diagnostics.filter(d => d.code === 'UNINDEXED_CONCEPT').map(d => d.path)).toEqual(['forgotten.md']);
    expect(lint.errors).toBe(0);
    const index = await run(f.store.read('repo', 'topic/index.md'));
    await run(f.store.save({ bundle: 'repo', path: index.path, raw: index.raw + '[forgotten](../forgotten.md)\n', expectedHash: index.hash }));
    expect((await run(f.store.validate({ lint: true }))).warnings).toBe(0);
  });

  it('keeps root indexes optional and treats external URLs as external', async () => {
    const f = await fixture(); await f.write('note.md', document('No index'));
    expect((await run(f.store.validate({ lint: true }))).warnings).toBe(0);
    await f.write('index.md', '# Guide\n[external](https://example.invalid/note.md)\n[missing](missing.md)\n');
    const lint = await run(f.store.validate({ lint: true }));
    expect(lint.diagnostics.map(d => d.code).sort()).toEqual(['BROKEN_LINK', 'UNINDEXED_CONCEPT']);
    expect(lint.errors).toBe(0);
  });

  it('keeps navigation inside each bundle', async () => {
    const f = await fixture(); await f.write('index.md', '# Repo\n[note](note.md)\n'); await f.write('note.md', document('Repo note'));
    const personal = path.join(f.root, 'personal'); await fs.mkdir(personal);
    await fs.writeFile(path.join(personal, 'index.md'), '# Personal\n'); await fs.writeFile(path.join(personal, 'note.md'), document('Personal note'));
    const store = createStore({ ...f.context, bundles: [...f.context.bundles, { name: 'personal', root: personal, kind: 'personal', writable: true }] });
    expect((await run(store.validate({ lint: true }))).diagnostics).toEqual([expect.objectContaining({ code: 'UNINDEXED_CONCEPT', bundle: 'personal', path: 'note.md' })]);
    expect((await run(store.validate({ bundle: 'repo', lint: true }))).warnings).toBe(0);
  });
});
