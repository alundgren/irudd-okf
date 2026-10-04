import { ByteSize, Cause, Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { NodeHttpServer } from '@effect/platform-node';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { OkfError, type ApiError, type DeleteRequest, type RenameRequest, type Store, type WriteRequest } from '../../core/src/contracts.ts';
import { GitMemory } from './git.ts';

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };
const response = (data: unknown, status = 200) => HttpServerResponse.jsonUnsafe(data, { status, headers });
const errorResponse = (error: unknown) => {
  const e = error instanceof OkfError ? error : new OkfError('INVALID_INPUT', 'The request could not be processed.');
  const data: ApiError = { version: 1, error: { code: e.code, message: e.message, details: e.details } };
  return response(data, /CONFLICT|BUSY|EXPIRED|SCOPE_CHANGED/.test(e.code) ? 409 : /NOT_FOUND/.test(e.code) ? 404 : /UNAUTHORIZED|FORBIDDEN|UNSAFE/.test(e.code) ? 403 : /FAILED/.test(e.code) ? 500 : 400);
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OkfError('INVALID_INPUT', 'A JSON object is required.');
  return value as Record<string, unknown>;
};
const string = (value: unknown, field: string) => { if (typeof value !== 'string') throw new OkfError('INVALID_INPUT', `${field} must be a string.`); return value; };
const boolean = (value: unknown, field: string) => { if (typeof value !== 'boolean') throw new OkfError('INVALID_INPUT', `${field} must be a boolean.`); return value; };
const number = (value: string | null, fallback: number) => { const n = value === null ? fallback : Number(value); if (!Number.isInteger(n)) throw new OkfError('INVALID_INPUT', 'An integer query parameter is required.'); return n; };

