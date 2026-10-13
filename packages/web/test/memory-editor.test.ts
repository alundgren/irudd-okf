import { expect, it } from "vite-plus/test";
import { parse } from "yaml";
import { editField, fieldValue, structuredMemory } from "../src/memory-editor.ts";

const raw = `---
type: Rule
# Keep the operator's comment
producer_extra: keep
sources:
  - resource: evidence.md
    producer_extra: citation-detail
memory:
  kind: procedural
  stage: silver
  namespace: project
  reviews:
    - by: human:operator
      content_hash: previous
---

Use the check command.
`;
it("ordinary memory edits retain citations, review history, unknown fields, and comments", () => {
  const changed = editField(
    editField(raw, "title", "Check the build"),
    "body",
    "Run npm run check.",
  );
  const metadata = parse(changed.split("---\n")[1]!);
  expect(metadata.sources[0].producer_extra).toBe("citation-detail");
  expect(metadata.memory.reviews[0].content_hash).toBe("previous");
  expect(metadata.producer_extra).toBe("keep");
  expect(changed).toContain("# Keep the operator's comment");
  expect(fieldValue(changed, "body")).toBe("Run npm run check.");
});
it("structured editing adds conditional fields and clears only the chosen field", () => {
  const changed = editField(
    editField(raw, "taskReference", "ticket-42"),
    "expiresAt",
    "2030-04-01T00:00:00Z",
  );
  const cleared = editField(changed, "expiresAt", "");
  expect(fieldValue(cleared, "taskReference")).toBe("ticket-42");
  expect(fieldValue(cleared, "expiresAt")).toBe("");
  expect(fieldValue(cleared, "namespace")).toBe("project");
});
it("malformed raw documents remain untouched for manual repair", () => {
  const malformed = "---\nmemory: [\n---\nImportant original bytes.";
  expect(structuredMemory(malformed)).toBe(false);
  expect(editField(malformed, "title", "Repair")).toBe(malformed);
});
it("retains BOM and Windows line endings during structured metadata edits", () => {
  const windows = "\uFEFF" + raw.replace(/\n/g, "\r\n");
  const changed = editField(windows, "description", "Specific evidence");
  expect(changed.startsWith("\uFEFF---\r\n")).toBe(true);
  expect(changed.replace(/\r\n/g, "")).not.toContain("\n");
  expect(changed).toContain("producer_extra: citation-detail");
});
it("keeps invalid source entries available for repair without crashing field rendering", () => {
  const invalid = raw
    .replace(
      "sources:\n  - resource: evidence.md\n    producer_extra: citation-detail",
      "sources: [null, 42]",
    )
    .replace("  reviews:", "  derived_from: [null]\n  reviews:");
  expect(fieldValue(invalid, "sources")).toBe("null\n42");
  expect(fieldValue(invalid, "derivedFrom")).toBe("null");
  expect(editField(invalid, "title", "Repair sources")).toContain("sources: [ null, 42 ]");
});
