import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import MarkdownIt from 'markdown-it';
import { OkfError, type AgentProvider, type Bundle, type InstructionResult, type InstructionStatus, type Operation } from '../../core/src/contracts.ts';
import { absent, atomicCreate, atomicReplace, canonicalDirectory, ensureDirectory, normalizeSystemPath, operation, readRaw, recovery, withLock } from '../../core/src/files.ts';

export const instructionStart = '<!-- BEGIN irudd-okf personal-memory -->';
export const instructionEnd = '<!-- END irudd-okf personal-memory -->';
const markdown = new MarkdownIt({ html: true });

interface ProfileOptions { home?: string; env?: NodeJS.ProcessEnv; dryRun?: boolean }

function directory(provider: AgentProvider, options: ProfileOptions) {
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  return path.resolve(provider === 'codex' ? env.CODEX_HOME || path.join(home, '.codex') : env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'));
}

export function personalInstructions(bundle: Bundle): string {
  return `## Personal development memories

Personal development memories live in ${JSON.stringify(bundle.root)}.
Before editing code, read its root index.md and search that directory with
rg -n -i using task terms. Read a few relevant notes, check their project
scope and follow replacement links. Repository instructions override
conflicting personal defaults.

Personal memory is read-only unless the operator asks to record or update it.
When authorized to write memory, first read the root and relevant topic indexes
and follow their authoring conventions. Search for duplicates before creating
a note. Update an existing note when it already covers the lesson. Keep each
new note focused, with OKF frontmatter and enough context to apply the rule.
Use the existing topic folder and add or update its index entry. The root index
links to topic indexes; add a root link when creating a new topic. Link only
directly related notes with relative Markdown links. Preserve history and link
obsolete guidance to its replacement according to the bundle's conventions.
Check the changed notes and links; run scoped irudd-okf validate and lint when
available. Report the memory paths changed with the development result.
`;
}

function ownedRange(raw: string): { start: number; end: number } | null {
  const starts = [...raw.matchAll(/<!-- BEGIN irudd-okf personal-memory -->/g)];
  const ends = [...raw.matchAll(/<!-- END irudd-okf personal-memory -->/g)];
  if (!starts.length && !ends.length) return null;
  const start = starts[0]?.index ?? -1;
  const closing = ends[0]?.index ?? -1;
  const end = closing + instructionEnd.length;
  const comments = new Set(markdown.parse(raw.replace(/^\uFEFF/, ''), {}).filter(token => token.type === 'html_block' && [instructionStart, instructionEnd].includes(token.content.trim())).map(token => token.map?.[0]));
  const line = (offset: number) => raw.slice(0, offset).split(/\r\n|\n|\r/).length - 1;
  const fullLine = (offset: number, length: number) => (offset === 0 || offset === 1 && raw[0] === '\uFEFF' || /[\r\n]/.test(raw[offset - 1] ?? '')) && (offset + length === raw.length || /[\r\n]/.test(raw[offset + length] ?? ''));
  if (starts.length !== 1 || ends.length !== 1 || start >= closing || !fullLine(start, instructionStart.length) || !fullLine(closing, instructionEnd.length) || !comments.has(line(start)) || !comments.has(line(closing))) {
    throw new OkfError('INSTRUCTION_MARKERS', 'The irudd-okf instruction markers are incomplete, duplicated or not on separate lines. Existing instructions were left unchanged.');
  }
  return { start, end: end + (raw.slice(end).startsWith('\r\n') ? 2 : /[\r\n]/.test(raw[end] ?? '') ? 1 : 0) };
}

export function editInstructions(raw: string, instructions: string | null): string {
  const range = ownedRange(raw);
  if (instructions === null) return range ? raw.slice(0, range.start) + raw.slice(range.end) : raw;
  const newline = raw.includes('\r\n') ? '\r\n' : raw.includes('\r') && !raw.includes('\n') ? '\r' : '\n';
  const block = [instructionStart, '<!-- Managed by irudd-okf instructions install; change bundle conventions in index.md. -->', instructions.trimEnd(), instructionEnd].join('\n').replaceAll('\n', newline);
  if (range) {
    const hadEnding = /[\r\n]/.test(raw.slice(range.end - 1, range.end));
    return raw.slice(0, range.start) + block + (hadEnding ? newline : '') + raw.slice(range.end);
  }
  const separator = !raw ? '' : /[\r\n]$/.test(raw) ? newline : newline + newline;
  return raw + separator + block + newline;
}

async function readProfile(file: string): Promise<{ raw: string; mode: number } | null> {
  try {
    await canonicalDirectory(path.dirname(file));
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new OkfError('UNSAFE_PATH', 'The provider instruction file must be a regular file, not a symbolic link.', { file });
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const bytes = await handle.readFile();
      return { raw: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), mode: info.mode & 0o777 };
    } finally { await handle.close(); }
  } catch (error) { if (absent(error)) return null; throw error; }
}

