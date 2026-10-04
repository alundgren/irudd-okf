import { Effect, Schema } from "effect";
import type { Command, Update } from "foldkit";
import type {
  Concept,
  ConceptSummary,
  GitStatus,
  Graph,
  MemoryContext,
  PullRequestResult,
  SearchResult,
  ValidationResult,
} from "../../core/src/contracts.ts";
import { request, RequestError, type Responses } from "./api.ts";
import { boundedGraph } from "./content.ts";

export interface Draft {
  bundle: string;
  path: string;
  raw: string;
  original: string;
  expectedHash: string | null;
  operation: "write" | "rename" | "delete";
  newPath: string;
  updateLinks: boolean;
  preview: boolean;
}
export type Intent =
  | { _tag: "Open"; bundle: string; path: string; fragment?: string }
  | { _tag: "Scope"; bundle: string }
  | { _tag: "View"; view: "wiki" | "graph" | "review" }
  | { _tag: "New" }
  | { _tag: "Cancel" }
  | { _tag: "Index"; path: string }
  | { _tag: "Route"; url: string }
  | { _tag: "Search"; offset?: number };
type Loaded = {
  [K in keyof Responses]: {
    _tag: "Loaded";
    kind: K;
    value: Responses[K];
    lane: string;
    id: number;
  };
}[keyof Responses];
export type Message =
  | Intent
  | Loaded
  | { _tag: "Failed"; lane: string; id: number; error: RequestError }
  | { _tag: "Refresh" }
  | { _tag: "Reload" }
  | { _tag: "Query"; value: string }
  | { _tag: "ListPage"; offset: number }
  | { _tag: "Edit"; operation: Draft["operation"] }
  | { _tag: "Draft"; field: "raw" | "path" | "newPath"; value: string }
  | { _tag: "UpdateLinks"; value: boolean }
  | { _tag: "PreviewDraft" }
  | { _tag: "Save" }
  | { _tag: "ContinueDraft" }
  | { _tag: "Discard" }
  | { _tag: "Stay" }
  | { _tag: "Copy" }
  | { _tag: "Notice"; text: string }
  | { _tag: "Recovery"; draft: Draft | null; bundle: string; path: string }
  | { _tag: "Recover" }
  | { _tag: "ForgetRecovery" }
  | { _tag: "UseCurrent" }
  | { _tag: "RebaseDraft" }
  | { _tag: "GraphLimit"; value: string }
  | { _tag: "GraphDepth"; value: string }
  | { _tag: "Zoom"; value: number }
  | { _tag: "Pan"; x: number; y: number }
  | { _tag: "ResetGraph" }
  | { _tag: "Validate" }
  | { _tag: "SelectPath"; path: string }
  | { _tag: "ReviewField"; field: "base" | "title" | "body"; value: string }
  | { _tag: "GitPreview" }
  | { _tag: "Publish" }
  | { _tag: "Noop" };
