import { describe, expect, it } from 'vite-plus/test';
import { Effect, Fiber, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { NodeHttpServer } from '@effect/platform-node';
import { createServer, request } from 'node:http';
import { realpath, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoutes } from '../src/server.ts';
import { createStore } from '../../core/src/store.ts';
import { OkfError, type Store } from '../../core/src/contracts.ts';

const store = {
  context: { version: 1, cwd: '/test', gitRoot: null, configPath: '/test/config.json', bundles: [] },
  list: () => Effect.succeed([]),
  save: () => Effect.fail(new OkfError('EDIT_CONFLICT', 'Observed file changed.')),
} as unknown as Store;
const session = 'test-session';
describe('local HTTP capability boundary', () => {
  it('passes repeated namespace and audit selection to core before retrieval', async () => {
    const requests: unknown[] = [];
    const selected = { ...store, list: (bundle: unknown, options: unknown) => { requests.push({ bundle, options }); return Effect.succeed([]); }, search: (query: unknown, options: unknown) => { requests.push({ query, options }); return Effect.succeed({ results: [], total: 0 }); }, graph: (options: unknown) => { requests.push({ options }); return Effect.succeed({ nodes: [] }); }, index: (bundle: unknown, path: unknown, options: unknown) => { requests.push({ bundle, path, options }); return Effect.succeed({ raw: '' }); }, audit: (options: unknown) => { requests.push({ options }); return Effect.succeed({ concepts: [] }); } } as unknown as Store;
    const web = HttpRouter.toWebHandler(createRoutes(selected, session, '<head>'), { disableLogger: true });
    try {
      for (const path of ['list', 'search', 'graph', 'index', 'audit']) {
        const result = await web.handler(new Request(`http://localhost:3210/api/${path}?bundle=repo&namespace=payments&namespace=platform&includeExcluded=true`, { headers: { host: 'localhost:3210', 'x-okf-session': session } }));
        expect(result.status).toBe(200);
      }
      expect(requests).toHaveLength(5);
      expect(requests.every(value => JSON.stringify(value).includes('"namespaces":["payments","platform"]'))).toBe(true);
      expect(requests.slice(0, 4).every(value => JSON.stringify(value).includes('"includeExcluded":true'))).toBe(true);
      const invalid = await web.handler(new Request('http://localhost:3210/api/list?includeExcluded=perhaps', { headers: { host: 'localhost:3210', 'x-okf-session': session } }));
      expect(invalid.status).toBe(400);
    } finally { await web.dispose(); }
  });

  it('exposes every memory operation using core-owned request schemas and the existing session boundary', async () => {
    const observed: string[] = [];
    const method = (name: string) => (input: unknown) => { observed.push(name); return Effect.succeed({ input }); };
    const adapter = { ...store, profile: method('profile'), namespaces: method('namespaces'), bootstrap: method('bootstrap'), inspectMaintenance: method('inspectMaintenance'), recoverMaintenance: method('recoverMaintenance'), template: method('template'), review: method('review'), verify: method('verify'), updateTask: method('updateTask'), lifecycle: method('lifecycle'), previewMaintenance: method('previewMaintenance'), applyMaintenance: method('applyMaintenance'), previewMigration: method('previewMigration'), applyMigration: method('applyMigration') } as unknown as Store;
    const web = HttpRouter.toWebHandler(createRoutes(adapter, session, '<head>'), { disableLogger: true });
    const mutation = { bundle: 'repo', path: 'note.md', expectedHash: 'a'.repeat(64) };
    const preview = { version: 1, bundle: 'repo', root: '/example/bundle', purpose: 'maintenance', reason: 'Reviewed changes.', previewHash: 'b'.repeat(64), changes: [], guards: [], diagnostics: [], unresolved: [], allowNamespaceChange: false };
    const operations: Array<[string, unknown]> = [
      ['template', { bundle: 'repo', kind: 'semantic', title: 'Knowledge', description: 'Evidence.', tags: ['testing'], actor: 'agent:test' }],
      ['review', { ...mutation, decision: 'approve', actor: 'human:reviewer', reason: 'Checked evidence.', operator: true }],
      ['verify', { ...mutation, actor: 'agent:checker', method: 'Checked evidence.' }],
      ['task', { ...mutation, task: { reference: 'task:42', state: 'completed' }, retentionDays: null, retentionReason: null }],
      ['lifecycle', { ...mutation, action: 'clear-expiration' }],
      ['maintenance/preview', { version: 1, bundle: 'repo', purpose: 'consolidation', reason: 'Reviewed lineage.', changes: [] }],
      ['maintenance/apply', { preview, authorizePersonal: true }],
      ['maintenance/recover', { bundle: 'repo', previewHash: 'b'.repeat(64), authorizePersonal: true }],
      ['migration/preview', { bundle: 'repo', decisions: { 'legacy.md': { raw: '---\ntype: Fact\n---\nEvidence.' } } }],
      ['migration/apply', { preview: { ...preview, purpose: 'migration' } }],
    ];
    const post = (path: string, body: unknown, authorized = true) => web.handler(new Request(`http://localhost:3210/api/${path}`, { method: 'POST', headers: { host: 'localhost:3210', 'content-type': 'application/json', ...(authorized ? { 'x-okf-session': session } : {}) }, body: JSON.stringify(body) }));
    try {
      for (const path of ['profile', 'namespaces', 'bootstrap', 'maintenance/journal']) {
        expect((await web.handler(new Request(`http://localhost:3210/api/${path}?bundle=repo&previewHash=${'b'.repeat(64)}`, { headers: { host: 'localhost:3210', 'x-okf-session': session } }))).status).toBe(200);
      }
      for (const [path, data] of operations) {
        expect((await post(path, data)).status).toBe(200);
        expect((await post(path, data, false)).status).toBe(403);
        expect((await post(path, {})).status).toBe(400);
      }
      expect(observed).toEqual(['profile', 'namespaces', 'bootstrap', 'inspectMaintenance', 'template', 'review', 'verify', 'updateTask', 'lifecycle', 'previewMaintenance', 'applyMaintenance', 'recoverMaintenance', 'previewMigration', 'applyMigration']);
      expect((await post('review', { ...mutation, decision: 'approve', actor: 'human:reviewer', reason: 'Checked evidence.', operator: false })).status).toBe(400);
    } finally { await web.dispose(); }
  });
  it('supports absent optional edit flags through the real file engine', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'okf-api-edit-')));
    const root = join(directory, '.okf'); await mkdir(root);
    await writeFile(join(root, 'rule.md'), '---\ntype: Rule\n---\nOriginal.\n');
    const real = createStore({ version: 1, cwd: directory, gitRoot: null, configPath: join(directory, 'config.json'), bundles: [{ name: 'repo', root, kind: 'explicit', writable: true }] });
    const web = HttpRouter.toWebHandler(createRoutes(real, session, '<head>'), { disableLogger: true });
    const post = (route: string, value: unknown) => web.handler(new Request(`http://localhost:3210${route}`, { method: 'POST', headers: { host: 'localhost:3210', 'x-okf-session': session, 'content-type': 'application/json' }, body: JSON.stringify(value) }));
    try {
      const concept = await Effect.runPromise(real.read('repo', 'rule.md'));
      const preview = await post('/api/rename/preview', { bundle: 'repo', path: 'rule.md', newPath: 'renamed.md', expectedHash: concept.hash });
      expect(preview.status).toBe(200);
      const result = await preview.json() as { previewHash: string };
      expect((await post('/api/rename', { bundle: 'repo', path: 'rule.md', newPath: 'renamed.md', expectedHash: concept.hash, previewHash: result.previewHash })).status).toBe(200);
      expect((await post('/api/concept', { bundle: 'repo', path: 'new.md', raw: '---\ntype: Rule\n---\nNew.', expectedHash: null })).status).toBe(200);
    } finally { await web.dispose(); await rm(directory, { recursive: true, force: true }); }
  });
  it('requires exact host, same origin and session for API reads and edits', async () => {
    const web = HttpRouter.toWebHandler(createRoutes(store, session, '<html><head></head><body>Viewer</body></html>'), { disableLogger: true });
    try {
      const invoke = (path: string, options: RequestInit = {}) => web.handler(new Request(`http://localhost:3210${path}`, { ...options, headers: { host: 'localhost:3210', ...(options.headers as Record<string, string>) } }));
      expect((await invoke('/api/context')).status).toBe(403);
      expect((await invoke('/api/context', { headers: { 'x-okf-session': session, origin: 'https://example.org' } })).status).toBe(403);
      expect((await invoke('/api/context', { headers: { 'x-okf-session': session, host: 'attacker.invalid:3210' } })).status).toBe(403);
      expect((await invoke('/api/context', { headers: { 'x-okf-session': session } })).status).toBe(200);
      const html = await (await invoke('/wiki')).text();
      expect(html).toContain('name="okf-session"');
      expect((await invoke('/api/concept', { method: 'POST', headers: { 'x-okf-session': session, 'content-type': 'application/json' }, body: JSON.stringify({ bundle: 'repo', path: 'rule.md', raw: 'x', expectedHash: null }) })).status).toBe(409);
    } finally { await web.dispose(); }
  });
  it('returns structured errors for malformed JSON and invalid request fields', async () => {
    const web = HttpRouter.toWebHandler(createRoutes(store, session, '<head>'), { disableLogger: true });
    try {
      for (const body of ['{', JSON.stringify({ bundle: 5, path: 'rule.md', raw: 'x', expectedHash: null })]) {
        const result = await web.handler(new Request('http://localhost:3210/api/concept', { method: 'POST', headers: { host: 'localhost:3210', 'x-okf-session': session, 'content-type': 'application/json' }, body }));
        expect(result.status).toBe(400);
        expect(await result.json()).toMatchObject({ version: 1, error: { code: 'INVALID_INPUT' } });
      }
    } finally { await web.dispose(); }
  });
  it('rejects a chunked body before the sender finishes', async () => {
    const server = createServer();
    const layer = HttpRouter.serve(createRoutes(store, session, '<head>'), { disableLogger: true, disableListenLog: true }).pipe(Layer.provide(NodeHttpServer.layer(() => server, { host: '127.0.0.1', port: 0 })));
    const fiber = Effect.runFork(Layer.launch(layer));
    try {
      for (let i = 0; i < 200 && !server.listening; i++) await new Promise(done => setTimeout(done, 5));
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Server not listening.');
      const result = await new Promise<{ status: number | null; body: string; code?: string }>((done, reject) => {
        const call = request({ host: '127.0.0.1', port: address.port, method: 'POST', path: '/api/concept', headers: { 'content-type': 'application/json', 'x-okf-session': session } }, response => {
          let body = ''; response.on('data', chunk => { body += chunk; }); response.once('end', () => { call.destroy(); done({ status: response.statusCode ?? 0, body }); });
        });
        call.once('error', error => {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ECONNRESET' || code === 'EPIPE') done({ status: null, body: '', code });
          else reject(error);
        });
        for (let i = 0; i < 24; i++) call.write('x'.repeat(100_000));
        // Leave the request open: a post-buffer size check would never respond.
      });
      // Node closes an oversized incoming stream, which can reset its socket or reject a write
      // before a JSON response is sent. Either outcome must occur before EOF.
      if (result.status === null) expect(['ECONNRESET', 'EPIPE']).toContain(result.code);
      else { expect(result.status).toBe(400); expect(JSON.parse(result.body)).toMatchObject({ version: 1, error: { code: 'INVALID_INPUT' } }); }
    } finally { await Effect.runPromise(Fiber.interrupt(fiber)); }
  });
});
