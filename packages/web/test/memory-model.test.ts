import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { initialModel, issue, update, type Model, type Message } from "../src/model.ts";
import type { Concept } from "../../core/src/contracts.ts";
const concept: Concept = {
  bundle: "repo",
  path: "facts.md",
  title: "Facts",
  type: "Knowledge",
  description: "Evidence",
  tags: ["testing"],
  hash: "whole-file-revision",
  malformed: false,
  raw: "---\ntype: Knowledge\nmemory:\n  kind: semantic\n  stage: bronze\n---\n\nBody.",
  body: "Body.",
  metadata: {},
  diagnostics: [],
  links: [],
  backlinks: [],
};
const model = (): Model => ({
  ...initialModel(),
  bundle: "repo",
  concept,
  desiredPath: concept.path,
  context: {
    version: 1,
    cwd: "/project",
    gitRoot: "/project",
    configPath: "/config",
    bundles: [{ name: "repo", root: "/project/.okf", kind: "repository", writable: true }],
  },
});
beforeEach(() => {
  vi.stubGlobal("location", new URL("http://localhost/wiki"));
  vi.stubGlobal("document", { querySelector: () => ({ content: "session-capability" }) });
  vi.stubGlobal("history", { pushState: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
it("sends OR namespace selection consistently to browsing and graph without setting a write namespace", async () => {
  const requests: URL[] = [];
  vi.stubGlobal("fetch", async (url: URL) => {
    requests.push(url);
    return { ok: true, json: async () => ({}) };
  });
  const selected = update(
    { ...model(), view: "graph", selectedNamespaces: ["project"] },
    { _tag: "Namespaces", name: "research" },
  );
  for (const command of selected.commands ?? []) await Effect.runPromise(command.effect);
  for (const endpoint of ["list", "graph"]) {
    const url = requests.find((url) => url.pathname === `/api/${endpoint}`)!;
    expect(url.searchParams.getAll("namespace")).toEqual(["project", "research"]);
  }
  expect(selected.model.memoryForm.namespace).toBe("shared");
});
it("binds deliberate human review to the displayed file revision", async () => {
  let body: Record<string, unknown> = {};
  vi.stubGlobal("fetch", async (_url: URL, options: RequestInit) => {
    body = JSON.parse(String(options.body));
    return {
      ok: true,
      json: async () => ({
        version: 1,
        bundle: "repo",
        path: "facts.md",
        hash: "review-hash",
        changedPaths: ["facts.md"],
      }),
    };
  });
  const reviewed = update(
    {
      ...model(),
      memoryForm: {
        actor: "human:operator",
        decision: "reject",
        reviewReason: "Evidence contradicts this claim",
      },
    },
    { _tag: "MemoryAction", action: "review" },
  );
  await Effect.runPromise(reviewed.commands![0]!.effect);
  expect(body).toMatchObject({
    expectedHash: "whole-file-revision",
    operator: true,
    decision: "reject",
    actor: "human:operator",
  });
});
it("keeps partially typed tags in a recoverable source-bound draft", () => {
  const edited = update(model(), { _tag: "Edit", operation: "write" }).model;
  const changed = update(edited, { _tag: "MemoryField", field: "tags", value: "testing, " }).model;
  expect(changed.draft?.fields?.tags).toBe("testing, ");
  expect(changed.draft?.root).toBe("/project/.okf");
  expect(update(changed, { _tag: "View", view: "profile" }).model.pendingIntent).toEqual({
    _tag: "View",
    view: "profile",
  });
});
it("ignores a delayed profile response after the bundle directory changes", () => {
  const requested = issue(model(), "profile", "profile").model;
  const changed = {
    ...requested,
    context: {
      ...requested.context!,
      bundles: [{ ...requested.context!.bundles[0]!, root: "/another/.okf" }],
    },
  };
  const loaded = update(changed, {
    _tag: "Loaded",
    kind: "profile",
    value: { version: 1, bundle: "repo", mode: "generic", policy: null, diagnostics: [] },
    lane: "profile",
    id: requested.requests.profile!,
    scope: { bundle: "repo", root: "/project/.okf" },
  }).model;
  expect(loaded.profile).toBeNull();
});
it("blocks applying unresolved migration choices and restores the authoritative preview from a journal", () => {
  const preview = {
    version: 1 as const,
    bundle: "repo",
    root: "/project/.okf",
    purpose: "migration" as const,
    reason: "Adopt",
    previewHash: "digest",
    changes: [],
    guards: [],
    diagnostics: [],
    unresolved: [{ path: "facts.md", field: "kind", message: "Choose kind" }],
    allowNamespaceChange: false,
  };
  expect(
    update({ ...model(), maintenancePreview: preview }, { _tag: "MemoryAction", action: "apply" })
      .commands,
  ).toEqual([]);
  const requested = issue(model(), "journal", "maintenance/journal").model;
  const loaded = update(requested, {
    _tag: "Loaded",
    kind: "journal",
    value: {
      version: 1,
      bundle: "repo",
      previewHash: "digest",
      journalPath: "/state/journal",
      state: "applying",
      preview,
      paths: [],
    },
    lane: "journal",
    id: requested.requests.journal!,
    scope: { bundle: "repo", root: "/project/.okf" },
  }).model;
  expect(loaded.maintenancePreview).toBe(preview);
});
it("keeps the selected source stable while interrupted-batch recovery is running", () => {
  const recovering = { ...model(), busy: ["maintenanceRecovery"] };
  expect(update(recovering, { _tag: "Scope", bundle: "other" }).model.bundle).toBe("repo");
  expect(update(recovering, { _tag: "MemoryAction", action: "review" }).commands).toEqual([]);
});
it("prefills another episode from its own task and clears the previous lifecycle inputs", async () => {
  const selected = {
    ...model(),
    memoryForm: {
      actor: "human:operator",
      taskReference: "task:changed-a",
      taskState: "completed",
      completedAt: "2026-10-01T00:00:00Z",
      retentionDays: "0",
      retentionReason: "A history",
      lifecycleAction: "expire",
      lifecycleAt: "2026-10-01T00:00:00Z",
      replacement: "a-replacement.md",
      lifecycleReason: "A reason",
      reason: "Proposal reason",
    },
  };
  const requested = issue({ ...selected, concept: null }, "concept", "concept").model;
  const other = {
    ...concept,
    path: "episode-b.md",
    metadata: {
      memory: {
        kind: "episodic",
        task: { reference: "task:b", state: "open", retention_days: 12 },
        retention_reason: "B history",
        replaced_by: "b-replacement.md",
      },
    },
  };
  const loaded = update(requested, {
    _tag: "Loaded",
    kind: "concept",
    value: other,
    lane: "concept",
    id: requested.requests.concept!,
    scope: { bundle: "repo", root: "/project/.okf" },
  }).model;
  expect(loaded.memoryForm).toMatchObject({
    actor: "human:operator",
    taskReference: "task:b",
    taskState: "open",
    retentionDays: "12",
    retentionReason: "B history",
    completedAt: "",
    lifecycleAction: "archive",
    lifecycleAt: "",
    replacement: "b-replacement.md",
    lifecycleReason: "",
    reason: "Proposal reason",
  });
  let body: Record<string, unknown> = {};
  vi.stubGlobal("fetch", async (_url: URL, options: RequestInit) => {
    body = JSON.parse(String(options.body));
    return {
      ok: true,
      json: async () => ({
        version: 1,
        bundle: "repo",
        path: "episode-b.md",
        hash: "updated-b",
        changedPaths: ["episode-b.md"],
      }),
    };
  });
  await Effect.runPromise(
    update(loaded, { _tag: "MemoryAction", action: "task" }).commands![0]!.effect,
  );
  expect(body).toMatchObject({
    path: "episode-b.md",
    task: { reference: "task:b", state: "open" },
    retentionDays: 12,
    retentionReason: "B history",
  });
});
it("discards a deferred preview after proposal, migration, or policy decisions change", () => {
  const preview = {
    version: 1 as const,
    bundle: "repo",
    root: "/project/.okf",
    purpose: "maintenance" as const,
    reason: "Original",
    previewHash: "original-digest",
    changes: [],
    guards: [],
    diagnostics: [],
    unresolved: [],
    allowNamespaceChange: false,
  };
  const edits: Message[] = [
    { _tag: "ProposalChange", index: 0, field: "raw", value: "Latest candidate" },
    { _tag: "MigrationField", path: "facts.md", field: "kind", value: "episodic" },
    { _tag: "MemoryForm", field: "goldReview", value: "human" },
  ];
  for (const edit of edits) {
    const requested = issue(
      { ...model(), proposalChanges: [{ path: "facts.md", raw: "Original candidate" }] },
      "maintenancePreview",
      "maintenance/preview",
    ).model;
    const changed = update(requested, edit).model;
    const loaded = update(changed, {
      _tag: "Loaded",
      kind: "maintenancePreview",
      value: preview,
      lane: "maintenancePreview",
      id: requested.requests.maintenancePreview!,
      scope: { bundle: "repo", root: "/project/.okf" },
    }).model;
    expect(loaded.maintenancePreview).toBeNull();
    expect(loaded.busy).not.toContain("maintenancePreview");
  }
});