async function profile(provider: AgentProvider, options: ProfileOptions) {
  const folder = await normalizeSystemPath(directory(provider, options));
  const file = path.join(folder, provider === 'codex' ? 'AGENTS.md' : 'CLAUDE.md');
  const original = await readProfile(file);
  const shadowed = provider === 'codex' && Boolean((await readProfile(path.join(folder, 'AGENTS.override.md')))?.raw.trim());
  return { folder, file, original, shadowed };
}

export function instructionStatus(provider: AgentProvider, options: ProfileOptions = {}): Operation<InstructionStatus> {
  return operation(async () => {
    const selected = await profile(provider, options);
    return { version: 1, provider, file: selected.file, installed: Boolean(ownedRange(selected.original?.raw ?? '')), shadowed: selected.shadowed };
  });
}

async function change(provider: AgentProvider, instructions: string | null, options: ProfileOptions): Promise<InstructionResult> {
  const selected = await profile(provider, options);
  if (instructions !== null && selected.shadowed) throw new OkfError('INSTRUCTIONS_SHADOWED', 'Codex is reading AGENTS.override.md. Merge or remove that override before installing the shared instruction section.', { file: selected.file, override: path.join(selected.folder, 'AGENTS.override.md') });
  const raw = selected.original?.raw ?? '';
  const updated = editInstructions(raw, instructions);
  const result: InstructionResult = { version: 1, provider, file: selected.file, installed: Boolean(ownedRange(updated)), shadowed: selected.shadowed, changed: updated !== raw, dryRun: options.dryRun ?? false, instructions };
  if (!result.changed || result.dryRun) return result;
  await ensureDirectory(selected.folder);
  return withLock(selected.folder, async () => {
    const current = await profile(provider, options);
    if (current.original?.raw !== selected.original?.raw || current.shadowed !== selected.shadowed) throw new OkfError('INSTRUCTION_CONFLICT', 'The provider instructions changed. Read them again before retrying.', { file: selected.file });
    const recoveryPath = selected.original ? await recovery(selected.folder, raw) : undefined;
    const verify = async () => {
      const observed = await profile(provider, options);
      if (observed.original?.raw !== selected.original?.raw || observed.original?.mode !== selected.original?.mode || observed.shadowed !== selected.shadowed) throw new OkfError('INSTRUCTION_CONFLICT', 'The provider instructions changed. Read them again before retrying.', { file: selected.file, recoveryPath });
    };
    try {
      if (selected.original) await atomicReplace(selected.file, updated, selected.original.mode, verify);
      else await atomicCreate(selected.file, updated, verify).catch(error => { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new OkfError('INSTRUCTION_CONFLICT', 'Another writer created the provider instruction file.', { file: selected.file }); throw error; });
    } catch (error) {
      if (error instanceof OkfError) throw new OkfError(error.code, error.message, { ...error.details, ...(recoveryPath ? { recoveryPath } : {}) });
      throw new OkfError('INSTRUCTION_WRITE_FAILED', 'Could not publish the instruction section.', { file: selected.file, cause: String(error), ...(recoveryPath ? { recoveryPath } : {}) });
    }
    return { ...result, ...(recoveryPath ? { recoveryPath } : {}) };
  });
}

export function installInstructions(provider: AgentProvider, bundle: Bundle, options: ProfileOptions = {}): Operation<InstructionResult> {
  return operation(async () => {
    if (bundle.kind !== 'personal') throw new OkfError('PERSONAL_BUNDLE_REQUIRED', 'Select an active, explicitly registered personal bundle for machine-wide instructions.', { bundle: bundle.name });
    await canonicalDirectory(bundle.root);
    await readRaw(bundle, 'index.md').catch(error => { if (absent(error)) throw new OkfError('INDEX_REQUIRED', 'Create the personal bundle root index.md before installing instructions.', { bundle: bundle.name, root: bundle.root }); throw error; });
    return change(provider, personalInstructions(bundle), options);
  });
}

export function removeInstructions(provider: AgentProvider, options: ProfileOptions = {}): Operation<InstructionResult> {
  return operation(() => change(provider, null, options));
}
