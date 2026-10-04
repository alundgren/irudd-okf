import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { realpath, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const executable = resolve(process.argv[2] ?? 'build/irudd-okf');
const cwd = await realpath(await mkdtemp(resolve(tmpdir(), 'okf-native-')));
const environment = { ...process.env, PATH: '/nonexistent', XDG_CONFIG_HOME: resolve(cwd, 'config'), XDG_STATE_HOME: resolve(cwd, 'state') };
const run = (...args) => JSON.parse(execFileSync(executable, args, { cwd, encoding: 'utf8', env: environment }));
let server;
try {
  for (const args of [[], ['--help'], ['bundle'], ['search', '--help']]) {
    const result = spawnSync(executable, args, { cwd, encoding: 'utf8', env: environment });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /USAGE/);
    assert.equal(result.stderr, '');
  }
  const invalid = spawnSync(executable, ['search'], { cwd, encoding: 'utf8', env: environment });
  assert.equal(invalid.status, 2);
  assert.match(JSON.parse(invalid.stderr).error.message, /Missing required argument: query/);
  assert.equal(run('cli', 'schema', 'search').command, 'search');
  assert.match(run('licenses').text, /Node.js 26.10.0/);
  run('init');
  await writeFile(resolve(cwd, '.okf', 'test.md'), '---\ntype: Rule\ntitle: Native execution\n---\nValidate native execution without Node on PATH.\n');
  assert.equal(run('context').bundles.length, 1);
  assert.equal(run('search', 'native').results[0].path, 'test.md');
  assert.equal(run('validate').errors, 0);
  run('skill', 'install', resolve(cwd, 'skills'));
  assert.match(await readFile(resolve(cwd, 'skills/okf/SKILL.md'), 'utf8'), /name: okf/);
  const port = 20000 + Math.floor(Math.random() * 30000);
  server = spawn(executable, ['serve', '--port', String(port)], { cwd, env: environment, stdio: ['ignore', 'ignore', 'pipe'] });
  const origin = `http://127.0.0.1:${port}`;
  let html;
  for (let i = 0; i < 100; i++) {
    try { html = await (await fetch(`${origin}/wiki`)).text(); break; } catch { await new Promise(done => setTimeout(done, 100)); }
  }
  assert.match(html ?? '', /okf-session/);
  assert.match(html ?? '', /<script/);
  const capability = html.match(/name="okf-session" content="([a-f0-9]+)"/)[1];
  const result = await fetch(`${origin}/api/search?q=native`, { headers: { 'X-OKF-Session': capability } });
  assert.equal((await result.json()).results[0].path, 'test.md');
  assert.equal((await fetch(`${origin}/api/context`)).status, 403);
  console.log(JSON.stringify({ version: 1, platform: process.platform, arch: process.arch, checks: ['standalone-without-node', 'help', 'invalid-arguments', 'files', 'search', 'validation', 'embedded-skill', 'embedded-viewer', 'session-authorization'], passed: true }));
} finally {
  if (server) { server.kill('SIGTERM'); await new Promise(done => { server.once('exit', done); setTimeout(done, 1000); }); }
  await rm(cwd, { recursive: true, force: true });
}
