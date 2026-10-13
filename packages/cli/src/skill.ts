import { Effect } from 'effect';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { OkfError, type Operation } from '../../core/src/contracts.ts';
import { canonicalDirectory, ensureDirectory, normalizeSystemPath } from '../../core/src/files.ts';

export const skillNames = ['okf', 'okf-librarian', 'okf-memory-reviewer'] as const;
export type SkillName = typeof skillNames[number];
const filesFor = (name: SkillName) => ['SKILL.md', name === 'okf' ? 'references/usage.md' : 'references/workflow.md'];

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
    // Owning a new directory prevents a failed install from changing an existing skill.
    await mkdir(target);
    try {
      await mkdir(resolve(target, 'references'));
      for (let i = 0; i < files.length; i++) await writeFile(resolve(target, files[i]), sources[i], { flag: 'wx' });
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      throw error;
    }
    return { directory: target, files };
  },
  catch: error => new OkfError('SKILL_INSTALL_FAILED', 'Could not install the skill. Existing files were preserved.', { cause: String(error) }),
});
