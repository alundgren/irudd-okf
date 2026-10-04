import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Effect } from 'effect';
import { normalizeSystemPath, canonicalDirectory, ensureDirectory } from '../src/files.ts';
import { createStore, initializeBundle, resolveContext, registerBundle } from '../src/index.ts';

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));
const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function systemAliases() {
  const lstat = fs.lstat;
  const readlink = fs.readlink;
  const directory = await lstat('/');
  const settings = { aliasOwner: 0, privateOwner: 0, privateMode: 0o755, targetOwner: 0, targetLink: false, destination: '' };
  vi.spyOn(fs, 'lstat').mockImplementation(async input => {
    const name = String(input);
    if (['/var', '/tmp', '/etc'].includes(name)) return { ...directory, uid: settings.aliasOwner, isDirectory: () => false, isSymbolicLink: () => true };
    if (name === '/private') return { ...directory, uid: settings.privateOwner, mode: settings.privateMode, isDirectory: () => true, isSymbolicLink: () => false };
    if (['/private/var', '/private/tmp', '/private/etc'].includes(name)) return { ...directory, uid: settings.targetOwner, mode: name === '/private/tmp' ? 0o1777 : 0o755, isDirectory: () => !settings.targetLink, isSymbolicLink: () => settings.targetLink };
    return lstat(input);
  });
  vi.spyOn(fs, 'readlink').mockImplementation(async input => ['/var', '/tmp', '/etc'].includes(String(input)) ? settings.destination || `private${String(input)}` : readlink(input));
  return settings;
}
describe('platform directory aliases', () => {
  it('normalizes only verified Darwin root aliases and accepts the standard writable temporary directory', async () => {
    await systemAliases();
    for (const name of ['var', 'tmp', 'etc']) expect(await normalizeSystemPath(`/${name}/folders/work/.okf`, 'darwin')).toBe(`/private/${name}/folders/work/.okf`);
    expect(await normalizeSystemPath('/var/folders/work', 'linux')).toBe('/var/folders/work');
    expect(await normalizeSystemPath('/various/work', 'darwin')).toBe('/various/work');
    expect(await normalizeSystemPath('/home/user/tmp/work', 'darwin')).toBe('/home/user/tmp/work');
  });
  it('rejects user ownership, changed alias targets, writable private parents and target symlinks', async () => {
    const settings = await systemAliases();
    settings.aliasOwner = 501;
    await expect(normalizeSystemPath('/var/folders/work', 'darwin')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    settings.aliasOwner = 0; settings.destination = '/Users/user/private/var';
    await expect(normalizeSystemPath('/var/folders/work', 'darwin')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    settings.destination = ''; settings.privateMode = 0o777;
    await expect(normalizeSystemPath('/var/folders/work', 'darwin')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    settings.privateMode = 0o755; settings.privateOwner = 501;
    await expect(normalizeSystemPath('/var/folders/work', 'darwin')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    settings.privateOwner = 0; settings.targetOwner = 501;
    await expect(normalizeSystemPath('/var/folders/work', 'darwin')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    settings.targetOwner = 0; settings.targetLink = true;
    await expect(normalizeSystemPath('/var/folders/work', 'darwin')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  });
  it('keeps actual user-created roots and parent symlinks blocked', async () => {
    const lexicalRoot = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'okf-platform-'));
    const root = await fs.realpath(lexicalRoot); directories.push(root);
    const actual = path.join(root, 'actual'); await fs.mkdir(actual); await fs.symlink(actual, path.join(root, 'link'));
    await expect(canonicalDirectory(path.join(lexicalRoot, 'link'))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(ensureDirectory(path.join(lexicalRoot, 'link', 'new'))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(fs.stat(path.join(actual, 'new'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(Effect.runPromise(resolveContext({ cwd: lexicalRoot, explicitBundles: [{ name: 'user', root: path.join(lexicalRoot, 'link') }] }))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  });
  it('uses the home configuration directory for unset, empty or relative XDG_CONFIG_HOME values', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'okf-xdg-path-'))); directories.push(root);
    const fallback = path.join(os.homedir(), '.config', 'irudd-okf', 'config.json');
    for (const value of [undefined, '', 'relative/config', '~/config']) {
      vi.stubEnv('XDG_CONFIG_HOME', value);
      const context = await Effect.runPromise(resolveContext({ cwd: root, explicitBundles: [] }));
      expect(context.configPath).toBe(fallback);
    }
    const absolute = path.join(root, 'configured'); vi.stubEnv('XDG_CONFIG_HOME', absolute);
    expect((await Effect.runPromise(resolveContext({ cwd: root, explicitBundles: [] }))).configPath).toBe(path.join(absolute, 'irudd-okf', 'config.json'));
  });
  it('uses XDG_CONFIG_HOME for explicitly activated personal registration outside the working directory', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'okf-xdg-'))); directories.push(root);
    const cwd = path.join(root, 'working'); await fs.mkdir(cwd);
    const personal = path.join(root, 'personal', '.okf'); await Effect.runPromise(initializeBundle(personal));
    const configHome = path.join(root, 'xdg-config'); vi.stubEnv('XDG_CONFIG_HOME', configHome);
    await Effect.runPromise(registerBundle('me', personal, { activate: true }));
    const context = await Effect.runPromise(resolveContext({ cwd }));
    expect(context.configPath).toBe(path.join(configHome, 'irudd-okf', 'config.json'));
    expect(context.bundles).toEqual([{ name: 'me', root: personal, kind: 'personal', writable: true }]);
    expect(JSON.parse(await fs.readFile(context.configPath, 'utf8')).active).toEqual(['me']);
  });
  it('initializes, mounts, reads and writes through the actual platform temporary directory', async () => {
    const lexicalRoot = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'okf-platform-'));
    const root = await fs.realpath(lexicalRoot); directories.push(root);
    const requested = path.join(lexicalRoot, '.okf');
    expect((await Effect.runPromise(initializeBundle(requested))).root).toBe(path.join(root, '.okf'));
    const context = await Effect.runPromise(resolveContext({ cwd: lexicalRoot, explicitBundles: [{ name: 'temp', root: requested }] }));
    expect(context.bundles[0].root).toBe(path.join(root, '.okf'));
    const store = createStore(context);
    await Effect.runPromise(store.save({ bundle: 'temp', path: 'rule.md', raw: '---\ntype: Rule\n---\nPlatform paths\n', expectedHash: null }));
    expect((await Effect.runPromise(store.read('temp', 'rule.md'))).body).toContain('Platform paths');
    expect((await Effect.runPromise(store.search('platform'))).results[0].path).toBe('rule.md');
    const direct = createStore({ ...context, bundles: [{ ...context.bundles[0], root: requested }] });
    const concept = await Effect.runPromise(direct.read('temp', 'rule.md'));
    await Effect.runPromise(direct.save({ bundle: 'temp', path: 'rule.md', raw: concept.raw + 'Direct context edit.\n', expectedHash: concept.hash }));
    expect((await Effect.runPromise(direct.search('direct'))).results[0].path).toBe('rule.md');
  });
});
