import { Effect, Schema } from "effect";
import type {
  ApiError,
  Concept,
  ConceptSummary,
  GitPreview,
  GitStatus,
  Graph,
  MemoryContext,
  MutationResult,
  PullRequestResult,
  SearchResult,
  ValidationResult,
} from "../../core/src/contracts.ts";

const summary = {
  bundle: Schema.String,
  path: Schema.String,
  title: Schema.String,
  type: Schema.NullOr(Schema.String),
  description: Schema.String,
  tags: Schema.Array(Schema.String),
  hash: Schema.String,
  malformed: Schema.Boolean,
};
const diagnostic = Schema.Struct({
  level: Schema.Literals(["error", "warning"]),
  code: Schema.String,
  path: Schema.String,
  message: Schema.String,
  bundle: Schema.optional(Schema.String),
});
const schemas = {
  context: Schema.Struct({
    version: Schema.Literal(1),
    cwd: Schema.String,
    gitRoot: Schema.NullOr(Schema.String),
    configPath: Schema.String,
    bundles: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        root: Schema.String,
        kind: Schema.Literals(["repository", "personal", "explicit"]),
        writable: Schema.Boolean,
      }),
    ),
  }),
  list: Schema.Struct({
    version: Schema.Literal(1),
    concepts: Schema.Array(Schema.Struct(summary)),
  }),
  concept: Schema.Struct({
    ...summary,
    raw: Schema.String,
    body: Schema.String,
    metadata: Schema.Record(Schema.String, Schema.Unknown),
    diagnostics: Schema.Array(diagnostic),
    links: Schema.Array(
      Schema.Struct({
        target: Schema.String,
        label: Schema.String,
        external: Schema.Boolean,
        broken: Schema.Boolean,
        fragment: Schema.optional(Schema.String),
      }),
    ),
    backlinks: Schema.Array(
      Schema.Struct({ bundle: Schema.String, path: Schema.String, title: Schema.String }),
    ),
  }),
  search: Schema.Struct({
    version: Schema.Literal(1),
    query: Schema.String,
    results: Schema.Array(
      Schema.Struct({
        ...summary,
        score: Schema.Number,
        excerpt: Schema.String,
        matched: Schema.Array(Schema.String),
      }),
    ),
    total: Schema.Number,
    limit: Schema.Number,
    offset: Schema.Number,
    truncated: Schema.Boolean,
  }),
  graph: Schema.Struct({
    version: Schema.Literal(1),
    nodes: Schema.Array(Schema.Struct(summary)),
    edges: Schema.Array(
      Schema.Struct({
        from: Schema.String,
        to: Schema.String,
        label: Schema.String,
        broken: Schema.Boolean,
        external: Schema.Boolean,
      }),
    ),
    truncated: Schema.Boolean,
    limit: Schema.Number,
  }),
  validation: Schema.Struct({
    version: Schema.Literal(1),
    files: Schema.Number,
    errors: Schema.Number,
    warnings: Schema.Number,
    diagnostics: Schema.Array(diagnostic),
  }),
  mutation: Schema.Struct({
    version: Schema.Literal(1),
    bundle: Schema.String,
    path: Schema.String,
    hash: Schema.NullOr(Schema.String),
    changedPaths: Schema.Array(Schema.String),
    recoveryPath: Schema.optional(Schema.String),
  }),
  status: Schema.Struct({
    version: Schema.Literal(1),
    available: Schema.Boolean,
    root: Schema.NullOr(Schema.String),
    branch: Schema.NullOr(Schema.String),
    remote: Schema.NullOr(Schema.String),
    files: Schema.Array(Schema.Struct({ path: Schema.String, status: Schema.String })),
    reason: Schema.optional(Schema.String),
  }),
  preview: Schema.Struct({
    version: Schema.Literal(1),
    token: Schema.String,
    bundle: Schema.String,
    base: Schema.String,
    baseRef: Schema.String,
    repository: Schema.String,
    branch: Schema.String,
    paths: Schema.Array(Schema.String),
    diff: Schema.String,
    expiresAt: Schema.String,
    warnings: Schema.Array(Schema.String),
  }),
  pr: Schema.Struct({
    version: Schema.Literal(1),
    url: Schema.String,
    branch: Schema.String,
    worktree: Schema.String,
    state: Schema.Literals(["created", "existing"]),
  }),
  error: Schema.Struct({
    version: Schema.Literal(1),
    error: Schema.Struct({
      code: Schema.String,
      message: Schema.String,
      details: Schema.Record(Schema.String, Schema.Unknown),
    }),
  }),
};
export interface Responses {
  context: MemoryContext;
  list: { version: 1; concepts: ConceptSummary[] };
  concept: Concept;
  search: SearchResult;
  graph: Graph;
  validation: ValidationResult;
  mutation: MutationResult;
  status: GitStatus;
  preview: GitPreview & { baseRef: string; repository: string };
  pr: PullRequestResult;
}
export class RequestError extends Error {
  readonly _tag = "RequestError";
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly status = 0,
  ) {
    super(message);
  }
}
export const errorFrom = (error: unknown): RequestError =>
  error instanceof RequestError
    ? error
    : new RequestError(
        "connection",
        "The local server could not be reached. Restart irudd-okf serve and reload this page. Draft recovery is kept in this tab.",
      );
export function request<K extends keyof Responses>(
  kind: K,
  endpoint: string,
  params: Record<string, string | number | undefined> = {},
  body?: unknown,
  method = "GET",
): Effect.Effect<Responses[K], RequestError> {
  return Effect.gen(function* () {
    const url = new URL(`/api/${endpoint}`, location.origin);
    for (const [key, value] of Object.entries(params))
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    const capability = document.querySelector<HTMLMetaElement>('meta[name="okf-session"]')?.content;
    if (!capability)
      return yield* Effect.fail(
        new RequestError(
          "session",
          "This page has no local session. Restart irudd-okf serve and open its viewer URL.",
        ),
      );
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(url, {
          method,
          signal,
          headers: {
            "X-OKF-Session": capability,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      catch: errorFrom,
    });
    const json = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () =>
        new RequestError(
          "response",
          "The server returned an unreadable response.",
          {},
          response.status,
        ),
    });
    if (!response.ok) {
      const parsed = yield* Schema.decodeUnknownEffect(schemas.error)(json).pipe(
        Effect.mapError(
          () =>
            new RequestError(
              "response",
              `The server returned HTTP ${response.status}.`,
              {},
              response.status,
            ),
        ),
      );
      const failure = parsed as ApiError;
      return yield* Effect.fail(
        new RequestError(
          failure.error.code,
          failure.error.message,
          failure.error.details,
          response.status,
        ),
      );
    }
    const decoded = yield* Schema.decodeUnknownEffect(schemas[kind])(json).pipe(
      Effect.mapError(
        () =>
          new RequestError(
            "response",
            "The server returned data this viewer cannot read. Restart the server and reload this page.",
          ),
      ),
    );
    return decoded as unknown as Responses[K];
  });
}
