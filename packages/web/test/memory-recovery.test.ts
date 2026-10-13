import { afterEach, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { initialModel, type Model } from "../src/model.ts";
import { keepMemoryWorkspace, restoreMemoryWorkspace } from "../src/memory-recovery.ts";
afterEach(() => vi.unstubAllGlobals());
it("recovers proposal and migration work only for the same canonical bundle directory", async () => {
  vi.stubGlobal("location", new URL("http://localhost/wiki"));
  const entries = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  const make = (root: string): Model => ({
    ...initialModel(),
    bundle: "repo",
    context: {
      version: 1,
      cwd: "/work",
      gitRoot: "/work",
      configPath: "/config",
      bundles: [{ name: "repo", root, kind: "repository", writable: true }],
    },
  });
  const original = {
    ...make("/repository-A/.okf"),
    proposalChanges: [{ path: "decision.md", raw: "Original candidate" }],
    migrationDecisions: { "legacy.md": { kind: "semantic" } },
  };
  await Effect.runPromise(keepMemoryWorkspace(original).effect);
  expect(
    await Effect.runPromise(restoreMemoryWorkspace(make("/repository-B/.okf")).effect),
  ).toEqual({ _tag: "Noop" });
  const restored = await Effect.runPromise(
    restoreMemoryWorkspace(make("/repository-A/.okf")).effect,
  );
  expect(restored).toMatchObject({
    _tag: "MemoryWorkspaceRecovery",
    root: "/repository-A/.okf",
    value: {
      proposalChanges: original.proposalChanges,
      migrationDecisions: original.migrationDecisions,
    },
  });
});
it("restores a validated source-bound preview and operation hash without restoring note-specific task inputs", async () => {
  vi.stubGlobal("location", new URL("http://localhost/wiki"));
  const entries = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  const source: Model = {
    ...initialModel(),
    bundle: "repo",
    context: {
      version: 1,
      cwd: "/work",
      gitRoot: "/work",
      configPath: "/config",
      bundles: [{ name: "repo", root: "/work/.okf", kind: "repository", writable: true }],
    },
  };
  const preview = {
    version: 1 as const,
    bundle: "repo",
    root: "/work/.okf",
    purpose: "maintenance" as const,
    reason: "Concrete change",
    previewHash: "operation-id",
    changes: [
      {
        path: "fact.md",
        expectedHash: "before",
        raw: "After",
        before: "Before",
        afterHash: "after",
      },
    ],
    guards: [{ path: "fact.md", expectedHash: "before" }],
    diagnostics: [],
    unresolved: [],
    allowNamespaceChange: false,
  };
  await Effect.runPromise(
    keepMemoryWorkspace({
      ...source,
      maintenancePreview: preview,
      operationHash: preview.previewHash,
      memoryForm: {
        actor: "human:operator",
        taskReference: "task:a",
        retentionDays: "0",
        lifecycleAction: "expire",
      },
    }).effect,
  );
  const restored = await Effect.runPromise(restoreMemoryWorkspace(source).effect);
  expect(restored).toMatchObject({
    _tag: "MemoryWorkspaceRecovery",
    value: {
      maintenancePreview: preview,
      operationHash: "operation-id",
      memoryForm: { actor: "human:operator" },
    },
  });
  if (restored._tag === "MemoryWorkspaceRecovery")
    expect(restored.value.memoryForm).not.toHaveProperty("taskReference");
  const key = [...entries.keys()][0]!;
  const tampered = JSON.parse(entries.get(key)!);
  tampered.maintenancePreview.root = "/another/.okf";
  entries.set(key, JSON.stringify(tampered));
  const rejected = await Effect.runPromise(restoreMemoryWorkspace(source).effect);
  if (rejected._tag === "MemoryWorkspaceRecovery")
    expect(rejected.value.maintenancePreview).toBeNull();
});
