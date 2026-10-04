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
