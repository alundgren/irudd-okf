import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Effect } from 'effect';

export const hash = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex');
export const operation = thunk => Effect.tryPromise({ try: thunk, catch: error => error });
export const json = async (file, data) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n'); };
export const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export const write = async (root, file, content) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), content); };
export function outside(workspace, evaluator) {
  const rel = path.relative(path.resolve(workspace), path.resolve(evaluator));
  if (!rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))) throw new Error('Evaluator artifacts must be outside the agent workspace.');
}
export async function inventory(root, { allowSymlinks = false } = {}) {
  const entries = [];
  async function visit(dir) {
    for (const item of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name === '.git') continue;
      const file = path.join(dir, item.name);
      if (item.isSymbolicLink()) {
        if (!allowSymlinks) throw new Error('Benchmark workspaces cannot contain symbolic links.');
        const target = await fs.readlink(file);
        entries.push({ path: path.relative(root, file), hash: hash(target), symlink_target: target, bytes: Buffer.byteLength(target) });
        continue;
      }
      if (item.isDirectory()) await visit(file);
      else entries.push({ path: path.relative(root, file), hash: hash(await fs.readFile(file)), bytes: (await fs.stat(file)).size });
    }
  }
  await visit(root);
  return entries;
}
export function command(executable, args, options = {}) {
  return new Promise(resolve => {
    const start = performance.now(), grouped = process.platform !== 'win32';
    let child, stdout = '', stderr = '', timedOut = false, processError = null, finished = false;
    let timeout, escalation, deadline;
    const stop = signal => {
      if (!child?.pid) return;
      try { grouped ? process.kill(-child.pid, signal) : child.kill(signal); } catch (error) { if (error.code !== 'ESRCH') processError ??= { code: error.code, message: error.message }; }
      if (!grouped && signal === 'SIGKILL') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => {});
    };
    const finish = (code, signal, forced = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout); clearTimeout(escalation); clearTimeout(deadline);
      // The detached process group belongs to this invocation, including its ordinary descendants.
      stop('SIGKILL');
      child?.stdin.destroy(); child?.stdout.destroy(); child?.stderr.destroy(); child?.unref();
      resolve({ code, signal, stdout, stderr, timed_out: timedOut, error: processError, wall_time_ms: performance.now() - start, process_tree_cleanup: grouped ? 'SIGKILL to owned process group; descendants that create another group are outside this cleanup boundary' : 'taskkill /T /F on Windows', forced_stream_close: forced });
    };
    try { child = spawn(executable, args, { cwd: options.cwd, env: options.env ?? process.env, detached: grouped, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) { processError = { code: error.code, message: error.message }; finish(null, null); return; }
    const grace = options.killGraceMs ?? 100;
    timeout = setTimeout(() => {
      timedOut = true; stop('SIGTERM');
      escalation = setTimeout(() => stop('SIGKILL'), grace);
      // A descendant that escaped the group can keep inherited pipes open. Do not wait forever.
      deadline = setTimeout(() => finish(child.exitCode, child.signalCode, true), grace + 100);
    }, options.timeoutMs ?? 300000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') processError = { code: error.code, message: error.message }; });
    child.on('error', error => { processError = { code: error.code, message: error.message }; });
    child.on('close', finish);
    child.stdin.end(options.input ?? '');
  });
}
export function rng(seed) {
  let state = seed >>> 0;
  return () => { state = Math.imul(1664525, state) + 1013904223 >>> 0; return state / 4294967296; };
}
export function shuffle(values, seed) {
  const output = [...values], random = rng(seed);
  for (let i = output.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [output[i], output[j]] = [output[j], output[i]]; }
  return output;
}
