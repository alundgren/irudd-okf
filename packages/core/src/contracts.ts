import type { Effect } from 'effect';
import metadata from '../../../package.json' with { type: 'json' };

export const VERSION = metadata.version;
export type BundleKind = 'repository' | 'personal' | 'explicit';
export interface Bundle { name: string; root: string; kind: BundleKind; writable: boolean }
export interface MemoryContext { version: 1; cwd: string; gitRoot: string | null; bundles: Bundle[]; configPath: string }
export interface Diagnostic { level: 'error' | 'warning'; code: string; path: string; message: string; bundle?: string }
export interface Link { target: string; label: string; external: boolean; broken: boolean; fragment?: string }
export interface ConceptSummary { bundle: string; path: string; title: string; type: string | null; description: string; tags: string[]; hash: string; malformed: boolean; memory?: MemoryProjection }
export interface Concept extends ConceptSummary { raw: string; body: string; metadata: Record<string, unknown>; diagnostics: Diagnostic[]; links: Link[]; backlinks: Array<{ bundle: string; path: string; title: string }> }
export interface SearchHit extends ConceptSummary { score: number; excerpt: string; matched: string[] }
export interface SearchResult { version: 1; query: string; results: SearchHit[]; total: number; limit: number; offset: number; truncated: boolean }
export interface Graph { version: 1; nodes: ConceptSummary[]; edges: Array<{ from: string; to: string; label: string; broken: boolean; external: boolean }>; truncated: boolean; limit: number }
export interface ValidationResult { version: 1; files: number; errors: number; warnings: number; diagnostics: Diagnostic[] }
export interface WriteRequest { bundle: string; path: string; raw: string; expectedHash: string | null; authorizePersonal?: boolean; namespace?: string; actor?: MemoryActor; reason?: string }
export interface DeleteRequest { bundle: string; path: string; expectedHash: string; authorizePersonal?: boolean; actor?: MemoryActor; reason?: string }
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
  inspectChanges(bundle: string): Operation<ChangeRecoveryResult>;
  recoverChanges(bundle: string, authorizePersonal?: boolean): Operation<ChangeRecoveryResult>;
  inspectBundle(bundle: string): Operation<BundleInspection>;
  migrationGuide(bundle: string): Operation<MigrationGuide>;
  proposeChange(request: ChangeRequest): Operation<ChangeRecord>;
  listChanges(bundle: string, status?: ChangeRecord["status"], page?: {limit?: number; offset?: number}): Operation<{ version: 1; bundle: string; changes: ChangeRecord[]; total: number; limit: number; offset: number; truncated: boolean }>;
  readChange(bundle: string, id: string): Operation<ChangeRecord>;
  reviewChange(request: ChangeReviewRequest): Operation<ChangeRecord>;
  undoChange(request: ChangeUndoRequest): Operation<ChangeRecord>;
  browse(request: BrowseRequest): Operation<BrowseResult>;
  profile(bundle: string): Operation<ProfileResult>;
  namespaces(bundle: string): Operation<NamespaceResult>;
  bootstrap(bundle: string): Operation<BootstrapResult>;
  template(request: TemplateRequest): Operation<TemplateResult>;
  review(request: ReviewRequest): Operation<MutationResult>;
  verify(request: VerifyRequest): Operation<MutationResult>;
  updateTask(request: TaskRequest): Operation<MutationResult>;
  lifecycle(request: LifecycleRequest): Operation<MutationResult>;
  audit(options?: AuditOptions): Operation<AuditResult>;
  previewMaintenance(proposal: MaintenanceProposal): Operation<MaintenancePreview>;
  recoverMaintenance(request: MaintenanceRecoverRequest): Operation<MaintenanceRecoveryResult>;
  inspectMaintenance(request: MaintenanceInspectRequest): Operation<MaintenanceJournalResult>;
  applyMaintenance(request: MaintenanceApplyRequest): Operation<MaintenanceResult>;
  previewMigration(request: MigrationRequest): Operation<MaintenancePreview>;
  applyMigration(request: MaintenanceApplyRequest): Operation<MaintenanceResult>;
  list(bundle?: string, options?: RecallSelection): Operation<ConceptSummary[]>;
  read(bundle: string, path: string, options?: { current?: boolean; machine?: string; repository?: string; allApplicability?: boolean }): Operation<Concept>;
  index(bundle: string, path?: string, options?: RecallSelection): Operation<Concept>;
  search(query: string, options?: SearchOptions): Operation<SearchResult>;
  graph(options?: GraphOptions): Operation<Graph>;
  validate(options?: { bundle?: string; lint?: boolean }): Operation<ValidationResult>;
  save(request: WriteRequest): Operation<MutationResult>;
  remove(request: DeleteRequest): Operation<MutationResult>;
  rename(request: RenameRequest): Operation<MutationResult>;
  previewRename(request: RenameRequest): Operation<RenamePreview>;
  botCatalog(selection?: BotSelection): Operation<BotCatalog>;
  resolveBot(request: BotResolveRequest): Operation<ResolvedBot>;
  checkBots(request: BotCheckRequest): Operation<BotCheckResult>;
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

