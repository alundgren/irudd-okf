import { describe, expect, it } from "vite-plus/test";
import { boundedGraph, lineChanges, resolveLink } from "../src/content.ts";
import type { Graph } from "../../core/src/contracts.ts";

describe("viewer content safety and bounds", () => {
  it("keeps local links inside the selected bundle and blocks unsafe schemes", () => {
    expect(resolveLink("../facts/name.md#details", "me", "rules/test.md")).toEqual({
      kind: "internal",
      bundle: "me",
      path: "facts/name.md",
      fragment: "details",
    });
    expect(resolveLink("/index.md", "repo", "rules/test.md")).toEqual({
      kind: "internal",
      bundle: "repo",
      path: "index.md",
      fragment: "",
    });
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,a",
      "file:///etc/passwd",
      "//outside.example/file",
      "../../outside.md",
      "%2e%2e/%2e%2e/outside.md",
      "\\outside.md",
    ])
      expect(resolveLink(href, "repo", "rules/test.md").kind).toBe("blocked");
    expect(resolveLink("https://example.com/read", "repo", "test.md")).toEqual({
      kind: "external",
      href: "https://example.com/read",
    });
    expect(resolveLink("#details", "repo", "test.md")).toEqual({
      kind: "internal",
      bundle: "repo",
      path: "test.md",
      fragment: "details",
    });
  });
  it("caps graph nodes at 250 and keeps missing destinations visible", () => {
    const graph: Graph = {
      version: 1,
      limit: 1000,
      truncated: false,
      nodes: Array.from({ length: 300 }, (_, index) => ({
        bundle: "repo",
        path: `${index}.md`,
        title: `${index}`,
        type: "concept",
        description: "",
        tags: [],
        malformed: false,
        hash: `${index}`,
      })),
      edges: [
        { from: "repo:0.md", to: "repo:299.md", label: "", external: false, broken: false },
        {
          from: "repo:0.md",
          to: "repo:missing.md",
          label: "Missing",
          external: false,
          broken: true,
        },
      ],
    };
    const bounded = boundedGraph(graph, 1000);
    expect(bounded.nodes).toHaveLength(250);
    expect(bounded.truncated).toBe(true);
    expect(bounded.edges).toEqual([graph.edges[1]]);
  });
  it("previews changed lines without hiding deletions or unchanged file status", () => {
    expect(lineChanges("a\nb\nc", "a\nchanged\nc")).toEqual({
      line: 2,
      removed: ["b"],
      added: ["changed"],
    });
    expect(lineChanges("a\nb", "")).toEqual({ line: 1, removed: ["a", "b"], added: [""] });
    expect(lineChanges("a\nb", "a\nb")).toEqual({ line: 3, removed: [], added: [] });
  });
});
