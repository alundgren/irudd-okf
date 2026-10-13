import { Schema } from 'effect';
import { OkfError } from './contracts.ts';

export const ConfigSchema = Schema.Struct({ version: Schema.Literal(1), bundles: Schema.mutable(Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String, personal: Schema.optional(Schema.Boolean) }))), active: Schema.mutable(Schema.Array(Schema.String)) });
export const WriteSchema = Schema.Struct({ bundle: Schema.String, path: Schema.String, raw: Schema.String, namespace: Schema.optional(Schema.String), expectedHash: Schema.NullOr(Schema.String), authorizePersonal: Schema.optional(Schema.Boolean) });
export const DeleteSchema = Schema.Struct({ bundle: Schema.String, path: Schema.String, expectedHash: Schema.String, authorizePersonal: Schema.optional(Schema.Boolean) });
export const RenameSchema = Schema.Struct({ ...DeleteSchema.fields, newPath: Schema.String, updateLinks: Schema.optional(Schema.Boolean), previewHash: Schema.optional(Schema.String) });
export function decode<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown, code = 'INVALID_REQUEST') {
  try { return Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(value); }
  catch { throw new OkfError(code, code === 'INVALID_CONFIG' ? 'Runtime configuration does not match version 1.' : 'The request contains missing, invalid or unexpected fields.'); }
}

