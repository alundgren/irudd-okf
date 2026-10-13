import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { OkfError, type Bundle, type MaintenancePreview, type MaintenanceResult, type MaintenanceJournalResult, type MaintenanceJournalPath } from './contracts.ts';
import { atomicReplace, atomicCreate, canonicalDirectory, cleanPath, guarded, hash, absent, scan, withLock, recovery } from './files.ts';
import { canonicalJson } from './memory.ts';
import { decode, PreviewSchema } from './schemas.ts';

interface Journal { version: 1; root: string; preview: MaintenancePreview; state: MaintenanceJournalResult['state']; completed: string[]; recovery: Record<string, string>; conflicts: Array<{path: string; actualHash: string | null; recoveryPath?: string}> }
export function previewDigest(preview: MaintenancePreview): string {
  const { previewHash: _, ...payload } = preview;
  return hash(canonicalJson(payload));
}
function validatePreview(preview: MaintenancePreview): void {
  decode(PreviewSchema, preview);
  if (!/^[a-f0-9]{64}$/.test(preview.previewHash) || preview.previewHash !== previewDigest(preview)) throw new OkfError('INVALID_PREVIEW', 'Preview digest does not match its payload.');
  if (preview.changes.length > (preview.purpose==='migration'?10002:100) || new Set(preview.changes.map(item => item.path)).size !== preview.changes.length || new Set(preview.guards.map(item => item.path)).size !== preview.guards.length) throw new OkfError('INVALID_PREVIEW', 'Preview paths must be unique and respect the maintenance or migration batch limit.');
  for (const change of preview.changes) {
    if (cleanPath(change.path) !== change.path || !(change.path.endsWith('.md') || preview.purpose === 'migration' && ['memory-history.json', 'memory-bundle.json'].includes(change.path)) || change.expectedHash !== (change.before === null ? null : hash(change.before)) || change.afterHash !== (change.raw === null ? null : hash(change.raw))) throw new OkfError('INVALID_PREVIEW', 'Preview paths and before/after digests must match exact bytes.', { path: change.path });
    const guard = preview.guards.find(item => item.path === change.path);
    if (change.before !== null && guard?.expectedHash !== change.expectedHash || change.before === null && guard) throw new OkfError('INVALID_PREVIEW', 'Every existing changed file must have an exact inventory guard.', { path: change.path });
  }
  for (const guard of preview.guards) if (cleanPath(guard.path) !== guard.path || !(guard.path.endsWith('.md') || preview.purpose === 'migration' && ['memory-history.json', 'memory-bundle.json'].includes(guard.path)) || !/^[a-f0-9]{64}$/.test(guard.expectedHash)) throw new OkfError('INVALID_PREVIEW', 'Inventory guards require canonical Markdown paths and SHA-256 digests.');
}
async function rawAt(bundle: Bundle, relative: string): Promise<string | null> {
  try { const file = await guarded(bundle, relative); const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW); try { return await handle.readFile('utf8'); } finally { await handle.close(); } }
  catch (error) { if (absent(error)) return null; throw error; }
}
async function journalFile(bundle: Bundle, digest: string, create = false): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new OkfError('INVALID_REQUEST', 'Journal identity must be a SHA-256 preview digest.');
  const root = await canonicalDirectory(bundle.root);
  let directory = root;
  for (const name of ['.irudd-okf', 'maintenance']) {
    directory = path.join(directory, name);
    if (create) await fs.mkdir(directory).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
    const information = await fs.lstat(directory);
    if (!information.isDirectory() || information.isSymbolicLink()) throw new OkfError('UNSAFE_PATH', 'Journal directories must be ordinary bundle-owned directories.');
  }
  const file = path.join(directory, digest + '.json');
  try { const information = await fs.lstat(file); if (!information.isFile() || information.isSymbolicLink()) throw new OkfError('UNSAFE_PATH', 'Journal files must be ordinary files.'); } catch (error) { if (!absent(error)) throw error; }
  return file;
}
async function loadJournal(file: string, root: string, expected: string): Promise<Journal | null> {
  let raw: string;
  try { const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW); try { raw = await handle.readFile('utf8'); } finally { await handle.close(); } } catch (error) { if (absent(error)) return null; throw error; }
  let journal: Journal;
  try { journal = JSON.parse(raw); } catch { throw new OkfError('INVALID_JOURNAL', 'Durable journal cannot be parsed. Preserve it and inspect recovery copies.', { journalPath: file }); }
  if(journal?.preview?.purpose==='migration') {
    const progressFile=file+'.progress';
    try {
      const information=await fs.lstat(progressFile);if(!information.isFile() || information.isSymbolicLink())throw new OkfError('UNSAFE_PATH','Migration progress must be an ordinary file.');
      const handle=await fs.open(progressFile,constants.O_RDONLY | constants.O_NOFOLLOW);let progress;
      try{progress=JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}
      if(progress?.version!==1 || progress.previewHash!==expected || progress.root!==root || !Array.isArray(progress.completed) || !Array.isArray(progress.conflicts) || !['prepared','applying','applied','conflict'].includes(progress.state))throw new OkfError('INVALID_JOURNAL','Migration progress does not match its retained preview.');
      journal={...journal,state:progress.state,completed:progress.completed,conflicts:progress.conflicts};
    } catch(error){if(!absent(error))throw error;}
  }
  if (!journal || journal.version !== 1 || journal.root !== root || !journal.preview || !Array.isArray(journal.completed) || !journal.recovery || typeof journal.recovery !== 'object' || !Array.isArray(journal.conflicts) || !['prepared', 'applying', 'applied', 'conflict'].includes(journal.state)) throw new OkfError('INVALID_JOURNAL', 'Durable journal metadata is invalid.', { journalPath: file });
  try { validatePreview(journal.preview); } catch { throw new OkfError('INVALID_JOURNAL', 'Durable journal preview is invalid.', { journalPath: file }); }
  if (journal.preview.previewHash !== expected || journal.preview.root !== root) throw new OkfError('INVALID_JOURNAL', 'Journal belongs to a different bundle or preview.', { journalPath: file });
  for (const [relative, recoveryFile] of Object.entries(journal.recovery)) if (typeof recoveryFile !== 'string' || !path.resolve(recoveryFile).startsWith(path.join(root, '.irudd-okf', 'recovery') + path.sep) || !journal.preview.changes.some(item => item.path === relative)) throw new OkfError('INVALID_JOURNAL', 'Journal recovery references must remain inside this bundle recovery directory.', { journalPath: file });
  if (journal.completed.some(item => typeof item !== 'string' || !journal.preview.changes.some(change => change.path === item))) throw new OkfError('INVALID_JOURNAL', 'Journal progress lists an unknown path.', { journalPath: file });
  return journal;
}
async function pathStates(bundle: Bundle, journal: Journal): Promise<MaintenanceJournalPath[]> {
  return Promise.all(journal.preview.changes.map(async change => {
    const current = await rawAt(bundle, change.path);
    const currentHash = current === null ? null : hash(current);
    return { path: change.path, state: currentHash === change.afterHash ? 'applied' : currentHash === change.expectedHash && !journal.completed.includes(change.path) && journal.state !== 'applied' ? 'untouched' : 'externally-changed', before: change.before, after: change.raw, currentHash, ...(journal.recovery[change.path] ? { recoveryPath: journal.recovery[change.path] } : {}) };
  }));
}
export async function inspectJournal(bundle: Bundle, digest: string): Promise<MaintenanceJournalResult> {
  const root = await canonicalDirectory(bundle.root);
  let file: string;
  try { file = await journalFile(bundle, digest); } catch (error) { if (absent(error)) throw new OkfError('JOURNAL_NOT_FOUND', 'No durable journal exists for this preview.'); throw error; }
  const journal = await loadJournal(file, root, digest);
  if (!journal) throw new OkfError('JOURNAL_NOT_FOUND', 'No durable journal exists for this preview.');
  const paths = await pathStates(bundle, journal);
  return { version: 1, bundle: bundle.name, previewHash: digest, journalPath: file, state: paths.some(item => item.state === 'externally-changed') ? 'conflict' : journal.state, preview: journal.preview, paths };
}
export async function applyJournal(bundle: Bundle, preview: MaintenancePreview, afterWrite?: (completed: number) => Promise<void>, beforeApply?: () => Promise<void>): Promise<MaintenanceResult> {
  validatePreview(preview);
  const root = await canonicalDirectory(bundle.root);
  if (preview.root !== root || preview.bundle !== bundle.name) throw new OkfError('INVALID_PREVIEW', 'Preview was produced for another canonical bundle.');
  return withLock(root, async () => {
    const file = await journalFile(bundle, preview.previewHash, true);
    let journal = await loadJournal(file, root, preview.previewHash);
    const resumed = journal !== null;
    if (journal && previewDigest(journal.preview) !== previewDigest(preview)) throw new OkfError('INVALID_JOURNAL', 'Preview differs from durable journal payload.', { journalPath: file });
    if (!journal) {
      journal = { version: 1, root, preview: structuredClone(preview), state: 'prepared', completed: [], recovery: {}, conflicts: [] };
      for (const change of preview.changes) if (change.before !== null) journal.recovery[change.path] = await recovery(root, change.before);
      await atomicCreate(file, JSON.stringify(journal, null, 2) + '\n');
    }
    const active = journal;
    const changedPaths: string[] = [];
    const persist = async () => {
      if(preview.purpose!=='migration')return atomicReplace(file,JSON.stringify(active,null,2)+'\n');
      const progressFile=file+'.progress',raw=JSON.stringify({version:1,previewHash:preview.previewHash,root,state:active.state,completed:active.completed,conflicts:active.conflicts})+'\n';
      try {
        const information=await fs.lstat(progressFile);if(!information.isFile() || information.isSymbolicLink())throw new OkfError('UNSAFE_PATH','Migration progress must remain an ordinary file.');
        await atomicReplace(progressFile,raw);
      }catch(error){if(!absent(error))throw error;await atomicCreate(progressFile,raw);}
    };
    const conflict = async (relative: string, current: string | null, message: string): Promise<never> => {
      const recoveryPath = current === null ? undefined : await recovery(root, current);
      for (const changedPath of [...changedPaths].reverse()) {
        const change = preview.changes.find(item => item.path === changedPath)!;
        const raw = await rawAt(bundle, changedPath);
        if ((raw === null ? null : hash(raw)) !== change.afterHash) continue;
        const destination = await guarded(bundle, changedPath, true);
        if (change.before === null) await fs.unlink(destination);
        else if (raw === null) await atomicCreate(destination, change.before);
        else await atomicReplace(destination, change.before);
        active.completed = active.completed.filter(item => item !== changedPath);
      }
      active.state = 'conflict';
      active.conflicts.push({ path: relative, actualHash: current === null ? null : hash(current), ...(recoveryPath ? { recoveryPath } : {}) });
      await persist();
      throw new OkfError('CONFLICT', message, { previewHash: preview.previewHash, journalPath: file, paths: await pathStates(bundle, active), conflicts: active.conflicts });
    };
    const inventory = new Set(preview.guards.map(item => item.path));
    for (const change of preview.changes) if (change.before === null) inventory.add(change.path);
    const checkInventory = async () => {
      for (const scanned of await scan(bundle)) if (!inventory.has(scanned.path)) await conflict(scanned.path, await rawAt(bundle, scanned.path), 'A new document appeared after preview. Review its backlinks and a fresh proposal.');
      for (const guard of preview.guards) {
        const current = await rawAt(bundle, guard.path);
        const actual = current === null ? null : hash(current);
        const change = preview.changes.find(item => item.path === guard.path);
        if (change && (active.completed.includes(change.path) || active.state === 'applied') && actual !== change.afterHash) await conflict(guard.path, current, 'A completed journal path differs from its recorded post-state. External restoration remains untouched.');
        if (actual !== guard.expectedHash && !(change && actual === change.afterHash && (resumed || active.completed.includes(change.path)))) await conflict(guard.path, current, 'A guarded source, index or backlink changed after preview. External edits remain untouched.');
      }
    };
    await checkInventory();
    for (const change of preview.changes) {
      const current = await rawAt(bundle, change.path);
      const actual = current === null ? null : hash(current);
      if ((active.completed.includes(change.path) || active.state === 'applied') && actual !== change.afterHash) await conflict(change.path, current, 'A completed journal destination differs from its recorded post-state.');
      // A process may stop after publication but before recording progress.
      if (!resumed && actual !== change.expectedHash) await conflict(change.path, current, 'A first apply destination changed after preview, even if it contains identical proposed bytes.');
      if (actual === change.afterHash && actual !== change.expectedHash && !active.completed.includes(change.path)) active.completed.push(change.path);
      else if (actual !== change.expectedHash && actual !== change.afterHash) await conflict(change.path, current, 'A proposal destination contains external edits. Recovery will not overwrite them.');
    }
    if (active.state === 'applied') return { version: 1, bundle: bundle.name, previewHash: preview.previewHash, changedPaths: [], journalPath: file, state: 'unchanged' };
    await beforeApply?.();
    active.state = 'applying'; await persist();
    for (const change of preview.changes) {
      let current = await rawAt(bundle, change.path);
      if ((current === null ? null : hash(current)) === change.afterHash) { if (!active.completed.includes(change.path)) active.completed.push(change.path); await persist(); continue; }
      if ((current === null ? null : hash(current)) !== change.expectedHash) await conflict(change.path, current, 'A document changed during apply. Retry will preserve its external edits.');
      const destination = await guarded(bundle, change.path, true);
      const beforePublish = async () => { if(preview.purpose!=='migration' || change.path==='memory-bundle.json')await checkInventory(); current = await rawAt(bundle, change.path); if ((current === null ? null : hash(current)) !== change.expectedHash) await conflict(change.path, current, 'A document changed before atomic publication.'); };
      if (change.raw === null) { await beforePublish(); await fs.unlink(destination); }
      else if (change.expectedHash === null) {
        try { await atomicCreate(destination, change.raw, beforePublish); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') await conflict(change.path, await rawAt(bundle, change.path), 'Another writer created the destination during apply.'); throw error; }
      } else { const mode = (await fs.stat(destination)).mode & 0o777; await atomicReplace(destination, change.raw, mode, beforePublish); }
      active.completed.push(change.path); changedPaths.push(change.path); await persist();
      try { await afterWrite?.(active.completed.length); } catch { throw new OkfError('INTERRUPTED', 'Maintenance stopped after durable progress. Inspect the journal and retry the same preview.', { previewHash: preview.previewHash, journalPath: file, paths: await pathStates(bundle, active) }); }
    }
    await checkInventory();
    active.state = 'applied'; await persist();
    return { version: 1, bundle: bundle.name, previewHash: preview.previewHash, changedPaths, journalPath: file, state: changedPaths.length ? 'applied' : 'unchanged' };
  });
}

export async function recoverBundleLock(bundle: Bundle): Promise<{lockRecovered:boolean;lockRecoveryPath?:string}> {
  const root = await canonicalDirectory(bundle.root);
  const file = path.join(root, '.irudd-okf', 'write.lock');
  let raw: string;
  let information;
  try {
    information = await fs.lstat(file);
    if (!information.isFile() || information.isSymbolicLink()) throw new OkfError('UNSAFE_PATH', 'Write lock must be an ordinary file.');
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { raw = await handle.readFile('utf8'); } finally { await handle.close(); }
  } catch (error) { if (absent(error)) return { lockRecovered: false }; throw error; }
  let owner: {pid?: unknown; startedAt?: unknown};
  try { owner = JSON.parse(raw); } catch { throw new OkfError('LOCK_OWNER_UNKNOWN', 'Write lock has no valid owner. Preserve it for manual inspection.', { lockPath: file }); }
  if (!owner || typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.startedAt !== 'string' || !Number.isFinite(Date.parse(owner.startedAt))) throw new OkfError('LOCK_OWNER_UNKNOWN', 'Write lock owner cannot be verified. Preserve it for manual inspection.', { lockPath: file });
  let stopped = false;
  try { process.kill(owner.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') stopped = true; else if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error; }
  if (!stopped) throw new OkfError('LOCK_OWNER_RUNNING', 'The write lock owner is still running or cannot be inspected. Recovery will not remove its lock.', { lockPath: file, ownerPid: owner.pid, startedAt: owner.startedAt });
  const lockRecoveryPath = await recovery(root, raw);
  const latest = await fs.lstat(file);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let latestRaw;
  try { latestRaw = await handle.readFile('utf8'); } finally { await handle.close(); }
  if (latest.isSymbolicLink() || latest.ino !== information.ino || latest.dev !== information.dev || latestRaw !== raw) throw new OkfError('CONFLICT', 'Write lock changed while recovery was being prepared. It remains untouched.', { lockPath: file, lockRecoveryPath });
  await fs.unlink(file);
  return { lockRecovered: true, lockRecoveryPath };
}

export async function recoverJournalLock(bundle: Bundle, digest: string): Promise<import('./contracts.ts').MaintenanceRecoveryResult> {
  await inspectJournal(bundle,digest);
  const recovery=await recoverBundleLock(bundle);
  return {...await inspectJournal(bundle,digest),...recovery};
}
