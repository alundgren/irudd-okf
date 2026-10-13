import { Effect } from 'effect';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { resolve } from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { OkfError, type Operation } from '../../core/src/contracts.ts';
import { canonicalDirectory, ensureDirectory, normalizeSystemPath } from '../../core/src/files.ts';

export const skillNames = ['okf', 'okf-librarian', 'okf-memory-reviewer'] as const;
export type SkillName = typeof skillNames[number];
const filesFor = (name: SkillName) => ['SKILL.md', name === 'okf' ? 'references/usage.md' : 'references/workflow.md'];
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
async function requireContents(directory: string, information: Stats, references: Stats, files: CreatedFile[]) {
  await requireDirectory(directory, information);
  await requireDirectory(resolve(directory, 'references'), references);
  const expectedReferences = files.filter(item => item.file.startsWith('references/')).map(item => item.file.slice('references/'.length)).sort();
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(['SKILL.md', 'references']) || JSON.stringify((await readdir(resolve(directory, 'references'))).sort()) !== JSON.stringify(expectedReferences)) throw new OkfError('UNSAFE_PATH', 'Unexpected content appeared in the skill installation directory.');
  for (const item of files) {
    if (!await owned(resolve(directory, item.file), item.information) || await readFile(resolve(directory, item.file), 'utf8') !== item.raw) throw new OkfError('UNSAFE_PATH', 'A skill file changed during installation.');
  }
}

async function cleanup(directory: string, information: Stats, references: Stats | undefined, files: CreatedFile[]) {
  // Remove only unchanged files we created; unexpected content remains for inspection.
  if (!await owned(directory, information)) return;
  await canonicalDirectory(directory).catch(() => { throw new OkfError('UNSAFE_PATH', 'Skill installation cleanup cannot follow directory replacements.'); });
  for (const item of files) {
    await requireDirectory(directory, information);
    if (item.file.startsWith('references/') && (!references || !await owned(resolve(directory, 'references'), references))) continue;
    const file = resolve(directory, item.file);
    if (!await owned(file, item.information) || await readFile(file, 'utf8').catch(() => null) !== item.raw) continue;
    await requireDirectory(directory, information);
    if (item.file.startsWith('references/')) await requireDirectory(resolve(directory, 'references'), references!);
    if (await owned(file, item.information)) await unlink(file).catch(() => {});
  }
  if (references && await owned(directory, information) && await owned(resolve(directory, 'references'), references)) await rmdir(resolve(directory, 'references')).catch(() => {});
  if (await owned(directory, information)) await rmdir(directory).catch(() => {});
}

export const installSkill = (directory: string, name: SkillName = 'okf'): Operation<{ directory: string; files: string[] }> => Effect.tryPromise({
  try: async () => {
    if (!skillNames.includes(name)) throw new OkfError('INVALID_INPUT', 'Select okf, okf-librarian or okf-memory-reviewer.');
    const parent = await normalizeSystemPath(resolve(directory));
    const target = resolve(parent, name);
    const files = filesFor(name);
    const asset = name === 'okf' ? 'skill' : `skills/${name}`;
    const sources = await Promise.all(files.map(file => isSea() ? getAsset(`${asset}/${file}`, 'utf8') : readFile(resolve(`skills/${name}`, file), 'utf8')));
    await ensureDirectory(parent);
    await canonicalDirectory(parent);
    const parentInformation = await lstat(parent);
    const staging = await mkdtemp(resolve(parent, '.okf-skill-install-'));
    const stagingInformation = await lstat(staging);
    let references: Stats | undefined;
    let reservation: Stats | undefined;
    let published = false;
    let completed = false;
    const created: CreatedFile[] = [];
    try {
      await requireDirectory(parent, parentInformation);
      await requireDirectory(staging, stagingInformation);
      await mkdir(resolve(staging, 'references'), { mode: 0o700 });
      await requireDirectory(staging, stagingInformation);
      references = await lstat(resolve(staging, 'references'));
      await requireDirectory(resolve(staging, 'references'), references);
      for (let i = 0; i < files.length; i++) {
        await requireDirectory(staging, stagingInformation);
        await requireDirectory(resolve(staging, 'references'), references);
        await writeFile(resolve(staging, files[i]), sources[i], { flag: 'wx', mode: 0o600 });
        await requireDirectory(staging, stagingInformation);
        await requireDirectory(resolve(staging, 'references'), references);
        created.push({ file: files[i], information: await lstat(resolve(staging, files[i])), raw: sources[i] });
      }
      await requireContents(staging, stagingInformation, references, created);
      await requireDirectory(parent, parentInformation);
      // Reserve an empty destination exclusively; all nested writes stay in private staging.
      await mkdir(target, { mode: 0o700 });
      reservation = await lstat(target);
      await requireDirectory(target, reservation);
      await requireContents(staging, stagingInformation, references, created);
      await requireDirectory(parent, parentInformation);
      await requireDirectory(target, reservation);
      if (process.platform === 'win32') await rmdir(target);
      await rename(staging, target);
      published = true;
      await requireContents(target, stagingInformation, references, created);
      completed = true;
      return { directory: target, files };
    } finally {
      if (await owned(parent, parentInformation)) {
        await cleanup(staging, stagingInformation, references, created);
        if (published && !completed) await cleanup(target, stagingInformation, references, created);
        if (!published && reservation && await owned(target, reservation)) await rmdir(target).catch(() => {});
      }
    }
  },
  catch: error => new OkfError('SKILL_INSTALL_FAILED', 'Could not install the skill. Existing files were preserved.', { cause: String(error) }),
});