// CLI errors retain a stable structured envelope.
export interface ApiError { version: 1; error: { code: string; message: string; details: Record<string, unknown> } }


export type MemoryKind = 'procedural' | 'episodic' | 'semantic';
export type MemoryStage = 'bronze' | 'silver' | 'gold';
export type ReviewState = 'approved' | 'rejected' | 'pending';
export type Freshness = 'current' | 'stale' | 'expired' | 'invalid';
export type DependencyState = 'valid' | 'changed' | 'rejected' | 'unavailable' | 'cycle' | 'invalid';
export interface ReviewEvent { decision: 'approve' | 'reject'; actor_type: 'human' | 'machine'; by: string; at: string; reason: string; content_hash: string }
export interface VerificationEvent { actor_type: 'machine'; by: string; at: string; method: string; content_hash: string }
export interface Derivation { resource: string; content_hash: string }
export interface MemoryTask { reference: string; state: 'open' | 'completed' | 'cancelled'; completed_at?: string }
export interface MemoryMetadata {
  kind: MemoryKind; stage: MemoryStage; namespace?: string; occurred_at?: string; expires_at?: string;
  archived_at?: string; retention_reason?: string; task?: MemoryTask;
  reviews?: ReviewEvent[]; derived_from?: Derivation[]; prerequisites?: string[]; replaces?: string[]; replaced_by?: string;
  [key: string]: unknown;
}
export interface MemoryProjection {
  id?: string; applicability?: Applicability; revisionHash?: string;
  kind: MemoryKind | null; stage: MemoryStage | null; namespace: string; review: ReviewState;
  verified: boolean; humanReviewed: boolean; machineVerified: boolean; trustTier: 'unverified' | 'machine-confirmed' | 'human-reviewed'; historicalVerificationEvents: unknown[]; freshness: Freshness; archived: boolean; deprecated: boolean;
  contentHash: string; dependency: DependencyState; eligible: boolean;
  trust: 'approved' | 'verified' | 'pending' | 'rejected' | 'invalid';
  reviewEvents: ReviewEvent[]; verificationEvents: VerificationEvent[];
  diagnostics: Diagnostic[];
}
export interface MemoryPolicy {
  name: 'agent-memory'; version: 1; namespaces: string[]; topics: string[];
  task_retention_days: number; review_interval_days: number; gold_review: 'any' | 'human';
}
export interface ProfileResult { version: 1; bundle: string; mode: 'generic' | 'memory' | 'invalid'; policy: MemoryPolicy | null; diagnostics: Diagnostic[] }
export interface NamespaceResult { version: 1; bundle: string; namespaces: string[]; shared: 'shared'; mode: ProfileResult['mode'] }
export interface BootstrapResult { version: 1; bundle: string; path: string; raw: string | null; profile: ProfileResult }
export interface RecallSelection { allApplicability?: boolean; namespaces?: string[]; includeExcluded?: boolean; machine?: string; repository?: string }
export interface SearchOptions extends RecallSelection { bundle?: string; limit?: number; offset?: number }
export interface GraphOptions extends RecallSelection { bundle?: string; path?: string; depth?: number; limit?: number }
export interface TemplateRequest { id?: string; applicability?: Applicability; bundle: string; kind: MemoryKind; stage?: MemoryStage; namespace?: string; title: string; description: string; tags: string[]; actor: string; at?: string; occurredAt?: string; sources?: Array<string | { resource: string; [key: string]: unknown }>; task?: MemoryTask }
export interface TemplateResult { version: 1; bundle: string; raw: string }
export interface ReviewRequest extends Omit<DeleteRequest, "actor"> { decision: 'approve' | 'reject'; actor: string; reason: string; at?: string; operator?: true }
export interface VerifyRequest extends Omit<DeleteRequest, "actor"> { actor: string; method: string; at?: string }
export interface TaskRequest extends DeleteRequest { task: MemoryTask; retentionDays?: number | null; retentionReason?: string | null }
export interface LifecycleRequest extends DeleteRequest { action: 'archive' | 'restore' | 'expire' | 'deprecate' | 'clear-expiration' | 'recheck'; at?: string; replacement?: string; reason?: string }
export interface AuditOptions extends RecallSelection { bundle?: string }
export interface AuditResult { version: 1; concepts: ConceptSummary[]; diagnostics: Diagnostic[] }
export interface ProposalChange { path: string; expectedHash: string | null; raw: string | null }
export interface MaintenanceProposal {
  version: 1; bundle: string; purpose: 'maintenance' | 'consolidation' | 'migration';
  changes: ProposalChange[]; reason: string; allowNamespaceChange?: boolean;
}
export interface PreviewChange extends ProposalChange { before: string | null; afterHash: string | null }
export interface MigrationIssue { path: string; field: string; message: string }
export interface MaintenancePreview {
  version: 1; bundle: string; root: string; purpose: MaintenanceProposal['purpose']; reason: string;
  previewHash: string; changes: PreviewChange[]; guards: Array<{ path: string; expectedHash: string }>; diagnostics: Diagnostic[];
  unresolved: MigrationIssue[]; allowNamespaceChange: boolean;
}
export interface MaintenanceApplyRequest { preview: MaintenancePreview; authorizePersonal?: boolean }
export interface MaintenanceResult { version: 1; bundle: string; previewHash: string; changedPaths: string[]; journalPath: string; state: 'applied' | 'unchanged' }
export interface MigrationRequest {
  bundle: string; policy?: Partial<Omit<MemoryPolicy, 'name' | 'version'>>;
  decisions?: Record<string, MigrationDecision>;
}
// onWarning receives read diagnostics that do not change a result, such as an unfinished publication; the CLI prints them to stderr after a successful command.
export interface StoreOptions { afterChangeWrite?: (phase: 'prepared' | 'published', changeId: string) => Promise<void>; now?: () => Date; afterJournalWrite?: (completedPaths: number) => Promise<void>; onWarning?: (diagnostic: Diagnostic) => void }

