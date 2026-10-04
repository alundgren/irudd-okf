import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Effect } from 'effect';
import type { Bundle } from '../../core/src/contracts.ts';
import { editInstructions, installInstructions, instructionEnd, instructionStart, instructionStatus, removeInstructions } from '../src/instructions.ts';

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));
const directories: string[] = [];
const run = Effect.runPromise;
async function fixture() {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'okf-instructions-'))); directories.push(home);
  const root = path.join(home, 'memory with spaces'); await fs.mkdir(root); await fs.writeFile(path.join(root, 'index.md'), '# Personal knowledge\n');
  const bundle: Bundle = { name: 'personal', root, kind: 'personal', writable: true };
  return { home, bundle, options: { home, env: {} }, codex: path.join(home, '.codex', 'AGENTS.md'), claude: path.join(home, '.claude', 'CLAUDE.md') };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });

describe('owned provider instructions', () => {
  it('changes only its block, preserving surrounding CRLF content', () => {
    const before = '# Existing rules\r\nKeep these exact bytes.\r\n\r\n';
    const after = '\r\n## Other tool\r\nDo not edit.\r\n';
    const raw = before + instructionStart + '\r\nold content\r\n' + instructionEnd + '\r\n' + after;
    const changed = editInstructions(raw, 'new content\nsecond line\n');
    expect(changed).toBe(before + instructionStart + '\r\n<!-- Managed by irudd-okf instructions install; change bundle conventions in index.md. -->\r\nnew content\r\nsecond line\r\n' + instructionEnd + '\r\n' + after);
    expect(editInstructions(changed, 'new content\nsecond line\n')).toBe(changed);
    expect(editInstructions(changed, null)).toBe(before + after);
  });

  it.each([
    instructionStart, instructionEnd, instructionEnd + '\n' + instructionStart,
    instructionStart + '\n' + instructionStart + '\n' + instructionEnd,
    'quoted ' + instructionStart + '\n' + instructionEnd,
    '```md\n' + instructionStart + '\nexample instructions\n' + instructionEnd + '\n```\n',
    '<div>\n' + instructionStart + '\nexample instructions\n' + instructionEnd + '\n</div>\n',
  ])('refuses ambiguous ownership markers', raw => {
    expect(() => editInstructions(raw, 'new content')).toThrow(/markers/);
    expect(() => editInstructions(raw, null)).toThrow(/markers/);
  });

  it('accepts a leading BOM and preserves CR-only line endings', async () => {
    const f = await fixture(); await run(installInstructions('codex', f.bundle, f.options));
    await fs.writeFile(f.codex, '\uFEFF' + await fs.readFile(f.codex, 'utf8'));
    expect((await run(instructionStatus('codex', f.options))).installed).toBe(true);
    expect((await run(installInstructions('codex', f.bundle, f.options))).changed).toBe(false);
    await run(removeInstructions('codex', f.options));
    expect(await fs.readFile(f.codex, 'utf8')).toBe('\uFEFF');
    const prefix = '# Existing\r\r', suffix = '\r# Other\r';
    const raw = prefix + instructionStart + '\rold\r' + instructionEnd + '\r' + suffix;
    const edited = editInstructions(raw, 'new\n');
    expect(edited).not.toContain('\n');
    expect(editInstructions(edited, null)).toBe(prefix + suffix);
  });

  it('installs, updates and removes providers independently with recovery and original permissions', async () => {
    const f = await fixture(); await fs.mkdir(path.dirname(f.codex));
    const original = '# My rules\nUse existing tools.\n'; await fs.writeFile(f.codex, original, { mode: 0o640 });
    const codex = await run(installInstructions('codex', f.bundle, f.options));
    expect(codex).toMatchObject({ changed: true, installed: true, shadowed: false, file: f.codex });
    expect(await fs.readFile(codex.recoveryPath!, 'utf8')).toBe(original);
    expect((await fs.stat(f.codex)).mode & 0o777).toBe(0o640);
    expect(await fs.readFile(f.codex, 'utf8')).toContain('"' + f.bundle.root + '"');
    expect((await run(installInstructions('codex', f.bundle, f.options))).changed).toBe(false);
    await expect(fs.stat(f.claude)).rejects.toMatchObject({ code: 'ENOENT' });
    await run(installInstructions('claude', f.bundle, f.options));
    const claudeRaw = await fs.readFile(f.claude, 'utf8');
    const moved = { ...f.bundle, root: path.join(f.home, 'other-memory') }; await fs.mkdir(moved.root); await fs.writeFile(path.join(moved.root, 'index.md'), '# Other\n');
    await run(installInstructions('codex', moved, f.options));
    expect(await fs.readFile(f.codex, 'utf8')).not.toContain(f.bundle.root);
    expect(await fs.readFile(f.codex, 'utf8')).toContain(moved.root);
    await run(removeInstructions('codex', f.options));
    expect(await fs.readFile(f.codex, 'utf8')).toBe(original + '\n');
    expect(await fs.readFile(f.claude, 'utf8')).toBe(claudeRaw);
    expect((await run(instructionStatus('codex', f.options))).installed).toBe(false);
    expect((await run(removeInstructions('codex', f.options))).changed).toBe(false);
  });

  it('previews without creating provider directories and respects custom profiles', async () => {
    const f = await fixture();
    const preview = await run(installInstructions('codex', f.bundle, { ...f.options, dryRun: true }));
    expect(preview).toMatchObject({ changed: true, dryRun: true, installed: true });
    expect(preview.instructions).toContain('root and relevant topic indexes');
    await expect(fs.stat(path.dirname(f.codex))).rejects.toMatchObject({ code: 'ENOENT' });
    const options = { home: f.home, env: { CODEX_HOME: path.join(f.home, 'codex-profile'), CLAUDE_CONFIG_DIR: path.join(f.home, 'claude-profile') } };
    expect((await run(installInstructions('codex', f.bundle, options))).file).toBe(path.join(options.env.CODEX_HOME, 'AGENTS.md'));
    expect((await run(installInstructions('claude', f.bundle, options))).file).toBe(path.join(options.env.CLAUDE_CONFIG_DIR, 'CLAUDE.md'));
    const removal = await run(removeInstructions('claude', { ...options, dryRun: true }));
    expect(removal).toMatchObject({ changed: true, installed: false, dryRun: true });
    expect((await run(instructionStatus('claude', options))).installed).toBe(true);
  });

  it('reports a nonempty Codex override and leaves it unchanged', async () => {
    const f = await fixture(); await fs.mkdir(path.dirname(f.codex));
    const override = path.join(path.dirname(f.codex), 'AGENTS.override.md'); await fs.writeFile(override, '# Temporary instructions\n');
    expect((await run(instructionStatus('codex', f.options))).shadowed).toBe(true);
    await expect(run(installInstructions('codex', f.bundle, f.options))).rejects.toMatchObject({ code: 'INSTRUCTIONS_SHADOWED' });
    await expect(fs.stat(f.codex)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(override, 'utf8')).toBe('# Temporary instructions\n');
    await fs.writeFile(override, ' \n');
    expect((await run(installInstructions('codex', f.bundle, f.options))).changed).toBe(true);
  });

  it('rejects symlinks, malformed UTF-8 and missing authoring indexes without replacing anything', async () => {
    const f = await fixture(); await fs.mkdir(path.dirname(f.codex));
    const target = path.join(f.home, 'rules.md'); await fs.writeFile(target, 'Existing rules'); await fs.symlink(target, f.codex);
    await expect(run(installInstructions('codex', f.bundle, f.options))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect((await fs.lstat(f.codex)).isSymbolicLink()).toBe(true); expect(await fs.readFile(target, 'utf8')).toBe('Existing rules');
    await fs.unlink(f.codex); await fs.writeFile(f.codex, Buffer.from([0xff, 0xfe]));
    await expect(run(installInstructions('codex', f.bundle, f.options))).rejects.toMatchObject({ code: 'IO_ERROR' });
    expect(await fs.readFile(f.codex)).toEqual(Buffer.from([0xff, 0xfe]));
    await fs.unlink(path.join(f.bundle.root, 'index.md'));
    await expect(run(installInstructions('claude', f.bundle, f.options))).rejects.toMatchObject({ code: 'INDEX_REQUIRED' });
    await expect(run(installInstructions('claude', { ...f.bundle, kind: 'repository' }, f.options))).rejects.toMatchObject({ code: 'PERSONAL_BUNDLE_REQUIRED' });
  });

  it('retains the original file when atomic publication fails', async () => {
    const f = await fixture(); await fs.mkdir(path.dirname(f.codex)); const original = '# Existing rules\n'; await fs.writeFile(f.codex, original);
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('simulated publication failure'));
    const error = await run(installInstructions('codex', f.bundle, f.options)).catch(error => error);
    expect(error).toMatchObject({ code: 'INSTRUCTION_WRITE_FAILED', details: { recoveryPath: expect.any(String) } });
    expect(await fs.readFile(f.codex, 'utf8')).toBe(original);
    expect((await fs.readdir(path.dirname(f.codex))).some(file => file.endsWith('.tmp'))).toBe(false);
    const backups = await fs.readdir(path.join(path.dirname(f.codex), '.irudd-okf', 'recovery'));
    expect(await fs.readFile(path.join(path.dirname(f.codex), '.irudd-okf', 'recovery', backups[0]), 'utf8')).toBe(original);
  });

  it('detects an external edit while preparing recovery and preserves the newer instructions', async () => {
    const f = await fixture(); await fs.mkdir(path.dirname(f.codex)); await fs.writeFile(f.codex, '# Original\n');
    const write = fs.writeFile;
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      if (String(args[0]).includes(`${path.sep}recovery${path.sep}`)) await write(f.codex, '# External edit\n');
      return write(...args);
    });
    await expect(run(installInstructions('codex', f.bundle, f.options))).rejects.toMatchObject({ code: 'INSTRUCTION_CONFLICT' });
    expect(await fs.readFile(f.codex, 'utf8')).toBe('# External edit\n');
  });

  it.each(['text', 'permissions', 'override-existing', 'override-new'])('rechecks %s after temporary-file preparation', async kind => {
    const f = await fixture(); await fs.mkdir(path.dirname(f.codex));
    if (kind !== 'override-new') await fs.writeFile(f.codex, '# Original\n', { mode: 0o600 });
    const open = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]).endsWith('.tmp')) {
        const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementation(async (...writeArgs) => {
          await write(...writeArgs);
          if (kind === 'text') await fs.writeFile(f.codex, '# New external edit\n');
          else if (kind === 'permissions') await fs.chmod(f.codex, 0o640);
          else await fs.writeFile(path.join(path.dirname(f.codex), 'AGENTS.override.md'), '# New override\n');
        });
      }
      return handle;
    });
    await expect(run(installInstructions('codex', f.bundle, f.options))).rejects.toMatchObject({ code: 'INSTRUCTION_CONFLICT' });
    if (kind === 'override-new') await expect(fs.stat(f.codex)).rejects.toMatchObject({ code: 'ENOENT' });
    else expect(await fs.readFile(f.codex, 'utf8')).toBe(kind === 'text' ? '# New external edit\n' : '# Original\n');
    if (kind === 'permissions') expect((await fs.stat(f.codex)).mode & 0o777).toBe(0o640);
    expect((await fs.readdir(path.dirname(f.codex))).some(file => file.endsWith('.tmp'))).toBe(false);
  });
});