export interface Model {
  context: MemoryContext | null;
  bundle: string;
  concept: Concept | null;
  concepts: ConceptSummary[];
  listOffset: number;
  query: string;
  search: SearchResult | null;
  view: "wiki" | "graph" | "review";
  graph: Graph | null;
  graphLimit: number;
  graphDepth: number;
  zoom: number;
  panX: number;
  panY: number;
  draft: Draft | null;
  recovery: Draft | null;
  conflict: Concept | null;
  pendingIntent: Intent | null;
  status: GitStatus | null;
  selectedPaths: string[];
  gitPreview: Responses["preview"] | null;
  pr: PullRequestResult | null;
  base: string;
  title: string;
  body: string;
  validation: ValidationResult | null;
  notice: string;
  errors: Record<string, RequestError>;
  requests: Record<string, number>;
  busy: string[];
  sequence: number;
  desiredPath: string;
  fragment: string;
}
export const ModelSchema = Schema.declare<Model>(
  (value): value is Model =>
    typeof value === "object" && value !== null && "sequence" in value && "view" in value,
);
export function initialModel(): Model {
  const params = new URLSearchParams(location.search);
  return {
    context: null,
    bundle: params.get("bundle") ?? "",
    desiredPath: params.get("path") ?? "",
    fragment: decodeURIComponent(location.hash.slice(1)),
    concept: null,
    concepts: [],
    listOffset: 0,
    query: "",
    search: null,
    view: location.pathname === "/graph" ? "graph" : "wiki",
    graph: null,
    graphLimit: 80,
    graphDepth: 1,
    zoom: 1,
    panX: 0,
    panY: 0,
    draft: null,
    recovery: null,
    conflict: null,
    pendingIntent: null,
    status: null,
    selectedPaths: [],
    gitPreview: null,
    pr: null,
    base: "",
    title: "Update memory",
    body: "",
    validation: null,
    notice: "",
    errors: {},
    requests: {},
    busy: [],
    sequence: 0,
  };
}
export const dirty = (model: Model) =>
  !!model.draft &&
  (model.draft.operation !== "write" ||
    model.draft.raw !== model.draft.original ||
    model.draft.expectedHash === null);
type Result = Update.Return<Model, Message>;
type Commands = Array<Command.Command<Message>>;
const done = (model: Model, commands: Commands = []): Result => ({ model, commands });
export function issue<K extends keyof Responses>(
  model: Model,
  kind: K,
  endpoint: string,
  params: Record<string, string | number | undefined> = {},
  body?: unknown,
  method = "GET",
  lane: string = kind,
): Result {
  const id = model.sequence + 1;
  return {
    model: {
      ...model,
      sequence: id,
      requests: { ...model.requests, [lane]: id },
      busy: [...model.busy.filter((item) => item !== lane), lane],
      errors: Object.fromEntries(Object.entries(model.errors).filter(([key]) => key !== lane)),
    },
    commands: [
      {
        name: `Fetch${kind}`,
        effect: request(kind, endpoint, params, body, method).pipe(
          Effect.map((value) => ({ _tag: "Loaded", kind, value, lane, id }) as Loaded),
          Effect.catch((error) => Effect.succeed<Message>({ _tag: "Failed", error, lane, id })),
        ),
      },
    ],
  };
}
function combine(model: Model, tasks: Array<(model: Model) => Result>): Result {
  const commands: Commands = [];
  for (const task of tasks) {
    const result = task(model);
    model = result.model;
    commands.push(...(result.commands ?? []));
  }
  return done(model, commands);
}
function route(model: Model): Command.Command<Message> {
  return {
    name: "RememberLocation",
    effect: Effect.sync(() => {
      const params = new URLSearchParams({ bundle: model.bundle });
      if (model.desiredPath) params.set("path", model.desiredPath);
      history.pushState(
        null,
        "",
        `/${model.view === "graph" ? "graph" : "wiki"}?${params}${model.fragment ? `#${encodeURIComponent(model.fragment)}` : ""}`,
      );
      return { _tag: "Noop" } as Message;
    }),
  };
}
const draftKey = (draft: Pick<Draft, "bundle" | "path">) =>
  `okf-draft:${draft.bundle}:${draft.path}`;
