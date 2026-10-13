import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import { installSkill, skillNames } from '../src/skill.ts';

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));
const directories: string[] = [];
const run = Effect.runPromise;
const fixture = async () => {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'okf-skill-')));
  directories.push(root);
  return root;
};
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

describe('portable skill installation', () => {
  it('keeps the original default and refuses to change an existing customized skill', async () => {
    const root = await fixture();
    const result = await run(installSkill(root));
    expect(result.files).toEqual(['SKILL.md', 'references/usage.md']);
    expect(await fs.readFile(join(result.directory, 'SKILL.md'), 'utf8')).toContain('name: okf');
    await fs.writeFile(join(result.directory, 'SKILL.md'), 'Customized retrieval procedure.');
    const reference = await fs.readFile(join(result.directory, 'references/usage.md'), 'utf8');
    await expect(run(installSkill(root))).rejects.toMatchObject({ code: 'SKILL_INSTALL_FAILED' });
    expect(await fs.readFile(join(result.directory, 'SKILL.md'), 'utf8')).toBe('Customized retrieval procedure.');
    expect(await fs.readFile(join(result.directory, 'references/usage.md'), 'utf8')).toBe(reference);
  });

  it.each(skillNames)('installs %s with its own referenced workflow', async name => {
    const root = await fixture();
    const original = fs.readFile;
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
      const file = String(args[0]);
      if (file.includes(`/skills/${name}/`)) return file.endsWith('SKILL.md') ? `name: ${name}\n` : 'Workflow reference.\n';
      return original(...args);
    });
    const result = await run(installSkill(root, name));
    expect(result.directory).toBe(join(root, name));
    expect(result.files).toContain(name === 'okf' ? 'references/usage.md' : 'references/workflow.md');
    expect(await fs.readFile(join(result.directory, 'SKILL.md'), 'utf8')).toContain(`name: ${name}`);
  });

  it('rejects symbolic link destinations and parents without touching their files', async () => {
    const root = await fixture();
    const destination = join(root, 'existing');
    await fs.mkdir(destination);
    await fs.writeFile(join(destination, 'keep.md'), 'Keep.');
    await fs.symlink(destination, join(root, 'okf'));
    await expect(run(installSkill(root))).rejects.toMatchObject({ code: 'SKILL_INSTALL_FAILED' });
    await fs.symlink(destination, join(root, 'linked-parent'));
    await expect(run(installSkill(join(root, 'linked-parent', 'nested')))).rejects.toMatchObject({ code: 'SKILL_INSTALL_FAILED' });
    expect(await fs.readdir(destination)).toEqual(['keep.md']);
  });

  it('removes only its new destination if writing a referenced file fails', async () => {
    const root = await fixture();
    const original = fs.writeFile;
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      if (String(args[0]).endsWith('references/usage.md')) throw new Error('Disk unavailable.');
      return original(...args);
    });
    await expect(run(installSkill(root))).rejects.toMatchObject({ code: 'SKILL_INSTALL_FAILED' });
    expect(await fs.readdir(root)).toEqual([]);
    vi.restoreAllMocks();
    expect((await run(installSkill(root))).files).toHaveLength(2);
  });
});
