import { Effect } from 'effect';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { resolve } from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { OkfError, type Operation } from '../../core/src/contracts.ts';
import { canonicalDirectory, ensureDirectory, normalizeSystemPath } from '../../core/src/files.ts';
import { skillAsset, skillFiles, skillNames, type SkillName } from './skill-files.ts';

export { skillNames, type SkillName };
// Skill files sit at the top level or in one subdirectory, such as references/ or agents/.
const folderOf = (file: string) => file.includes('/') ? file.slice(0, file.indexOf('/')) : null;
const foldersFor = (files: readonly string[]) => [...new Set(files.flatMap(file => folderOf(file) ?? []))].sort();
const sameFile = (current: Stats, observed: Stats) => current.dev === observed.dev && current.ino === observed.ino && !current.isSymbolicLink();
const owned = async (path: string, observed: Stats) => {
  const current = await lstat(path).catch(() => undefined);
  return current !== undefined && sameFile(current, observed);
};
const requireDirectory = async (path: string, observed: Stats) => {
  if (!await owned(path, observed)) throw new OkfError('UNSAFE_PATH', 'A skill installation directory was replaced.');
  await canonicalDirectory(path);
};
interface CreatedFile { file: string; information: Stats; raw: string }
const listing = (values: string[]) => JSON.stringify([...values].sort());
async function requireContents(directory: string, information: Stats, folders: Map<string, Stats>, files: CreatedFile[]) {
  await requireDirectory(directory, information);
  for (const [folder, observed] of folders) await requireDirectory(resolve(directory, folder), observed);
  if (await readdir(directory).then(listing) !== listing([...files.filter(item => !folderOf(item.file)).map(item => item.file), ...folders.keys()])) throw new OkfError('UNSAFE_PATH', 'Unexpected content appeared in the skill installation directory.');
  for (const folder of folders.keys()) if (await readdir(resolve(directory, folder)).then(listing) !== listing(files.filter(item => folderOf(item.file) === folder).map(item => item.file.slice(folder.length + 1)))) throw new OkfError('UNSAFE_PATH', 'Unexpected content appeared in the skill installation directory.');
  for (const item of files) {
    if (!await owned(resolve(directory, item.file), item.information) || await readFile(resolve(directory, item.file), 'utf8') !== item.raw) throw new OkfError('UNSAFE_PATH', 'A skill file changed during installation.');
  }
}

async function cleanup(directory: string, information: Stats, folders: Map<string, Stats>, files: CreatedFile[]) {
  // Remove only unchanged files we created; unexpected content remains for inspection.
  if (!await owned(directory, information)) return;
  await canonicalDirectory(directory).catch(() => { throw new OkfError('UNSAFE_PATH', 'Skill installation cleanup cannot follow directory replacements.'); });
  for (const item of files) {
    await requireDirectory(directory, information);
    const folder = folderOf(item.file), folderInformation = folder ? folders.get(folder) : undefined;
    if (folder && (!folderInformation || !await owned(resolve(directory, folder), folderInformation))) continue;
    const file = resolve(directory, item.file);
    if (!await owned(file, item.information) || await readFile(file, 'utf8').catch(() => null) !== item.raw) continue;
    await requireDirectory(directory, information);
    if (folder) await requireDirectory(resolve(directory, folder), folderInformation!);
    if (await owned(file, item.information)) await unlink(file).catch(() => {});
  }
  for (const [folder, observed] of folders) if (await owned(directory, information) && await owned(resolve(directory, folder), observed)) await rmdir(resolve(directory, folder)).catch(() => {});
  if (await owned(directory, information)) await rmdir(directory).catch(() => {});
}

export const installSkill = (directory: string, name: SkillName = 'okf'): Operation<{ directory: string; files: string[] }> => Effect.tryPromise({
  try: async () => {
    if (!skillNames.includes(name)) throw new OkfError('INVALID_INPUT', `Select one of ${skillNames.join(', ')}.`);
    const parent = await normalizeSystemPath(resolve(directory));
    const target = resolve(parent, name);
    const files = [...skillFiles[name]], folderNames = foldersFor(files);
    const sources = await Promise.all(files.map(file => isSea() ? getAsset(skillAsset(name, file), 'utf8') : readFile(resolve(`skills/${name}`, file), 'utf8')));
    await ensureDirectory(parent);
    await canonicalDirectory(parent);
    const parentInformation = await lstat(parent);
    const staging = await mkdtemp(resolve(parent, '.okf-skill-install-'));
    const stagingInformation = await lstat(staging);
    const folders = new Map<string, Stats>();
    let reservation: Stats | undefined;
    let published = false;
    let completed = false;
    const created: CreatedFile[] = [];
    const requireStaging = async (folder: string | null) => { await requireDirectory(staging, stagingInformation); if (folder) await requireDirectory(resolve(staging, folder), folders.get(folder)!); };
    try {
      await requireDirectory(parent, parentInformation);
      await requireDirectory(staging, stagingInformation);
      for (const folder of folderNames) {
        await mkdir(resolve(staging, folder), { mode: 0o700 });
        await requireDirectory(staging, stagingInformation);
        folders.set(folder, await lstat(resolve(staging, folder)));
        await requireDirectory(resolve(staging, folder), folders.get(folder)!);
      }
      for (let i = 0; i < files.length; i++) {
        const folder = folderOf(files[i]);
        await requireStaging(folder);
        await writeFile(resolve(staging, files[i]), sources[i], { flag: 'wx', mode: 0o600 });
        await requireStaging(folder);
        created.push({ file: files[i], information: await lstat(resolve(staging, files[i])), raw: sources[i] });
      }
      await requireContents(staging, stagingInformation, folders, created);
      await requireDirectory(parent, parentInformation);
      // Reserve an empty destination exclusively; all nested writes stay in private staging.
      await mkdir(target, { mode: 0o700 });
      reservation = await lstat(target);
      await requireDirectory(target, reservation);
      await requireContents(staging, stagingInformation, folders, created);
      await requireDirectory(parent, parentInformation);
      await requireDirectory(target, reservation);
      if (process.platform === 'win32') await rmdir(target);
      await rename(staging, target);
      published = true;
      await requireContents(target, stagingInformation, folders, created);
      completed = true;
      return { directory: target, files };
    } finally {
      if (await owned(parent, parentInformation)) {
        await cleanup(staging, stagingInformation, folders, created);
        if (published && !completed) await cleanup(target, stagingInformation, folders, created);
        if (!published && reservation && await owned(target, reservation)) await rmdir(target).catch(() => {});
      }
    }
  },
  catch: error => new OkfError('SKILL_INSTALL_FAILED', 'Could not install the skill. Existing files were preserved.', { cause: String(error) }),
});
