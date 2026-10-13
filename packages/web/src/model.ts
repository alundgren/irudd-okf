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
import {
  keepMemoryWorkspace,
  restoreMemoryWorkspace,
  type MemoryWorkspace,
} from "./memory-recovery.ts";
import { editField, structuredMemory, type MemoryField } from "./memory-editor.ts";
import { boundedGraph } from "./content.ts";

export interface Draft {
  fields?: Partial<Record<MemoryField | "body", string>>;
  root: string;
  bundle: string;
  path: string;
  raw: string;
  original: string;
  expectedHash: string | null;
  operation: "write" | "rename" | "delete";
  newPath: string;
  updateLinks: boolean;
  preview: boolean;
  referrers: Concept["backlinks"];
}
export type Intent =
  | { _tag: "Open"; bundle: string; path: string; fragment?: string }
  | { _tag: "Scope"; bundle: string }
  | { _tag: "View"; view: "wiki" | "graph" | "review" | "maintenance" | "profile" }
  | { _tag: "New" }
  | { _tag: "Namespaces"; name: string }
  | { _tag: "RecallAll" }
  | { _tag: "IncludeExcluded"; value: boolean }
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
    scope: RequestScope | null;
  };
}[keyof Responses];
export type Message =
  | Intent
  | Loaded
  | { _tag: "Failed"; lane: string; id: number; error: RequestError; scope: RequestScope | null }
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
  | { _tag: "Recovery"; draft: Draft | null; bundle: string; path: string; root: string }
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
  | { _tag: "MemoryField"; field: MemoryField | "body"; value: string }
  | { _tag: "MemoryForm"; field: string; value: string }
  | {
      _tag: "MemoryAction";
      action:
        | "template"
        | "review"
        | "verify"
        | "task"
        | "lifecycle"
        | "migration"
        | "proposal"
        | "apply"
        | "journal"
        | "recoverBatch";
    }
  | { _tag: "ProposalChange"; index: number; field: "path" | "raw"; value: string }
  | { _tag: "ProposalAdd" }
  | { _tag: "ProposalRemove"; index: number }
  | { _tag: "MigrationField"; path: string; field: string; value: string }
  | { _tag: "MemoryWorkspaceRecovery"; root: string; bundle: string; value: MemoryWorkspace }
  | { _tag: "Disclosure"; key: string; value: boolean }
  | { _tag: "Noop" };