export const createRoutes = (store: Store, capability: string, html: string, git = new GitMemory(store.context)) => {
  const handler = (request: HttpServerRequest.HttpServerRequest) => Effect.gen(function* () {
    const host = request.headers.host ?? '';
    if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)) return errorResponse(new OkfError('FORBIDDEN_HOST', 'Use the loopback address printed by the CLI.'));
    const url = new URL(request.url, `http://${host}`);
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) return errorResponse(new OkfError('FORBIDDEN_ORIGIN', 'Cross-origin requests are disabled.'));
    if (request.headers['sec-fetch-site'] === 'cross-site') return errorResponse(new OkfError('FORBIDDEN_ORIGIN', 'Cross-site requests are disabled.'));
    if (!url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET' || !['/', '/wiki', '/graph'].includes(url.pathname)) return response({ error: 'Not found' }, 404);
      return HttpServerResponse.text(html.replace('<head>', `<head><meta name="okf-session" content="${capability}">`), { headers, contentType: 'text/html' });
    }
    if (request.headers['x-okf-session'] !== capability) return errorResponse(new OkfError('UNAUTHORIZED_SESSION', 'Open the local wiki to establish this session.'));
    const query = url.searchParams;
    const bundle = query.get('bundle') ?? undefined;
    const requiredBundle = () => string(bundle, 'bundle');
    if (request.method === 'GET') {
      switch (url.pathname) {
        case '/api/context': return response(store.context);
        case '/api/list': return response({ version: 1, concepts: yield* store.list(bundle) });
        case '/api/search': return response(yield* store.search(query.get('q') ?? '', { bundle, limit: number(query.get('limit'), 10), offset: number(query.get('offset'), 0) }));
        case '/api/index': return response(yield* store.index(requiredBundle(), query.get('path') ?? undefined));
        case '/api/concept': return response(yield* store.read(requiredBundle(), string(query.get('path'), 'path')));
        case '/api/graph': return response(yield* store.graph({ bundle, path: query.get('path') ?? undefined, depth: number(query.get('depth'), 1), limit: number(query.get('limit'), 80) }));
        case '/api/validate': return response(yield* store.validate({ bundle, lint: query.get('lint') === 'true' }));
        case '/api/git/status': return response(yield* git.status(requiredBundle()));
        default: return response({ error: 'Not found' }, 404);
      }
    }
    if (!['POST', 'DELETE'].includes(request.method)) return response({ error: 'Method not allowed' }, 405);
    if (!request.headers['content-type']?.startsWith('application/json')) return errorResponse(new OkfError('INVALID_INPUT', 'Use application/json.'));
    const length = Number(request.headers['content-length'] ?? 0);
    if (length > 2_000_000) return errorResponse(new OkfError('INVALID_INPUT', 'Request body exceeds 2 MB.'));
    const raw = yield* request.text;
    if (Buffer.byteLength(raw) > 2_000_000) return errorResponse(new OkfError('INVALID_INPUT', 'Request body exceeds 2 MB.'));
    const data = object(JSON.parse(raw));
    const mutation = () => ({ bundle: string(data.bundle, 'bundle'), path: string(data.path, 'path'), ...(data.authorizePersonal === undefined ? {} : { authorizePersonal: boolean(data.authorizePersonal, 'authorizePersonal') }) });
    switch (`${request.method} ${url.pathname}`) {
      case 'POST /api/concept': {
        const write: WriteRequest = { ...mutation(), raw: string(data.raw, 'raw'), expectedHash: data.expectedHash === null ? null : string(data.expectedHash, 'expectedHash') };
        return response(yield* store.save(write));
      }
      case 'DELETE /api/concept': {
        const remove: DeleteRequest = { ...mutation(), expectedHash: string(data.expectedHash, 'expectedHash') };
        return response(yield* store.remove(remove));
      }
      case 'POST /api/rename/preview':
      case 'POST /api/rename': {
        const rename: RenameRequest = { ...mutation(), expectedHash: string(data.expectedHash, 'expectedHash'), newPath: string(data.newPath, 'newPath'), ...(data.updateLinks === undefined ? {} : { updateLinks: boolean(data.updateLinks, 'updateLinks') }), ...(data.previewHash === undefined ? {} : { previewHash: string(data.previewHash, 'previewHash') }) };
        if (url.pathname.endsWith('/preview')) return response(yield* store.previewRename(rename));
        if (!rename.previewHash) return errorResponse(new OkfError('INVALID_INPUT', 'Review the affected files before confirming a rename.'));
        return response(yield* store.rename(rename));
      }
      case 'POST /api/git/preview': {
        if (!Array.isArray(data.paths) || data.paths.some(path => typeof path !== 'string')) throw new OkfError('INVALID_INPUT', 'paths must be a string array.');
        return response(yield* git.preview(string(data.bundle, 'bundle'), data.paths as string[], data.base === undefined ? undefined : string(data.base, 'base')));
      }
      case 'POST /api/git/pr': return response(yield* git.publish(string(data.token, 'token'), string(data.title, 'title'), data.body === undefined ? undefined : string(data.body, 'body')));
      default: return response({ error: 'Not found' }, 404);
    }
  }).pipe(
    Effect.provideService(HttpServerRequest.MaxBodySize, ByteSize.bytes(2_000_000)),
    Effect.catchCause(cause => Effect.succeed(errorResponse(Cause.squash(cause)))),
  );
  return HttpRouter.add('*', '/*', handler);
};

export const serve = (store: Store, port: number) => Effect.gen(function* () {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return yield* Effect.fail(new OkfError('INVALID_INPUT', 'Choose a port from 1024 to 65535.'));
  const html = isSea() ? getAsset('viewer.html', 'utf8') : yield* Effect.tryPromise({ try: () => readFile(resolve('web-dist/viewer.html'), 'utf8'), catch: () => new OkfError('VIEWER_NOT_BUILT', 'Run npm run build:web and node scripts/inline-web.mjs before serving from source.') });
  const capability = randomBytes(32).toString('hex');
  const server = HttpRouter.serve(createRoutes(store, capability, html), { disableLogger: true, disableListenLog: true }).pipe(Layer.provide(NodeHttpServer.layer(createServer, { host: '127.0.0.1', port })));
  yield* Effect.sync(() => process.stderr.write(`OKF wiki: http://127.0.0.1:${port}/wiki\nOKF graph: http://127.0.0.1:${port}/graph\nPress Ctrl+C to stop.\n`));
  yield* Layer.launch(server);
});
