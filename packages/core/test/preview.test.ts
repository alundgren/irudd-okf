import { afterEach, describe, expect, it } from 'vite-plus/test';
import { Effect } from 'effect';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createStore } from '../src/index.ts';
import { resolveLinkTarget } from '../src/links.ts';
let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
describe('shared link resolution and exact rename preview', () => {
  it('resolves directory, fragment, query and encoded punctuation without Node APIs', () => {
    expect(resolveLinkTarget('one.md', 'nested/')).toMatchObject({ target: 'nested/index.md', unsafe: false });
    expect(resolveLinkTarget('nested/one.md', '../target.md?view=1#part')).toMatchObject({ target: 'target.md', fragment: 'part', unsafe: false });
    expect(resolveLinkTarget('one.md', 'a%23b%3Fc.md')).toMatchObject({ target: 'a#b?c.md' });
    expect(resolveLinkTarget('one.md', '../../outside.md').unsafe).toBe(true);
  });
  it('previews every affected raw file and rejects a backlink changed after preview', async () => {
    directory = await realpath(await mkdtemp(resolve(tmpdir(), 'okf-rename-preview-')));
    const root = resolve(directory, '.okf'); await mkdir(root);
    const source = '---\ntype: Rule\n---\n[Ref](ref.md)\n';
    const ref = '---\ntype: Decision\n---\n[Rule](old.md)\n';
    await writeFile(resolve(root, 'old.md'), source); await writeFile(resolve(root, 'ref.md'), ref);
    const store = createStore({ version: 1, cwd: directory, gitRoot: null, configPath: '', bundles: [{ name: 'repo', root, kind: 'repository', writable: true }] });
    const concept = await Effect.runPromise(store.read('repo', 'old.md'));
    const request = { bundle: 'repo', path: 'old.md', newPath: 'nested/new.md', expectedHash: concept.hash, updateLinks: true };
    const preview = await Effect.runPromise(store.previewRename(request));
    expect(preview.changes.map(change => change.path)).toEqual(['old.md', 'nested/new.md', 'ref.md']);
    expect(preview.changes[1].after).toContain('../ref.md');
    expect(preview.changes[2].after).toContain('nested/new.md');
    await expect(readFile(resolve(root, 'nested/new.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(resolve(root, 'ref.md'), `${ref}\nExternal edit.\n`);
    await expect(Effect.runPromise(store.rename({ ...request, previewHash: preview.previewHash }))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(resolve(root, 'old.md'), 'utf8')).toBe(source);
    const fresh = await Effect.runPromise(store.previewRename(request));
    await Effect.runPromise(store.rename({ ...request, previewHash: fresh.previewHash }));
    expect(await readFile(resolve(root, 'nested/new.md'), 'utf8')).toBe(fresh.changes[1].after);
    expect(await readFile(resolve(root, 'ref.md'), 'utf8')).toBe(fresh.changes[2].after);
  });
});
