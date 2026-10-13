import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { describe, expect, it } from 'vite-plus/test';
import { Effect } from 'effect';
import {policyRaw} from '../../core/src/memory.ts';
import { createStore } from '../../core/src/index.ts';

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const loader = import.meta.resolve('tsx');
async function fixture(library=false) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'okf-memory-cli-')));
  const root = join(cwd, '.okf');
  const execute = (...args: string[]) => spawnSync(process.execPath, ['--import', loader, main, ...args], { cwd, encoding: 'utf8', env: { ...process.env, TSX_DISABLE_CACHE: '1', NODE_NO_WARNINGS: '1', XDG_CONFIG_HOME: join(cwd, 'config'), XDG_STATE_HOME: join(cwd, 'state') }, timeout: 60000 });
  const run = (...args: string[]) => {
    const result = execute(...args);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  };
  const json = async (name: string, value: unknown) => { const file = join(cwd, name); await writeFile(file, JSON.stringify(value)); return file; };
  run('init');
  if(!library)await import('node:fs/promises').then(fs => fs.unlink(join(root, 'memory-bundle.json')));
  const policy = parseDocument(policyRaw().split('---')[1]);
  policy.setIn(['memory_policy', 'namespaces'], ['shared', 'payments', 'platform']);
  if(!library)await writeFile(join(root, 'memory-policy.md'), `---\n${policy.toString()}---\n\n# Memory policy\n`);
  const store = createStore({ version: 1, cwd, gitRoot: null, configPath: join(cwd, 'config/config.json'), bundles: [{ name: 'repo', root, kind: 'explicit', writable: true }] });
  const read = (path: string) => Effect.runPromise(store.read('repo', path));
  return { cwd, root, run, execute, json, read };
}

