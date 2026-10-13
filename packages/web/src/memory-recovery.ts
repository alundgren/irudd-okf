import { Effect, Schema } from "effect";
import type { Command } from "foldkit";
import { maintenancePreviewSchema } from "./api.ts";
import type { Model, Message } from "./model.ts";

export const documentFields = [
  "taskReference",
  "taskState",
  "completedAt",
  "retentionDays",
  "retentionReason",
  "lifecycleAction",
  "lifecycleAt",
  "replacement",
  "lifecycleReason",
  "method",
  "decision",
  "reviewReason",
];
const commonFields = (fields: Record<string, string>) =>
  Object.fromEntries(Object.entries(fields).filter(([name]) => !documentFields.includes(name)));
export type MemoryWorkspace = Pick<
  Model,
  "memoryForm" | "migrationDecisions" | "proposalChanges" | "maintenancePreview" | "operationHash"
>;
const identity = (model: Model) => ({
  bundle: model.bundle,
  root: model.context?.bundles.find((item) => item.name === model.bundle)?.root ?? "",
});
const key = (source: { bundle: string; root: string }) =>
  `okf-memory-work:v1:${JSON.stringify([source.root, source.bundle])}`;
const strings = (value: unknown): value is Record<string, string> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every((item) => typeof item === "string");
export function keepMemoryWorkspace(model: Model): Command.Command<Message> {
  return {
    name: "KeepMemoryWork",
    effect: Effect.sync(() => {
      const source = identity(model);
      try {
        if (source.root)
          sessionStorage.setItem(
            key(source),
            JSON.stringify({
              ...source,
              memoryForm: commonFields(model.memoryForm),
              maintenancePreview: model.maintenancePreview,
              operationHash: model.operationHash,
              migrationDecisions: model.migrationDecisions,
              proposalChanges: model.proposalChanges,
            }),
          );
        return { _tag: "Noop" } as Message;
      } catch {
        return {
          _tag: "Notice",
          text: "Browser storage is unavailable. Keep this tab open while preparing your proposal or migration.",
        } as Message;
      }
    }),
  };
}
export function restoreMemoryWorkspace(model: Model): Command.Command<Message> {
  return {
    name: "ReadMemoryWork",
    effect: Effect.sync(() => {
      const source = identity(model);
      try {
        const raw = source.root ? sessionStorage.getItem(key(source)) : null;
        const value = raw ? JSON.parse(raw) : null;
        if (
          value?.root === source.root &&
          value?.bundle === source.bundle &&
          strings(value.memoryForm) &&
          value.migrationDecisions &&
          typeof value.migrationDecisions === "object" &&
          !Array.isArray(value.migrationDecisions) &&
          Object.values(value.migrationDecisions).every(strings) &&
          Array.isArray(value.proposalChanges) &&
          value.proposalChanges.every(
            (change: unknown) =>
              strings(change) && typeof change.path === "string" && typeof change.raw === "string",
          )
        ) {
          const preview = value.maintenancePreview
            ? Schema.decodeUnknownSync(maintenancePreviewSchema)(value.maintenancePreview)
            : null;
          const validPreview =
            preview &&
            preview.bundle === source.bundle &&
            preview.root === source.root &&
            preview.previewHash === value.operationHash
              ? preview
              : null;
          const operationHash = typeof value.operationHash === "string" ? value.operationHash : "";
          return {
            _tag: "MemoryWorkspaceRecovery",
            ...source,
            value: {
              memoryForm: commonFields(value.memoryForm),
              maintenancePreview: validPreview,
              operationHash,
              migrationDecisions: value.migrationDecisions,
              proposalChanges: value.proposalChanges,
            },
          } as Message;
        }
      } catch {}
      return { _tag: "Noop" } as Message;
    }),
  };
}
