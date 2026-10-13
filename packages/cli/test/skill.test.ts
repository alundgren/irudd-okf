import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import * as fs from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import { installSkill, skillNames } from '../src/skill.ts';

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));
const directories: string[] = [];
const run = Effect.runPromise;
const directoryLink = (target: string, destination: string) => fs.symlink(target, destination, process.platform === 'win32' ? 'junction' : 'dir');
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
      if (file.includes(`${sep}skills${sep}${name}${sep}`)) return file.endsWith('SKILL.md') ? `name: ${name}\n` : 'Workflow reference.\n';
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
    await directoryLink(destination, join(root, 'okf'));
    await expect(run(installSkill(root))).rejects.toMatchObject({ code: 'SKILL_INSTALL_FAILED' });
    await directoryLink(destination, join(root, 'linked-parent'));
    await expect(run(installSkill(join(root, 'linked-parent', 'nested')))).rejects.toMatchObject({ code: 'SKILL_INSTALL_FAILED' });
    expect(await fs.readdir(destination)).toEqual(['keep.md']);
  });

  it('removes only its new destination if writing a referenced file fails', async () => {
    const root = await fixture();
    const original = fs.writeFile;
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      if (String(args[0]).endsWith(join('references', 'usage.md'))) throw new Error('Disk unavailable.');
      return original(...args);
    });
    await expect(run(installSkill(root))).rejects.toMatchObject({ code: 'SKILL_INSTALL_FAILED' });
    expect(await fs.readdir(root)).toEqual([]);
    vi.restoreAllMocks();
    expect((await run(installSkill(root))).files).toHaveLength(2);
  });

  it('rejects a swapped destination without writing into or removing the foreign directory', async () => {
    const root = await fixture();
    const foreign = join(root, 'foreign'); await fs.mkdir(foreign); await fs.writeFile(join(foreign, 'keep.md'), 'Foreign content.');
    const target = join(root, 'okf');
    const original = fs.mkdir;
    vi.spyOn(fs, 'mkdir').mockImplementation(async (...args: Parameters<typeof fs.mkdir>) => {
      const result = await original(...args);
      if (String(args[0]) === target) { await fs.rename(target, join(root, 'displaced')); await directoryLink(foreign, target); }
      return result;
    });
    await expect(run(installSkill(root))).rejects.toMatchObject({ code: 'SKILL_INSTALL_FAILED' });
    expect(await fs.readdir(foreign)).toEqual(['keep.md']);
    expect(await fs.readFile(join(foreign, 'keep.md'), 'utf8')).toBe('Foreign content.');
    expect((await fs.lstat(target)).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(join(root, 'displaced'))).isDirectory()).toBe(true);
  });

  it('detects a staging-directory swap before creating skill files and preserves foreign content', async () => {
    const root = await fixture();
    const foreign = join(root, 'foreign'); await fs.mkdir(foreign); await fs.writeFile(join(foreign, 'keep.md'), 'Foreign content.');
    const original = fs.mkdir;
    vi.spyOn(fs, 'mkdir').mockImplementation(async (...args: Parameters<typeof fs.mkdir>) => {
      const path = String(args[0]);
      if (basename(path) === 'references' && basename(dirname(path)).startsWith('.okf-skill-install-')) {
        await fs.rename(dirname(path), join(root, 'displaced'));
        await directoryLink(foreign, dirname(path));
      }
      return original(...args);
    });
    await expect(run(installSkill(root))).rejects.toMatchObject({ code: 'SKILL_INSTALL_FAILED' });
    expect(await fs.readFile(join(foreign, 'keep.md'), 'utf8')).toBe('Foreign content.');
    expect(await fs.readdir(join(foreign, 'references'))).toEqual([]);
    await expect(fs.lstat(join(foreign, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(join(root, 'okf'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves a foreign file added to staging and refuses to publish it', async () => {
    const root = await fixture();
    const original = fs.writeFile;
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      if (String(args[0]).endsWith(join('references', 'usage.md'))) {
        await original(join(dirname(dirname(String(args[0]))), 'foreign.md'), 'Foreign content.');
      }
      return original(...args);
    });
    await expect(run(installSkill(root))).rejects.toMatchObject({ code: 'SKILL_INSTALL_FAILED' });
    const entries = await fs.readdir(root);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^\.okf-skill-install-/);
    expect(await fs.readdir(join(root, entries[0]))).toEqual(['foreign.md']);
    expect(await fs.readFile(join(root, entries[0], 'foreign.md'), 'utf8')).toBe('Foreign content.');
  });

  it('rejects changes during publication and preserves edited bytes during rollback', async () => {
    const root = await fixture();
    const original = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementation(async (...args: Parameters<typeof fs.rename>) => {
      if (String(args[0]).includes('.okf-skill-install-') && String(args[1]) === join(root, 'okf')) await fs.writeFile(join(String(args[0]), 'SKILL.md'), 'Foreign edited skill.');
      return original(...args);
    });
    await expect(run(installSkill(root))).rejects.toMatchObject({ code: 'SKILL_INSTALL_FAILED' });
    expect(await fs.readdir(join(root, 'okf'))).toEqual(['SKILL.md']);
    expect(await fs.readFile(join(root, 'okf', 'SKILL.md'), 'utf8')).toBe('Foreign edited skill.');
  });
});
