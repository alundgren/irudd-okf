import { parseDocument } from "yaml";

export const memoryFields = [
  "title",
  "type",
  "description",
  "tags",
  "status",
  "kind",
  "stage",
  "namespace",
  "generatedBy",
  "generatedAt",
  "sources",
  "occurredAt",
  "staleAfter",
  "expiresAt",
  "prerequisites",
  "replaces",
  "taskReference",
  "taskState",
  "completedAt",
  "retentionReason",
  "derivedFrom",
] as const;
export type MemoryField = (typeof memoryFields)[number];
const paths: Record<MemoryField, string[]> = {
  title: ["title"],
  type: ["type"],
  description: ["description"],
  tags: ["tags"],
  status: ["status"],
  kind: ["memory", "kind"],
  stage: ["memory", "stage"],
  namespace: ["memory", "namespace"],
  generatedBy: ["generated", "by"],
  generatedAt: ["generated", "at"],
  sources: ["sources"],
  occurredAt: ["memory", "occurred_at"],
  staleAfter: ["stale_after"],
  expiresAt: ["memory", "expires_at"],
  prerequisites: ["memory", "prerequisites"],
  replaces: ["memory", "replaces"],
  taskReference: ["memory", "task", "reference"],
  taskState: ["memory", "task", "state"],
  completedAt: ["memory", "task", "completed_at"],
  retentionReason: ["memory", "retention_reason"],
  derivedFrom: ["memory", "derived_from"],
};
function parts(raw: string) {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) return null;
  try {
    const doc = parseDocument(match[1]!);
    const metadata = doc.toJS();
    return doc.errors.length || !metadata || typeof metadata !== "object" || Array.isArray(metadata)
      ? null
      : {
          doc,
          body: raw.slice(match[0].length),
          newline: match[0].includes("\r\n") ? "\r\n" : "\n",
          prefix: raw.startsWith("\uFEFF") ? "\uFEFF" : "",
        };
  } catch {
    return null;
  }
}
export function structuredMemory(raw: string): boolean {
  const metadata = parts(raw)?.doc.toJS();
  const record = (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value);
  return (
    !!metadata &&
    record(metadata.memory) &&
    !!metadata.memory.kind &&
    (metadata.generated === undefined || record(metadata.generated)) &&
    (metadata.memory.task === undefined || record(metadata.memory.task))
  );
}

export function fieldValue(raw: string, field: MemoryField | "body"): string {
  const parsed = parts(raw);
  if (!parsed) return "";
  if (field === "body") return parsed.body.replace(/^\r?\n/, "");
  const value = paths[field].reduce<unknown>(
    (current, key) =>
      current && typeof current === "object"
        ? (current as Record<string, unknown>)[key]
        : undefined,
    parsed.doc.toJS(),
  );
  if (field === "derivedFrom" && Array.isArray(value))
    return value
      .map((item) =>
        item && typeof item === "object"
          ? `${item.resource ?? ""} ${item.content_hash ?? ""}`
          : String(item),
      )
      .join("\n");
  if (Array.isArray(value))
    return value
      .map((item) =>
        typeof item === "string"
          ? item
          : item && typeof item === "object"
            ? (item.resource ?? "")
            : String(item),
      )
      .join(field === "tags" ? ", " : "\n");
  return value === undefined || value === null ? "" : String(value);
}
export function editField(raw: string, field: MemoryField | "body", value: string): string {
  const parsed = parts(raw);
  if (!parsed) return raw;
  if (field === "body") parsed.body = parsed.newline + value.replace(/\r?\n/g, parsed.newline);
  else if (!value.trim()) parsed.doc.deleteIn(paths[field]);
  else {
    const list = ["sources", "prerequisites", "replaces"].includes(field);
    const next =
      field === "tags"
        ? value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : field === "derivedFrom"
          ? value
              .split("\n")
              .filter(Boolean)
              .map((line) => {
                const [resource, content_hash] = line.trim().split(/\s+/);
                return { resource, content_hash };
              })
          : list
            ? value
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean)
                .map((resource) => {
                  if (field !== "sources") return resource;
                  const existing = parsed.doc.toJS()?.sources;
                  return Array.isArray(existing)
                    ? (existing.find(
                        (item) => item && typeof item === "object" && item.resource === resource,
                      ) ?? resource)
                    : resource;
                })
            : value;
    parsed.doc.setIn(paths[field], next);
  }
  return `${parsed.prefix}---${parsed.newline}${parsed.doc.toString().replace(/\n/g, parsed.newline)}---${parsed.newline}${parsed.body}`;
}
