import * as fs from 'node:fs/promises';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import linkRule from 'markdown-it/lib/rules_inline/link.mjs';
import referenceRule from 'markdown-it/lib/rules_block/reference.mjs';
import { OkfError, type Bundle, type Concept, type ConceptSummary, type Diagnostic, type MemoryContext, type Store, type Operation, type WriteRequest, type DeleteRequest, type RenameRequest, type MutationResult, type RenamePreview } from './contracts.ts';
import { operation, guarded, scan, hash, absent, cleanPath, withLock, recovery, atomicReplace, atomicCreate, readRaw } from './files.ts';
import { decode, WriteSchema, DeleteSchema, RenameSchema } from './schemas.ts';
import { parseConcept, reserved, resolveLink } from './parser.ts';

const summary = (concept: Concept): ConceptSummary => ({ bundle: concept.bundle, path: concept.path, title: concept.title, type: concept.type, description: concept.description, tags: [...concept.tags], hash: concept.hash, malformed: concept.malformed });
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const bounded = (value: number | undefined, fallback: number, maximum: number) => Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value!))) : fallback;
const id = (concept: { bundle: string; path: string }) => `${concept.bundle}:${concept.path}`;
function unindexedConcepts(documents: Concept[]): Diagnostic[] {
  const all = new Map(documents.map(concept => [id(concept), concept]));
  const indexedBundles = new Set<string>();
  const reached = new Set<string>();
  const queue: Concept[] = [];
  for (const concept of documents.filter(concept => concept.path === 'index.md')) {
    indexedBundles.add(concept.bundle);
    reached.add(id(concept));
    queue.push(concept);
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const source = queue[cursor];
    for (const link of source.links) {
      if (link.external || link.broken) continue;
      const key = id({ bundle: source.bundle, path: link.target });
      const target = all.get(key);
      if (!target || reached.has(key)) continue;
      reached.add(key);
      queue.push(target);
    }
  }
  return documents.filter(concept => indexedBundles.has(concept.bundle) && !reserved(concept.path) && !reached.has(id(concept))).map(concept => ({ level: 'warning', code: 'UNINDEXED_CONCEPT', bundle: concept.bundle, path: concept.path, message: 'No Markdown-link route from root index.md. Link this note from its topic index or directly related guidance.' }));
}
function select(context: MemoryContext, name: string) { const bundle = context.bundles.find(bundle => bundle.name === name); if (!bundle) throw new OkfError('BUNDLE_NOT_FOUND', 'The bundle is not active in this context.', { bundle: name }); return bundle; }
function writable(bundle: Bundle, request: { authorizePersonal?: boolean }) {
  if (!bundle.writable) throw new OkfError('READ_ONLY', 'This bundle is read-only.');
  if (bundle.kind === 'personal' && !request.authorizePersonal) throw new OkfError('PERSONAL_AUTHORIZATION', 'Writing personal memory requires explicit authorization.');
}
async function current(file: string): Promise<string | null> { try { return await fs.readFile(file, 'utf8'); } catch (error) { if (absent(error)) return null; throw error; } }
async function requireHash(file: string, expected: string | null) {
  const raw = await current(file);
  if ((raw === null ? null : hash(raw)) !== expected) throw new OkfError('CONFLICT', 'The file changed since it was read. Reload it before saving.', { expectedHash: expected, actualHash: raw === null ? null : hash(raw) });
  return raw;
}

