import { Effect } from 'effect';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { OkfError, type Operation } from '../../core/src/contracts.ts';

export const installSkill = (directory: string): Operation<{ directory: string; files: string[] }> => Effect.tryPromise({
  try: async () => {
    const target = resolve(directory, 'okf');
    const files = ['SKILL.md', 'references/usage.md'];
    // Exclusive creation protects a skill the operator has already customized.
    const sources = await Promise.all(files.map(file => isSea() ? getAsset(`skill/${file}`, 'utf8') : readFile(resolve('skills/okf', file), 'utf8')));
    await mkdir(resolve(target, 'references'), { recursive: true });
    const created: string[] = [];
    for (let i = 0; i < files.length; i++) {
      await writeFile(resolve(target, files[i]), sources[i], { flag: 'wx' });
      created.push(files[i]);
    }
    return { directory: target, files: created };
  },
  catch: error => new OkfError('SKILL_INSTALL_FAILED', 'Could not install the skill. Existing files were preserved.', { cause: String(error) }),
});
