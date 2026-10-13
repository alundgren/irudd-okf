import type { Html } from "foldkit";
import type { ConceptSummary } from "../../core/src/contracts.ts";
import type { Model, Message } from "./model.ts";
import { fieldValue, type MemoryField } from "./memory-editor.ts";
import { lineChanges, resolveLink } from "./content.ts";

export function memoryStatus<M>(item: ConceptSummary, h: Html.HtmlBuilder<M>): Html.Html | null {
  const m = item.memory;
  return m
    ? h.p(
        [h.Class("memory-status")],
        [
          `${m.kind ?? "unclassified"} · ${m.stage ?? "unstaged"} · ${m.namespace} · ${m.review} · ${m.trustTier} · ${m.freshness}${m.archived ? " · archived" : ""}${m.deprecated ? " · deprecated" : ""}${m.dependency !== "valid" ? ` · evidence ${m.dependency}` : ""}${!m.eligible ? " · excluded from recall" : ""}`,
        ],
      )
    : null;
}
export function memoryViews(model: Model, h: Html.HtmlBuilder<Message>) {
  const busy = (lane: string) => model.busy.includes(lane);
  const writable = !!model.context?.bundles.find((item) => item.name === model.bundle)?.writable;
  const button = (label: string, message: Message, disabled = false, className = "") =>
    h.button(
      [h.Type("button"), h.OnClick(message), h.Disabled(disabled), h.Class(className)],
      [label],
    );
  const field = (
    label: string,
    value: string,
    onInput: (value: string) => Message,
    multiline = false,
  ) =>
    h.label(
      [h.Class("field")],
      [
        h.span([], [label]),
        multiline
          ? h.textarea([h.Attribute("aria-label", label), h.Value(value), h.OnInput(onInput)])
          : h.input([h.Attribute("aria-label", label), h.Value(value), h.OnInput(onInput)]),
      ],
    );
  const select = (
    label: string,
    value: string,
    options: string[],
    onChange: (value: string) => Message,
  ) =>
    h.label(
      [h.Class("field")],
      [
        h.span([], [label]),
        h.select(
          [h.Attribute("aria-label", label), h.Value(value), h.OnChange(onChange)],
          options.map((option) =>
            h.option([h.Value(option), h.Selected(option === value)], [option]),
          ),
        ),
      ],
    );
  const form = (label: string, name: string, multiline = false, fallback = "") =>
    field(
      label,
      model.memoryForm[name] ?? fallback,
      (value) => ({ _tag: "MemoryForm", field: name, value }),
      multiline,
    );
  const choice = (label: string, name: string, options: string[], fallback = options[0]!) =>
    select(label, model.memoryForm[name] ?? fallback, options, (value) => ({
      _tag: "MemoryForm",
      field: name,
      value,
    }));
  const action = (
    label: string,
    name: Extract<Message, { _tag: "MemoryAction" }>["action"],
    disabled = false,
    className = "",
  ) =>
    button(
      label,
      { _tag: "MemoryAction", action: name },
      disabled ||
        (!writable && name !== "journal") ||
        model.busy.includes("mutation") ||
        model.busy.includes("maintenanceResult") ||
        model.busy.includes("maintenanceRecovery"),
      className,
    );
  const error = (lane: string) =>
    model.errors[lane]
      ? h.div(
          [h.Class("error"), h.Role("alert")],
          [model.errors[lane]!.message, h.small([], [JSON.stringify(model.errors[lane]!.details)])],
        )
      : null;
  const open = (path: string): Message => ({ _tag: "Open", bundle: model.bundle, path });
  const namespaces = [
    "shared",
    ...(model.namespaces?.namespaces.filter((name) => name !== "shared") ?? []),
  ];
  const disclosure = (key: string): Html.Attribute<Message>[] => [
    h.Key(key),
    h.Open(model.disclosures[key] ?? false),
    h.OnToggle((value) => ({ _tag: "Disclosure", key, value })),
  ];
  const summary = (key: string, label: string) =>
    h.summary(
      [
        h.OnClick(
          { _tag: "Disclosure", key, value: !(model.disclosures[key] ?? false) },
          { defaultAction: "Prevent" },
        ),
      ],
      [label],
    );
  function structuredEditor() {
    const raw = model.draft!.raw;
    const edit = (label: string, name: MemoryField | "body", multiline = false) =>
      field(
        label,
        model.draft!.fields?.[name] ?? fieldValue(raw, name),
        (value) => ({ _tag: "MemoryField", field: name, value }),
        multiline,
      );
    const editChoice = (label: string, name: MemoryField, options: string[]) =>
      select(
        label,
        model.draft!.fields?.[name] ??
          (fieldValue(raw, name) || (name === "namespace" ? "shared" : "")),
        options,
        (value) => ({ _tag: "MemoryField", field: name, value }),
      );
    return h.div(
      [h.Class("memory-author")],
      [
        edit("Title", "title"),
        edit("Description", "description"),
        edit("Memory text", "body", true),
        h.div(
          [h.Class("form-row")],
          [
            editChoice("Memory kind", "kind", ["procedural", "episodic", "semantic"]),
            editChoice("Processing stage", "stage", ["bronze", "silver", "gold"]),
            editChoice("Write namespace", "namespace", namespaces),
          ],
        ),
        edit("Topic tags, comma separated", "tags"),
        edit("Sources, one resource per line", "sources", true),
        h.details(disclosure("metadata-editor"), [
          summary("metadata-editor", "Dates, task, and supporting metadata"),
          edit("OKF type", "type"),
          edit("Status", "status"),
          edit("Producer", "generatedBy"),
          edit("Produced at, UTC ISO date", "generatedAt"),
          edit("Occurred at, UTC ISO date", "occurredAt"),
          edit("Recheck after, UTC ISO date", "staleAfter"),
          edit("Expires at, UTC ISO date", "expiresAt"),
          edit("Task reference", "taskReference"),
          editChoice("Task state", "taskState", ["", "open", "completed", "cancelled"]),
          edit("Task completed at, UTC ISO date", "completedAt"),
          edit("Retention reason", "retentionReason"),
          edit("Prerequisites, one resource per line", "prerequisites", true),
          edit("Replaces, one resource per line", "replaces", true),
          edit("Derived revisions, resource and content hash per line", "derivedFrom", true),
        ]),
      ],
    );
  }
  function create() {
    return h.details(disclosure("memory-template"), [
      summary("memory-template", "Add memory from template"),
      form("New memory path", "path"),
      form("Memory title", "title"),
      form("Memory description", "description"),
      choice("Template kind", "kind", ["semantic", "episodic", "procedural"]),
      choice("Template stage", "stage", ["bronze", "silver", "gold"]),
      choice("Template namespace", "namespace", namespaces),
      form("Template topic tags, comma separated", "tags"),
      form("Template producer", "actor"),
      form("Template occurred at, UTC ISO date", "occurredAt"),
      form("Template sources, one resource per line", "sources", true),
      error("template"),
      action(
        busy("template") ? "Preparing template…" : "Create draft",
        "template",
        busy("template") || !model.memoryForm.title?.trim() || !!model.draft,
        "primary",
      ),
    ]);
  }
  function document() {
    const concept = model.concept;
    if (!concept?.memory) return null;
    const m = concept.memory;
    const generated = concept.metadata.generated as { by?: string; at?: string } | undefined;
    const sources = Array.isArray(concept.metadata.sources) ? concept.metadata.sources : [];
    const metadata = concept.metadata.memory as
      | {
          derived_from?: Array<{ resource: string; content_hash: string }>;
          task?: { reference: string; state: string };
        }
      | undefined;
    const revisions = Array.isArray(metadata?.derived_from)
      ? metadata.derived_from.filter(
          (source) =>
            source &&
            typeof source === "object" &&
            typeof source.resource === "string" &&
            typeof source.content_hash === "string",
        )
      : [];
    const resourceLink = (resource: string) => {
      const resolved = resolveLink(resource, concept.bundle, concept.path);
      return resolved.kind === "internal"
        ? h.a(
            [
              h.Href(
                `/wiki?bundle=${encodeURIComponent(resolved.bundle)}&path=${encodeURIComponent(resolved.path)}`,
              ),
              h.OnClick(
                {
                  _tag: "Open",
                  bundle: resolved.bundle,
                  path: resolved.path,
                  fragment: resolved.fragment,
                },
                { defaultAction: "Prevent" },
              ),
            ],
            [resource],
          )
        : h.span([], [resource]);
    };
    return h.div(
      [h.Class("memory-document")],
      [
        memoryStatus(concept, h),
        h.p(
          [h.Class("muted")],
          [
            `Produced by ${generated?.by ?? "unknown"}${generated?.at ? ` at ${generated.at}` : ""}. Processing stage and review are independent. Actor records are not identity proof.`,
          ],
        ),
        h.details(disclosure("evidence"), [
          summary("evidence", "Evidence and review history"),
          h.p([h.Class("provenance")], [`Current content digest: ${m.contentHash}`]),
          h.ul(
            [],
            sources.map((source) => {
              const resource =
                typeof source === "string"
                  ? source
                  : source && typeof source === "object" && "resource" in source
                    ? String(source.resource)
                    : JSON.stringify(source);
              return h.li([], [resourceLink(resource)]);
            }),
          ),
          h.ul(
            [],
            revisions.map((source) =>
              h.li(
                [],
                [
                  resourceLink(source.resource),
                  h.small([h.Class("provenance")], [` · ${source.content_hash}`]),
                ],
              ),
            ),
          ),
          h.ul(
            [],
            m.reviewEvents.map((event) =>
              h.li(
                [],
                [
                  `${event.decision} · ${event.actor_type} · ${event.by} · ${event.at} · ${event.reason}`,
                  h.small(
                    [h.Class("provenance")],
                    [
                      ` · ${event.content_hash}${event.content_hash === m.contentHash ? " · current content" : " · previous content"}`,
                    ],
                  ),
                ],
              ),
            ),
          ),
          h.ul(
            [],
            m.verificationEvents.map((event) =>
              h.li(
                [],
                [
                  `Machine verification · ${event.by} · ${event.at} · ${event.method}${event.content_hash === m.contentHash ? " · current content" : " · previous content"}`,
                ],
              ),
            ),
          ),
          m.historicalVerificationEvents.length
            ? h.p(
                [],
                [
                  `${m.historicalVerificationEvents.length} historical confirmations without a current content binding.`,
                ],
              )
            : null,
        ]),
        h.details(disclosure("human-review"), [
          summary("human-review", "Review current content"),
          h.p(
            [],
            [
              "Read the memory and its evidence before recording a decision. This action records a human operator review of the displayed content digest.",
            ],
          ),
          choice("Review decision", "decision", ["approve", "reject"]),
          form("Reviewer, human: name", "actor"),
          form("Review reason", "reason", true),
          action(
            "Record human review",
            "review",
            !model.memoryForm.reason?.trim() || !model.memoryForm.actor?.startsWith("human:"),
            model.memoryForm.decision === "reject" ? "danger" : "primary",
          ),
        ]),
        h.details(disclosure("machine-verification"), [
          summary("machine-verification", "Record machine verification"),
          form("Machine actor", "machineActor", false, "machine:operator-check"),
          form("Verification method and evidence checked", "method", true),
          action("Record machine verification", "verify", !model.memoryForm.method?.trim()),
        ]),
        h.details(disclosure("task-retention"), [
          summary("task-retention", "Task completion and retention"),
          form("Task reference", "taskReference", false, metadata?.task?.reference),
          choice("Task outcome", "taskState", ["completed", "cancelled", "open"]),
          form("Completed at, UTC ISO date, optional", "completedAt"),
          form(
            `Retention days, default ${model.profile?.policy?.task_retention_days ?? 30}`,
            "retentionDays",
          ),
          form("Keep historical episode, retention reason", "retentionReason"),
          h.p(
            [h.Class("muted")],
            [
              "Clearing a previously entered retention value removes that override. A retention reason can keep a historical episode available.",
            ],
          ),
          action("Update task", "task"),
        ]),
        h.details(disclosure("lifecycle"), [
          summary("lifecycle", "Expiration, archive, and replacement"),
          choice("Lifecycle action", "lifecycleAction", [
            "archive",
            "restore",
            "expire",
            "clear-expiration",
            "recheck",
            "deprecate",
          ]),
          form("Action date, UTC ISO date, optional", "lifecycleAt"),
          form("Replacement resource, for deprecation", "replacement"),
          form("Lifecycle reason", "lifecycleReason"),
          h.p(
            [h.Class("muted")],
            [
              "Archive retains the file. Expiration hides it from ordinary recall. Recheck requests another evidence review. Deprecated guidance can identify its replacement.",
            ],
          ),
          action(
            "Apply lifecycle action",
            "lifecycle",
            false,
            ["archive", "expire", "deprecate"].includes(
              model.memoryForm.lifecycleAction ?? "archive",
            )
              ? "danger"
              : "",
          ),
        ]),
      ],
    );
  }
  function preview() {
    const p = model.maintenancePreview;
    if (!p) return null;
    return h.section(
      [h.Class("maintenance-preview")],
      [
        h.h2([], ["Review proposed file changes"]),
        h.p(
          [],
          [
            `${p.purpose} · ${p.reason} · ${p.changes.length} files · ${p.guards.length} inventory checks`,
          ],
        ),
        h.p([h.Class("provenance")], [p.root]),
        ...p.changes.map((change) => {
          const diff = lineChanges(change.before ?? "", change.raw ?? "");
          return h.details(
            [h.Open(true)],
            [
              h.summary(
                [h.Class("provenance")],
                [
                  `${change.path}${change.raw === null ? " · DELETE" : change.before === null ? " · new file" : ""}`,
                ],
              ),
              h.div(
                [h.Class("diff")],
                [
                  h.pre([h.Class("removed")], [diff.removed.map((line) => `- ${line}`).join("\n")]),
                  h.pre([h.Class("added")], [diff.added.map((line) => `+ ${line}`).join("\n")]),
                ],
              ),
            ],
          );
        }),
        h.ul(
          [h.Class("diagnostics")],
          p.diagnostics.map((item) => h.li([], [`${item.path}: ${item.message}`])),
        ),
        p.unresolved.length
          ? h.div(
              [h.Class("notice")],
              [
                h.p(
                  [],
                  [
                    "Resolve these classification and evidence choices, then preview again before applying.",
                  ],
                ),
                h.ul(
                  [],
                  p.unresolved.map((item) =>
                    h.li([], [`${item.path} · ${item.field}: ${item.message}`]),
                  ),
                ),
              ],
            )
          : null,
        error("maintenanceResult"),
        model.errors.maintenanceResult
          ? h.p(
              [],
              [
                "The preview remains available. Inspect recovery before retrying. External edits require a new preview.",
              ],
            )
          : null,
        action(
          busy("maintenanceResult") ? "Applying…" : "Apply reviewed changes",
          "apply",
          !!p.unresolved.length ||
            p.diagnostics.some((item) => item.level === "error") ||
            !!model.maintenanceResult ||
            busy("maintenanceResult") ||
            busy("maintenancePreview"),
          p.changes.some((change) => change.raw === null) ? "danger" : "primary",
        ),
        action("Inspect recovery journal", "journal", busy("journal")),
        error("journal"),
        model.maintenanceResult
          ? h.p(
              [h.Role("status")],
              [
                `${model.maintenanceResult.state} · ${model.maintenanceResult.changedPaths.join(", ")}`,
              ],
            )
          : null,
        model.journal
          ? h.div(
              [h.Class("recovery-journal")],
              [
                h.h3([], [`Recovery ${model.journal.state}`]),
                h.p(
                  [],
                  [
                    "Recover a stopped operation before retrying. The engine checks the recorded process owner and preserves the lock before removing it.",
                  ],
                ),
                action("Recover interrupted batch", "recoverBatch", busy("maintenanceRecovery")),
                error("maintenanceRecovery"),
                h.p([h.Class("provenance")], [model.journal.journalPath]),
                ...model.journal.paths.map((path) =>
                  h.details(
                    [],
                    [
                      h.summary([], [`${path.path} · ${path.state}`]),
                      h.p(
                        [h.Class("provenance")],
                        [
                          `Current hash: ${path.currentHash ?? "missing"}. ${path.recoveryPath ?? "No recovery file"}`,
                        ],
                      ),
                      h.pre([], [path.before ?? "New file"]),
                      h.pre([], [path.after ?? "Deleted file"]),
                    ],
                  ),
                ),
              ],
            )
          : null,
      ],
    );
  }
  function maintenance() {
    return h.main(
      [h.Class("memory-page")],
      [
        h.h1([], ["Maintain memory"]),
        h.p(
          [],
          [
            "Inspect excluded and stale memories, then preview a concrete proposal before writing files. The engine checks every bundle file for intervening changes.",
          ],
        ),
        error("audit"),
        busy("audit") ? h.p([h.Role("status")], ["Reading audit…"]) : null,
        model.audit
          ? h.div(
              [],
              [
                h.ul(
                  [h.Class("audit-list")],
                  model.audit.concepts.map((item) =>
                    h.li(
                      [],
                      [
                        button(item.title || item.path, open(item.path)),
                        h.small([h.Class("provenance")], [item.path]),
                        memoryStatus(item, h),
                      ],
                    ),
                  ),
                ),
                !model.audit.concepts.length
                  ? h.p([], ["No memories in this namespace selection."])
                  : null,
                h.ul(
                  [h.Class("diagnostics")],
                  model.audit.diagnostics.map((item) =>
                    h.li([], [`${item.path}: ${item.message}`]),
                  ),
                ),
              ],
            )
          : null,
        h.details(disclosure("recovery-lookup"), [
          summary("recovery-lookup", "Recover a previous operation"),
          form("Recovery preview hash", "journalHash"),
          action(
            "Load recovery journal",
            "journal",
            !model.memoryForm.journalHash?.trim() || busy("journal"),
          ),
          error("journal"),
        ]),
        h.details(disclosure("maintenance-proposal"), [
          summary("maintenance-proposal", "Prepare maintenance or consolidation proposal"),
          choice("Proposal purpose", "purpose", ["maintenance", "consolidation"]),
          form("Proposal reason", "reason", true),
          h.label(
            [h.Class("check")],
            [
              h.input([
                h.Type("checkbox"),
                h.Checked(model.memoryForm.allowNamespaceChange === "true"),
                h.OnChange(() => ({
                  _tag: "MemoryForm",
                  field: "allowNamespaceChange",
                  value: model.memoryForm.allowNamespaceChange === "true" ? "false" : "true",
                })),
              ]),
              "Allow reviewed publication to a different namespace",
            ],
          ),
          ...model.proposalChanges.map((change, index) =>
            h.div(
              [h.Class("proposal-file")],
              [
                field("Proposal path", change.path, (value) => ({
                  _tag: "ProposalChange",
                  index,
                  field: "path",
                  value,
                })),
                field(
                  "Proposed full Markdown, empty deletes file",
                  change.raw,
                  (value) => ({ _tag: "ProposalChange", index, field: "raw", value }),
                  true,
                ),
                button("Remove proposed file", { _tag: "ProposalRemove", index }),
              ],
            ),
          ),
          button("Add proposed file", { _tag: "ProposalAdd" }),
          error("maintenancePreview"),
          action(
            "Preview proposal",
            "proposal",
            !model.proposalChanges.length ||
              !model.memoryForm.reason?.trim() ||
              busy("maintenancePreview"),
          ),
        ]),
        preview(),
      ],
    );
  }
  function profile() {
    const policy = model.profile?.policy;
    const candidates =
      model.audit?.concepts.filter(
        (item) => !/(^|\/)(index|log)\.md$/.test(item.path) && item.path !== "memory-policy.md",
      ) ?? [];
    return h.main(
      [h.Class("memory-page")],
      [
        h.h1([], ["Bundle memory profile"]),
        error("profile"),
        h.p([], [`Mode: ${model.profile?.mode ?? "loading"}`]),
        h.ul(
          [h.Class("diagnostics")],
          model.profile?.diagnostics.map((item) => h.li([], [item.message])) ?? [],
        ),
        model.profile?.mode === "invalid"
          ? h.p(
              [],
              ["Repair the policy file to enable profile operations. Raw files remain available."],
            )
          : null,
        button("Open policy file", open("memory-policy.md")),
        policy
          ? h.p(
              [],
              [
                `Namespaces: ${policy.namespaces.join(", ") || "shared only"}. Topics: ${policy.topics.join(", ")}. Task retention ${policy.task_retention_days} days. Review interval ${policy.review_interval_days} days. Gold review: ${policy.gold_review === "human" ? "human required" : "machine or human"}.`,
              ],
            )
          : h.p(
              [],
              [
                "Generic OKF files remain readable. Adoption needs explicit classification and evidence choices.",
              ],
            ),
        h.details(disclosure("profile-migration"), [
          h.summary(
            [],
            [policy ? "Edit profile with a reviewed migration" : "Adopt the memory profile"],
          ),
          form(
            "Registered namespaces, comma separated",
            "policyNamespaces",
            false,
            policy?.namespaces.join(", "),
          ),
          form(
            "Controlled topics, comma separated",
            "policyTopics",
            false,
            policy?.topics.join(", "),
          ),
          form(
            "Default task retention days",
            "taskRetention",
            false,
            String(policy?.task_retention_days ?? 30),
          ),
          form(
            "Durable memory review interval days",
            "reviewInterval",
            false,
            String(policy?.review_interval_days ?? 90),
          ),
          choice(
            "Gold review requirement",
            "goldReview",
            ["any", "human"],
            policy?.gold_review ?? "any",
          ),
          h.p(
            [h.Class("muted")],
            [
              "Any permits machine or human confirmation. Human requires an operator review of current gold content.",
            ],
          ),
          ...candidates.map((item) => {
            const values = model.migrationDecisions[item.path] ?? {};
            const set =
              (name: string) =>
              (value: string): Message => ({
                _tag: "MigrationField",
                path: item.path,
                field: name,
                value,
              });
            return h.details(disclosure(`migration-${item.path}`), [
              summary(`migration-${item.path}`, item.title || item.path),
              h.small([h.Class("provenance")], [item.path]),
              select(
                "Migration kind",
                values.kind ?? "",
                ["", "procedural", "episodic", "semantic"],
                set("kind"),
              ),
              select(
                "Migration stage",
                values.stage ?? "",
                ["", "bronze", "silver", "gold"],
                set("stage"),
              ),
              field("Migration namespace", values.namespace ?? "", set("namespace")),
              field("Migration title", values.title ?? "", set("title")),
              field("Migration description", values.description ?? "", set("description")),
              field("Migration topic tags, comma separated", values.tags ?? "", set("tags")),
              field("Migration producer", values.actor ?? "", set("actor")),
              field("Migration produced at, UTC ISO date", values.at ?? "", set("at")),
              field("Migration status", values.status ?? "", set("status")),
              field(
                "Migration occurred at, UTC ISO date",
                values.occurredAt ?? "",
                set("occurredAt"),
              ),
              field(
                "Migration sources, one resource per line",
                values.sources ?? "",
                set("sources"),
                true,
              ),
              h.details(disclosure(`migration-lifecycle-${item.path}`), [
                summary(
                  `migration-lifecycle-${item.path}`,
                  "Task, lifecycle, and source revisions",
                ),
                field("Migration task reference", values.taskReference ?? "", set("taskReference")),
                select(
                  "Migration task state",
                  values.taskState ?? "open",
                  ["open", "completed", "cancelled"],
                  set("taskState"),
                ),
                field(
                  "Migration task completed at, UTC ISO date",
                  values.completedAt ?? "",
                  set("completedAt"),
                ),
                field(
                  "Migration retention reason",
                  values.retentionReason ?? "",
                  set("retentionReason"),
                ),
                field(
                  "Migration expires at, UTC ISO date",
                  values.expiresAt ?? "",
                  set("expiresAt"),
                ),
                field(
                  "Migration recheck after, UTC ISO date",
                  values.staleAfter ?? "",
                  set("staleAfter"),
                ),
                field(
                  "Migration archived at, UTC ISO date",
                  values.archivedAt ?? "",
                  set("archivedAt"),
                ),
                field(
                  "Migration prerequisites, one resource per line",
                  values.prerequisites ?? "",
                  set("prerequisites"),
                  true,
                ),
                field(
                  "Migration replaces, one resource per line",
                  values.replaces ?? "",
                  set("replaces"),
                  true,
                ),
                field("Migration replacement resource", values.replacedBy ?? "", set("replacedBy")),
                field(
                  "Migration derived revisions, resource and content hash per line",
                  values.derivedFrom ?? "",
                  set("derivedFrom"),
                  true,
                ),
              ]),
              h.details(disclosure(`migration-raw-${item.path}`), [
                summary(`migration-raw-${item.path}`, "Complete candidate for other metadata"),
                field("Reviewed complete Markdown candidate", values.raw ?? "", set("raw"), true),
              ]),
            ]);
          }),
          error("maintenancePreview"),
          action("Preview profile changes", "migration", busy("maintenancePreview")),
        ]),
        preview(),
      ],
    );
  }
  return { structuredEditor, create, document, maintenance, profile };
}