export interface Model {
  disclosures: Record<string, boolean>;
  profile: Responses["profile"] | null;
  namespaces: Responses["namespaces"] | null;
  selectedNamespaces: string[];
  includeExcluded: boolean;
  audit: Responses["audit"] | null;
  maintenancePreview: Responses["maintenancePreview"] | null;
  maintenanceResult: Responses["maintenanceResult"] | null;
  journal: Responses["journal"] | null;
  memoryForm: Record<string, string>;
  migrationDecisions: Record<string, Record<string, string>>;
  proposalChanges: Array<{ path: string; raw: string }>;
  context: MemoryContext | null;
  bundle: string;
  concept: Concept | null;
  concepts: ConceptSummary[];
  listOffset: number;
  query: string;
  search: SearchResult | null;
  view: "wiki" | "graph" | "review" | "maintenance" | "profile";
  graph: Graph | null;
  graphLimit: number;
  graphDepth: number;
  zoom: number;
  panX: number;
  panY: number;
  draft: Draft | null;
  recovery: Draft | null;
  conflict: Concept | null;
  renamePreview: Responses["renamePreview"] | null;
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
    disclosures: {},
    profile: null,
    namespaces: null,
    selectedNamespaces: params.getAll("namespace"),
    includeExcluded: params.get("includeExcluded") === "true",
    audit: null,
    maintenancePreview: null,
    maintenanceResult: null,
    journal: null,
    memoryForm: {
      kind: "semantic",
      stage: "bronze",
      namespace: "shared",
      actor: "human:operator",
      decision: "approve",
      taskState: "completed",
      lifecycleAction: "archive",
      purpose: "maintenance",
    },
    migrationDecisions: {},
    proposalChanges: [],
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
    renamePreview: null,
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
interface RequestScope {
  bundle: string;
  root: string;
}
const bundleRoot = (model: Model, bundle = model.bundle) =>
  model.context?.bundles.find((item) => item.name === bundle)?.root ?? "";
const sameScope = (model: Model, scope: RequestScope | null) =>
  scope === null || (scope.bundle === model.bundle && scope.root === bundleRoot(model));
function clearScope(model: Model, bundle: string): Model {
  return {
    ...model,
    bundle,
    memoryForm: {
      kind: "semantic",
      stage: "bronze",
      namespace: "shared",
      actor: "human:operator",
      decision: "approve",
      taskState: "completed",
      lifecycleAction: "archive",
      purpose: "maintenance",
    },
    disclosures: {},
    profile: null,
    namespaces: null,
    audit: null,
    maintenancePreview: null,
    maintenanceResult: null,
    journal: null,
    selectedNamespaces: [],
    includeExcluded: false,
    migrationDecisions: {},
    proposalChanges: [],
    requests: {},
    busy: [],
    errors: {},
    concept: null,
    concepts: [],
    graph: null,
    search: null,
    query: "",
    status: null,
    selectedPaths: [],
    gitPreview: null,
    renamePreview: null,
    validation: null,
    pr: null,
    recovery: null,
    conflict: null,
    listOffset: 0,
    base: "",
  };
}
function clearRenamePreview(model: Model): Model {
  return {
    ...model,
    renamePreview: null,
    requests: Object.fromEntries(
      Object.entries(model.requests).filter(
        ([lane]) => lane !== "renamePreview" && lane !== "deletePreview",
      ),
    ),
    busy: model.busy.filter((lane) => lane !== "renamePreview" && lane !== "deletePreview"),
  };
}
type Result = Update.Return<Model, Message>;
type Commands = Array<Command.Command<Message>>;
const done = (model: Model, commands: Commands = []): Result => ({ model, commands });
const doneMemory = (model: Model): Result => done(model, [keepMemoryWorkspace(model)]);
export function issue<K extends keyof Responses>(
  model: Model,
  kind: K,
  endpoint: string,
  params: Record<string, string | number | boolean | string[] | undefined> = {},
  body?: unknown,
  method = "GET",
  lane: string = kind,
): Result {
  const id = model.sequence + 1;
  const scope = kind === "context" ? null : { bundle: model.bundle, root: bundleRoot(model) };
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
          Effect.map((value) => ({ _tag: "Loaded", kind, value, lane, id, scope }) as Loaded),
          Effect.catch((error) =>
            Effect.succeed<Message>({ _tag: "Failed", error, lane, id, scope }),
          ),
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
      model.selectedNamespaces.forEach((name) => params.append("namespace", name));
      if (model.includeExcluded) params.set("includeExcluded", "true");
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
const draftKey = (draft: Pick<Draft, "root" | "bundle" | "path">) =>
  `okf-draft:v2:${JSON.stringify([draft.root, draft.bundle, draft.path])}`;
const lastDraftKey = (draft: Pick<Draft, "root" | "bundle">) =>
  `okf-last-draft:v2:${JSON.stringify([draft.root, draft.bundle])}`;
function persist(draft: Draft | null, old?: Draft | null): Command.Command<Message> {
  return {
    name: "KeepDraft",
    effect: Effect.sync(() => {
      try {
        if (old && (!draft || old.path !== draft.path)) {
          sessionStorage.removeItem(draftKey(old));
          if (sessionStorage.getItem(lastDraftKey(old)) === draftKey(old))
            sessionStorage.removeItem(lastDraftKey(old));
        }
        if (draft) {
          sessionStorage.setItem(draftKey(draft), JSON.stringify(draft));
          sessionStorage.setItem(lastDraftKey(draft), draftKey(draft));
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
      const root = bundleRoot(model);
      try {
        const raw = root
          ? (sessionStorage.getItem(
              draftKey({ root, bundle: model.bundle, path: model.desiredPath }),
            ) ??
            sessionStorage.getItem(
              sessionStorage.getItem(lastDraftKey({ root, bundle: model.bundle })) ?? "",
            ))
          : null;
        const value = raw ? JSON.parse(raw) : null;
        const valid =
          value &&
          typeof value.raw === "string" &&
          (value.fields === undefined ||
            (value.fields &&
              typeof value.fields === "object" &&
              Object.values(value.fields).every((item) => typeof item === "string"))) &&
          typeof value.original === "string" &&
          typeof value.path === "string" &&
          value.bundle === model.bundle &&
          value.root === root &&
          !!root &&
          Array.isArray(value.referrers) &&
          value.referrers.every(
            (item: unknown) =>
              !!item &&
              typeof item === "object" &&
              "bundle" in item &&
              typeof item.bundle === "string" &&
              "path" in item &&
              typeof item.path === "string" &&
              "title" in item &&
              typeof item.title === "string",
          ) &&
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
          root,
        } as Message;
      } catch {
        return {
          _tag: "Recovery",
          draft: null,
          bundle: model.bundle,
          path: model.desiredPath,
          root,
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
    namespace: model.selectedNamespaces,
    includeExcluded: model.includeExcluded,
    depth: model.graphDepth,
    limit: model.graphLimit,
  });
}
function refresh(model: Model): Result {
  return combine({ ...model, validation: null }, [
    (m) =>
      issue(m, "list", "list", {
        bundle: m.bundle,
        namespace: m.selectedNamespaces,
        includeExcluded: m.includeExcluded,
      }),
    ...(model.bundle
      ? [
          (m: Model) => issue(m, "profile", "profile", { bundle: m.bundle }),
          (m: Model) => issue(m, "namespaces", "namespaces", { bundle: m.bundle }),
        ]
      : []),
    ...(model.view === "maintenance" || model.view === "profile"
      ? [
          (m: Model) =>
            issue(m, "audit", "audit", {
              bundle: m.bundle,
              namespace: m.view === "profile" ? undefined : m.selectedNamespaces,
            }),
        ]
      : []),
    (m) =>
      m.bundle
        ? issue(m, "concept", m.desiredPath ? "concept" : "index", {
            bundle: m.bundle,
            namespace: m.selectedNamespaces,
            includeExcluded: m.includeExcluded,
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
  if (
    model.busy.includes("mutation") ||
    model.busy.includes("maintenanceResult") ||
    model.busy.includes("maintenanceRecovery") ||
    model.busy.includes("template")
  )
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
  if (
    intent._tag === "Namespaces" ||
    intent._tag === "IncludeExcluded" ||
    intent._tag === "RecallAll"
  ) {
    const next =
      intent._tag === "Namespaces"
        ? {
            ...model,
            selectedNamespaces: model.selectedNamespaces.includes(intent.name)
              ? model.selectedNamespaces.filter((name) => name !== intent.name)
              : [...model.selectedNamespaces, intent.name],
          }
        : intent._tag === "IncludeExcluded"
          ? { ...model, includeExcluded: intent.value }
          : { ...model, selectedNamespaces: [] };
    const result = refresh({ ...next, search: null });
    return { ...result, commands: [...(result.commands ?? []), route(next)] };
  }
  if (intent._tag === "Search") {
    const next = { ...model, view: "wiki" as const, draft: null, conflict: null };
    const result = issue(next, "search", "search", {
      bundle: next.bundle,
      namespace: next.selectedNamespaces,
      includeExcluded: next.includeExcluded,
      q: next.query,
      limit: 10,
      offset: intent.offset ?? 0,
    });
    return { ...result, commands: [...(result.commands ?? []), route(next)] };
  }
  if (intent._tag === "Cancel")
    return done({ ...model, draft: null, conflict: null }, [persist(null, model.draft)]);
  if (intent._tag === "New") {
    if (!bundleRoot(model)) return done(model);
    const draft: Draft = {
      root: bundleRoot(model),
      bundle: model.bundle,
      path: "",
      raw: "---\ntype: concept\ntitle: New concept\n---\n\n",
      original: "",
      expectedHash: null,
      operation: "write",
      newPath: "",
      updateLinks: false,
      preview: false,
      referrers: [],
    };
    return done({
      ...model,
      draft,
      recovery: null,
      conflict: null,
      view: "wiki",
      disclosures: { ...model.disclosures, "raw-editor": true },
      notice: "",
      errors: {},
    });
  }
  let next = clearRenamePreview({
    ...model,
    draft: null,
    conflict: null,
    recovery: null,
    notice: "",
    errors: {},
  });
  if (intent._tag === "Scope")
    next = { ...clearScope(next, intent.bundle), desiredPath: "", fragment: "" };
  if (intent._tag === "View") next = { ...next, view: intent.view };
  if (intent._tag === "Open") {
    if (intent.bundle !== next.bundle) next = clearScope(next, intent.bundle);
    next = {
      ...next,
      bundle: intent.bundle,
      desiredPath: intent.path,
      fragment: intent.fragment ?? "",
      concept: null,
      view: "wiki",
      search: null,
    };
  }
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
    const bundle = url.searchParams.get("bundle") ?? model.bundle;
    if (bundle !== next.bundle) next = clearScope(next, bundle);
    next = {
      ...next,
      view: url.pathname === "/graph" ? "graph" : "wiki",
      bundle: url.searchParams.get("bundle") ?? model.bundle,
      desiredPath: url.searchParams.get("path") ?? "",
      selectedNamespaces: url.searchParams.getAll("namespace"),
      includeExcluded: url.searchParams.get("includeExcluded") === "true",
      fragment: decodeURIComponent(url.hash.slice(1)),
      concept: null,
    };
  }
  const result =
    intent._tag === "Index"
      ? issue(next, "concept", "index", {
          bundle: next.bundle,
          path: intent.path || undefined,
          namespace: next.selectedNamespaces,
          includeExcluded: next.includeExcluded,
        })
      : refresh(next);
  return {
    ...result,
    commands: [
      ...(result.commands ?? []),
      ...(model.bundle !== next.bundle ? [restoreMemoryWorkspace(next)] : []),
      route(next),
    ],
  };
}
export function update(model: Model, message: Message): Result {
  if (
    [
      "Open",
      "Scope",
      "View",
      "New",
      "Cancel",
      "Index",
      "Route",
      "Search",
      "Namespaces",
      "IncludeExcluded",
      "RecallAll",
    ].includes(message._tag)
  )
    return navigate(model, message as Intent);
  switch (message._tag) {
    case "Loaded": {
      if (model.requests[message.lane] !== message.id || !sameScope(model, message.scope))
        return done(model);
      const next = { ...model, busy: model.busy.filter((lane) => lane !== message.lane) };
      switch (message.kind) {
        case "context": {
          const bundle =
            message.value.bundles.find((item) => item.name === model.bundle)?.name ??
            message.value.bundles[0]?.name ??
            "";
          const result = refresh({ ...next, context: message.value, bundle });
          return {
            ...result,
            commands: [
              ...(result.commands ?? []),
              recovery(result.model),
              restoreMemoryWorkspace(result.model),
            ],
          };
        }
        case "profile":
          return message.value.bundle === model.bundle
            ? done({ ...next, profile: message.value })
            : done(next);
        case "namespaces":
          return message.value.bundle === model.bundle
            ? done({ ...next, namespaces: message.value })
            : done(next);
        case "bootstrap":
          return done(next);
        case "audit":
          return done({ ...next, audit: message.value });
        case "maintenanceRecovery":
          return done({
            ...next,
            journal: message.value,
            maintenancePreview: message.value.preview,
            notice: message.value.lockRecovered
              ? `Interrupted operation lock recovered. Recovery copy: ${message.value.lockRecoveryPath ?? "saved"}. Review the journal before applying again.`
              : "No interrupted lock required recovery. Review the journal before continuing.",
          });
        case "journal":
          return message.value.bundle === model.bundle
            ? done({ ...next, journal: message.value, maintenancePreview: message.value.preview })
            : done(next);
        case "maintenancePreview":
          return message.value.bundle === model.bundle
            ? done({
                ...next,
                maintenancePreview: message.value,
                errors: Object.fromEntries(
                  Object.entries(next.errors).filter(
                    ([lane]) =>
                      !["maintenanceResult", "journal", "maintenanceRecovery"].includes(lane),
                  ),
                ),
                maintenanceResult: null,
                journal: null,
              })
            : done(next);
        case "maintenanceResult":
          return refresh({
            ...next,
            maintenanceResult: message.value,
            notice: `Applied ${message.value.changedPaths.length} files. Recovery journal: ${message.value.journalPath}`,
          });
        case "template": {
          if (message.value.bundle !== model.bundle) return done(next);
          const result = navigate(next, { _tag: "New" });
          if (!result.model.draft) return result;
          const draft = {
            ...result.model.draft,
            raw: message.value.raw,
            path: model.memoryForm.path ?? "",
          };
          return done(
            {
              ...result.model,
              draft,
              disclosures: {
                ...result.model.disclosures,
                "raw-editor": !structuredMemory(draft.raw),
              },
            },
            [persist(draft)],
          );
        }
        case "list":
          if (message.value.concepts.some((concept) => concept.bundle !== model.bundle))
            return done(next);
          return done({
            ...next,
            concepts: message.value.concepts,
            listOffset: Math.min(
              next.listOffset,
              Math.max(0, Math.floor((message.value.concepts.length - 1) / 30) * 30),
            ),
          });
        case "concept": {
          if (message.value.bundle !== model.bundle) return done(next);
          if (message.lane === "renameConflict") {
            if (next.draft?.operation !== "rename" || next.draft.path !== message.value.path)
              return done(next);
            return done({
              ...next,
              conflict: next.draft.expectedHash !== message.value.hash ? message.value : null,
              concept: message.value,
            });
          }
          if (message.lane === "deletePreview") {
            if (next.draft?.operation !== "delete" || next.draft.path !== message.value.path)
              return done(next);
            if (next.draft.expectedHash !== message.value.hash)
              return done({ ...next, conflict: message.value });
            return done({
              ...next,
              concept: message.value,
              draft: { ...next.draft, referrers: message.value.backlinks, preview: true },
            });
          }
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
          return message.value.results.some((concept) => concept.bundle !== model.bundle)
            ? done(next)
            : done({ ...next, search: message.value });
        case "graph":
          return message.value.nodes.some((concept) => concept.bundle !== model.bundle)
            ? done(next)
            : done({ ...next, graph: boundedGraph(message.value, next.graphLimit) });
        case "validation":
          return message.value.diagnostics.some(
            (diagnostic) => diagnostic.bundle !== undefined && diagnostic.bundle !== model.bundle,
          )
            ? done(next)
            : done({ ...next, validation: message.value });
        case "status":
          return done({
            ...next,
            status: message.value,
            selectedPaths: next.selectedPaths.filter((path) =>
              message.value.files.some((file) => file.path === path),
            ),
          });
        case "preview":
          return message.value.bundle === model.bundle
            ? done({ ...next, gitPreview: message.value, pr: null })
            : done(next);
        case "renamePreview":
          return next.draft?.operation === "rename" &&
            message.value.bundle === model.bundle &&
            message.value.path === next.draft.path &&
            message.value.newPath === next.draft.newPath
            ? done({
                ...next,
                renamePreview: message.value,
                draft: { ...next.draft, preview: true },
              })
            : done(next);
        case "pr":
          return done({
            ...next,
            pr: message.value,
            notice: "Pull request created. Open it to review and merge on GitHub.",
          });
        case "mutation": {
          if (message.value.bundle !== model.bundle) return done(next);
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
      if (model.requests[message.lane] !== message.id || !sameScope(model, message.scope))
        return done(model);
      const next = {
        ...model,
        busy: model.busy.filter((lane) => lane !== message.lane),
        errors: { ...model.errors, [message.lane]: message.error },
      };
      if (
        (message.lane === "mutation" || message.lane === "renamePreview") &&
        message.error.status === 409 &&
        model.draft?.operation === "rename"
      )
        return issue(
          { ...clearRenamePreview(next), draft: { ...model.draft, preview: false } },
          "concept",
          "concept",
          { bundle: model.draft.bundle, path: model.draft.path },
          undefined,
          "GET",
          "renameConflict",
        );
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
    case "MemoryField": {
      if (!model.draft) return done(model);
      const draft = {
        ...model.draft,
        raw: editField(model.draft.raw, message.field, message.value),
        fields: { ...model.draft.fields, [message.field]: message.value },
        preview: false,
      };
      return done({ ...model, draft }, [persist(draft)]);
    }
    case "MemoryForm":
      return doneMemory({
        ...model,
        memoryForm: { ...model.memoryForm, [message.field]: message.value },
        maintenancePreview: [
          "reason",
          "purpose",
          "allowNamespaceChange",
          "policyNamespaces",
          "policyTopics",
          "taskRetention",
          "reviewInterval",
          "goldReview",
        ].includes(message.field)
          ? null
          : model.maintenancePreview,
      });
    case "MigrationField":
      return doneMemory({
        ...model,
        migrationDecisions: {
          ...model.migrationDecisions,
          [message.path]: {
            ...model.migrationDecisions[message.path],
            [message.field]: message.value,
          },
        },
        maintenancePreview: null,
      });
    case "ProposalAdd":
      return doneMemory({
        ...model,
        proposalChanges: [...model.proposalChanges, { path: "", raw: "" }],
        maintenancePreview: null,
      });
    case "ProposalRemove":
      return doneMemory({
        ...model,
        proposalChanges: model.proposalChanges.filter((_, index) => index !== message.index),
        maintenancePreview: null,
      });
    case "ProposalChange":
      return doneMemory({
        ...model,
        proposalChanges: model.proposalChanges.map((change, index) =>
          index === message.index ? { ...change, [message.field]: message.value } : change,
        ),
        maintenancePreview: null,
      });
    case "MemoryWorkspaceRecovery":
      return message.bundle === model.bundle && message.root === bundleRoot(model)
        ? done({ ...model, ...message.value })
        : done(model);
    case "MemoryAction":
      return memoryAction(model, message.action);
    case "Disclosure":
      return model.disclosures[message.key] === message.value
        ? done(model)
        : done({ ...model, disclosures: { ...model.disclosures, [message.key]: message.value } });
    case "Query":
      return done({ ...model, query: message.value });
    case "ListPage":
      return done({ ...model, listOffset: message.offset });
    case "Edit": {
      if (!model.concept) return done(model);
      if (!bundleRoot(model)) return done(model);
      const draft: Draft = {
        root: bundleRoot(model),
        bundle: model.bundle,
        path: model.concept.path,
        raw: model.concept.raw,
        original: model.concept.raw,
        expectedHash: model.concept.hash || null,
        operation: message.operation,
        newPath: model.concept.path,
        updateLinks: true,
        preview: false,
        referrers: model.concept.backlinks,
      };
      return done(
        {
          ...model,
          draft,
          disclosures: { ...model.disclosures, "raw-editor": !structuredMemory(draft.raw) },
          conflict: null,
          recovery: null,
          notice: "",
          errors: {},
        },
        [persist(draft)],
      );
    }
    case "Draft": {
      if (!model.draft) return done(model);
      const draft = {
        ...model.draft,
        [message.field]: message.value,
        ...(message.field === "raw" ? { fields: undefined } : {}),
        preview: false,
      };
      return done({ ...clearRenamePreview(model), draft }, [persist(draft, model.draft)]);
    }
    case "UpdateLinks":
      return model.draft
        ? done(
            {
              ...clearRenamePreview(model),
              draft: { ...model.draft, updateLinks: message.value, preview: false },
            },
            [persist({ ...model.draft, updateLinks: message.value, preview: false })],
          )
        : done(model);
    case "PreviewDraft": {
      const draft = model.draft;
      if (!draft) return done(model);
      const next = clearRenamePreview(model);
      if (draft.operation === "rename")
        return issue(
          next,
          "renamePreview",
          "rename/preview",
          {},
          {
            bundle: draft.bundle,
            path: draft.path,
            expectedHash: draft.expectedHash,
            authorizePersonal: true,
            newPath: draft.newPath,
            updateLinks: draft.updateLinks,
          },
          "POST",
        );
      if (draft.operation === "delete")
        return issue(
          next,
          "concept",
          "concept",
          { bundle: draft.bundle, path: draft.path },
          undefined,
          "GET",
          "deletePreview",
        );
      return done({ ...next, draft: { ...draft, preview: true } });
    }
    case "ContinueDraft":
      return model.draft
        ? done({ ...clearRenamePreview(model), draft: { ...model.draft, preview: false } })
        : done(model);
    case "Save": {
      const draft = model.draft;
      if (!draft?.preview || model.busy.includes("mutation") || model.conflict) return done(model);
      if (
        !draft.root ||
        draft.root !== bundleRoot(model, draft.bundle) ||
        draft.bundle !== model.bundle
      )
        return done({
          ...model,
          notice:
            "The bundle directory changed. Copy this draft before opening the current bundle.",
        });
      if (
        draft.operation === "rename" &&
        (!model.renamePreview ||
          model.renamePreview.bundle !== draft.bundle ||
          model.renamePreview.path !== draft.path ||
          model.renamePreview.newPath !== draft.newPath)
      )
        return done(model);
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
            ? {
                ...common,
                newPath: draft.newPath,
                updateLinks: draft.updateLinks,
                previewHash: model.renamePreview?.previewHash,
              }
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
      return model.draft ||
        model.bundle !== message.bundle ||
        model.desiredPath !== message.path ||
        message.root !== bundleRoot(model) ||
        (message.draft !== null && message.draft.root !== bundleRoot(model))
        ? done(model)
        : done({ ...model, recovery: message.draft });
    case "Recover": {
      if (
        !model.recovery ||
        model.recovery.bundle !== model.bundle ||
        model.recovery.root !== bundleRoot(model)
      )
        return done({ ...model, recovery: null });
      const draft = { ...model.recovery, preview: false };
      const next = {
        ...model,
        draft,
        recovery: null,
        conflict: null,
        concept: null,
        desiredPath: draft.path,
        view: "wiki" as const,
        disclosures: { ...model.disclosures, "raw-editor": !structuredMemory(draft.raw) },
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

function memoryAction(
  model: Model,
  action: Extract<Message, { _tag: "MemoryAction" }>["action"],
): Result {
  if (
    dirty(model) ||
    model.busy.includes("mutation") ||
    model.busy.includes("maintenanceResult") ||
    model.busy.includes("maintenanceRecovery")
  )
    return done({
      ...model,
      notice: "Save or cancel your draft and wait for the current operation before continuing.",
    });
  const f = model.memoryForm;
  const base = model.concept
    ? {
        bundle: model.bundle,
        path: model.concept.path,
        expectedHash: model.concept.hash,
        authorizePersonal: true,
      }
    : null;
  const lines = (value = "") =>
    value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  if (action === "template")
    return issue(
      model,
      "template",
      "template",
      {},
      {
        bundle: model.bundle,
        kind: f.kind,
        stage: f.stage,
        namespace: f.namespace || "shared",
        title: f.title ?? "",
        description: f.description ?? "",
        tags: (f.tags ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        actor: f.actor,
        occurredAt: f.occurredAt || undefined,
        sources: lines(f.sources),
      },
      "POST",
    );
  if (action === "review" && base)
    return issue(
      model,
      "mutation",
      "review",
      {},
      { ...base, decision: f.decision, actor: f.actor, reason: f.reason ?? "", operator: true },
      "POST",
    );
  if (action === "verify" && base)
    return issue(
      model,
      "mutation",
      "verify",
      {},
      { ...base, actor: f.machineActor || "machine:operator-check", method: f.method ?? "" },
      "POST",
    );
  if (action === "lifecycle" && base)
    return issue(
      model,
      "mutation",
      "lifecycle",
      {},
      {
        ...base,
        action: f.lifecycleAction,
        at: f.lifecycleAt || undefined,
        replacement: f.replacement || undefined,
        reason: f.lifecycleReason || undefined,
      },
      "POST",
    );
  if (action === "task" && base) {
    const memory = model.concept?.metadata.memory as { task?: { reference?: string } } | undefined;
    return issue(
      model,
      "mutation",
      "task",
      {},
      {
        ...base,
        task: {
          reference: f.taskReference || memory?.task?.reference || "",
          state: f.taskState,
          ...(f.completedAt ? { completed_at: f.completedAt } : {}),
        },
        ...(f.retentionDays !== undefined
          ? { retentionDays: f.retentionDays ? Number(f.retentionDays) : null }
          : {}),
        ...(f.retentionReason !== undefined ? { retentionReason: f.retentionReason || null } : {}),
      },
      "POST",
    );
  }
  if (action === "proposal")
    return issue(
      model,
      "maintenancePreview",
      "maintenance/preview",
      {},
      {
        version: 1,
        bundle: model.bundle,
        purpose: f.purpose,
        reason: f.reason ?? "",
        allowNamespaceChange: f.allowNamespaceChange === "true",
        changes: model.proposalChanges.map((change) => ({
          ...change,
          raw: change.raw || null,
          expectedHash:
            model.audit?.concepts.find((item) => item.path === change.path)?.hash ?? null,
        })),
      },
      "POST",
    );
  if (action === "migration") {
    const decisions = Object.fromEntries(
      Object.entries(model.migrationDecisions).map(([path, fields]) => {
        const entries = Object.fromEntries(
          Object.entries(fields)
            .filter(
              ([field, value]) =>
                value !== "" && !["taskReference", "taskState", "completedAt"].includes(field),
            )
            .map(([field, value]) => [
              field,
              field === "derivedFrom"
                ? lines(value).map((line) => {
                    const [resource, content_hash] = line.split(/\s+/);
                    return { resource, content_hash };
                  })
                : field === "tags"
                  ? value
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean)
                  : ["sources", "prerequisites", "replaces"].includes(field)
                    ? lines(value)
                    : value,
            ]),
        );
        return [
          path,
          {
            ...entries,
            ...(fields.taskReference
              ? {
                  task: {
                    reference: fields.taskReference,
                    state: fields.taskState || "open",
                    ...(fields.completedAt ? { completed_at: fields.completedAt } : {}),
                  },
                }
              : {}),
          },
        ];
      }),
    );
    const policy = {
      ...(f.policyNamespaces !== undefined
        ? {
            namespaces: (f.policyNamespaces ?? "")
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          }
        : {}),
      ...(f.policyTopics !== undefined
        ? {
            topics: (f.policyTopics ?? "")
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          }
        : {}),
      ...(f.taskRetention ? { task_retention_days: Number(f.taskRetention) } : {}),
      ...(f.reviewInterval ? { review_interval_days: Number(f.reviewInterval) } : {}),
      ...(f.goldReview ? { gold_review: f.goldReview } : {}),
    };
    return issue(
      model,
      "maintenancePreview",
      "migration/preview",
      {},
      { bundle: model.bundle, policy, decisions },
      "POST",
    );
  }
  if (action === "apply" && model.maintenancePreview && !model.maintenancePreview.unresolved.length)
    return issue(
      model,
      "maintenanceResult",
      model.maintenancePreview.purpose === "migration" ? "migration/apply" : "maintenance/apply",
      {},
      { preview: model.maintenancePreview, authorizePersonal: true },
      "POST",
    );
  if (action === "recoverBatch" && model.journal)
    return issue(
      model,
      "maintenanceRecovery",
      "maintenance/recover",
      {},
      { bundle: model.bundle, previewHash: model.journal.previewHash, authorizePersonal: true },
      "POST",
    );
  if (action === "journal" && (model.memoryForm.journalHash || model.maintenancePreview))
    return issue(model, "journal", "maintenance/journal", {
      bundle: model.bundle,
      previewHash: model.memoryForm.journalHash || model.maintenancePreview!.previewHash,
    });
  return done(model);
}
