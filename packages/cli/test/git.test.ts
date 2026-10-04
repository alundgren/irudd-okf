import { afterEach, describe, expect, it } from 'vite-plus/test';
import { Effect } from 'effect';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { GitMemory } from '../src/git.ts';
import { OkfError, type MemoryContext } from '../../core/src/contracts.ts';
const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
const fixture = async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'okf-git-test-')); directories.push(root);
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'OKF Tests'); git(root, 'config', 'user.email', 'tests@example.invalid');
  await mkdir(resolve(root, '.okf'));
  await writeFile(resolve(root, '.okf/rule.md'), '---\ntype: Rule\n---\nOriginal\n');
  await writeFile(resolve(root, 'code.txt'), 'Original code\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'base');
  git(root, 'remote', 'add', 'origin', 'https://github.com/test/okf.git');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const context: MemoryContext = { version: 1, cwd: root, gitRoot: root, configPath: resolve(root, 'config.json'), bundles: [{ name: 'repo', root: resolve(root, '.okf'), kind: 'repository', writable: true }] };
  return { root, memory: new GitMemory(context, resolve(root, 'state'), async (_command, args) => {
    if (args[0] === 'api') return git(root, 'rev-parse', 'refs/remotes/origin/main');
    throw new OkfError('PROCESS_FAILED', 'Simulated gh authentication failure.');
  }) };
};
describe('isolated memory PR preparation', () => {
  it('preserves staged code and selected base identity', async () => {
    const { root, memory } = await fixture();
    git(root, 'update-ref', 'refs/remotes/origin/aaa-other', 'HEAD');
    await writeFile(resolve(root, 'code.txt'), 'Unrelated code\n'); git(root, 'add', 'code.txt');
    await writeFile(resolve(root, '.okf/rule.md'), '---\ntype: Rule\n---\nReviewed memory\n');
    const before = git(root, 'diff', '--cached', '--binary');
    const preview = await Effect.runPromise(memory.preview('repo', ['rule.md'], 'origin/main'));
    expect(preview.baseRef).toBe('main'); expect(preview.repository).toBe('test/okf');
    expect(preview.diff).toContain('Reviewed memory'); expect(preview.diff).not.toContain('code.txt');
    expect(git(root, 'diff', '--cached', '--binary')).toBe(before);
    expect(git(root, 'branch', '--show-current')).toBe('main');
  });
  it('rejects a symlinked destination bundle in the selected Git base', async () => {
    const { root, memory } = await fixture();
    const external = await mkdtemp(resolve(tmpdir(), 'okf-git-external-')); directories.push(external);
    await rm(resolve(root, '.okf'), { recursive: true }); await symlink(external, resolve(root, '.okf'));
    git(root, 'add', '-A'); git(root, 'commit', '-m', 'symlink base'); git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    await rm(resolve(root, '.okf')); await mkdir(resolve(root, '.okf')); await writeFile(resolve(root, '.okf/rule.md'), '---\ntype: Rule\n---\nCurrent\n');
    await expect(Effect.runPromise(memory.preview('repo', ['rule.md'], 'origin/main'))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(readFile(resolve(external, 'rule.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects source changes after preview before branch publication', async () => {
    const { root, memory } = await fixture();
    await writeFile(resolve(root, '.okf/rule.md'), '---\ntype: Rule\n---\nFirst edit\n');
    const preview = await Effect.runPromise(memory.preview('repo', ['rule.md'], 'origin/main'));
    await writeFile(resolve(root, '.okf/rule.md'), '---\ntype: Rule\n---\nConcurrent edit\n');
    await expect(Effect.runPromise(memory.publish(preview.token, 'Memory edits'))).rejects.toMatchObject({ code: 'EDIT_CONFLICT' });
    expect(git(root, 'branch', '--show-current')).toBe('main');
  });
  it('resumes a prepared branch after commit failure and recovers dead lock ownership', async () => {
    const { root, memory } = await fixture();
    await writeFile(resolve(root, '.okf/rule.md'), '---\ntype: Rule\n---\nFirst edit\n');
    const preview = await Effect.runPromise(memory.preview('repo', ['rule.md'], 'origin/main'));
    git(root, 'config', 'user.name', '');
    await expect(Effect.runPromise(memory.publish(preview.token, 'Memory edits'))).rejects.toMatchObject({ code: 'PROCESS_FAILED', details: { state: 'prepared' } });
    const jobPath = resolve(root, 'state', `${preview.token}.json`);
    const job = JSON.parse(await readFile(jobPath, 'utf8'));
    expect(git(job.worktree, 'branch', '--show-current')).toBe(preview.branch);
    git(root, 'config', 'user.name', 'OKF Tests');
    // Simulate termination after a successful commit but before journal update.
    git(job.worktree, 'commit', '-m', 'Memory edits');
    await writeFile(resolve(root, 'state', `${preview.token}.lock`), JSON.stringify({ pid: 2_147_483_647, nonce: 'dead-process' }));
    // Authentication lookup is intentionally blocked to keep this regression local.
    await expect(Effect.runPromise(memory.publish(preview.token, 'Memory edits'))).rejects.toMatchObject({ details: { state: 'committed' } });
    const recovered = JSON.parse(await readFile(jobPath, 'utf8'));
    expect(recovered.state).toBe('committed');
    expect(recovered.commit).toBe(git(job.worktree, 'rev-parse', 'HEAD'));
  });
  it('rejects an effective push URL outside the reviewed repository', async () => {
    const { root, memory } = await fixture();
    await writeFile(resolve(root, '.okf/rule.md'), '---\ntype: Rule\n---\nReviewed edit\n');
    git(root, 'config', 'remote.origin.pushurl', 'https://github.com/another/repository.git');
    await expect(Effect.runPromise(memory.preview('repo', ['rule.md'], 'origin/main'))).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
    git(root, 'config', 'remote.origin.pushurl', 'https://github.com/test/okf.git');
    const preview = await Effect.runPromise(memory.preview('repo', ['rule.md'], 'origin/main'));
    git(root, 'config', 'remote.origin.pushurl', 'https://attacker.invalid/github.com/test/okf.git');
    await expect(Effect.runPromise(memory.publish(preview.token, 'Reviewed edit'))).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
  });
  it('refuses a later unreviewed commit in a retained publication worktree', async () => {
    const { root, memory } = await fixture();
    await writeFile(resolve(root, '.okf/rule.md'), '---\ntype: Rule\n---\nReviewed edit\n');
    const preview = await Effect.runPromise(memory.preview('repo', ['rule.md'], 'origin/main'));
    await expect(Effect.runPromise(memory.publish(preview.token, 'Reviewed edit'))).rejects.toMatchObject({ details: { state: 'committed' } });
    const job = JSON.parse(await readFile(resolve(root, 'state', `${preview.token}.json`), 'utf8'));
    await writeFile(resolve(job.worktree, 'unrelated.md'), 'Unreviewed document.\n');
    git(job.worktree, 'add', 'unrelated.md'); git(job.worktree, 'commit', '-m', 'Unreviewed later commit');
    await expect(Effect.runPromise(memory.publish(preview.token, 'Reviewed edit'))).rejects.toMatchObject({ code: 'EDIT_CONFLICT' });
  });
  it('serializes competing dead-lock recovery attempts', async () => {
    const { root, memory } = await fixture();
    await writeFile(resolve(root, '.okf/rule.md'), '---\ntype: Rule\n---\nReviewed edit\n');
    const preview = await Effect.runPromise(memory.preview('repo', ['rule.md'], 'origin/main'));
    await writeFile(resolve(root, 'state', `${preview.token}.lock`), JSON.stringify({ pid: 2_147_483_647, nonce: 'dead' }));
    const results = await Promise.allSettled([Effect.runPromise(memory.publish(preview.token, 'Reviewed edit')), Effect.runPromise(memory.publish(preview.token, 'Reviewed edit'))]);
    const codes = results.map(result => result.status === 'rejected' ? result.reason.code : 'success').sort();
    expect(codes).toEqual(['PROCESS_FAILED', 'PR_BUSY'].sort());
    const job = JSON.parse(await readFile(resolve(root, 'state', `${preview.token}.json`), 'utf8'));
    expect(job.state).toBe('committed');
    expect(git(job.worktree, 'rev-list', '--count', `${job.base}..HEAD`)).toBe('1');
  });
  it('reports actionable recovery for a terminated acquisition claim', async () => {
    const { root, memory } = await fixture();
    await writeFile(resolve(root, '.okf/rule.md'), '---\ntype: Rule\n---\nReviewed edit\n');
    const preview = await Effect.runPromise(memory.preview('repo', ['rule.md'], 'origin/main'));
    const claim = resolve(root, 'state', `${preview.token}.lock.recovery`);
    await mkdir(claim); await writeFile(resolve(claim, 'owner.json'), JSON.stringify({ pid: 2_147_483_647, nonce: 'dead' }));
    await expect(Effect.runPromise(memory.publish(preview.token, 'Reviewed edit'))).rejects.toMatchObject({ code: 'PR_BUSY', details: { ownerPid: 2_147_483_647, ownerRunning: false, recoveryClaim: claim, recovery: expect.stringContaining('Preserve the primary lock, journal and worktree') } });
    await writeFile(resolve(claim, 'owner.json'), '{');
    await expect(Effect.runPromise(memory.publish(preview.token, 'Reviewed edit'))).rejects.toMatchObject({ code: 'PR_BUSY', details: { ownerPid: null, recovery: expect.stringContaining('confirm no publication process remains') } });
    expect(JSON.parse(await readFile(resolve(root, 'state', `${preview.token}.json`), 'utf8')).state).toBe('preview');
  });
});
