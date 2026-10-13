import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { realpath, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const executable = resolve(process.argv[2] ?? (process.platform === 'win32' ? 'build/irudd-okf.exe' : 'build/irudd-okf'));
const cwd = await realpath(await mkdtemp(resolve(tmpdir(), 'okf-native-')));
const environment = { ...process.env, PATH: '/nonexistent', XDG_CONFIG_HOME: resolve(cwd, 'config'), XDG_STATE_HOME: resolve(cwd, 'state'), CODEX_HOME: resolve(cwd, 'codex'), CLAUDE_CONFIG_DIR: resolve(cwd, 'claude') };
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
  assert.equal(run('profile', 'repo').mode, 'memory');
  assert.ok(run('namespaces', 'repo').namespaces.includes('shared'));
  assert.match(run('bootstrap', 'repo').raw, /agent-memory/);
  const templateRequest = resolve(cwd, 'template.json');
  await writeFile(templateRequest, JSON.stringify({ kind: 'episodic', title: 'Native episode', description: 'Packaged task lifecycle.', tags: ['testing'], actor: 'agent:native-smoke', sources: ['https://example.invalid/evidence'], task: { reference: 'task:native', state: 'open' } }));
  const episodeFile = resolve(cwd, 'episode.md');
  await writeFile(episodeFile, run('template', 'repo', '--file', templateRequest).raw);
  run('write', 'repo', 'episode.md', '--file', episodeFile, '--expected', 'new', '--namespace', 'shared');
  const episode = () => run('read', 'repo', 'episode.md');
  assert.ok(['draft', 'stable'].includes(episode().metadata.status));
  run('verify', 'repo', 'episode.md', '--actor', 'agent:checker', '--method', 'Checked source evidence.', '--expected', episode().hash);
  assert.equal(episode().memory.machineVerified, true);
  run('review', 'repo', 'episode.md', '--actor', 'human:operator', '--decision', 'approve', '--reason', 'Checked observed episode.', '--expected', episode().hash, '--operator');
  assert.equal(episode().memory.humanReviewed, true);
  const taskFile = resolve(cwd, 'task.json');
  await writeFile(taskFile, JSON.stringify({ task: { reference: 'task:native', state: 'completed', completed_at: '2020-01-01T00:00:00.000Z' }, retentionDays: 0 }));
  run('task', 'repo', 'episode.md', '--file', taskFile, '--expected', episode().hash);
  assert.equal(run('search', 'Native episode', '--namespace', 'shared').results.some(note => note.path === 'episode.md'), false);
  assert.equal(run('audit', '--namespace', 'shared').concepts.some(note => note.path === 'episode.md'), true);
  run('lifecycle', 'repo', 'episode.md', '--action', 'clear-expiration', '--expected', episode().hash);
  assert.equal(episode().metadata.memory.expires_at, undefined);
  run('lifecycle', 'repo', 'episode.md', '--action', 'archive', '--expected', episode().hash);
  assert.equal(episode().memory.archived, true);
  run('lifecycle', 'repo', 'episode.md', '--action', 'restore', '--expected', episode().hash);
  const proposalFile = resolve(cwd, 'proposal.json');
  await writeFile(proposalFile, JSON.stringify({ version: 1, bundle: 'repo', purpose: 'maintenance', reason: 'Add exact reviewed file.', changes: [{ path: 'packaged.md', expectedHash: null, raw: '---\ntype: Fact\ntitle: Packaged proposal\n---\nJournal behavior.\n' }] }));
  const maintenance = run('maintenance', 'preview', '--file', proposalFile);
  const previewFile = resolve(cwd, 'preview.json'); await writeFile(previewFile, JSON.stringify(maintenance));
  assert.equal(run('maintenance', 'apply', '--file', previewFile).state, 'applied');
  assert.equal(run('maintenance', 'apply', '--file', previewFile).state, 'unchanged');
  assert.equal(run('maintenance', 'inspect', 'repo', maintenance.previewHash).state, 'applied');
  assert.equal(run('maintenance', 'recover', 'repo', maintenance.previewHash).lockRecovered, false);
  assert.equal(run('migration', 'preview', 'repo').purpose, 'migration');
  const legacyRoot = resolve(cwd, 'legacy'); await mkdir(legacyRoot);
  await writeFile(resolve(legacyRoot, 'index.md'), '---\nokf_version: "0.2"\n---\n[Legacy](legacy.md)\n');
  await writeFile(resolve(legacyRoot, 'legacy.md'), '---\ntype: Fact\ncustom: preserved\n---\nLegacy evidence.\n');
  const migrationRequest = resolve(cwd, 'migration.json');
  await writeFile(migrationRequest, JSON.stringify({ decisions: { 'legacy.md': { kind: 'semantic', stage: 'silver', actor: 'agent:migrator', at: '2026-01-01T00:00:00.000Z', title: 'Legacy fact', description: 'Preserved knowledge.', tags: ['testing'], sources: ['https://example.invalid/evidence'], status: 'stable' } } }));
  const migrated = run('--bundle', `legacy=${legacyRoot}`, 'migration', 'preview', 'legacy', '--file', migrationRequest);
  assert.deepEqual(migrated.unresolved, []);
  const migratedFile = resolve(cwd, 'migration-preview.json'); await writeFile(migratedFile, JSON.stringify(migrated));
  assert.equal(run('--bundle', `legacy=${legacyRoot}`, 'migration', 'apply', '--file', migratedFile).state, 'applied');
  assert.equal(run('--bundle', `legacy=${legacyRoot}`, 'migration', 'apply', '--file', migratedFile).state, 'unchanged');
  assert.equal(run('--bundle', `legacy=${legacyRoot}`, 'read', 'legacy', 'legacy.md').metadata.custom, 'preserved');
  await writeFile(resolve(cwd, '.okf', 'test.md'), '---\ntype: Rule\ntitle: Native execution\n---\nValidate native execution without Node on PATH.\n');
  assert.equal(run('context').bundles.length, 1);
  assert.equal(run('search', 'native').results.some(note => note.path === 'test.md'), true);
  assert.equal(run('validate').errors, 0);
  run('init', resolve(cwd, 'personal'));
  run('bundle', 'add', 'personal', resolve(cwd, 'personal'), '--activate');
  const personalSource = resolve(cwd, 'personal-note.md'); await writeFile(personalSource, '---\ntype: Fact\n---\nAuthorized personal example.\n');
  const deniedWrite = spawnSync(executable, ['write', 'personal', 'note.md', '--file', personalSource, '--expected', 'new'], { cwd, encoding: 'utf8', env: environment });
  assert.equal(deniedWrite.status, 2);
  run('write', 'personal', 'note.md', '--file', personalSource, '--expected', 'new', '--authorize-personal');
  const preview = run('instructions', 'install', 'codex', 'personal', '--dry-run');
  assert.equal(preview.changed, true); assert.equal(preview.dryRun, true);
  for (const provider of ['codex', 'claude']) {
    assert.equal(run('instructions', 'install', provider, 'personal').changed, true);
    assert.equal(run('instructions', 'install', provider, 'personal').changed, false);
    assert.equal(run('instructions', 'status', provider).installed, true);
    assert.match(await readFile(resolve(cwd, provider, provider === 'codex' ? 'AGENTS.md' : 'CLAUDE.md'), 'utf8'), /root and relevant topic indexes/);
    assert.equal(run('instructions', 'remove', provider).installed, false);
  }
  run('skill', 'install', resolve(cwd, 'skills'));
  assert.match(await readFile(resolve(cwd, 'skills/okf/SKILL.md'), 'utf8'), /name: okf/);
  for (const name of ['okf-librarian', 'okf-memory-reviewer']) {
    const installed = run('skill', 'install', resolve(cwd, 'skills'), '--name', name);
    assert.deepEqual(installed.files, ['SKILL.md', 'references/workflow.md']);
    const skillPath = resolve(cwd, 'skills', name, 'SKILL.md');
    assert.match(await readFile(skillPath, 'utf8'), new RegExp(`name: ${name}`));
    assert.ok((await readFile(resolve(cwd, 'skills', name, 'references/workflow.md'), 'utf8')).length > 100);
    await writeFile(skillPath, 'Customized skill.\n');
    const repeat = spawnSync(executable, ['skill', 'install', resolve(cwd, 'skills'), '--name', name], { cwd, encoding: 'utf8', env: environment });
    assert.equal(repeat.status, 2);
    assert.equal(JSON.parse(repeat.stderr).error.code, 'SKILL_INSTALL_FAILED');
    assert.equal(await readFile(skillPath, 'utf8'), 'Customized skill.\n');
  }
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
  assert.equal((await result.json()).results.some(note => note.path === 'test.md'), true);
  assert.equal((await (await fetch(`${origin}/api/profile?bundle=repo`, { headers: { 'X-OKF-Session': capability } })).json()).mode, 'memory');
  assert.equal((await (await fetch(`${origin}/api/maintenance/journal?bundle=repo&previewHash=${maintenance.previewHash}`, { headers: { 'X-OKF-Session': capability } })).json()).state, 'applied');
  assert.equal((await fetch(`${origin}/api/context`)).status, 403);
  console.log(JSON.stringify({ version: 1, platform: process.platform, arch: process.arch, checks: ['standalone-without-node', 'help', 'invalid-arguments', 'files', 'search', 'validation', 'memory-profile-bootstrap', 'authoring-template', 'review-verification', 'task-lifecycle-audit', 'maintenance-preview-apply-inspection', 'migration-preview-apply-retry', 'personal-write-authorization', 'owned-provider-instructions', 'embedded-skills', 'exclusive-skill-install', 'embedded-viewer', 'session-authorization'], passed: true }));
} finally {
  if (server) { server.kill('SIGTERM'); await new Promise(done => { server.once('exit', done); setTimeout(done, 1000); }); }
  await rm(cwd, { recursive: true, force: true });
}
