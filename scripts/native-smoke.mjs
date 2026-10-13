import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const executable = resolve(process.argv[2] ?? (process.platform === 'win32' ? 'build/irudd-okf.exe' : 'build/irudd-okf'));
const cwd = await realpath(await mkdtemp(resolve(tmpdir(), 'okf-native-')));
const environment = { ...process.env, PATH: '/nonexistent', XDG_CONFIG_HOME: resolve(cwd, 'config'), XDG_STATE_HOME: resolve(cwd, 'state'), CODEX_HOME: resolve(cwd, 'codex'), CLAUDE_CONFIG_DIR: resolve(cwd, 'claude') };
const run = (...args) => JSON.parse(execFileSync(executable, args, { cwd, encoding: 'utf8', env: environment }));
const actor = { type: 'agent', id: 'native-smoke' };
let requestNumber = 0;
const request = async (value) => {
  const file = resolve(cwd, `request-${++requestNumber}.json`);
  await writeFile(file, JSON.stringify(value));
  return file;
};
const review = async (change, decision = 'accept') => run('change', 'review', 'repo', change.id, '--file', await request({
  expectedRevisionHash: change.revisionHash, decision, actor: { type: 'human', id: 'native-operator' },
  reason: 'Checked the synthetic packaged change.', operator: true, sources: change.sources,
}));
const raw = (id, title, body, applicability = { type: 'global' }) => `---\ntype: Fact\ntitle: ${title}\ndescription: Packaged memory example.\ntags: [testing]\nstatus: stable\ngenerated:\n  by: agent:native-smoke\n  at: "2026-01-01T00:00:00.000Z"\nstale_after: "2099-01-01T00:00:00.000Z"\nmemory:\n  id: ${id}\n  kind: semantic\n  stage: bronze\n  applicability: ${JSON.stringify(applicability)}\n---\n\n${body}\n`;
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
  assert.notEqual(spawnSync(executable, ['serve'], { cwd, encoding: 'utf8', env: environment }).status, 0);
  assert.equal(run('cli', 'schema', 'search').command, 'search');
  assert.equal(run('cli', 'schema', 'change', 'review').command, 'change review');
  assert.ok(run('cli', 'search', 'review memory change').results.length > 0);
  assert.match(run('licenses').text, /Node.js 26.10.0/);

  run('init');
  const inspection = run('bundle', 'inspect', 'repo');
  assert.equal(inspection.status, 'current');
  assert.equal(inspection.formatVersion, inspection.supportedFormatVersion);
  assert.equal(run('context').gitRoot, null);
  assert.equal(run('profile', 'repo').mode, 'memory');
  const template = run('template', 'repo', '--file', await request({ kind: 'semantic', title: 'Template example', description: 'Current-format authoring.', tags: [], actor: 'native-smoke', applicability: { type: 'global' } }));
  const authored = run('change', 'propose', 'repo', '--file', await request({ path: 'template.md', raw: template.raw, expectedHash: null, actor, reason: 'Check native template output.' }));
  assert.equal(authored.status, 'pending');
  assert.match(authored.after.raw, /applicability/);
  await review(authored, 'reject');

  const initialRaw = raw(randomUUID(), 'Native execution', 'Keep the reviewed native result.');
  const created = run('change', 'propose', 'repo', '--file', await request({ path: 'native.md', raw: initialRaw, expectedHash: null, actor, reason: 'Capture native evidence.' }));
  assert.equal(created.status, 'pending');
  assert.equal(run('search', 'Native execution').results.length, 0);
  await review(created);
  const accepted = run('read', 'repo', 'native.md');
  assert.equal(accepted.raw, initialRaw);
  assert.equal(run('search', 'Native execution').results[0].path, 'native.md');
  assert.ok(run('browse', 'repo').entries.some(entry => entry.path === 'native.md'));

  const changed = run('change', 'propose', 'repo', '--file', await request({ path: 'native.md', raw: initialRaw.replace('Keep the reviewed native result.', 'Pending replacement text.'), expectedHash: accepted.hash, actor, reason: 'Propose a corrected result.' }));
  assert.equal(run('read', 'repo', 'native.md').raw, initialRaw);
  assert.match(run('change', 'read', 'repo', changed.id).after.raw, /Pending replacement text/);
  await review(changed, 'reject');
  assert.equal(run('read', 'repo', 'native.md').raw, initialRaw);
  assert.equal(run('change', 'list', 'repo', '--status', 'pending').changes.length, 0);

  const removed = run('change', 'propose', 'repo', '--file', await request({ path: 'native.md', raw: null, expectedHash: run('read', 'repo', 'native.md').hash, actor, reason: 'Review reversible removal.' }));
  assert.equal(run('read', 'repo', 'native.md').raw, initialRaw);
  await review(removed);
  assert.equal(run('search', 'Native execution').results.length, 0);
  const restored = run('change', 'undo', 'repo', removed.id, '--file', await request({ expectedRevisionHash: removed.revisionHash, actor, reason: 'Restore retained evidence.' }));
  await review(restored);
  assert.equal(run('read', 'repo', 'native.md').raw, initialRaw);

  const scoped = run('change', 'propose', 'repo', '--file', await request({ path: 'machine.md', raw: raw(randomUUID(), 'Machine-specific example', 'Only this machine uses the example.', { type: 'machine', id: 'example-machine' }), expectedHash: null, actor, reason: 'Capture explicit machine applicability.' }));
  await review(scoped);
  assert.equal(run('search', 'Machine-specific example').results.some(note => note.path === 'machine.md'), false);
  assert.equal(run('search', 'Machine-specific example', '--machine', 'example-machine').results.some(note => note.path === 'machine.md'), true);
  assert.equal(run('validate').errors, 0);

  const legacy = resolve(cwd, 'legacy');
  await mkdir(legacy);
  await writeFile(resolve(legacy, 'index.md'), '---\nokf_version: "0.2"\n---\n# Knowledge\n\n[Legacy](legacy.md)\n');
  await writeFile(resolve(legacy, 'legacy.md'), '---\ntype: Fact\ncustom: preserved\n---\nLegacy evidence.\n');
  const legacyArgs = ['--bundle', `legacy=${legacy}`];
  assert.equal(run(...legacyArgs, 'bundle', 'inspect', 'legacy').status, 'migration-required');
  const guide = run(...legacyArgs, 'migration', 'guide', 'legacy');
  assert.ok(guide.instructions.length > 0);
  assert.ok(guide.questions.some(question => question.path === 'legacy.md'));
  const migrationInput = await request({ decisions: { 'legacy.md': {
    id: 'legacy-native-example', kind: 'semantic', stage: 'bronze', applicability: { type: 'global' },
    actor: 'agent:native-migrator', at: '2026-01-01T00:00:00.000Z', title: 'Legacy fact',
    description: 'Preserved native migration example.', tags: ['testing'], status: 'stable',
    staleAfter: '2099-01-01T00:00:00.000Z', sources: ['https://example.invalid/evidence'],
  } } });
  const migration = run(...legacyArgs, 'migration', 'preview', 'legacy', '--file', migrationInput);
  assert.deepEqual(migration.unresolved, []);
  const migrationPreview = await request(migration);
  assert.equal(run(...legacyArgs, 'migration', 'apply', '--file', migrationPreview).state, 'applied');
  assert.equal(run(...legacyArgs, 'bundle', 'inspect', 'legacy').status, 'current');
  assert.equal(run(...legacyArgs, 'read', 'legacy', 'legacy.md', '--current').metadata.custom, 'preserved');
  assert.equal(run(...legacyArgs, 'migration', 'apply', '--file', migrationPreview).state, 'unchanged');
  const journal = run(...legacyArgs, 'maintenance', 'inspect', 'legacy', migration.previewHash);
  assert.equal(journal.state, 'applied');
  assert.ok(journal.paths.some(path => path.path === 'legacy.md' && path.before.includes('custom: preserved')));
  assert.equal(run(...legacyArgs, 'maintenance', 'recover', 'legacy', migration.previewHash).lockRecovered, false);

  const personal = resolve(cwd, 'personal');
  run('init', personal);
  run('bundle', 'add', 'personal', personal, '--activate');
  const deniedFile = await request({ path: 'note.md', raw: raw(randomUUID(), 'Personal example', 'Requires personal write authority.'), expectedHash: null, actor, reason: 'Authorization example.' });
  const denied = spawnSync(executable, ['change', 'propose', 'personal', '--file', deniedFile], { cwd, encoding: 'utf8', env: environment });
  assert.equal(denied.status, 2);
  assert.equal(run('change', 'propose', 'personal', '--file', deniedFile, '--authorize-personal').status, 'pending');
  for (const provider of ['codex', 'claude']) {
    assert.equal(run('instructions', 'install', provider, 'personal', '--dry-run').dryRun, true);
    assert.equal(run('instructions', 'install', provider, 'personal').changed, true);
    assert.equal(run('instructions', 'install', provider, 'personal').changed, false);
    assert.equal(run('instructions', 'status', provider).installed, true);
    assert.match(await readFile(resolve(cwd, provider, provider === 'codex' ? 'AGENTS.md' : 'CLAUDE.md'), 'utf8'), /migration|format/i);
    assert.equal(run('instructions', 'remove', provider).installed, false);
  }
  for (const name of ['okf', 'okf-librarian', 'okf-memory-reviewer']) {
    const installed = run('skill', 'install', resolve(cwd, 'skills'), '--name', name);
    assert.ok(installed.files.includes('SKILL.md'));
    const skillPath = resolve(cwd, 'skills', name, 'SKILL.md');
    assert.match(await readFile(skillPath, 'utf8'), new RegExp(`name: ${name}`));
    await writeFile(skillPath, 'Customized skill.\n');
    const repeat = spawnSync(executable, ['skill', 'install', resolve(cwd, 'skills'), '--name', name], { cwd, encoding: 'utf8', env: environment });
    assert.equal(repeat.status, 2);
    assert.equal(JSON.parse(repeat.stderr).error.code, 'SKILL_INSTALL_FAILED');
    assert.equal(await readFile(skillPath, 'utf8'), 'Customized skill.\n');
  }
  console.log(JSON.stringify({ version: 1, platform: process.platform, arch: process.arch, checks: ['standalone-without-node-or-git', 'cli-only', 'discovery', 'bundle-format', 'authoring-template', 'pending-recall', 'review-rejection', 'reversible-removal', 'machine-applicability', 'migration-guide-preview-apply-retry-recovery', 'personal-authorization', 'provider-instructions', 'embedded-skills'], passed: true }));
} finally {
  await rm(cwd, { recursive: true, force: true });
}