export interface MigrationDecision { id?: string; applicability?: Applicability; raw?: string; kind?: MemoryKind; stage?: MemoryStage; namespace?: string; actor?: string; at?: string; title?: string; description?: string; tags?: string[]; sources?: Array<string | { resource: string; [key: string]: unknown }>; status?: string; occurredAt?: string; task?: MemoryTask; retentionReason?: string | null; expiresAt?: string | null; staleAfter?: string | null; archivedAt?: string | null; prerequisites?: string[]; replaces?: string[]; replacedBy?: string | null; derivedFrom?: Derivation[] }
export interface MaintenanceInspectRequest { bundle: string; previewHash: string }
export type JournalPathState = 'untouched' | 'applied' | 'externally-changed';
export interface MaintenanceJournalPath { path: string; state: JournalPathState; before: string | null; after: string | null; currentHash: string | null; recoveryPath?: string }
export interface MaintenanceJournalResult { version: 1; bundle: string; previewHash: string; journalPath: string; state: 'prepared' | 'applying' | 'applied' | 'conflict'; preview: MaintenancePreview; paths: MaintenanceJournalPath[] }

export interface MaintenanceRecoverRequest extends MaintenanceInspectRequest { authorizePersonal?: boolean }
export interface MaintenanceRecoveryResult extends MaintenanceJournalResult { lockRecovered: boolean; lockRecoveryPath?: string }

export const SUPPORTED_FORMAT_VERSION = 2;
export interface MemoryActor { type: 'agent' | 'human'; id: string }
export type Applicability = { type: 'global' } | { type: 'machine' | 'repository'; id: string };
export interface BundleInspection { version: 1; bundle: string; root: string; name: string; id: string | null; formatVersion: number | null; cliVersion: string; supportedFormatVersion: number; status: 'current' | 'migration-required' | 'newer' | 'invalid' }
export interface SourceRevision { applicability?: Applicability; displayTitle?: string; bundle?: string; id?: string; path: string; hash: string }
export interface RevisionBytes { raw: string; hash: string }
export interface ChangeProposal { version: 1; id: string; bundle: string; path: string; action: 'create' | 'update' | 'delete'; before: RevisionBytes | null; after: RevisionBytes | null; revisionHash: string; actor: MemoryActor; reason: string; createdAt: string; sources: SourceRevision[]; humanRequired: boolean; expectedHash?: string | null; requestHash?: string; requestId?: string }
export interface ChangeReview { actor: MemoryActor; reason: string; at: string; decision: 'accept' | 'reject'; revisionHash: string; sources: SourceRevision[] }
export interface MemoryDisplay {kind:MemoryKind|null;stage:MemoryStage|null;applicability:Applicability|null}
export interface ChangeRecord extends ChangeProposal { display: {title:string;beforeBody:string|null;afterBody:string|null;beforeMemory:MemoryDisplay|null;afterMemory:MemoryDisplay|null}; status: 'pending' | 'accepted' | 'rejected' | 'superseded'; replacementChangeId?: string; reviews: ChangeReview[]; agentReview?: ChangeReview; humanReview?: ChangeReview; review?: ChangeReview }
export interface ChangeRequest { bundle: string; path: string; raw: string | null; expectedHash: string | null; actor: MemoryActor; reason: string; sources?: SourceRevision[]; requestId?: string; authorizePersonal?: boolean }
export interface ChangeReviewRequest { bundle: string; id: string; expectedRevisionHash: string; decision: 'accept' | 'reject'; actor: MemoryActor; reason: string; sources: SourceRevision[]; operator?: true; authorizePersonal?: boolean }
export interface ChangeUndoRequest { bundle: string; id: string; expectedRevisionHash: string; actor: MemoryActor; reason: string; requestId?: string; authorizePersonal?: boolean }
export interface BrowseRequest { allApplicability?: boolean; machine?: string; repository?: string; bundle: string; path?: string; limit?: number; offset?: number }
export interface BrowseResult { version: 1; bundle: string; path: string; limit: number; offset: number; truncated: boolean; entries: Array<{ path: string; kind: 'directory' | 'memory'; title?: string; id?: string }> }
export interface MigrationGuide { version: 1; inspection: BundleInspection; instructions: string[]; questions: MigrationIssue[]; requestExample: unknown }

