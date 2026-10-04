import type { Effect } from 'effect';
import metadata from '../../../package.json' with { type: 'json' };

export const VERSION = metadata.version;
export type BundleKind = 'repository' | 'personal' | 'explicit';
export interface Bundle { name: string; root: string; kind: BundleKind; writable: boolean }
export interface MemoryContext { version: 1; cwd: string; gitRoot: string | null; bundles: Bundle[]; configPath: string }
export interface Diagnostic { level: 'error' | 'warning'; code: string; path: string; message: string; bundle?: string }
export interface Link { target: string; label: string; external: boolean; broken: boolean; fragment?: string }
export interface ConceptSummary { bundle: string; path: string; title: string; type: string | null; description: string; tags: string[]; hash: string; malformed: boolean }
export interface Concept extends ConceptSummary { raw: string; body: string; metadata: Record<string, unknown>; diagnostics: Diagnostic[]; links: Link[]; backlinks: Array<{ bundle: string; path: string; title: string }> }
export interface SearchHit extends ConceptSummary { score: number; excerpt: string; matched: string[] }
export interface SearchResult { version: 1; query: string; results: SearchHit[]; total: number; limit: number; offset: number; truncated: boolean }
export interface Graph { version: 1; nodes: ConceptSummary[]; edges: Array<{ from: string; to: string; label: string; broken: boolean; external: boolean }>; truncated: boolean; limit: number }
export interface ValidationResult { version: 1; files: number; errors: number; warnings: number; diagnostics: Diagnostic[] }
export interface WriteRequest { bundle: string; path: string; raw: string; expectedHash: string | null; authorizePersonal?: boolean }
export interface DeleteRequest { bundle: string; path: string; expectedHash: string; authorizePersonal?: boolean }
export interface RenameRequest extends DeleteRequest { newPath: string; updateLinks?: boolean; previewHash?: string }
export interface RenamePreview { version: 1; bundle: string; path: string; newPath: string; previewHash: string; changes: Array<{ path: string; before: string; after: string }> }
export interface MutationResult { version: 1; bundle: string; path: string; hash: string | null; changedPaths: string[]; recoveryPath?: string }
export class OkfError extends Error {
  readonly _tag = 'OkfError';
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) { super(message); this.name = 'OkfError'; }
}
export type Operation<A> = Effect.Effect<A, OkfError>;
export interface Store {
  readonly context: MemoryContext;
  list(bundle?: string): Operation<ConceptSummary[]>;
  read(bundle: string, path: string): Operation<Concept>;
  index(bundle: string, path?: string): Operation<Concept>;
  search(query: string, options?: { bundle?: string; limit?: number; offset?: number }): Operation<SearchResult>;
  graph(options?: { bundle?: string; path?: string; depth?: number; limit?: number }): Operation<Graph>;
  validate(options?: { bundle?: string; lint?: boolean }): Operation<ValidationResult>;
  save(request: WriteRequest): Operation<MutationResult>;
  remove(request: DeleteRequest): Operation<MutationResult>;
  rename(request: RenameRequest): Operation<MutationResult>;
  previewRename(request: RenameRequest): Operation<RenamePreview>;
}
export interface GitFile { path: string; status: string }
export interface GitStatus { version: 1; available: boolean; root: string | null; branch: string | null; remote: string | null; files: GitFile[]; reason?: string }
export interface GitPreview { version: 1; token: string; bundle: string; base: string; baseRef: string; repository: string; branch: string; paths: string[]; diff: string; expiresAt: string; warnings: string[] }
export interface PullRequestResult { version: 1; url: string; branch: string; worktree: string; state: 'created' | 'existing' }
export interface SourceInstallation { version: 1; source: string; revision: string; productVersion: string; vp?: string }
export interface UpgradeCheckResult { current: string; latest: string; updateAvailable: boolean }
export interface UpgradeResult { previous: string; current: string; updated: boolean }
export type AgentProvider = 'codex' | 'claude';
export interface InstructionStatus { version: 1; provider: AgentProvider; file: string; installed: boolean; shadowed: boolean }
export interface InstructionResult extends InstructionStatus { changed: boolean; dryRun: boolean; instructions: string | null; recoveryPath?: string }

// HTTP wire types share file semantics with the CLI. All mutations require the
// browser session capability, and Git publication additionally requires preview.
export interface ApiError { version: 1; error: { code: string; message: string; details: Record<string, unknown> } }
