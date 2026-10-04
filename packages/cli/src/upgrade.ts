import { Effect } from 'effect';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { OkfError, type Operation, type SourceInstallation, type UpgradeCheckResult, type UpgradeResult } from '../../core/src/contracts.ts';
import { checkedProcess } from './process.ts';

const readInstallation = (directory: string): Operation<SourceInstallation> => Effect.tryPromise({
  try: async () => {
    const value: SourceInstallation = JSON.parse(await readFile(join(directory, 'irudd-okf.install.json'), 'utf8'));
    if (value.version !== 1 || typeof value.source !== 'string' || !isAbsolute(value.source) || typeof value.revision !== 'string' || !/^[a-f0-9]{40,64}$/.test(value.revision) || typeof value.productVersion !== 'string') throw new Error('Invalid installation record.');
    return value;
  },
  catch: error => new OkfError('INSTALLATION_NOT_FOUND', 'Install from a separate clone with vp run install:cli before using upgrade. Keep irudd-okf.install.json beside the executable.', { cause: String(error) }),
});
const installed = (executable: string) => Effect.gen(function* () {
  const directory = dirname(yield* Effect.tryPromise({
    try: () => realpath(executable),
    catch: error => new OkfError('INSTALLATION_NOT_FOUND', 'Could not locate the installed executable.', { cause: String(error) }),
  }));
  return { directory, installation: yield* readInstallation(directory) };
});
const packageVersion = (raw: string): Operation<string> => Effect.try({
  try: () => {
    const value = JSON.parse(raw).version;
    if (typeof value !== 'string' || !value) throw new Error('Missing package version.');
    return value;
  },
  catch: error => new OkfError('UPGRADE_VERSION_FAILED', 'Could not read the package version on main.', { cause: String(error) }),
});

export const checkUpgrade = (executable = process.execPath): Operation<UpgradeCheckResult> => Effect.gen(function* () {
  const { installation } = yield* installed(executable);
  const remote = yield* checkedProcess('git', ['remote', 'get-url', 'origin'], installation.source);
  const refs = yield* checkedProcess('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/main'], installation.source);
  const revision = refs.split(/\s+/)[0];
  if (revision === installation.revision) return { current: installation.productVersion, latest: installation.productVersion, updateAvailable: false };
  // Fetch into a temporary repository so checks leave the installation clone,
  // its Git refs, and the installed executable untouched.
  const latest = yield* Effect.acquireUseRelease(
    Effect.tryPromise({ try: () => mkdtemp(join(tmpdir(), 'irudd-okf-check-')), catch: error => new OkfError('UPGRADE_CHECK_FAILED', 'Could not create a temporary update check.', { cause: String(error) }) }),
    directory => Effect.gen(function* () {
      yield* checkedProcess('git', ['init', '--bare', directory], directory);
      yield* checkedProcess('git', ['--git-dir', directory, 'fetch', '--no-tags', '--depth=1', '--', remote, revision], installation.source);
      return yield* packageVersion(yield* checkedProcess('git', ['--git-dir', directory, 'show', 'FETCH_HEAD:package.json'], directory));
    }),
    directory => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  );
  return { current: installation.productVersion, latest, updateAvailable: true };
});

export const upgrade = (executable = process.execPath): Operation<UpgradeResult> => Effect.gen(function* () {
  const { directory, installation } = yield* installed(executable);
  const git = (...args: string[]) => checkedProcess('git', args, installation.source);
  if ((yield* git('rev-parse', '--show-toplevel')) !== installation.source || (yield* git('branch', '--show-current')) !== 'main' || (yield* git('status', '--porcelain'))) {
    return yield* Effect.fail(new OkfError('UPGRADE_SOURCE_CHANGED', 'The installation clone must be clean and on main. Commit or move local changes first.', { source: installation.source }));
  }
  yield* git('fetch', '--no-tags', 'origin', 'main:refs/remotes/origin/main');
  const revision = yield* git('rev-parse', 'refs/remotes/origin/main');
  const head = yield* git('rev-parse', 'HEAD');
  yield* git('merge-base', '--is-ancestor', head, revision).pipe(Effect.mapError(() => new OkfError('UPGRADE_SOURCE_CHANGED', 'Local main contains commits absent from origin/main. Use a clean installation clone.', { source: installation.source })));
  if (head !== revision) yield* git('-c', 'core.hooksPath=/dev/null', 'merge', '--ff-only', revision);
  if (installation.revision !== revision) {
    yield* checkedProcess('vp', ['install', '--frozen-lockfile'], installation.source);
    yield* checkedProcess('vp', ['run', '--no-cache', 'install:cli', directory], installation.source);
    const current = yield* readInstallation(directory);
    if (current.revision !== revision) return yield* Effect.fail(new OkfError('UPGRADE_INSTALL_FAILED', 'The installer did not install the expected commit.', { revision }));
    return { previous: installation.productVersion, current: current.productVersion, updated: true };
  }
  return { previous: installation.productVersion, current: installation.productVersion, updated: false };
});