const Kind = Schema.Literals(['procedural', 'episodic', 'semantic']);
const Stage = Schema.Literals(['bronze', 'silver', 'gold']);
const Actor = Schema.String;
const Sources = Schema.mutable(Schema.Array(Schema.Union([Schema.String, Schema.StructWithRest(Schema.Struct({ resource: Schema.String }), [Schema.Record(Schema.String, Schema.Unknown)])])));
export const TaskSchema = Schema.Struct({ reference: Schema.String, state: Schema.Literals(['open', 'completed', 'cancelled']), completed_at: Schema.optional(Schema.String) });
export const TemplateSchema = Schema.Struct({ bundle: Schema.String, kind: Kind, stage: Schema.optional(Stage), namespace: Schema.optional(Schema.String), title: Schema.String, description: Schema.String, tags: Schema.mutable(Schema.Array(Schema.String)), actor: Actor, at: Schema.optional(Schema.String), occurredAt: Schema.optional(Schema.String), sources: Schema.optional(Sources), task: Schema.optional(TaskSchema) });
export const ReviewSchema = Schema.Struct({ ...DeleteSchema.fields, decision: Schema.Literals(['approve', 'reject']), actor: Actor, reason: Schema.String, at: Schema.optional(Schema.String), operator: Schema.optional(Schema.Literal(true)) });
export const VerifySchema = Schema.Struct({ ...DeleteSchema.fields, actor: Actor, method: Schema.String, at: Schema.optional(Schema.String) });
export const TaskRequestSchema = Schema.Struct({ ...DeleteSchema.fields, task: TaskSchema, retentionDays: Schema.optional(Schema.NullOr(Schema.Number)), retentionReason: Schema.optional(Schema.NullOr(Schema.String)) });
export const LifecycleSchema = Schema.Struct({ ...DeleteSchema.fields, action: Schema.Literals(['archive', 'restore', 'expire', 'deprecate', 'clear-expiration', 'recheck']), at: Schema.optional(Schema.String), replacement: Schema.optional(Schema.String), reason: Schema.optional(Schema.String) });
const Purpose = Schema.Literals(['maintenance', 'consolidation', 'migration']);
const Change = Schema.Struct({ path: Schema.String, expectedHash: Schema.NullOr(Schema.String), raw: Schema.NullOr(Schema.String) });
export const ProposalSchema = Schema.Struct({ version: Schema.Literal(1), bundle: Schema.String, purpose: Purpose, changes: Schema.mutable(Schema.Array(Change)), reason: Schema.String, allowNamespaceChange: Schema.optional(Schema.Boolean) });
const DiagnosticSchema = Schema.Struct({ level: Schema.Literals(['error', 'warning']), code: Schema.String, path: Schema.String, message: Schema.String, bundle: Schema.optional(Schema.String) });
export const PreviewSchema = Schema.Struct({ version: Schema.Literal(1), bundle: Schema.String, root: Schema.String, purpose: Purpose, reason: Schema.String, previewHash: Schema.String, changes: Schema.mutable(Schema.Array(Schema.Struct({ ...Change.fields, before: Schema.NullOr(Schema.String), afterHash: Schema.NullOr(Schema.String) }))), guards: Schema.mutable(Schema.Array(Schema.Struct({ path: Schema.String, expectedHash: Schema.String }))), diagnostics: Schema.mutable(Schema.Array(DiagnosticSchema)), unresolved: Schema.mutable(Schema.Array(Schema.Struct({ path: Schema.String, field: Schema.String, message: Schema.String }))), allowNamespaceChange: Schema.Boolean });
export const ApplySchema = Schema.Struct({ preview: PreviewSchema, authorizePersonal: Schema.optional(Schema.Boolean) });
export const MigrationSchema = Schema.Struct({ bundle: Schema.String, policy: Schema.optional(Schema.Struct({ namespaces: Schema.optional(Schema.mutable(Schema.Array(Schema.String))), topics: Schema.optional(Schema.mutable(Schema.Array(Schema.String))), gold_review: Schema.optional(Schema.Literals(['any', 'human'])), task_retention_days: Schema.optional(Schema.Number), review_interval_days: Schema.optional(Schema.Number) })), decisions: Schema.optional(Schema.Record(Schema.String, Schema.Struct({ raw: Schema.optional(Schema.String), kind: Schema.optional(Kind), stage: Schema.optional(Stage), namespace: Schema.optional(Schema.String), actor: Schema.optional(Actor), at: Schema.optional(Schema.String), title: Schema.optional(Schema.String), description: Schema.optional(Schema.String), tags: Schema.optional(Schema.mutable(Schema.Array(Schema.String))), sources: Schema.optional(Sources), status: Schema.optional(Schema.String), occurredAt: Schema.optional(Schema.String), task: Schema.optional(TaskSchema), retentionReason: Schema.optional(Schema.NullOr(Schema.String)), expiresAt: Schema.optional(Schema.NullOr(Schema.String)), staleAfter: Schema.optional(Schema.NullOr(Schema.String)), archivedAt: Schema.optional(Schema.NullOr(Schema.String)), prerequisites: Schema.optional(Schema.mutable(Schema.Array(Schema.String))), replaces: Schema.optional(Schema.mutable(Schema.Array(Schema.String))), replacedBy: Schema.optional(Schema.NullOr(Schema.String)), derivedFrom: Schema.optional(Schema.mutable(Schema.Array(Schema.Struct({resource: Schema.String, content_hash: Schema.String})))) }))) });

export const InspectSchema = Schema.Struct({ bundle: Schema.String, previewHash: Schema.String });
export const RecallSchema = Schema.Struct({ namespaces: Schema.optional(Schema.mutable(Schema.Array(Schema.String))), includeExcluded: Schema.optional(Schema.Boolean) });
export const SearchOptionsSchema = Schema.Struct({ ...RecallSchema.fields, bundle: Schema.optional(Schema.String), limit: Schema.optional(Schema.Number), offset: Schema.optional(Schema.Number) });
export const GraphOptionsSchema = Schema.Struct({ ...RecallSchema.fields, bundle: Schema.optional(Schema.String), path: Schema.optional(Schema.String), depth: Schema.optional(Schema.Number), limit: Schema.optional(Schema.Number) });

export const RecoverySchema = Schema.Struct({ ...InspectSchema.fields, authorizePersonal: Schema.optional(Schema.Boolean) });
