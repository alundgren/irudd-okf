import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { OkfError, type Operation, type Bundle } from './contracts.ts';

export const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
export const operation = <A>(run: () => Promise<A>): Operation<A> => Effect.tryPromise({ try: run, catch: error => error instanceof OkfError ? error : new OkfError('IO_ERROR', error instanceof Error ? error.message : String(error)) });
export const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export const within = (root: string, target: string) => target === root || target.startsWith(root + path.sep);
export function cleanPath(input: string): string {
  if (!input || input.includes('\0') || input.includes('\\') || path.isAbsolute(input) || input.split('/').includes('..')) throw new OkfError('UNSAFE_PATH', 'Use a relative path within the bundle.', { path: input });
  const normalized = path.posix.normalize(input);
  if (normalized === '.' || normalized.startsWith('../') || normalized.startsWith('.irudd-okf/') || normalized.startsWith('.git/')) throw new OkfError('UNSAFE_PATH', 'The path is reserved or outside the bundle.', { path: input });
  return normalized;
}
export async function guarded(bundle: Bundle, input: string, create = false): Promise<string> {
  const relative = cleanPath(input);
  const root = await fs.realpath(bundle.root);
  if (root !== path.resolve(bundle.root)) throw new OkfError('UNSAFE_PATH', 'Bundle roots must not be symbolic links.', { root: bundle.root });
  const parts = relative.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const info = await fs.lstat(current);
      if (info.isSymbolicLink()) throw new OkfError('UNSAFE_PATH', 'Symbolic links are not supported inside bundles.', { path: input });
      if (i < parts.length - 1 && !info.isDirectory()) throw new OkfError('UNSAFE_PATH', 'A parent path is not a directory.', { path: input });
    } catch (error) {
      if (!absent(error) || !create) throw error;
      // Each new parent is created separately so a concurrent link cannot redirect traversal.
      if (i < parts.length - 1) {
        await fs.mkdir(current).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
        const info = await fs.lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new OkfError('UNSAFE_PATH', 'Unsafe parent directory.', { path: input });
      }
    }
  }
  return current;
}
export async function scan(bundle: Bundle): Promise<Array<{ path: string; fingerprint: string }>> {
  const candidates: string[] = [];
  const root = await fs.realpath(bundle.root);
  if (root !== path.resolve(bundle.root)) throw new OkfError('UNSAFE_PATH', 'Bundle roots must not be symbolic links.');
  async function visit(directory: string, prefix: string) {
    if (prefix) await guarded(bundle, prefix.slice(0, -1));
    const entries = await fs.readdir(directory, { withFileTypes: true });
    await Promise.all(entries.map(async entry => {
      if (entry.name === '.irudd-okf' || entry.name === '.git' || entry.isSymbolicLink()) return;
      const relative = prefix + entry.name;
      if (entry.isDirectory()) return visit(path.join(directory, entry.name), relative + '/');
      if (entry.isFile() && entry.name.endsWith('.md')) candidates.push(relative);
    }));
  }
  await visit(root, '');
  candidates.sort();
  const result: Array<{ path: string; fingerprint: string }> = new Array(candidates.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(32, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const index = cursor++;
      const relative = candidates[index];
      const info = await fs.lstat(path.join(root, relative), { bigint: true });
      if (!info.isFile() || info.isSymbolicLink()) throw new OkfError('CONFLICT', 'A file changed while the bundle was scanned.', { path: relative });
      result[index] = { path: relative, fingerprint: `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}` };
    }
  }));
  return result;
}
export async function withLock<A>(root: string, run: () => Promise<A>): Promise<A> {
  const folder = path.join(root, '.irudd-okf');
  await fs.mkdir(folder, { recursive: true });
  if ((await fs.lstat(folder)).isSymbolicLink()) throw new OkfError('UNSAFE_PATH', 'Recovery directory must not be a symbolic link.');
  const lock = path.join(folder, 'write.lock');
  let handle;
  try { handle = await fs.open(lock, 'wx', 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new OkfError('LOCKED', 'Another write is active. Inspect .irudd-okf/write.lock if a process stopped unexpectedly.'); throw error; }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); return await run(); }
  finally { await handle.close(); await fs.unlink(lock); }
}
export async function recovery(root: string, raw: string): Promise<string> {
  const directory = path.join(root, '.irudd-okf', 'recovery');
  await fs.mkdir(directory, { recursive: true });
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new OkfError('UNSAFE_PATH', 'Recovery directory must not be a symbolic link.');
  const file = path.join(directory, `${Date.now()}-${randomUUID()}.md`);
  await fs.writeFile(file, raw, { flag: 'wx', mode: 0o600 });
  return file;
}
export async function atomicReplace(file: string, raw: string): Promise<void> {
  const temporary = path.join(path.dirname(file), `.okf-${randomUUID()}.tmp`);
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.unlink(temporary).catch(error => { if (!absent(error)) throw error; }); }
}
export async function atomicCreate(file: string, raw: string): Promise<void> {
  const temporary = path.join(path.dirname(file), `.okf-${randomUUID()}.tmp`);
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
    // A hard link publishes complete bytes and fails if another writer already owns the destination.
    await fs.link(temporary, file);
  } finally { await fs.unlink(temporary).catch(error => { if (!absent(error)) throw error; }); }
}

export async function readRaw(bundle: Bundle, relative: string): Promise<string> {
  const file = path.join(bundle.root, cleanPath(relative));
  if (await fs.realpath(file) !== file) throw new OkfError('UNSAFE_PATH', 'Symbolic links are not supported inside bundles.', { path: relative });
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return await handle.readFile('utf8'); } finally { await handle.close(); }
}

export async function ensureDirectory(absolute: string): Promise<void> {
  const parsed = path.parse(path.resolve(absolute));
  let current = parsed.root;
  for (const component of path.resolve(absolute).slice(parsed.root.length).split(path.sep)) {
    if (!component) continue;
    current = path.join(current, component);
    await fs.mkdir(current).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new OkfError('UNSAFE_PATH', 'Bundle directory parents must not be symbolic links.', { path: absolute });
  }
}
