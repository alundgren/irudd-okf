import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { request } from "../src/api.ts";
const summary = {
  bundle: "repo",
  path: "fact.md",
  title: "Fact",
  type: "Knowledge",
  description: "Evidence",
  tags: ["testing"],
  hash: "whole-file",
  malformed: false,
};
const memory = {
  kind: "semantic",
  stage: "silver",
  namespace: "backend",
  review: "pending",
  verified: true,
  humanReviewed: false,
  machineVerified: true,
  trustTier: "machine-confirmed",
  historicalVerificationEvents: [],
  freshness: "current",
  archived: false,
  deprecated: false,
  contentHash: "content-revision",
  dependency: "valid",
  eligible: true,
  trust: "verified",
  reviewEvents: [],
  verificationEvents: [],
  diagnostics: [],
};
beforeEach(() => {
  vi.stubGlobal("location", new URL("http://localhost/wiki"));
  vi.stubGlobal("document", { querySelector: () => ({ content: "local-session" }) });
});
afterEach(() => vi.unstubAllGlobals());
it("preserves engine-computed trust and lifecycle labels in summaries while accepting generic OKF", async () => {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({
      version: 1,
      concepts: [
        { ...summary, memory },
        { ...summary, path: "legacy.md" },
      ],
    }),
  }));
  const result = await Effect.runPromise(request("list", "list"));
  expect(result.concepts[0]?.memory).toMatchObject({
    machineVerified: true,
    humanReviewed: false,
    trustTier: "machine-confirmed",
    namespace: "backend",
  });
  expect(result.concepts[1]?.memory).toBeUndefined();
});
it("rejects unreadable projection data instead of silently presenting a different trust state", async () => {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({
      version: 1,
      concepts: [{ ...summary, memory: { ...memory, humanReviewed: "yes" } }],
    }),
  }));
  const result = await Effect.runPromise(request("list", "list").pipe(Effect.result));
  expect(result._tag).toBe("Failure");
});
it("validates nested recovery preview data before the viewer can apply it", async () => {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({
      version: 1,
      bundle: "repo",
      previewHash: "digest",
      journalPath: "/state",
      state: "applying",
      paths: [],
      preview: { version: 1 },
    }),
  }));
  const result = await Effect.runPromise(
    request("journal", "maintenance/journal").pipe(Effect.result),
  );
  expect(result._tag).toBe("Failure");
});