describe('complete memory CLI workflows', () => {
  it('authors current-format memory through discovered templates and keeps generated proposals pending',async()=>{
    const f=await fixture(true);try {
      const request=await f.json('template.json',{kind:'semantic',title:'Discovered authoring',description:'A recorded task outcome.',tags:['tests'],actor:'agent:cli',applicability:{type:'global'}});
      const template=f.run('template','repo','--file',request);expect(template.raw).toContain('stage: bronze');expect(template.raw).toContain('applicability:');
      const candidate=await f.json('candidate.json',{path:'note.md',raw:template.raw,expectedHash:null,actor:{type:'agent',id:'actual-session'},reason:'Observed the task outcome.'});
      const change=f.run('change','propose','repo','--file',candidate);expect(change.status).toBe('pending');expect(change.display.afterMemory.applicability).toEqual({type:'global'});
      expect(f.run('cli','browse','change').entries.some((item:{command:string})=>item.command==='change review')).toBe(true);
      const decision=await f.json('review.json',{expectedRevisionHash:change.revisionHash,decision:'accept',actor:{type:'human',id:'operator'},operator:true,reason:'Checked task evidence.',sources:change.sources});
      f.run('change','review','repo',change.id,'--file',decision);expect(f.run('read','repo','note.md').raw).toBe(template.raw);
    }finally{await rm(f.cwd,{recursive:true,force:true});}
  },60000);

  it('forwards namespace union, explicit review, verification, task retention and lifecycle operations to core', async () => {
    const f = await fixture();
    try {
      expect(f.run('profile', 'repo').mode).toBe('memory');
      expect(f.run('namespaces', 'repo').namespaces).toEqual(['shared', 'payments', 'platform']);
      expect(f.run('bootstrap', 'repo').raw).toContain('agent-memory');
      for (const [path, kind, namespace] of [['shared.md', 'semantic', 'shared'], ['payments.md', 'procedural', 'payments'], ['platform.md', 'episodic', 'platform']]) {
        const request = await f.json('template.json', { kind, namespace, title: 'Adapter evidence', description: 'Evidence for CLI integration.', tags: ['testing'], actor: 'agent:test', sources: [{ resource: 'https://example.invalid/evidence', description: 'Exact source citation.', custom: { preserved: true } }], ...(kind === 'episodic' ? { task: { reference: 'task:42', state: 'open' } } : {}) });
        const template = f.run('template', 'repo', '--file', request);
        const source = join(f.cwd, 'note.md'); await writeFile(source, template.raw);
        f.run('write', 'repo', path, '--file', source, '--expected', 'new', '--namespace', namespace);
        expect(((await f.read(path)).metadata.sources as Array<{ custom: unknown }>)[0].custom).toEqual({ preserved: true });
      }
      const selected = f.run('search', 'Adapter evidence', '--namespace', 'payments', '--namespace', 'platform', '--limit', '1', '--offset', '1');
      expect(selected.total).toBe(3);
      expect(f.run('list', '--namespace', 'payments').concepts.filter((note: { path: string }) => note.path.endsWith('.md') && ['shared.md', 'payments.md', 'platform.md'].includes(note.path)).map((note: { path: string }) => note.path).sort()).toEqual(['payments.md', 'shared.md']);
      expect(f.run('graph', '--namespace', 'payments').nodes.some((note: { path: string }) => note.path === 'platform.md')).toBe(false);
      expect(f.run('index', 'repo', '--namespace', 'payments').raw).not.toContain('platform.md');
      const observed = () => f.read('payments.md');
      const denied = f.execute('review', 'repo', 'payments.md', '--decision', 'approve', '--actor', 'human:reviewer', '--reason', 'Checked evidence.', '--expected', (await observed()).hash);
      expect(denied.status).toBe(2);
      expect(JSON.parse(denied.stderr).error.code).toBe('HUMAN_REVIEW_AUTHORIZATION');
      f.run('review', 'repo', 'payments.md', '--decision', 'approve', '--actor', 'human:reviewer', '--reason', 'Checked evidence.', '--expected', (await observed()).hash, '--operator');
      expect((await observed()).memory?.humanReviewed).toBe(true);
      f.run('verify', 'repo', 'payments.md', '--actor', 'agent:checker', '--method', 'Checked linked evidence.', '--expected', (await observed()).hash);
      expect((await observed()).memory?.machineVerified).toBe(true);
      f.run('review', 'repo', 'payments.md', '--decision', 'reject', '--actor', 'agent:checker', '--reason', 'Contrary evidence found.', '--expected', (await observed()).hash);
      expect(f.run('search', 'Adapter evidence', '--namespace', 'payments').results.some((note: { path: string }) => note.path === 'payments.md')).toBe(false);
      expect(f.run('audit', '--namespace', 'payments').concepts.some((note: { path: string }) => note.path === 'payments.md')).toBe(true);
      f.run('lifecycle', 'repo', 'payments.md', '--action', 'archive', '--expected', (await observed()).hash);
      expect((await observed()).memory?.archived).toBe(true);
      f.run('lifecycle', 'repo', 'payments.md', '--action', 'restore', '--expected', (await observed()).hash);
      const episode = () => f.read('platform.md');
      const task = await f.json('task.json', { task: { reference: 'task:42', state: 'completed', completed_at: '2026-01-01T00:00:00.000Z' }, retentionDays: 0 });
      f.run('task', 'repo', 'platform.md', '--file', task, '--expected', (await episode()).hash);
      expect(((await episode()).metadata.memory as Record<string, unknown>).expires_at).toBe('2026-01-01T00:00:00.000Z');
      expect(f.run('search', 'Adapter evidence', '--include-excluded').total).toBe(3);
      f.run('lifecycle', 'repo', 'platform.md', '--action', 'clear-expiration', '--expected', (await episode()).hash);
      expect(((await episode()).metadata.memory as Record<string, unknown>).expires_at).toBeUndefined();
      f.run('lifecycle', 'repo', 'shared.md', '--action', 'recheck', '--at', '2099-01-01T00:00:00.000Z', '--expected', (await f.read('shared.md')).hash);
      expect((await f.read('shared.md')).metadata.stale_after).toBe('2099-01-01T00:00:00.000Z');
    } finally { await rm(f.cwd, { recursive: true, force: true }); }
  }, 300000);

  it('exposes JSON proposal previews, protected apply, recovery inspection and explicit migration', async () => {
    const f = await fixture();
    try {
      const proposal = await f.json('proposal.json', { version: 1, bundle: 'repo', purpose: 'maintenance', reason: 'Add a reviewed fixture.', changes: [{ path: 'new.md', expectedHash: null, raw: '---\ntype: Fact\ntitle: Proposed knowledge\n---\nEvidence.\n' }] });
      const preview = f.run('maintenance', 'preview', '--file', proposal);
      const unsupported = await f.json('unsupported-preview.json', { ...preview, unresolvedQuestions: ['Unavailable evidence.'] });
      const rejectedApply = f.execute('maintenance', 'apply', '--file', unsupported);
      expect(rejectedApply.status).toBe(2);
      expect(JSON.parse(rejectedApply.stderr).error.code).toBe('INVALID_REQUEST');
      await expect(readFile(join(f.root, 'new.md'))).rejects.toMatchObject({ code: 'ENOENT' });
      const file = await f.json('preview.json', preview);
      expect(f.run('maintenance', 'apply', '--file', file).state).toBe('applied');
      expect(f.run('maintenance', 'apply', '--file', file).state).toBe('unchanged');
      const journal = f.run('maintenance', 'inspect', 'repo', preview.previewHash);
      expect(journal.state).toBe('applied');
      expect(journal.paths[0].state).toBe('applied');
      expect(f.run('maintenance', 'recover', 'repo', preview.previewHash).lockRecovered).toBe(false);
      const legacy = join(f.cwd, 'legacy');
      await import('node:fs/promises').then(fs => fs.mkdir(legacy));
      await writeFile(join(legacy, 'index.md'), '---\nokf_version: "0.2"\n---\n# Knowledge\n[Legacy](legacy.md)\n');
      await writeFile(join(legacy, 'legacy.md'), '---\ntype: Fact\ncustom: preserved\n---\nExisting evidence.\n');
      const migration = await f.json('migration.json', { decisions: { 'legacy.md': { id: 'legacy-id', applicability: {type:'global'}, kind: 'semantic', stage: 'silver', actor: 'agent:migrator', at: '2026-01-01T00:00:00.000Z', title: 'Legacy knowledge', description: 'Migrated evidence.', tags: ['testing'], sources: ['https://example.invalid/evidence'], status: 'stable' } } });
      const migrated = f.run('--bundle', `legacy=${legacy}`, 'migration', 'preview', 'legacy', '--file', migration);
      expect(migrated.unresolved).toEqual([]);
      const migrationFile = await f.json('migration-preview.json', migrated);
      expect(f.run('--bundle', `legacy=${legacy}`, 'migration', 'apply', '--file', migrationFile).state).toBe('applied');
      expect(f.run('--bundle', `legacy=${legacy}`, 'migration', 'apply', '--file', migrationFile).state).toBe('unchanged');
      expect(f.run('--bundle', `legacy=${legacy}`, 'read', 'legacy', 'legacy.md', '--current').metadata.custom).toBe('preserved');
      const malformed = await f.json('invalid.json', { kind: 'semantic', tags: 42 });
      const rejected = f.execute('template', 'repo', '--file', malformed);
      expect(rejected.status).toBe(2);
      expect(JSON.parse(rejected.stderr).error.code).toBe('INVALID_REQUEST');
      const mismatch = await f.json('mismatch.json', { bundle: 'other' });
      expect(JSON.parse(f.execute('template', 'repo', '--file', mismatch).stderr).error.code).toBe('INVALID_INPUT');
    } finally { await rm(f.cwd, { recursive: true, force: true }); }
  }, 300000);
});
