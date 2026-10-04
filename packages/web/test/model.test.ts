import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { initialModel, issue, update, type Message, type Model } from "../src/model.ts";
import { RequestError } from "../src/api.ts";
import type { Concept, MemoryContext, RenamePreview } from "../../core/src/contracts.ts";

const context = (root = "/repositories/A/.okf"): MemoryContext => ({
  version: 1,
  cwd: "/repositories/A",
  gitRoot: "/repositories/A",
  configPath: "/config",
  bundles: [
    { name: "repo", root, kind: "repository", writable: true },
    { name: "me", root: "/personal/.okf", kind: "personal", writable: true },
  ],
});
const concept: Concept = {
  bundle: "repo",
  path: "source.md",
  title: "Source",
  type: "rule",
  description: "",
  tags: [],
  hash: "source-hash",
  malformed: false,
  raw: "---\ntype: rule\n---\n\nOriginal.",
  body: "Original.",
  metadata: { type: "rule" },
  diagnostics: [],
  links: [],
  backlinks: [{ bundle: "repo", path: "referrer.md", title: "Referrer" }],
};
let storage: Map<string, string>;
function model(root?: string): Model {
  return {
    ...initialModel(),
    context: context(root),
    bundle: "repo",
    concept,
    desiredPath: concept.path,
  };
}
async function runCommands(result: ReturnType<typeof update>) {
  let current = result.model;
  for (const command of result.commands ?? [])
    current = update(current, await Effect.runPromise(command.effect)).model;
  return current;
}
beforeEach(() => {
  vi.stubGlobal("location", new URL("http://127.0.0.1:3210/wiki?bundle=repo&path=source.md"));
  vi.stubGlobal("history", { pushState: vi.fn() });
  storage = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
it("isolates recovered drafts when the same origin and aliases point at another repository", async () => {
  let a = await runCommands(update(model(), { _tag: "Edit", operation: "write" }));
  a = await runCommands(
    update(a, { _tag: "Draft", field: "raw", value: `${concept.raw}\nRepository A draft.` }),
  );
  const storedDraft = a.draft!;
  const b = issue(model("/repositories/B/.okf"), "concept", "concept");
  const loaded: Message = {
    _tag: "Loaded",
    kind: "concept",
    value: concept,
    lane: "concept",
    id: b.model.requests.concept!,
    scope: { bundle: "repo", root: "/repositories/B/.okf" },
  };
  const recoveredB = await runCommands(update(b.model, loaded));
  expect(recoveredB.recovery).toBe(null);
  expect(JSON.stringify([...storage.values()])).toContain("Repository A draft.");
  expect(update({ ...recoveredB, recovery: storedDraft }, { _tag: "Recover" }).model.draft).toBe(
    null,
  );
  const again = issue(model(), "concept", "concept");
  const recoveredA = await runCommands(
    update(again.model, {
      ...loaded,
      id: again.model.requests.concept!,
      scope: { bundle: "repo", root: "/repositories/A/.okf" },
    }),
  );
  expect(recoveredA.recovery?.raw).toContain("Repository A draft.");
  const forgedRoot = { ...storedDraft, root: "/repositories/B/.okf" };
  expect(
    update(recoveredB, {
      _tag: "Recovery",
      draft: forgedRoot,
      bundle: "repo",
      path: "source.md",
      root: "/repositories/A/.okf",
    }).model.recovery,
  ).toBe(null);
});
it("drops late search, Git status, Git preview, validation and errors after switching bundles", () => {
  const pending = {
    ...model(),
    sequence: 10,
    requests: { search: 1, status: 2, preview: 3, validation: 4 },
    busy: ["search", "status", "preview", "validation"],
  };
  let switched = update(pending, { _tag: "Scope", bundle: "me" }).model;
  const staleScope = { bundle: "repo", root: "/repositories/A/.okf" };
  const stale: Message[] = [
    {
      _tag: "Loaded",
      kind: "search",
      lane: "search",
      id: 1,
      scope: staleScope,
      value: {
        version: 1,
        query: "A content",
        results: [{ ...concept, score: 1, excerpt: "A private text", matched: ["body"] }],
        total: 1,
        offset: 0,
        limit: 10,
        truncated: false,
      },
    },
    {
      _tag: "Loaded",
      kind: "status",
      lane: "status",
      id: 2,
      scope: staleScope,
      value: {
        version: 1,
        available: true,
        root: "/repositories/A",
        branch: "A",
        remote: "origin",
        files: [{ path: "source.md", status: "M" }],
      },
    },
    {
      _tag: "Loaded",
      kind: "preview",
      lane: "preview",
      id: 3,
      scope: staleScope,
      value: {
        version: 1,
        bundle: "repo",
        token: "old-preview",
        base: "commit",
        baseRef: "main",
        repository: "example/A",
        branch: "memory-A",
        paths: ["source.md"],
        diff: "A private diff",
        expiresAt: "2099-01-01T00:00:00Z",
        warnings: [],
      },
    },
    {
      _tag: "Loaded",
      kind: "validation",
      lane: "validation",
      id: 4,
      scope: staleScope,
      value: {
        version: 1,
        files: 1,
        errors: 1,
        warnings: 0,
        diagnostics: [{ level: "error", code: "A", path: "source.md", message: "A error" }],
      },
    },
    {
      _tag: "Failed",
      lane: "search",
      id: 1,
      scope: staleScope,
      error: new RequestError("A", "A old failure"),
    },
  ];
  for (const message of stale) switched = update(switched, message).model;
  expect(switched.search).toBe(null);
  expect(switched.status).toBe(null);
  expect(switched.gitPreview).toBe(null);
  expect(switched.validation).toBe(null);
  expect(switched.errors).toEqual({});
  const current = issue(switched, "concept", "concept");
  expect(
    update(current.model, {
      _tag: "Loaded",
      kind: "concept",
      value: concept,
      lane: "concept",
      id: current.model.requests.concept!,
      scope: { bundle: "me", root: "/personal/.okf" },
    }).model.concept,
  ).toBe(null);
});
it("requires a successful matching rename preview and passes its digest to confirmation", async () => {
  let current = update(model(), { _tag: "Edit", operation: "rename" }).model;
  current = update(current, { _tag: "Draft", field: "newPath", value: "renamed.md" }).model;
  expect(
    update({ ...current, draft: { ...current.draft!, preview: true } }, { _tag: "Save" }).commands,
  ).toEqual([]);
  const preview = update(current, { _tag: "PreviewDraft" });
  expect(preview.model.draft?.preview).toBe(false);
  expect(preview.model.busy).toContain("renamePreview");
  const result: RenamePreview = {
    version: 1,
    bundle: "repo",
    path: "source.md",
    newPath: "renamed.md",
    previewHash: "reviewed-digest",
    changes: [
      { path: "source.md", before: concept.raw, after: "" },
      { path: "renamed.md", before: "", after: concept.raw },
      { path: "referrer.md", before: "[Source](source.md)", after: "[Source](renamed.md)" },
    ],
  };
  current = update(preview.model, {
    _tag: "Loaded",
    kind: "renamePreview",
    value: result,
    lane: "renamePreview",
    id: preview.model.requests.renamePreview!,
    scope: { bundle: "repo", root: "/repositories/A/.okf" },
  }).model;
  expect(current.draft?.preview).toBe(true);
  let sent: Record<string, unknown> | null = null;
  vi.stubGlobal("document", { querySelector: () => ({ content: "local-session" }) });
  vi.stubGlobal("fetch", async (_url: URL, options: RequestInit) => {
    sent = JSON.parse(String(options.body));
    return new Response(
      JSON.stringify({
        version: 1,
        bundle: "repo",
        path: "renamed.md",
        hash: "new-hash",
        changedPaths: ["source.md", "renamed.md", "referrer.md"],
      }),
      { status: 200 },
    );
  });
  const save = update(current, { _tag: "Save" });
  await Effect.runPromise(save.commands![0]!.effect);
  expect(sent).toMatchObject({
    previewHash: "reviewed-digest",
    expectedHash: "source-hash",
    updateLinks: true,
  });
  const changed = update(current, { _tag: "Draft", field: "newPath", value: "another.md" }).model;
  expect(changed.renamePreview).toBe(null);
  expect(changed.draft?.preview).toBe(false);
});