// Bot definitions are accepted library memories registered in one catalog per bundle.
// Visible names are literal; stable IDs are the definitions' memory IDs.
export const BOT_CATALOG_PATH = 'bots/catalog.md';
export const BOT_CATALOG_TYPE = 'Bot catalog';
export const BOT_DEFINITION_TYPE = 'Bot definition';
export interface BotMemoryTarget { id: string; role: 'own' | 'shared'; bundle?: string; path?: string; repository?: string; machine?: string; read: string; write: string }
export interface BotCollaborator { bot: string; bundle?: string; handoff: string }
export interface BotDefinition { name: string; purpose: string; identity: string; instructions: string; collaborators: BotCollaborator[]; memory: BotMemoryTarget[]; workspace?: string; tests?: string }
export interface BotDiagnostic { level: 'error' | 'warning'; code: string; message: string; bundle: string; path?: string; bot?: string; target?: string }
export interface BotSummary { id: string; name: string; purpose: string; bundle: string; bundleId: string; path: string; revisionHash: string; catalogRevisionHash: string; duplicateName: boolean }
export interface BotCatalog { version: 1; bots: BotSummary[]; diagnostics: BotDiagnostic[] }
export interface BotMemoryDocument { bundle: string; path: string; id: string; title: string; description: string; revisionHash: string; applicability: Applicability; body: string }
export interface ResolvedBotMemory { target: BotMemoryTarget; bundle: string | null; bundleId: string; status: 'available' | 'empty' | 'unavailable'; documents: BotMemoryDocument[]; truncated: boolean }
export interface ResolvedBotCollaborator { reference: BotCollaborator; status: 'available' | 'unavailable'; bot: BotSummary | null }
export interface ResolvedBot { version: 1; bot: BotSummary; definition: BotDefinition; collaborators: ResolvedBotCollaborator[]; memory: ResolvedBotMemory[]; diagnostics: BotDiagnostic[]; complete: boolean }
export interface BotSelection { bundle?: string }
export interface BotResolveRequest extends BotSelection { name?: string; id?: string }
// A bot check evaluates one library as if its pending proposals and the supplied drafts were accepted.
// It never publishes, accepts or recalls memory content; references to unaccepted revisions are listed in `requires`.
export interface BotDraft { path: string; raw: string }
// Removing or re-pointing an accepted or still-undecided registration fails unless that exact change is listed as confirmed by the user.
// `path` is the bundle path the entry points at after the change, or null when the entry is removed.
export interface BotRegistrationChange { id: string; path: string | null }
export interface BotCheckRequest { bundle: string; id?: string; drafts?: BotDraft[]; confirmedRegistrationChanges?: BotRegistrationChange[] }
export interface BotCheckCandidate { path: string; state: 'pending' | 'draft'; hash: string | null; changeId?: string; actor?: MemoryActor }
export interface BotCheckBot {
  id: string | null; name: string | null; path: string; state: 'accepted' | 'pending' | 'draft' | 'missing'; registered: boolean; ready: boolean; requires: string[];
  collaborators: Array<{ bot: string; bundleId: string; status: 'available' | 'unavailable' }>;
  memory: Array<{ target: string; bundleId: string; status: 'available' | 'empty' | 'unavailable'; paths: string[] }>;
  diagnostics: BotDiagnostic[];
}
export interface BotCheckResult { version: 1; bundle: string; bundleId: string; ready: boolean; candidates: BotCheckCandidate[]; bots: BotCheckBot[]; diagnostics: BotDiagnostic[] }

export interface ChangeRecoveryResult {version:1;bundle:string;lockRecovered:boolean;lockRecoveryPath?:string;publication:{id:string;path:string;state:'untouched'|'applied'|'externally-changed'}|null}
