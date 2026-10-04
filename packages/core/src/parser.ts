import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { parseDocument } from 'yaml';
import type { Concept, Diagnostic, Link } from './contracts.ts';
import { hash } from './files.ts';

const markdown = new MarkdownIt({ html: false, linkify: false });
export const reserved = (file: string) => ['index.md', 'log.md'].includes(path.posix.basename(file));
export function resolveLink(source: string, href: string): { target: string; external: boolean; fragment?: string; unsafe?: boolean } {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return { target: href, external: true };
  const separator = href.search(/[?#]/);
  const destination = separator < 0 ? href : href.slice(0, separator);
  const fragment = href.includes('#') ? href.slice(href.indexOf('#') + 1) : undefined;
  let decoded: string;
  try { decoded = decodeURIComponent(destination); } catch { return { target: href, external: false, unsafe: true, fragment }; }
  if (decoded.includes('\\') || decoded.includes('\0')) return { target: href, external: false, unsafe: true, fragment };
  let target = decoded ? path.posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : path.posix.join(path.posix.dirname(source), decoded)) : source;
  const unsafe = target === '..' || target.startsWith('../');
  if (target === '.') target = 'index.md';
  else if (decoded.endsWith('/')) target = target.replace(/\/$/, '') + '/index.md';
  return { target, external: false, fragment, unsafe };
}
function jsonMetadata(value: Record<string, unknown>): { value: Record<string, unknown>; adjusted: boolean } {
  const ancestors = new WeakSet<object>();
  let adjusted = false;
  let remaining = 50_000;
  function visit(value: unknown, depth: number): unknown {
    if (depth > 100 || --remaining < 0) { adjusted = true; return null; }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (Number.isFinite(value)) return value; adjusted = true; return null; }
    if (typeof value === 'bigint') { adjusted = true; return value.toString(); }
    if (typeof value !== 'object') { adjusted = true; return null; }
    if (ancestors.has(value)) { adjusted = true; return null; }
    ancestors.add(value);
    let result: unknown;
    if (Array.isArray(value)) result = value.map(item => visit(item, depth + 1));
    else if (value instanceof Set) { adjusted = true; result = [...value].map(item => visit(item, depth + 1)); }
    else if (value instanceof Map) { adjusted = true; result = [...value].map(([key, item]) => [visit(key, depth + 1), visit(item, depth + 1)]); }
    else if (value instanceof Date) { adjusted = true; result = Number.isNaN(value.getTime()) ? null : value.toISOString(); }
    else if (ArrayBuffer.isView(value)) { adjusted = true; result = Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)); }
    else result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, depth + 1)]));
    ancestors.delete(value);
    return result;
  }
  return { value: visit(value, 0) as Record<string, unknown>, adjusted };
}
export function parseConcept(bundle: string, file: string, raw: string): Concept {
  const diagnostics: Diagnostic[] = [];
  const report = (level: 'error' | 'warning', code: string, message: string) => diagnostics.push({ level, code, message, path: file, bundle });
  let body = raw;
  let metadata: Record<string, unknown> = {};
  let originalMetadata: Record<string, unknown> = metadata;
  let hasFrontmatter = false;
  const frontmatter = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (frontmatter) {
    hasFrontmatter = true;
    body = raw.slice(frontmatter[0].length);
    try {
      const document = parseDocument(frontmatter[1], { uniqueKeys: true, strict: true });
      if (document.errors.length) throw new Error(document.errors[0].message);
      const data = document.toJS({ maxAliasCount: 50 });
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Frontmatter must be a mapping.');
      originalMetadata = data;
      const projected = jsonMetadata(data);
      metadata = projected.value;
      if (projected.adjusted) report('warning', 'METADATA_PROJECTION', 'Metadata contains values JSON cannot represent directly. The metadata view replaces cyclic references and limits with null; original YAML remains in raw Markdown.');
    } catch (error) { report('error', 'MALFORMED_FRONTMATTER', error instanceof Error ? error.message : 'Cannot parse frontmatter.'); }
  } else if (!reserved(file)) report('error', 'MISSING_FRONTMATTER', 'Concepts need a YAML frontmatter block.');
  if (path.posix.basename(file) === 'index.md') {
    if (body.trim() && !markdown.parse(body, {}).some(token => token.type === 'heading_open')) report('error', 'INDEX_STRUCTURE', 'Index files group their entries under Markdown headings.');
    if (hasFrontmatter && (file !== 'index.md' || Object.keys(metadata).some(key => key !== 'okf_version'))) report('error', 'INDEX_FRONTMATTER', 'Only the root index may declare okf_version.');
  } else if (path.posix.basename(file) === 'log.md') {
    if (hasFrontmatter) report('error', 'LOG_FRONTMATTER', 'Log files contain Markdown without frontmatter.');
    for (const token of markdown.parse(body, {})) {
      if (token.type !== 'heading_open' || token.tag !== 'h2' || token.map === null) continue;
      const line = body.split(/\r?\n/)[token.map[0]].replace(/^##\s+/, '').trim();
      const date = new Date(line + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(line) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== line) report('error', 'LOG_DATE', 'Log date headings must use a valid YYYY-MM-DD date.');
    }
  } else {
    if (typeof originalMetadata.type !== 'string' || !originalMetadata.type.trim()) report('error', 'MISSING_TYPE', 'Concepts need a non-empty type string.');
    if (originalMetadata.type === 'Attested Computation' && (typeof originalMetadata.runtime !== 'string' || !originalMetadata.runtime.trim())) report('error', 'MISSING_RUNTIME', 'Attested Computation concepts need a runtime string.');
  }
  if (metadata.verified && !Array.isArray(metadata.verified) && typeof metadata.verified === 'object') metadata.verified = [metadata.verified];
  for (const field of ['title', 'description', 'resource']) if (originalMetadata[field] !== undefined && typeof originalMetadata[field] !== 'string') report('warning', 'OPTIONAL_FIELD', `${field} should be a string.`);
  if (metadata.tags !== undefined && (!Array.isArray(metadata.tags) || metadata.tags.some(tag => typeof tag !== 'string'))) report('warning', 'OPTIONAL_FIELD', 'tags should be a list of strings.');
  if (typeof metadata.stale_after === 'string' && Date.parse(metadata.stale_after) < Date.now()) report('warning', 'STALE', 'The concept is past stale_after.');
  const links: Link[] = [];
  for (const token of markdown.parse(body, {})) {
    const children = token.children ?? [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.type !== 'link_open') continue;
      const href = child.attrGet('href') ?? '';
      let label = '';
      for (let j = i + 1; j < children.length && children[j].type !== 'link_close'; j++) label += children[j].content;
      const resolved = resolveLink(file, href);
      links.push({ target: resolved.target, external: resolved.external, broken: !!resolved.unsafe, label, ...(resolved.fragment !== undefined ? { fragment: resolved.fragment } : {}) });
    }
  }
  return { bundle, path: file, title: typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title : path.posix.basename(file, '.md'), type: typeof metadata.type === 'string' ? metadata.type : null, description: typeof metadata.description === 'string' ? metadata.description : '', tags: Array.isArray(metadata.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === 'string') : [], hash: hash(raw), malformed: diagnostics.some(d => d.level === 'error'), raw, body, metadata, diagnostics, links, backlinks: [] };
}
