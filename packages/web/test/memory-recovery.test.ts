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