// Destinations are recorded by Markdown's parser, so code fences and ordinary prose stay untouched.
function rewriteLinks(raw: string, source: string, oldPath: string, newPath: string, moved = false): string {
  const prefixLength = raw.length - parseConcept('', source, raw).body.length;
  const prefix = raw.slice(0, prefixLength);
  raw = raw.slice(prefixLength);
  const md = new MarkdownIt();
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const original = md.helpers.parseLinkDestination;
  const transform = (destination: string) => {
    const resolved = resolveLink(source, destination);
    if (resolved.external || resolved.unsafe || (!moved && resolved.target !== oldPath)) return destination;
    const target = resolved.target === oldPath ? newPath : resolved.target;
    const suffixIndex = destination.search(/[?#]/);
    const suffix = suffixIndex < 0 ? '' : destination.slice(suffixIndex);
    const directoryLink = (suffixIndex < 0 ? destination : destination.slice(0, suffixIndex)).endsWith('/');
    const targetPath = directoryLink && target.endsWith('/index.md') ? target.slice(0, -8) : target;
    const relative = destination.startsWith('/') ? '/' + targetPath : path.posix.relative(path.posix.dirname(moved ? newPath : source), targetPath) || path.posix.basename(targetPath);
    return relative.split('/').map(part => part === '..' || part === '' ? part : encodeURIComponent(part)).join('/') + suffix;
  };
  const absolutePositions: number[] = [];
  for (let position = 0; position < raw.length; position++) { absolutePositions.push(position); if (raw[position] === '\r' && raw[position + 1] === '\n') position++; }
  absolutePositions.push(raw.length);
  md.block.ruler.at('reference', (state, startLine, endLine, silent) => {
    const captured: Array<{ start: number; end: number; value: string }> = [];
    md.helpers.parseLinkDestination = (text, position, maximum) => {
      const result = original(text, position, maximum);
      if (result.ok) {
        const value = transform(result.str);
        if (value !== result.str) {
          const positions: number[] = [];
          let lineNumber = startLine;
          for (const line of text.split('\n')) {
            const start = state.bMarks[lineNumber] + state.tShift[lineNumber];
            for (let index = 0; index < line.length; index++) positions.push(absolutePositions[start + index]);
            positions.push(absolutePositions[state.eMarks[lineNumber]]);
            lineNumber++;
          }
          const angle = text[position] === '<';
          captured.push({ start: positions[position + (angle ? 1 : 0)], end: positions[result.pos - (angle ? 1 : 0)], value });
        }
      }
      return result;
    };
    let accepted;
    try { accepted = referenceRule(state, startLine, endLine, silent); } finally { md.helpers.parseLinkDestination = original; }
    if (accepted && !silent) edits.push(...captured);
    return accepted;
  });
  const tokens = md.parse(raw, {});
  const lines = raw.split(/(?<=\n)/);
  const offsets: number[] = [0];
  for (const line of lines) offsets.push(offsets.at(-1)! + line.length);
  for (const token of tokens) {
    if (token.type !== 'inline' || !token.map) continue;
    const startLine = token.map[0];
    const locations: number[] = [];
    let searchAt = offsets[startLine];
    for (const line of token.content.split('\n')) {
      const found = raw.indexOf(line, searchAt);
      if (found < 0 || found >= offsets[token.map[1]]) break;
      for (let position = 0; position < line.length; position++) locations.push(found + position);
      locations.push(found + line.length);
      searchAt = found + line.length + 1;
    }
    if (locations.length < token.content.length) continue;
    md.inline.ruler.at('link', (state, silent) => {
      const captured: Array<{ start: number; end: number; value: string }> = [];
      md.helpers.parseLinkDestination = (text, position, maximum) => {
        const result = original(text, position, maximum);
        if (result.ok) {
          const value = transform(result.str);
          if (value !== result.str) {
            const angle = text[position] === '<';
            captured.push({ start: locations[position + (angle ? 1 : 0)], end: locations[result.pos - (angle ? 1 : 0)], value });
          }
        }
        return result;
      };
      let accepted;
      try { accepted = linkRule(state, silent); } finally { md.helpers.parseLinkDestination = original; }
      if (accepted && !silent) edits.push(...captured);
      return accepted;
    });
    md.inline.parse(token.content, md, {}, []);
  }
  md.helpers.parseLinkDestination = original;
  const uniqueEdits = [...new Map(edits.map(edit => [`${edit.start}:${edit.end}`, edit])).values()];
  for (const edit of uniqueEdits.sort((a, b) => b.start - a.start)) raw = raw.slice(0, edit.start) + edit.value + raw.slice(edit.end);
  return prefix + raw;
}

export function resolveBundleFile(context: MemoryContext, bundle: string, file: string): Operation<string> { return operation(() => guarded(select(context, bundle), file)); }
export function createStore(input: MemoryContext): Store {
  const context = structuredClone(input);
  context.bundles.forEach(Object.freeze);
  Object.freeze(context.bundles);
  Object.freeze(context);
  const cache = new Map<string, { fingerprint: string; concept: Concept }>();
  async function load(bundleName?: string, detailed = true): Promise<Concept[]> {
    const bundles = bundleName ? [select(context, bundleName)] : context.bundles;
    const output: Concept[] = [];
    for (const bundle of bundles) {
      const files = await scan(bundle);
      const active = new Set(files.map(file => `${bundle.name}:${file.path}`));
      for (const key of cache.keys()) if (key.startsWith(bundle.name + ':') && !active.has(key)) cache.delete(key);
      let cursor = 0;
      const offset = output.length;
      output.length += files.length;
      await Promise.all(Array.from({ length: Math.min(32, files.length) }, async () => {
        while (cursor < files.length) {
          const index = cursor++;
          const file = files[index];
          const key = `${bundle.name}:${file.path}`;
          let cached = cache.get(key);
          if (!cached || cached.fingerprint !== file.fingerprint) {
            const raw = await readRaw(bundle, file.path);
            cached = { fingerprint: file.fingerprint, concept: parseConcept(bundle.name, file.path, raw) };
            cache.set(key, cached);
          }
          output[offset + index] = detailed ? structuredClone(cached.concept) : cached.concept;
        }
      }));
    }
    output.sort((a, b) => compare(id(a), id(b)));
    if (!detailed) return output;
    const all = new Map(output.map(concept => [id(concept), concept]));
    const checked = new Map<string, Promise<boolean>>();
    await Promise.all(output.map(async concept => {
      for (const link of concept.links) {
        if (link.external || link.broken) continue;
        const key = `${concept.bundle}:${link.target}`;
        const target = all.get(key);
        if (target) { target.backlinks.push({ bundle: concept.bundle, path: concept.path, title: concept.title }); continue; }
        let check = checked.get(key);
        if (!check) { check = guarded(select(context, concept.bundle), link.target).then(file => fs.stat(file)).then(info => info.isFile()).catch(() => false); checked.set(key, check); }
        link.broken = !(await check);
      }
    }));
    for (const concept of output) {
      const seen = new Set<string>();
      concept.backlinks = concept.backlinks.filter(backlink => { const key = id(backlink); if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => compare(id(a), id(b)));
    }
    return output;
  }
  async function read(bundle: string, file: string): Promise<Concept> {
    const normalized = cleanPath(file);
    try { await guarded(select(context, bundle), normalized); } catch (error) { if (absent(error)) throw new OkfError('NOT_FOUND', 'The Markdown document does not exist.', { bundle, path: normalized }); throw error; }
    const concept = (await load(bundle)).find(concept => concept.path === normalized);
    if (!concept) throw new OkfError('NOT_FOUND', 'The Markdown document does not exist.', { bundle, path: normalized });
    return concept;
  }
  const store: Store = {
    context,
    previewRename: request => operation(async () => {
      request = decode(RenameSchema, request);
      const bundle = select(context, request.bundle);
      const oldPath = cleanPath(request.path), newPath = cleanPath(request.newPath);
      if (!newPath.endsWith('.md') || reserved(newPath) || reserved(oldPath)) throw new OkfError('INVALID_PATH', 'Rename applies to concept Markdown files.');
      const original = await requireHash(await guarded(bundle, oldPath), request.expectedHash);
      if (original === null) throw new OkfError('NOT_FOUND', 'The file does not exist.');
      if (oldPath !== newPath) {
        try { await guarded(bundle, newPath); throw new OkfError('CONFLICT', 'The rename destination already exists.'); }
        catch (error) { if (!absent(error)) throw error; }
      }
      return (await renamePlan(bundle.name, oldPath, newPath, original, request.updateLinks)).preview;
    }),
    list: bundle => operation(async () => (await load(bundle, false)).filter(concept => !reserved(concept.path)).map(summary)),
    read: (bundle, file) => operation(() => read(bundle, file)),
    index: (bundle, directory = '') => operation(async () => {
      const normalized = directory ? cleanPath(directory).replace(/\/$/, '') : '';
      const file = normalized.endsWith('.md') ? normalized : normalized ? normalized + '/index.md' : 'index.md';
      const documents = await load(bundle);
      const authored = documents.find(concept => concept.path === file);
      if (authored) return authored;
      const folder = path.posix.dirname(file);
      const prefix = folder === '.' ? '' : folder + '/';
      const entries = documents.filter(concept => concept.path.startsWith(prefix) && !reserved(concept.path));
      const raw = '# Knowledge\n\n' + entries.slice(0, 250).map(concept => `- [${concept.title.replace(/[\[\]]/g, '')}](${concept.path.slice(prefix.length).split('/').map(encodeURIComponent).join('/')})${concept.description ? ' - ' + concept.description : ''}`).join('\n') + '\n';
      return { ...parseConcept(bundle, file, raw), hash: '' };
    }),
    search: (query, options = {}) => operation(async () => {
      if (query.length > 2048) throw new OkfError('QUERY_LIMIT', 'Search queries are limited to 2048 characters.');
      const terms: string[] = [];
      const filters: Array<{ key: string; value: string }> = [];
      for (const match of query.matchAll(/(?:\b(bundle|path|type|tag|exact):)?(?:"([^"]*)"|([^\s]+))/g)) {
        const value = (match[2] ?? match[3]).toLocaleLowerCase('en');
        if (match[1]) filters.push({ key: match[1], value }); else terms.push(value);
      }
      if (terms.length + filters.length > 32) throw new OkfError('QUERY_LIMIT', 'Search queries are limited to 32 terms and filters.');
      const results = [];
      for (const concept of (await load(options.bundle, false)).filter(concept => !reserved(concept.path))) {
        if (!filters.every(filter => filter.key === 'bundle' ? concept.bundle.toLowerCase() === filter.value : filter.key === 'type' ? concept.type?.toLowerCase() === filter.value : filter.key === 'tag' ? concept.tags.some(tag => tag.toLowerCase() === filter.value) : filter.key === 'exact' ? concept.title.toLowerCase() === filter.value || concept.path.toLowerCase() === filter.value : concept.path.toLowerCase().includes(filter.value))) continue;
        const fields = [{ name: 'title', text: concept.title, weight: 12 }, { name: 'path', text: concept.path, weight: 8 }, { name: 'tags', text: concept.tags.join(' '), weight: 10 }, { name: 'description', text: concept.description, weight: 6 }, { name: 'type', text: concept.type ?? '', weight: 4 }, { name: 'body', text: concept.body, weight: 1 }].map(field => ({ ...field, text: field.text.toLowerCase() }));
        let score = 0;
        const matched = new Set<string>();
        for (const term of terms) for (const field of fields) { const text = field.text; let position = 0; let count = 0; while (count < 4 && (position = text.indexOf(term, position)) >= 0) { count++; position += term.length || 1; } if (count) { score += count * field.weight; matched.add(field.name); } }
        if (terms.length && !score) continue;
        const body = concept.body.replace(/\s+/g, ' ').trim();
        const at = terms.length ? Math.max(0, body.toLowerCase().indexOf(terms[0]) - 50) : 0;
        results.push({ ...summary(concept), score, excerpt: body.slice(at, at + 200), matched: [...matched] });
      }
      results.sort((a, b) => b.score - a.score || compare(id(a), id(b)));
      const limit = bounded(options.limit, 10, 100);
      const offset = Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset!)) : 0;
      return { version: 1, query, results: results.slice(offset, offset + limit), total: results.length, limit, offset, truncated: offset + limit < results.length };
    }),
    graph: (options = {}) => operation(async () => {
      const documents = (await load(options.bundle)).filter(concept => !reserved(concept.path));
      const limit = bounded(options.limit, 80, 250);
      const depth = Number.isFinite(options.depth) ? Math.max(0, Math.min(3, Math.floor(options.depth!))) : 1;
      const all = new Map(documents.map(concept => [id(concept), concept]));
      const selected = new Map<string, Concept>();
      let truncated = false;
      const edges = documents.flatMap(concept => concept.links.map(link => ({ from: id(concept), to: link.external ? link.target : `${concept.bundle}:${link.target}`, label: link.label, external: link.external, broken: link.broken })));
      if (options.path) {
        const file = cleanPath(options.path);
        if (!options.bundle && context.bundles.length !== 1) throw new OkfError('BUNDLE_REQUIRED', 'Select a bundle for a focused graph.');
        const seed = `${options.bundle ?? context.bundles[0]?.name}:${file}`;
        if (!all.has(seed)) throw new OkfError('NOT_FOUND', 'The graph source does not exist.');
        const queue = [{ key: seed, distance: 0 }];
        const seen = new Set([seed]);
        for (let cursor = 0; cursor < queue.length; cursor++) {
          const item = queue[cursor];
          if (selected.size >= limit) { truncated = true; break; }
          selected.set(item.key, all.get(item.key)!);
          if (item.distance >= depth) continue;
          for (const edge of edges) {
            const neighbor = edge.from === item.key ? edge.to : edge.to === item.key ? edge.from : undefined;
            if (neighbor && all.has(neighbor) && !seen.has(neighbor)) { seen.add(neighbor); queue.push({ key: neighbor, distance: item.distance + 1 }); }
          }
        }
      } else { for (const concept of documents.slice(0, limit)) selected.set(id(concept), concept); truncated = documents.length > limit; }
      const graphEdges = edges.filter(edge => selected.has(edge.from) && (selected.has(edge.to) || edge.external || edge.broken));
      const edgeLimit = limit * 8;
      if (graphEdges.length > edgeLimit) truncated = true;
      return { version: 1, nodes: [...selected.values()].map(summary), edges: graphEdges.slice(0, edgeLimit), truncated, limit };
    }),
    validate: (options = {}) => operation(async () => {
      const documents = await load(options.bundle, options.lint);
      const diagnostics = documents.flatMap(concept => [ ...concept.diagnostics.filter(diagnostic => options.lint || diagnostic.level === 'error'), ...(options.lint ? concept.links.filter(link => link.broken).map(link => ({ level: 'warning' as const, code: 'BROKEN_LINK', path: concept.path, bundle: concept.bundle, message: `Unavailable link target: ${link.target}` })) : []) ]);
      if (options.lint) diagnostics.push(...unindexedConcepts(documents));
      return { version: 1, files: documents.length, errors: diagnostics.filter(item => item.level === 'error').length, warnings: diagnostics.filter(item => item.level === 'warning').length, diagnostics };
    }),
    save: request => operation(() => save(decode(WriteSchema, request))),
    remove: request => operation(() => remove(decode(DeleteSchema, request))),
    rename: request => operation(() => rename(decode(RenameSchema, request)))
  };
  async function save(request: WriteRequest): Promise<MutationResult> {
    const bundle = select(context, request.bundle);
    writable(bundle, request);
    const file = await guarded(bundle, request.path, true);
    if (!request.path.endsWith('.md')) throw new OkfError('INVALID_PATH', 'Memory edits require a Markdown file.');
    return withLock(bundle.root, async () => {
      const original = await requireHash(file, request.expectedHash);
      if (original === request.raw) return { version: 1, bundle: bundle.name, path: cleanPath(request.path), hash: hash(request.raw), changedPaths: [] };
      const recoveryPath = original !== null ? await recovery(bundle.root, original) : undefined;
      await guarded(bundle, request.path, true);
      await requireHash(file, request.expectedHash);
      if (request.expectedHash === null) await atomicCreate(file, request.raw).catch(error => { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new OkfError('CONFLICT', 'The destination was created by another writer.'); throw error; });
      else await atomicReplace(file, request.raw);
      cache.delete(`${bundle.name}:${cleanPath(request.path)}`);
      return { version: 1, bundle: bundle.name, path: cleanPath(request.path), hash: hash(request.raw), changedPaths: [cleanPath(request.path)], ...(recoveryPath ? { recoveryPath } : {}) };
    });
  }
  async function remove(request: DeleteRequest): Promise<MutationResult> {
    const bundle = select(context, request.bundle);
    writable(bundle, request);
    const file = await guarded(bundle, request.path);
    return withLock(bundle.root, async () => {
      const original = await requireHash(file, request.expectedHash);
      if (original === null) throw new OkfError('NOT_FOUND', 'The file does not exist.');
      const recoveryPath = await recovery(bundle.root, original);
      await guarded(bundle, request.path);
      await requireHash(file, request.expectedHash);
      await fs.unlink(file);
      cache.delete(`${bundle.name}:${cleanPath(request.path)}`);
      return { version: 1, bundle: bundle.name, path: cleanPath(request.path), hash: null, changedPaths: [cleanPath(request.path)], recoveryPath };
    });
  }
  async function renamePlan(bundle: string, oldPath: string, newPath: string, original: string, updateLinks?: boolean) {
    const documents = updateLinks ? await load(bundle) : [];
    const updates = documents.filter(concept => concept.path !== oldPath).map(concept => ({ concept, raw: rewriteLinks(concept.raw, concept.path, oldPath, newPath) })).filter(item => item.raw !== item.concept.raw);
    const newRaw = updateLinks ? rewriteLinks(original, oldPath, oldPath, newPath, true) : original;
    const changes = oldPath === newPath ? [] : [{ path: oldPath, before: original, after: '' }, { path: newPath, before: '', after: newRaw }, ...updates.map(update => ({ path: update.concept.path, before: update.concept.raw, after: update.raw }))];
    const preview: RenamePreview = { version: 1, bundle, path: oldPath, newPath, changes, previewHash: hash(JSON.stringify({ bundle, oldPath, newPath, changes })) };
    return { updates, newRaw, preview };
  }
  async function rename(request: RenameRequest): Promise<MutationResult> {
    const bundle = select(context, request.bundle);
    writable(bundle, request);
    const oldPath = cleanPath(request.path);
    const newPath = cleanPath(request.newPath);
    if (!newPath.endsWith('.md') || reserved(newPath) || reserved(oldPath)) throw new OkfError('INVALID_PATH', 'Rename applies to concept Markdown files.');
    if (oldPath === newPath) return { version: 1, bundle: bundle.name, path: oldPath, hash: request.expectedHash, changedPaths: [] };
    return withLock(bundle.root, async () => {
      const source = await guarded(bundle, oldPath);
      const original = await requireHash(source, request.expectedHash);
      if (original === null) throw new OkfError('NOT_FOUND', 'The file does not exist.');
      const { updates, newRaw, preview } = await renamePlan(bundle.name, oldPath, newPath, original, request.updateLinks);
      if (request.previewHash !== undefined && request.previewHash !== preview.previewHash) throw new OkfError('CONFLICT', 'Files affected by this rename changed after preview. Review a fresh preview.');
      const destination = await guarded(bundle, newPath, true);
      await requireHash(destination, null);
      const recoveryPath = await recovery(bundle.root, original);
      for (const update of updates) { await requireHash(await guarded(bundle, update.concept.path), update.concept.hash); await recovery(bundle.root, update.concept.raw); }
      const completed: Array<{ file: string; original: string; written: string }> = [];
      let created = false;
      let deleted = false;
      try {
        await requireHash(source, request.expectedHash);
        await atomicCreate(destination, newRaw); created = true;
        for (const update of updates) {
          const file = await guarded(bundle, update.concept.path);
          await requireHash(file, update.concept.hash);
          await atomicReplace(file, update.raw);
          completed.push({ file, original: update.concept.raw, written: update.raw });
        }
        await guarded(bundle, oldPath);
        await requireHash(source, request.expectedHash);
        await fs.unlink(source); deleted = true;
      } catch (error) {
        const failures: string[] = [];
        for (const update of completed.reverse()) { try { await requireHash(update.file, hash(update.written)); await atomicReplace(update.file, update.original); } catch { failures.push(update.file); } }
        if (deleted) { try { await fs.writeFile(source, original, { flag: 'wx' }); } catch { failures.push(source); } }
        if (created) { try { await requireHash(destination, hash(newRaw)); await fs.unlink(destination); } catch { failures.push(destination); } }
        if (failures.length) throw new OkfError('ROLLBACK_INCOMPLETE', 'External changes prevented full rollback. Recovery copies are available.', { paths: failures, recoveryPath });
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new OkfError('CONFLICT', 'The rename destination was created by another writer.', { recoveryPath });
        throw error;
      }
      cache.clear();
      return { version: 1, bundle: bundle.name, path: newPath, hash: hash(newRaw), changedPaths: [oldPath, newPath, ...updates.map(update => update.concept.path)], recoveryPath };
    });
  }
  return store;
}
