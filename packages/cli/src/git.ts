import { Effect } from 'effect';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { OkfError, type GitPreview, type GitStatus, type MemoryContext, type Operation, type PullRequestResult } from '../../core/src/contracts.ts';
import { checkedProcess, runProcess } from './process.ts';

const call = (command: string, args: string[], cwd: string) => Effect.runPromise(checkedProcess(command, args, cwd));
const git = (cwd: string, ...args: string[]) => call('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never', ...args], cwd);
const safeOperation = <A>(run: () => Promise<A>): Operation<A> => Effect.tryPromise({ try: run, catch: error => error instanceof OkfError ? error : new OkfError('GIT_FAILED', error instanceof Error ? error.message : String(error)) });
const within = (root: string, file: string) => { const rel = relative(root, file); return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
const hash = (raw: string | null) => raw === null ? null : createHash('sha256').update(raw).digest('hex');
const githubRepository = (url: string) => url.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/)?.[1] ?? null;
interface Snapshot { path: string; raw: string | null; hash: string | null }
interface Job extends GitPreview { root: string; bundleRoot: string; worktree: string; snapshots: Snapshot[]; state: 'preview' | 'prepared' | 'committed' | 'pushed' | 'created'; url?: string; title?: string; body?: string; commit?: string }

export class GitMemory {
  private readonly directory: string;
  constructor(private readonly context: MemoryContext, stateDirectory?: string, private readonly githubCall = call) {
    this.directory = stateDirectory ?? resolve(process.env.XDG_STATE_HOME ?? resolve(homedir(), '.local/state'), 'irudd-okf', 'pr-jobs');
  }
  private async bundle(name: string) {
    const bundle = this.context.bundles.find(item => item.name === name);
    if (!bundle) throw new OkfError('BUNDLE_NOT_FOUND', `Bundle ${name} is not active.`);
    const root = await git(bundle.root, 'rev-parse', '--show-toplevel');
    const resolvedRoot = await realpath(root);
    if (!within(resolvedRoot, await realpath(bundle.root))) throw new OkfError('UNSAFE_PATH', 'The bundle must be inside the Git repository.');
    return { bundle, root: resolvedRoot };
  }
  private async safeFile(root: string, path: string) {
    if (!path || path.includes('\0') || path.includes('\\') || isAbsolute(path) || path.split('/').some(part => !part || part === '.' || part === '..') || !path.endsWith('.md')) throw new OkfError('UNSAFE_PATH', 'Select bundle-relative Markdown paths.');
    const file = resolve(root, path);
    if (!within(root, file)) throw new OkfError('UNSAFE_PATH', 'Path leaves the bundle.');
    // Check from the filesystem root, including the bundle root itself: the
    // selected Git base may contain different directories from the current tree.
    let current = resolve(root, '/');
    for (const segment of relative(current, file).split(sep)) {
      current = resolve(current, segment);
      try { if ((await lstat(current)).isSymbolicLink()) throw new OkfError('UNSAFE_PATH', 'Git memory edits cannot follow symbolic links.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return file;
  }
  status(name: string): Operation<GitStatus> {
    return safeOperation(async () => {
      let location: Awaited<ReturnType<GitMemory['bundle']>>;
      try { location = await this.bundle(name); }
      catch (error) { return { version: 1, available: false, root: null, branch: null, remote: null, files: [], reason: error instanceof Error ? error.message : String(error) }; }
      const { bundle, root } = location;
      const prefix = relative(root, bundle.root).split(sep).join('/');
      const raw = await git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', prefix || '.');
      const entries = raw.split('\0');
      const files: GitStatus['files'] = [];
      for (let i = 0; i < entries.length; i++) {
        const value = entries[i]; if (!value) continue;
        const status = value.slice(0, 2); const sourcePath = value.slice(3);
        const paths = [sourcePath]; if (/[RC]/.test(status)) paths.push(entries[++i]);
        for (const full of paths) {
          if (!full?.endsWith('.md')) continue;
          const local = prefix ? full.startsWith(`${prefix}/`) ? full.slice(prefix.length + 1) : null : full;
          if (local) files.push({ path: local, status: status.trim() });
        }
      }
      const remote = await Effect.runPromise(runProcess('git', ['remote', 'get-url', 'origin'], root));
      return { version: 1, available: true, root, branch: await git(root, 'rev-parse', '--abbrev-ref', 'HEAD'), remote: remote.exitCode === 0 ? remote.stdout.trim() : null, files };
    });
  }
  preview(name: string, paths: string[], base?: string): Operation<GitPreview> {
    return safeOperation(async () => {
      const { bundle, root } = await this.bundle(name);
      if (paths.length < 1 || paths.length > 250) throw new OkfError('INVALID_INPUT', 'Select 1–250 memory files.');
      const remote = await git(root, 'remote', 'get-url', 'origin');
      const repository = githubRepository(remote);
      if (!repository) throw new OkfError('GITHUB_REMOTE_REQUIRED', 'PR submission requires an origin remote on github.com. Use normal Git review for other hosts.');
      await this.checkPushTarget(root, repository);
      let chosenBase = base;
      if (!chosenBase) {
        const defaultRef = await Effect.runPromise(runProcess('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root));
        chosenBase = defaultRef.exitCode === 0 ? defaultRef.stdout.trim() : 'origin/main';
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(chosenBase) || chosenBase.includes('..')) throw new OkfError('INVALID_INPUT', 'Select a valid base branch or commit.');
      const baseHash = await git(root, 'rev-parse', '--verify', `${chosenBase}^{commit}`);
      const snapshots: Snapshot[] = [];
      for (const path of [...new Set(paths)].sort()) {
        const file = await this.safeFile(bundle.root, path);
        let raw: string | null; try { raw = await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; raw = null; }
        snapshots.push({ path, raw, hash: hash(raw) });
      }
      const temp = await realpath(await mkdtemp(resolve(tmpdir(), 'irudd-okf-pr-')));
      await chmod(temp, 0o700);
      const worktree = resolve(temp, 'tree');
      await git(root, 'worktree', 'add', '--detach', worktree, baseHash);
      const prefix = relative(root, bundle.root);
      try {
        for (const snapshot of snapshots) {
          const destBundle = resolve(worktree, prefix);
          const target = await this.safeFile(destBundle, snapshot.path);
          if (snapshot.raw === null) await rm(target, { force: true });
          else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, snapshot.raw, { mode: 0o600 }); }
        }
        const selectedPaths = snapshots.map(snapshot => relative(worktree, resolve(worktree, prefix, snapshot.path)));
        await git(worktree, 'add', '-A', '--', ...selectedPaths);
        const diff = await git(worktree, 'diff', '--cached', '--binary', '--');
        if (!diff.trim()) throw new OkfError('NO_CHANGES', 'The selected memory files match the PR base.');
        const token = randomUUID();
        const baseRef = chosenBase.replace(/^refs\/remotes\/origin\//, '').replace(/^origin\//, '').replace(/^refs\/heads\//, '');
        if (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(baseRef) || /^[0-9a-f]{40}$/.test(baseRef)) throw new OkfError('BASE_BRANCH_REQUIRED', 'Select an origin branch for the PR base, such as origin/main.');
        const job: Job = { version: 1, token, bundle: name, base: baseHash, baseRef, branch: `okf-memory/${token}`, paths: snapshots.map(snapshot => snapshot.path), diff, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), warnings: ['This diff is relative to the chosen PR base. Review its full content before publishing.', 'Other working-tree changes are excluded. Verify that these rules do not depend on unpublished code.'], root, bundleRoot: bundle.root, worktree, repository, snapshots, state: 'preview' };
        await this.saveJob(job);
        return this.publicPreview(job);
      } catch (error) { await git(root, 'worktree', 'remove', '--force', worktree).catch(() => {}); throw error; }
    });
  }
  private publicPreview(job: Job): GitPreview { const { version, token, bundle, base, baseRef, repository, branch, paths, diff, expiresAt, warnings } = job; return { version, token, bundle, base, baseRef, repository, branch, paths, diff, expiresAt, warnings }; }
  private async saveJob(job: Job) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if ((await lstat(this.directory)).isSymbolicLink()) throw new OkfError('UNSAFE_PATH', 'PR state directory cannot be a symbolic link.');
    const temporary = resolve(this.directory, `${job.token}.${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(job)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, resolve(this.directory, `${job.token}.json`));
  }
  private async acquireLock(token: string) {
    const path = resolve(this.directory, `${token}.lock`);
    const owner = { pid: process.pid, nonce: randomUUID(), createdAt: Date.now() };
    // All acquisitions, including ordinary creation, serialize through this
    // short claim. A second stale-lock reaper cannot rename a new owner's lock.
    const claim = `${path}.recovery`;
    try { await mkdir(claim, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let ownerPid: number | null = null;
      try { const recorded = JSON.parse(await readFile(resolve(claim, 'owner.json'), 'utf8')); if (Number.isInteger(recorded.pid) && recorded.pid > 0) ownerPid = recorded.pid; } catch {}
      let ownerRunning: boolean | null = null;
      if (ownerPid !== null) { try { process.kill(ownerPid, 0); ownerRunning = true; } catch (error) { ownerRunning = (error as NodeJS.ErrnoException).code === 'ESRCH' ? false : null; } }
      const claimAgeMs = Math.max(0, Date.now() - (await lstat(claim)).mtimeMs);
      throw new OkfError('PR_BUSY', 'Another or interrupted process owns the short preview-acquisition claim.', {
        ownerPid, ownerRunning, claimAgeMs, recoveryClaim: claim,
        recovery: ownerPid === null
          ? `Ownership is absent or incomplete. Inspect the claim age and confirm no publication process remains. Then remove only ${claim}, preserve the primary lock, journal and worktree, and retry the same preview token.`
          : `Confirm process ${ownerPid} has stopped before removing only ${claim}. Preserve the primary lock, journal and worktree, then retry the same preview token. Do not remove the claim while its owner is running.`,
      });
    }
    try {
      await writeFile(resolve(claim, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
      let prior: { pid?: number } | null = null;
      try { prior = JSON.parse(await readFile(path, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') prior = {}; }
      if (prior) {
        if (typeof prior.pid === 'number') {
          try { process.kill(prior.pid, 0); throw new OkfError('PR_BUSY', 'This preview is already being published.'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
        } else if (Date.now() - (await lstat(path)).mtimeMs < 30_000) throw new OkfError('PR_BUSY', 'A publication process is acquiring this preview.');
        await rename(path, `${path}.stale.${randomUUID()}`);
      }
      await writeFile(path, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
      return { path, owner };
    } finally { await rm(claim, { recursive: true, force: true }); }
  }
  private async checkPushTarget(root: string, repository: string) {
    const urls = (await git(root, 'remote', 'get-url', '--push', '--all', 'origin')).split('\n');
    if (urls.length !== 1 || githubRepository(urls[0]) !== repository) throw new OkfError('SCOPE_CHANGED', 'The effective origin push URL must name the reviewed GitHub repository.');
  }
  private async checkCommit(job: Job) {
    if (!job.commit || await git(job.worktree, 'rev-parse', 'HEAD') !== job.commit || await git(job.worktree, 'rev-parse', `${job.commit}^`) !== job.base || await git(job.worktree, 'diff', '--binary', job.base, job.commit, '--') !== job.diff || await git(job.worktree, 'status', '--porcelain') !== '') throw new OkfError('EDIT_CONFLICT', 'The retained worktree changed after its reviewed commit. Prepare a new preview.');
  }
  publish(token: string, title: string, body = 'Memory edits reviewed in the local OKF wiki.'): Operation<PullRequestResult> {
    return safeOperation(async () => {
      if (!/^[0-9a-f-]{36}$/.test(token) || !title.trim() || title.length > 200) throw new OkfError('INVALID_INPUT', 'A valid preview token and a title of 1–200 characters are required.');
      let job: Job; try { job = JSON.parse(await readFile(resolve(this.directory, `${token}.json`), 'utf8')) as Job; } catch { throw new OkfError('PREVIEW_NOT_FOUND', 'Preview not found. Prepare a new diff.'); }
      if (!this.context.bundles.some(bundle => bundle.name === job.bundle && bundle.root === job.bundleRoot)) throw new OkfError('SCOPE_CHANGED', 'This preview belongs to a bundle outside the current scope.');
      const lock = await this.acquireLock(token);
      try {
        if (job.url) return { version: 1, url: job.url, branch: job.branch, worktree: job.worktree, state: 'existing' };
        const currentRemote = await git(job.root, 'remote', 'get-url', 'origin');
        if (githubRepository(currentRemote) !== job.repository) throw new OkfError('SCOPE_CHANGED', 'The origin repository changed after preview.');
        await this.checkPushTarget(job.root, job.repository);
        if (job.state === 'preview' || job.state === 'prepared') {
          if (Date.parse(job.expiresAt) < Date.now()) throw new OkfError('PREVIEW_EXPIRED', 'Preview expired. Prepare a fresh diff.');
          for (const snapshot of job.snapshots) {
            const file = await this.safeFile(job.bundleRoot, snapshot.path);
            let raw: string | null; try { raw = await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; raw = null; }
            if (hash(raw) !== snapshot.hash) throw new OkfError('EDIT_CONFLICT', `Memory file ${snapshot.path} changed after preview. Prepare a new diff.`, { path: snapshot.path });
          }
          const liveBase = await this.githubCall('gh', ['api', `repos/${job.repository}/branches/${encodeURIComponent(job.baseRef)}`, '--jq', '.commit.sha'], job.worktree);
          if (liveBase.trim() !== job.base) throw new OkfError('EDIT_CONFLICT', 'The GitHub base branch changed after preview. Fetch it and prepare a new diff.');
          const head = await git(job.worktree, 'rev-parse', 'HEAD');
          if (head !== job.base) {
            if (await git(job.worktree, 'rev-parse', 'HEAD^') !== job.base || await git(job.worktree, 'diff', '--binary', job.base, 'HEAD', '--') !== job.diff || await git(job.worktree, 'rev-parse', '--abbrev-ref', 'HEAD') !== job.branch) throw new OkfError('EDIT_CONFLICT', 'The isolated worktree contains an unexpected commit.');
            job.commit = head; job.state = 'committed'; await this.saveJob(job);
          } else {
            if (await git(job.worktree, 'diff', '--cached', '--binary', '--') !== job.diff) throw new OkfError('EDIT_CONFLICT', 'The isolated preview changed. Prepare a new diff.');
            job.title ??= title; job.body ??= body; job.state = 'prepared'; await this.saveJob(job);
            const branch = await git(job.worktree, 'rev-parse', '--abbrev-ref', 'HEAD');
            if (branch !== job.branch) await git(job.worktree, 'switch', '-c', job.branch);
            await git(job.worktree, 'commit', '-m', job.title);
            job.commit = await git(job.worktree, 'rev-parse', 'HEAD'); job.state = 'committed'; await this.saveJob(job);
          }
        }
        await this.checkCommit(job);
        const existing = await this.githubCall('gh', ['pr', 'list', '--repo', job.repository, '--head', job.branch, '--state', 'all', '--json', 'url,state', '--limit', '1'], job.worktree);
        const prs = JSON.parse(existing) as Array<{ url: string; state: string }>;
        if (prs[0]) { job.url = prs[0].url; job.state = 'created'; await this.saveJob(job); return { version: 1, url: job.url, branch: job.branch, worktree: job.worktree, state: 'existing' }; }
        if (job.state === 'committed') { await this.checkCommit(job); await this.checkPushTarget(job.root, job.repository); await git(job.worktree, 'push', 'origin', `${job.commit}:refs/heads/${job.branch}`); job.state = 'pushed'; await this.saveJob(job); }
        const bodyFile = resolve(dirname(job.worktree), 'pr-body.md');
        await writeFile(bodyFile, job.body ?? body, { mode: 0o600 });
        job.url = await this.githubCall('gh', ['pr', 'create', '--repo', job.repository, '--base', job.baseRef, '--head', job.branch, '--title', job.title ?? title, '--body-file', bodyFile], job.worktree);
        job.state = 'created'; await this.saveJob(job);
        return { version: 1, url: job.url, branch: job.branch, worktree: job.worktree, state: 'created' };
      } catch (error) {
        throw new OkfError(error instanceof OkfError ? error.code : 'PR_FAILED', error instanceof Error ? error.message : String(error), { token, worktree: job.worktree, branch: job.branch, state: job.state, recovery: 'Retry with the same preview token after correcting the reported Git/gh failure.' });
      } finally { try { const owner = JSON.parse(await readFile(lock.path, 'utf8')); if (owner.nonce === lock.owner.nonce) await rm(lock.path); } catch {} }
    });
  }
}
