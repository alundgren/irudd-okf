import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const directory = await mkdtemp(resolve(tmpdir(), 'okf-installer-'));
const asset = `irudd-okf-${process.platform}-${process.arch}.tar.gz`;
execFileSync('tar', ['-czf', resolve(directory, asset), '-C', 'build', 'irudd-okf']);
const archive = await readFile(resolve(directory, asset));
let corrupt = false;
const server = createServer((req, res) => { if (req.url?.endsWith('SHA256SUMS')) res.end(`${corrupt ? '0'.repeat(64) : createHash('sha256').update(archive).digest('hex')}  ${asset}\n`); else res.end(archive); });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const installDirectory = resolve(directory, 'path with spaces', 'bin');
const run = () => new Promise((done, reject) => {
  const child = spawn('bash', ['install.sh'], { env: { ...process.env, OKF_INSTALL_DIR: installDirectory, OKF_DOWNLOAD_BASE: `http://127.0.0.1:${server.address().port}` }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; }); child.once('error', reject); child.once('exit', code => done({ code, stderr }));
});
try {
  assert.equal((await run()).code, 0);
  assert.match(execFileSync(resolve(installDirectory, 'irudd-okf'), ['--version'], { encoding: 'utf8' }), /0\.1\.0/);
  const before = await readFile(resolve(installDirectory, 'irudd-okf'));
  corrupt = true; const failure = await run();
  assert.notEqual(failure.code, 0); assert.match(failure.stderr, /Checksum mismatch/);
  assert.deepEqual(await readFile(resolve(installDirectory, 'irudd-okf')), before);
  console.log(JSON.stringify({ version: 1, checks: ['install-path-spaces', 'executable-runs', 'checksum-rejection', 'existing-install-preserved'], passed: true }));
} finally { await new Promise(done => server.close(done)); await rm(directory, { recursive: true, force: true }); }