function persist(draft: Draft | null, old?: Draft | null): Command.Command<Message> {
  return {
    name: "KeepDraft",
    effect: Effect.sync(() => {
      try {
        if (old && (!draft || old.path !== draft.path)) {
          sessionStorage.removeItem(draftKey(old));
          if (sessionStorage.getItem(`okf-last-draft:${old.bundle}`) === draftKey(old))
            sessionStorage.removeItem(`okf-last-draft:${old.bundle}`);
        }
        if (draft) {
          sessionStorage.setItem(draftKey(draft), JSON.stringify(draft));
          sessionStorage.setItem(`okf-last-draft:${draft.bundle}`, draftKey(draft));
        }
        return { _tag: "Noop" } as Message;
      } catch {
        return {
          _tag: "Notice",
          text: "Browser draft storage is unavailable. Keep this tab open or copy your draft before leaving.",
        } as Message;
      }
    }),
  };
}
function recovery(model: Model): Command.Command<Message> {
  return {
    name: "ReadDraft",
    effect: Effect.sync(() => {
      try {
        const raw =
          sessionStorage.getItem(draftKey({ bundle: model.bundle, path: model.desiredPath })) ??
          sessionStorage.getItem(sessionStorage.getItem(`okf-last-draft:${model.bundle}`) ?? "");
        const value = raw ? JSON.parse(raw) : null;
        const valid =
          value &&
          typeof value.raw === "string" &&
          typeof value.original === "string" &&
          typeof value.path === "string" &&
          value.bundle === model.bundle &&
          (value.operation === "write" ||
            value.operation === "rename" ||
            value.operation === "delete") &&
          typeof value.newPath === "string" &&
          typeof value.updateLinks === "boolean" &&
          (typeof value.expectedHash === "string" || value.expectedHash === null);
        return {
          _tag: "Recovery",
          draft:
            valid &&
            (value.operation !== "write" ||
              value.raw !== value.original ||
              value.expectedHash === null)
              ? value
              : null,
          bundle: model.bundle,
          path: model.desiredPath,
        } as Message;
      } catch {
        return {
          _tag: "Recovery",
          draft: null,
          bundle: model.bundle,
          path: model.desiredPath,
        } as Message;
      }
    }),
  };
}
function graphRequest(model: Model): Result {
  return issue(model, "graph", "graph", {
    bundle: model.bundle,
    path: /(?:^|\/)(?:index|log)\.md$/.test(model.desiredPath)
      ? undefined
      : model.desiredPath || undefined,
    depth: model.graphDepth,
    limit: model.graphLimit,
  });
}
function refresh(model: Model): Result {
  return combine({ ...model, validation: null }, [
    (m) => issue(m, "list", "list", { bundle: m.bundle }),
    (m) =>
      m.bundle
        ? issue(m, "concept", m.desiredPath ? "concept" : "index", {
            bundle: m.bundle,
            path: m.desiredPath || undefined,
          })
        : done(m),
    ...(model.view === "graph" ? [graphRequest] : []),
    ...(model.view === "review" && model.bundle
      ? [(m: Model) => issue(m, "status", "git/status", { bundle: m.bundle })]
      : []),
  ]);
}
function navigate(model: Model, intent: Intent): Result {
  if (model.busy.includes("pr"))
    return done({
      ...model,
      notice:
        "The pull request is being created. Wait for its result before switching sources or views.",
    });
  if (model.busy.includes("mutation"))
    return done({
      ...model,
      notice: "The file is being saved. Wait for the result before leaving this document.",
    });
  if (dirty(model))
    return done({ ...model, pendingIntent: intent }, [
      {
        name: "FocusDraftWarning",
        effect: Effect.sync(() => {
          requestAnimationFrame(() =>
            document.querySelector<HTMLButtonElement>(".modal button")?.focus(),
          );
          return { _tag: "Noop" } as Message;
        }),
      },
    ]);
  if (intent._tag === "Search") {
    const next = { ...model, view: "wiki" as const, draft: null, conflict: null };
    const result = issue(next, "search", "search", {
      bundle: next.bundle,
      q: next.query,
      limit: 10,
      offset: intent.offset ?? 0,
    });
    return { ...result, commands: [...(result.commands ?? []), route(next)] };
  }
  if (intent._tag === "Cancel")
    return done({ ...model, draft: null, conflict: null }, [persist(null, model.draft)]);
  if (intent._tag === "New") {
    const draft: Draft = {
      bundle: model.bundle,
      path: "",
      raw: "---\ntype: concept\ntitle: New concept\n---\n\n",
      original: "",
      expectedHash: null,
      operation: "write",
      newPath: "",
      updateLinks: false,
      preview: false,
    };
    return done({
      ...model,
      draft,
      recovery: null,
      conflict: null,
      view: "wiki",
      notice: "",
      errors: {},
    });
  }
  let next = { ...model, draft: null, conflict: null, recovery: null, notice: "", errors: {} };
  if (intent._tag === "Scope")
    next = {
      ...next,
      bundle: intent.bundle,
      concept: null,
      desiredPath: "",
      fragment: "",
      concepts: [],
      graph: null,
      search: null,
      query: "",
      status: null,
      selectedPaths: [],
      gitPreview: null,
      pr: null,
      listOffset: 0,
    };
  if (intent._tag === "View") next = { ...next, view: intent.view };
  if (intent._tag === "Open")
    next = {
      ...next,
      bundle: intent.bundle,
      desiredPath: intent.path,
      fragment: intent.fragment ?? "",
      concept: null,
      view: "wiki",
      search: null,
    };
  if (intent._tag === "Index")
    next = {
      ...next,
      desiredPath: intent.path,
      fragment: "",
      concept: null,
      view: "wiki",
      search: null,
    };
  if (intent._tag === "Route") {
    const url = new URL(intent.url, location.origin);
    next = {
      ...next,
      view: url.pathname === "/graph" ? "graph" : "wiki",
      bundle: url.searchParams.get("bundle") ?? model.bundle,
      desiredPath: url.searchParams.get("path") ?? "",
      fragment: decodeURIComponent(url.hash.slice(1)),
      concept: null,
    };
  }
  const result =
    intent._tag === "Index"
      ? issue(next, "concept", "index", { bundle: next.bundle, path: intent.path || undefined })
      : refresh(next);
  return { ...result, commands: [...(result.commands ?? []), route(next)] };
}
export function update(model: Model, message: Message): Result {
  if (["Open", "Scope", "View", "New", "Cancel", "Index", "Route", "Search"].includes(message._tag))
    return navigate(model, message as Intent);
  switch (message._tag) {
    case "Loaded": {
      if (model.requests[message.lane] !== message.id) return done(model);
      const next = { ...model, busy: model.busy.filter((lane) => lane !== message.lane) };
      switch (message.kind) {
        case "context": {
          const bundle =
            message.value.bundles.find((item) => item.name === model.bundle)?.name ??
            message.value.bundles[0]?.name ??
            "";
          const result = refresh({ ...next, context: message.value, bundle });
          return { ...result, commands: [...(result.commands ?? []), recovery(result.model)] };
        }
        case "list":
          return done({
            ...next,
            concepts: message.value.concepts,
            listOffset: Math.min(
              next.listOffset,
              Math.max(0, Math.floor((message.value.concepts.length - 1) / 30) * 30),
            ),
          });
        case "concept": {
          if (message.lane === "conflict") return done({ ...next, conflict: message.value });
          const result = {
            ...next,
            concept: message.value,
            desiredPath: message.value.path,
            conflict:
              message.lane === "restore" &&
              next.draft &&
              next.draft.expectedHash !== message.value.hash
                ? message.value
                : next.conflict,
          };
          const commands = [recovery(result)];
          if (next.fragment)
            commands.push({
              name: "ScrollFragment",
              effect: Effect.sync(() => {
                requestAnimationFrame(() =>
                  document.getElementById(next.fragment)?.scrollIntoView(),
                );
                return { _tag: "Noop" } as Message;
              }),
            });
          return done(result, commands);
        }
        case "search":
          return done({ ...next, search: message.value });
        case "graph":
          return done({ ...next, graph: boundedGraph(message.value, next.graphLimit) });
        case "validation":
          return done({ ...next, validation: message.value });
        case "status":
          return done({
            ...next,
            status: message.value,
            selectedPaths: next.selectedPaths.filter((path) =>
              message.value.files.some((file) => file.path === path),
            ),
          });
        case "preview":
          return done({ ...next, gitPreview: message.value, pr: null });
        case "pr":
          return done({
            ...next,
            pr: message.value,
            notice: "Pull request created. Open it to review and merge on GitHub.",
          });
        case "mutation": {
          const result = refresh({
            ...next,
            draft: null,
            recovery: null,
            conflict: null,
            concept: null,
            desiredPath: message.value.hash ? message.value.path : "",
            notice: `Saved ${message.value.changedPaths.join(", ")}.${message.value.recoveryPath ? ` Recovery copy: ${message.value.recoveryPath}` : ""}`,
            gitPreview: null,
          });
          return {
            ...result,
            commands: [...(result.commands ?? []), persist(null, model.draft), route(result.model)],
          };
        }
      }
    }
    case "Failed": {
      if (model.requests[message.lane] !== message.id) return done(model);
      const next = {
        ...model,
        busy: model.busy.filter((lane) => lane !== message.lane),
        errors: { ...model.errors, [message.lane]: message.error },
      };
      if (message.lane === "mutation" && message.error.status === 409 && model.draft !== null)
        return issue(
          next,
          "concept",
          "concept",
          { bundle: model.draft?.bundle, path: model.draft?.path },
          undefined,
          "GET",
          "conflict",
        );
      return done(next);
    }
    case "Reload":
      return done(model, [
        {
          name: "ReloadViewer",
          effect: Effect.sync(() => {
            location.reload();
            return { _tag: "Noop" } as Message;
          }),
        },
      ]);
    case "Refresh":
      return dirty(model)
        ? done({
            ...model,
            notice: "Your draft is kept. Save or cancel it before refreshing the document.",
          })
        : model.context
          ? refresh(model)
          : issue(model, "context", "context");
    case "Query":
      return done({ ...model, query: message.value });
    case "ListPage":
      return done({ ...model, listOffset: message.offset });
    case "Edit": {
      if (!model.concept) return done(model);
      const draft: Draft = {
        bundle: model.bundle,
        path: model.concept.path,
        raw: model.concept.raw,
        original: model.concept.raw,
        expectedHash: model.concept.hash || null,
        operation: message.operation,
        newPath: model.concept.path,
        updateLinks: true,
        preview: false,
      };
      return done({ ...model, draft, conflict: null, recovery: null, notice: "", errors: {} }, [
        persist(draft),
      ]);
    }
    case "Draft": {
      if (!model.draft) return done(model);
      const draft = { ...model.draft, [message.field]: message.value, preview: false };
      return done({ ...model, draft }, [persist(draft, model.draft)]);
    }
    case "UpdateLinks":
      return model.draft
        ? done(
            { ...model, draft: { ...model.draft, updateLinks: message.value, preview: false } },
            [persist({ ...model.draft, updateLinks: message.value, preview: false })],
          )
        : done(model);
    case "PreviewDraft":
      return model.draft
        ? done({ ...model, draft: { ...model.draft, preview: true } })
        : done(model);
    case "ContinueDraft":
      return model.draft
        ? done({ ...model, draft: { ...model.draft, preview: false } })
        : done(model);
    case "Save": {
      const draft = model.draft;
      if (!draft?.preview || model.busy.includes("mutation") || model.conflict) return done(model);
      const common = {
        bundle: draft.bundle,
        path: draft.path,
        expectedHash: draft.expectedHash,
        authorizePersonal: true,
      };
      return issue(
        model,
        "mutation",
        draft.operation === "rename" ? "rename" : "concept",
        {},
        draft.operation === "write"
          ? { ...common, raw: draft.raw }
          : draft.operation === "rename"
            ? { ...common, newPath: draft.newPath, updateLinks: draft.updateLinks }
            : common,
        draft.operation === "delete" ? "DELETE" : "POST",
      );
    }
    case "Discard": {
      const result = navigate(
        { ...model, draft: null, pendingIntent: null },
        model.pendingIntent ?? { _tag: "Cancel" },
      );
      return { ...result, commands: [...(result.commands ?? []), persist(null, model.draft)] };
    }
    case "Stay":
      return done({ ...model, pendingIntent: null });
    case "Copy":
      return done(model, [
        {
          name: "CopyDraft",
          effect: Effect.tryPromise({
            try: () => navigator.clipboard.writeText(model.draft?.raw ?? model.recovery?.raw ?? ""),
            catch: () =>
              new RequestError(
                "clipboard",
                "Copy failed. Select the Markdown in the editor and copy it with your keyboard.",
              ),
          }).pipe(
            Effect.map(() => ({ _tag: "Notice", text: "Draft copied." }) as Message),
            Effect.catch((error) =>
              Effect.succeed<Message>({ _tag: "Notice", text: error.message }),
            ),
          ),
        },
      ]);
    case "Notice":
      return done({ ...model, notice: message.text });
    case "Recovery":
      return model.draft || model.bundle !== message.bundle || model.desiredPath !== message.path
        ? done(model)
        : done({ ...model, recovery: message.draft });
    case "Recover": {
      if (!model.recovery) return done(model);
      const draft = { ...model.recovery, preview: false };
      const next = {
        ...model,
        draft,
        recovery: null,
        conflict: null,
        concept: null,
        desiredPath: draft.path,
        view: "wiki" as const,
      };
      return draft.expectedHash === null
        ? done(next, [route(next)])
        : issue(
            next,
            "concept",
            "concept",
            { bundle: draft.bundle, path: draft.path },
            undefined,
            "GET",
            "restore",
          );
    }
    case "ForgetRecovery":
      return done({ ...model, recovery: null }, [persist(null, model.recovery)]);
    case "UseCurrent":
      return done(
        {
          ...model,
          draft: null,
          conflict: null,
          concept: model.conflict ?? model.concept,
          errors: {},
        },
        [persist(null, model.draft)],
      );
    case "RebaseDraft": {
      if (!model.draft || !model.conflict) return done(model);
      const draft = {
        ...model.draft,
        original: model.conflict.raw,
        expectedHash: model.conflict.hash,
        preview: false,
      };
      return done({ ...model, draft, concept: model.conflict, conflict: null, errors: {} }, [
        persist(draft),
      ]);
    }
    case "GraphLimit":
      return graphRequest({
        ...model,
        graphLimit: Math.max(1, Math.min(250, Number(message.value) || 80)),
      });
    case "GraphDepth":
      return graphRequest({
        ...model,
        graphDepth: Math.max(0, Math.min(3, Number(message.value) || 0)),
      });
    case "Zoom":
      return done({ ...model, zoom: Math.max(0.3, Math.min(4, model.zoom * message.value)) });
    case "Pan":
      return done({ ...model, panX: model.panX + message.x, panY: model.panY + message.y });
    case "ResetGraph":
      return done({ ...model, zoom: 1, panX: 0, panY: 0 });
    case "Validate":
      return issue(model, "validation", "validate", { bundle: model.bundle, lint: "true" });
    case "SelectPath":
      if (model.busy.includes("pr")) return done(model);
      return done({
        ...model,
        selectedPaths: model.selectedPaths.includes(message.path)
          ? model.selectedPaths.filter((path) => path !== message.path)
          : [...model.selectedPaths, message.path],
        gitPreview: null,
        pr: null,
      });
    case "ReviewField":
      if (model.busy.includes("pr")) return done(model);
      return done({
        ...model,
        [message.field]: message.value,
        ...(message.field === "base" ? { gitPreview: null, pr: null } : {}),
      });
    case "GitPreview":
      return model.selectedPaths.length && !model.busy.includes("pr")
        ? issue(
            model,
            "preview",
            "git/preview",
            {},
            {
              bundle: model.bundle,
              paths: model.selectedPaths,
              ...(model.base ? { base: model.base } : {}),
            },
            "POST",
          )
        : done(model);
    case "Publish":
      return model.gitPreview && model.title.trim() && !model.busy.includes("pr")
        ? issue(
            model,
            "pr",
            "git/pr",
            {},
            { token: model.gitPreview.token, title: model.title, body: model.body },
            "POST",
          )
        : done(model);
    case "Noop":
      return done(model);
  }
  return done(model);
}
