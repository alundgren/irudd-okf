import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import * as fs from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import { installSkill, skillNames } from '../src/skill.ts';
import { skillAssets, skillFiles } from '../src/skill-files.ts';
import { parse } from 'yaml';

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
      if (file.includes(`${sep}skills${sep}${name}${sep}`)) return file.endsWith('SKILL.md') ? `name: ${name}\n` : `Supporting file ${basename(file)}.\n`;
      return original(...args);
    });
    const result = await run(installSkill(root, name));
    expect(result.directory).toBe(join(root, name));
    expect(result.files).toEqual([...skillFiles[name]]);
    for (const file of skillFiles[name].slice(1)) expect(await fs.readFile(join(result.directory, file), 'utf8')).toBe(`Supporting file ${basename(file)}.\n`);
    expect(await fs.readFile(join(result.directory, 'SKILL.md'), 'utf8')).toContain(`name: ${name}`);
  });

  it('installs all five bundled skills side by side with their exact files and manual-only bot metadata', async () => {
    const root = await fixture();
    expect(skillNames).toEqual(['okf', 'okf-librarian', 'okf-memory-reviewer', 'bot-creator', 'bot']);
    for (const name of skillNames) {
      const result = await run(installSkill(root, name));
      expect(result.files).toEqual([...skillFiles[name]]);
      for (const file of skillFiles[name]) expect(await fs.readFile(join(result.directory, file), 'utf8')).toBe(await fs.readFile(join('skills', name, file), 'utf8'));
      expect(await fs.readFile(join(result.directory, 'SKILL.md'), 'utf8')).toMatch(new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`));
    }
    expect((await fs.readdir(root)).sort()).toEqual([...skillNames].sort());
    const bot = await fs.readFile(join(root, 'bot', 'SKILL.md'), 'utf8'), frontmatter = bot.slice(0, bot.indexOf('\n---', 4));
    expect(frontmatter).toMatch(/^disable-model-invocation: true\r?$/m);
    expect(await fs.readFile(join(root, 'bot', 'agents', 'openai.yaml'), 'utf8')).toMatch(/^policy:\r?\n {2}allow_implicit_invocation: false\r?$/m);
    // The creator stays discoverable from ordinary requests; only activation is manual.
    expect(await fs.readFile(join(root, 'bot-creator', 'SKILL.md'), 'utf8')).not.toMatch(/disable-model-invocation/);
    await expect(fs.lstat(join(root, 'bot-creator', 'agents'))).rejects.toMatchObject({ code: 'ENOENT' });
    // An operator's edited installation is never replaced.
    for (const name of skillNames) {
      const file = join(root, name, skillFiles[name].at(-1)!);
      await fs.writeFile(file, 'Operator edit.\n');
      await expect(run(installSkill(root, name))).rejects.toMatchObject({ code: 'SKILL_INSTALL_FAILED' });
      expect(await fs.readFile(file, 'utf8')).toBe('Operator edit.\n');
    }
  });

  it('lists every file of each skills/ directory for installation and native packaging', async () => {
    const walk = async (directory: string, prefix = ''): Promise<string[]> => (await Promise.all((await fs.readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? walk(join(directory, entry.name), `${prefix}${entry.name}/`) : [prefix + entry.name]))).flat();
    expect((await fs.readdir('skills')).sort()).toEqual([...skillNames].sort());
    for (const name of skillNames) {
      expect((await walk(join('skills', name))).sort()).toEqual([...skillFiles[name]].sort());
      expect(skillFiles[name][0]).toBe('SKILL.md');
      expect(skillFiles[name].every(file => file.split('/').length <= 2)).toBe(true);
    }
    // Hosts skip a skill whose frontmatter is not valid YAML with string name and description.
    for (const name of skillNames) {
      const raw = await fs.readFile(join('skills', name, 'SKILL.md'), 'utf8'), match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
      const metadata = parse(match![1]);
      expect(metadata).toMatchObject({ name, description: expect.any(String) });
      expect(metadata.description.length).toBeLessThanOrEqual(1024);
    }
    const assets = skillAssets();
    expect(Object.values(assets).sort()).toEqual(skillNames.flatMap(name => skillFiles[name].map(file => `skills/${name}/${file}`)).sort());
    expect(assets['skill/SKILL.md']).toBe('skills/okf/SKILL.md');
    expect(assets['skills/bot/agents/openai.yaml']).toBe('skills/bot/agents/openai.yaml');
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
