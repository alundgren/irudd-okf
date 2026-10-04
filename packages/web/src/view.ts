import type { Html } from "foldkit";
import type { ConceptSummary } from "../../core/src/contracts.ts";
import { dirty, type Message, type Model } from "./model.ts";
import { lineChanges, renderMarkdown } from "./content.ts";

export function view(model: Model, h: Html.HtmlBuilder<Message>): Html.Html {
  const busy = (lane: string) => model.busy.includes(lane);
  const button = (text: string, message: Message, disabled = false, className = "") =>
    h.button(
      [h.Type("button"), h.OnClick(message), h.Disabled(disabled), h.Class(className)],
      [text],
    );
  const open = (bundle: string, path: string, fragment = ""): Message => ({
    _tag: "Open",
    bundle,
    path,
    fragment,
  });
  const source = model.context?.bundles.find((bundle) => bundle.name === model.bundle);
  const writable = !!source?.writable;
  const link = (concept: Pick<ConceptSummary, "bundle" | "path" | "title">) =>
    h.a(
      [
        h.Href(
          `/wiki?bundle=${encodeURIComponent(concept.bundle)}&path=${encodeURIComponent(concept.path)}`,
        ),
        h.OnClick(open(concept.bundle, concept.path), { defaultAction: "Prevent" }),
      ],
      [concept.title || concept.path],
    );
  const input = (
    label: string,
    value: string,
    message: (value: string) => Message,
    attrs: Html.Attribute<Message>[] = [],
  ) =>
    h.label(
      [h.Class("field")],
      [h.span([], [label]), h.input([h.Value(value), h.OnInput(message), ...attrs])],
    );
  const error = (lane: string) =>
    model.errors[lane]
      ? h.div(
          [h.Class("error"), h.Role("alert")],
          [
            h.p([], [model.errors[lane]!.message]),
            h.small(
              [],
              [
                `${model.errors[lane]!.code}${Object.keys(model.errors[lane]!.details).length ? ` · ${JSON.stringify(model.errors[lane]!.details)}` : ""}`,
              ],
            ),
          ],
        )
      : null;
  const pageButtons = (
    offset: number,
    limit: number,
    total: number,
    select: (offset: number) => Message,
  ) =>
    h.div(
      [h.Class("pager")],
      [
        button("Previous", select(Math.max(0, offset - limit)), offset === 0),
        h.span([], [`${total ? offset + 1 : 0}–${Math.min(total, offset + limit)} of ${total}`]),
        button("Next", select(offset + limit), offset + limit >= total),
      ],
    );
  const notices = h.div(
    [h.Class("notices"), h.Attribute("aria-live", "polite")],
    [
      model.notice ? h.p([h.Class("notice")], [model.notice]) : null,
      busy("context") ? h.p([], ["Connecting to the local server…"]) : null,
      error("context"),
      Object.values(model.errors).some((error) =>
        ["connection", "session", "UNAUTHORIZED_SESSION"].includes(error.code),
      )
        ? h.div(
            [h.Class("notice")],
            [
              h.p(
                [],
                [
                  "Reload the viewer after restarting the local server to establish a new session. Unsaved drafts are kept in this tab.",
                ],
              ),
              button("Reload viewer", { _tag: "Reload" }),
            ],
          )
        : null,
      model.recovery
        ? h.div(
            [h.Class("notice")],
            [
              h.p(
                [],
                [
                  `An unsaved draft for ${model.recovery.path || "a new concept"} is kept in this tab.`,
                ],
              ),
              button("Recover draft", { _tag: "Recover" }),
              button("Discard stored draft", { _tag: "ForgetRecovery" }),
            ],
          )
        : null,
    ],
  );
  const searchView = model.search
    ? h.section(
        [h.Class("search-results")],
        [
          h.h1([], [`Search results for “${model.search.query}”`]),
          model.search.total === 0
            ? h.p([], ["No matches in this source. Try another word or select another source."])
            : h.ul(
                [h.Class("result-list")],
                model.search.results.map((hit) =>
                  h.li(
                    [],
                    [
                      link(hit),
                      h.p([], [hit.excerpt || hit.description]),
                      h.small(
                        [h.Class("provenance")],
                        [`${hit.bundle} / ${hit.path} · matched ${hit.matched.join(", ")}`],
                      ),
                    ],
                  ),
                ),
              ),
          pageButtons(model.search.offset, model.search.limit, model.search.total, (offset) => ({
            _tag: "Search",
            offset,
          })),
          model.search.truncated
            ? h.p(
                [h.Class("muted")],
                ["More matches are available. Use the page controls or narrow your search."],
              )
            : null,
        ],
      )
    : null;
  function wiki() {
    const concept = model.concept;
    return h.div(
      [h.Class("wiki-layout")],
      [
        h.aside(
          [h.Class("browse"), h.Attribute("aria-label", "Browse concepts")],
          [
            h.div(
              [h.Class("browse-actions")],
              [
                button("Bundle index", { _tag: "Index", path: "" }, !model.bundle),
                button("Add concept", { _tag: "New" }, !writable || !!model.draft, "primary"),
              ],
            ),
            error("list"),
            busy("list") ? h.p([], ["Loading concepts…"]) : null,
            !model.concepts.length && !busy("list")
              ? h.p([h.Class("muted")], ["No concepts yet. Add one, or open the bundle index."])
              : null,
            h.ul(
              [h.Class("concept-list")],
              model.concepts
                .slice(model.listOffset, model.listOffset + 30)
                .map((item) =>
                  h.li(
                    [h.Class(item.path === concept?.path ? "current" : "")],
                    [
                      link(item),
                      h.small([], [`${item.path}${item.malformed ? " · needs repair" : ""}`]),
                    ],
                  ),
                ),
            ),
            pageButtons(model.listOffset, 30, model.concepts.length, (offset) => ({
              _tag: "ListPage",
              offset,
            })),
          ],
        ),
        h.main(
          [h.Class("reading")],
          [
            busy("search") ? h.p([h.Role("status")], ["Searching this source…"]) : null,
            error("search"),
            model.draft
              ? editor()
              : model.search
                ? searchView
                : h.div(
                    [],
                    [
                      error("concept"),
                      busy("concept") ? h.p([h.Role("status")], ["Loading document…"]) : null,
                      !concept && !busy("concept")
                        ? h.p(
                            [],
                            [
                              model.context?.bundles.length
                                ? "Choose a concept or open the bundle index."
                                : "No bundles are selected. Run irudd-okf init in your repository, then restart irudd-okf serve.",
                            ],
                          )
                        : null,
                      concept
                        ? h.article(
                            [],
                            [
                              h.div(
                                [h.Class("document-title")],
                                [
                                  h.h1([], [concept.title || concept.path]),
                                  h.div(
                                    [h.Class("actions")],
                                    [
                                      button(
                                        concept.hash ? "Edit" : "Save as index",
                                        { _tag: "Edit", operation: "write" },
                                        !writable,
                                      ),
                                      button(
                                        "Rename",
                                        { _tag: "Edit", operation: "rename" },
                                        !writable || !concept.hash,
                                      ),
                                      button(
                                        "Delete",
                                        { _tag: "Edit", operation: "delete" },
                                        !writable || !concept.hash,
                                        "danger",
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                              h.p([h.Class("provenance")], [`${concept.bundle} / ${concept.path}`]),
                              h.p(
                                [h.Class("source-root")],
                                [
                                  `${concept.hash ? "File" : "Generated index"}: ${source?.root ?? ""}/${concept.path}`,
                                ],
                              ),
                              concept.malformed
                                ? h.p(
                                    [h.Class("error")],
                                    [
                                      "This file has invalid metadata. Its raw Markdown is still available for repair.",
                                    ],
                                  )
                                : null,
                              concept.diagnostics.length
                                ? h.ul(
                                    [h.Class("diagnostics")],
                                    concept.diagnostics.map((item) =>
                                      h.li([], [`${item.level}: ${item.message}`]),
                                    ),
                                  )
                                : null,
                              renderMarkdown(concept.body, concept, h, open),
                              h.details(
                                [h.Class("metadata")],
                                [
                                  h.summary([], ["Metadata and raw source"]),
                                  h.pre([], [JSON.stringify(concept.metadata, null, 2)]),
                                  h.pre([], [concept.raw]),
                                ],
                              ),
                              concept.links.length || concept.backlinks.length
                                ? h.div(
                                    [h.Class("connections")],
                                    [
                                      h.h2([], ["Connections"]),
                                      h.ul(
                                        [],
                                        concept.links.map((item) =>
                                          h.li(
                                            [],
                                            [
                                              item.external
                                                ? h.span(
                                                    [],
                                                    [
                                                      `${item.label || item.target} · external · ${item.target}`,
                                                    ],
                                                  )
                                                : item.broken
                                                  ? h.span(
                                                      [h.Class("missing")],
                                                      [
                                                        `${item.label || item.target} · missing · ${item.target}`,
                                                      ],
                                                    )
                                                  : link({
                                                      bundle: concept.bundle,
                                                      path: item.target,
                                                      title: item.label || item.target,
                                                    }),
                                            ],
                                          ),
                                        ),
                                      ),
                                      concept.backlinks.length
                                        ? h.p([h.Class("muted")], ["Linked from"])
                                        : null,
                                      h.ul(
                                        [],
                                        concept.backlinks.map((item) => h.li([], [link(item)])),
                                      ),
                                      button("Explore graph", { _tag: "View", view: "graph" }),
                                    ],
                                  )
                                : null,
                            ],
                          )
                        : null,
                    ],
                  ),
          ],
        ),
      ],
    );
  }
  function editor() {
    const draft = model.draft!;
    const changes = lineChanges(draft.original, draft.operation === "delete" ? "" : draft.raw);
    const title =
      draft.operation === "delete"
        ? "Delete concept"
        : draft.operation === "rename"
          ? "Rename concept"
          : draft.expectedHash === null
            ? "Add concept"
            : "Edit concept";
    return h.section(
      [h.Class("editor")],
      [
        h.h1([], [title]),
        h.p([h.Class("provenance")], [`${draft.bundle} / ${draft.path || "new file"}`]),
        source?.kind === "personal"
          ? h.p(
              [h.Class("notice")],
              ["You are editing your personal bundle. Saving here changes personal memory."],
            )
          : null,
        error("mutation"),
        error("renamePreview"),
        error("deletePreview"),
        error("renameConflict"),
        busy("renamePreview") || busy("deletePreview")
          ? h.p([h.Role("status")], ["Preparing changes preview…"])
          : null,
        error("conflict"),
        error("restore"),
        model.conflict
          ? h.div(
              [h.Class("conflict"), h.Role("alert")],
              [
                h.h2([], ["The file changed since you opened it"]),
                h.p(
                  [],
                  [
                    "Your draft is kept. Compare the current file below, then continue with your draft against this version or use the current file.",
                  ],
                ),
                h.div(
                  [h.Class("compare")],
                  [
                    h.div([], [h.p([], ["Current file"]), h.pre([], [model.conflict.raw])]),
                    h.div([], [h.p([], ["Your draft"]), h.pre([], [draft.raw])]),
                  ],
                ),
                button("Continue with draft", { _tag: "RebaseDraft" }),
                button("Use current file", { _tag: "UseCurrent" }),
                button("Copy draft", { _tag: "Copy" }),
              ],
            )
          : null,
        !draft.preview
          ? h.div(
              [],
              [
                draft.expectedHash === null
                  ? input(
                      "File path within bundle",
                      draft.path,
                      (value) => ({ _tag: "Draft", field: "path", value }),
                      [h.Placeholder("rules/test-artifacts.md"), h.Required(true)],
                    )
                  : null,
                draft.operation === "rename"
                  ? h.div(
                      [],
                      [
                        input("New file path", draft.newPath, (value) => ({
                          _tag: "Draft",
                          field: "newPath",
                          value,
                        })),
                        h.label(
                          [h.Class("check")],
                          [
                            h.input([
                              h.Type("checkbox"),
                              h.Checked(draft.updateLinks),
                              h.OnChange(() => ({
                                _tag: "UpdateLinks",
                                value: !draft.updateLinks,
                              })),
                            ]),
                            "Update links within this bundle",
                          ],
                        ),
                      ],
                    )
                  : null,
                draft.operation === "delete"
                  ? h.p(
                      [],
                      [
                        "Review the file below before deleting it. A recovery copy is kept by the server.",
                      ],
                    )
                  : null,
                draft.operation === "write"
                  ? h.label(
                      [h.Class("field")],
                      [
                        h.span([], ["Raw Markdown, including YAML metadata"]),
                        h.textarea([
                          h.Id("draft-markdown"),
                          h.Class("raw-editor"),
                          h.Value(draft.raw),
                          h.OnInput((value) => ({ _tag: "Draft", field: "raw", value })),
                          h.Spellcheck(false),
                        ]),
                      ],
                    )
                  : h.pre([], [draft.raw]),
                h.div(
                  [h.Class("actions")],
                  [
                    button(
                      busy("renamePreview") || busy("deletePreview")
                        ? "Preparing preview…"
                        : "Preview changes",
                      { _tag: "PreviewDraft" },
                      busy("renamePreview") ||
                        busy("deletePreview") ||
                        !draft.path.trim() ||
                        (draft.operation === "rename" && !draft.newPath.trim()),
                      "primary",
                    ),
                    button("Cancel", { _tag: "Cancel" }),
                    button("Copy draft", { _tag: "Copy" }),
                  ],
                ),
              ],
            )
          : h.div(
              [],
              [
                h.p(
                  [],
                  [
                    draft.operation === "rename"
                      ? `Move ${draft.path} to ${draft.newPath}.${draft.updateLinks ? " Links within this bundle will be updated." : ""}`
                      : draft.operation === "delete"
                        ? `Delete ${draft.path}.`
                        : `Save changes to ${draft.path}.`,
                  ],
                ),
                draft.operation === "delete"
                  ? h.div(
                      [h.Class("delete-referrers")],
                      [
                        h.p(
                          [h.Class(draft.referrers.length ? "missing" : "muted")],
                          [
                            draft.referrers.length
                              ? "Deleting this file leaves links in these documents pointing to a missing file:"
                              : "No referring documents were found in this bundle.",
                          ],
                        ),
                        h.ul(
                          [],
                          draft.referrers.map((item) =>
                            h.li(
                              [],
                              [
                                link(item),
                                h.small(
                                  [h.Class("provenance")],
                                  [` · ${item.bundle} / ${item.path}`],
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    )
                  : null,
                draft.operation === "rename" && model.renamePreview
                  ? h.div(
                      [h.Class("rename-changes")],
                      [
                        h.p(
                          [],
                          [
                            `${model.renamePreview.changes.length} affected files. Review every path below before confirming.`,
                          ],
                        ),
                        ...model.renamePreview.changes.map((change) => {
                          const diff = lineChanges(change.before, change.after);
                          return h.details(
                            [h.Open(true)],
                            [
                              h.summary([h.Class("provenance")], [change.path]),
                              h.div(
                                [h.Class("diff")],
                                [
                                  diff.removed.length
                                    ? h.pre(
                                        [h.Class("removed")],
                                        [diff.removed.map((line) => `- ${line}`).join("\n")],
                                      )
                                    : null,
                                  diff.added.length
                                    ? h.pre(
                                        [h.Class("added")],
                                        [diff.added.map((line) => `+ ${line}`).join("\n")],
                                      )
                                    : null,
                                ],
                              ),
                            ],
                          );
                        }),
                        !draft.updateLinks && draft.referrers.length
                          ? h.div(
                              [],
                              [
                                h.p(
                                  [h.Class("missing")],
                                  [
                                    "Links in these documents keep their existing targets and may become unavailable:",
                                  ],
                                ),
                                h.ul(
                                  [],
                                  draft.referrers.map((item) => h.li([], [link(item)])),
                                ),
                              ],
                            )
                          : null,
                      ],
                    )
                  : null,
                draft.operation === "write" || draft.operation === "delete"
                  ? h.div(
                      [h.Class("diff")],
                      [
                        h.p([], [`Changed lines starting at ${changes.line}`]),
                        changes.removed.length
                          ? h.pre(
                              [h.Class("removed")],
                              [changes.removed.map((line) => `- ${line}`).join("\n")],
                            )
                          : null,
                        changes.added.length
                          ? h.pre(
                              [h.Class("added")],
                              [changes.added.map((line) => `+ ${line}`).join("\n")],
                            )
                          : null,
                        !changes.removed.length && !changes.added.length
                          ? h.p([], ["No content changes."])
                          : null,
                      ],
                    )
                  : null,
                draft.operation === "write"
                  ? h.details(
                      [],
                      [
                        h.summary([], ["Read Markdown preview"]),
                        renderMarkdown(
                          draft.raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ""),
                          draft,
                          h,
                          open,
                        ),
                      ],
                    )
                  : null,
                h.div(
                  [h.Class("actions")],
                  [
                    button(
                      busy("mutation")
                        ? "Saving…"
                        : draft.operation === "delete"
                          ? "Delete file"
                          : draft.operation === "rename"
                            ? "Rename file"
                            : "Save file",
                      { _tag: "Save" },
                      busy("mutation") ||
                        !!model.conflict ||
                        (draft.operation === "rename" && !model.renamePreview),
                      draft.operation === "delete" ? "danger" : "primary",
                    ),
                    button("Back to draft", { _tag: "ContinueDraft" }, busy("mutation")),
                    button("Cancel", { _tag: "Cancel" }, busy("mutation")),
                    button("Copy draft", { _tag: "Copy" }),
                  ],
                ),
              ],
            ),
        h.small(
          [h.Class("muted")],
          [
            dirty(model)
              ? "Unsaved changes. Draft recovery is kept in this tab."
              : "No unsaved changes.",
          ],
        ),
      ],
    );
  }
  function graph() {
    const data = model.graph;
    const nodes = data
      ? [...data.nodes].sort(
          (a, b) =>
            Number(b.path === model.desiredPath && b.bundle === model.bundle) -
            Number(a.path === model.desiredPath && a.bundle === model.bundle),
        )
      : [];
    const positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, index) => {
      const ring = Math.floor(index / 16) + 1,
        angle = index * 2.399963;
      positions.set(
        `${node.bundle}:${node.path}`,
        index === 0
          ? { x: 500, y: 320 }
          : {
              x: 500 + Math.cos(angle) * Math.min(430, ring * 85),
              y: 320 + Math.sin(angle) * Math.min(265, ring * 53),
            },
      );
    });
    const attr = (name: string, value: string | number) => h.Attribute(name, String(value));
    return h.main(
      [h.Class("graph-page")],
      [
        h.div(
          [h.Class("document-title")],
          [
            h.h1(
              [],
              [
                model.concept && !/(?:^|\/)(?:index|log)\.md$/.test(model.concept.path)
                  ? `Connections around ${model.concept.title}`
                  : "Bundle graph",
              ],
            ),
            button("Read selected concept", { _tag: "View", view: "wiki" }),
          ],
        ),
        h.div(
          [h.Class("graph-controls")],
          [
            input(
              "Node limit, up to 250",
              String(model.graphLimit),
              (value) => ({ _tag: "GraphLimit", value }),
              [h.Type("number"), h.Min("1"), h.Max("250")],
            ),
            input(
              "Link depth",
              String(model.graphDepth),
              (value) => ({ _tag: "GraphDepth", value }),
              [h.Type("number"), h.Min("0"), h.Max("3")],
            ),
            button("Zoom in", { _tag: "Zoom", value: 1.25 }),
            button("Zoom out", { _tag: "Zoom", value: 0.8 }),
            button("←", { _tag: "Pan", x: 80, y: 0 }),
            button("→", { _tag: "Pan", x: -80, y: 0 }),
            button("↑", { _tag: "Pan", x: 0, y: 60 }),
            button("↓", { _tag: "Pan", x: 0, y: -60 }),
            button("Reset view", { _tag: "ResetGraph" }),
          ],
        ),
        h.p(
          [h.Class("muted")],
          [
            "Choose a node to read it. Focus the graph and use arrow keys to pan, + and - to zoom. Every node is also listed below.",
          ],
        ),
        error("graph"),
        busy("graph") ? h.p([h.Role("status")], ["Loading connections…"]) : null,
        data && !data.nodes.length
          ? h.p([], ["No concepts in this graph. Add a concept in the wiki view."])
          : null,
        data
          ? h.div(
              [],
              [
                h.p(
                  [h.Class("muted")],
                  [
                    `${data.nodes.length} nodes · ${data.edges.length} links${data.truncated ? " · bounded view, raise the limit or choose a closer neighborhood" : ""}`,
                  ],
                ),
                h.svg(
                  [
                    h.Class("graph-canvas"),
                    h.ViewBox("0 0 1000 640"),
                    h.Role("img"),
                    h.Tabindex(0),
                    h.Attribute(
                      "aria-label",
                      "Concept graph. Arrow keys pan and plus or minus zoom.",
                    ),
                    h.OnKeyDown((key) =>
                      key === "+" || key === "="
                        ? { _tag: "Zoom", value: 1.25 }
                        : key === "-"
                          ? { _tag: "Zoom", value: 0.8 }
                          : key === "ArrowLeft"
                            ? { _tag: "Pan", x: 80, y: 0 }
                            : key === "ArrowRight"
                              ? { _tag: "Pan", x: -80, y: 0 }
                              : key === "ArrowUp"
                                ? { _tag: "Pan", x: 0, y: 60 }
                                : key === "ArrowDown"
                                  ? { _tag: "Pan", x: 0, y: -60 }
                                  : { _tag: "Noop" },
                    ),
                  ],
                  [
                    h.g(
                      [
                        attr(
                          "transform",
                          `translate(${model.panX} ${model.panY}) translate(500 320) scale(${model.zoom}) translate(-500 -320)`,
                        ),
                      ],
                      [
                        ...data.edges.flatMap((edge) => {
                          const from = positions.get(edge.from),
                            to = positions.get(edge.to);
                          return from && to
                            ? [
                                h.line(
                                  [
                                    attr("x1", from.x),
                                    attr("y1", from.y),
                                    attr("x2", to.x),
                                    attr("y2", to.y),
                                    h.Class("graph-edge"),
                                  ],
                                  [],
                                ),
                              ]
                            : [];
                        }),
                        ...nodes.map((node, index) => {
                          const pos = positions.get(`${node.bundle}:${node.path}`)!;
                          return h.g(
                            [
                              h.Class("graph-node"),
                              h.OnClick(open(node.bundle, node.path)),
                              h.Tabindex(0),
                              h.Role("button"),
                              h.Attribute("aria-label", `Read ${node.title}`),
                              h.OnKeyDown((key) =>
                                key === "Enter" || key === " "
                                  ? open(node.bundle, node.path)
                                  : { _tag: "Noop" },
                              ),
                            ],
                            [
                              h.circle(
                                [
                                  attr("cx", pos.x),
                                  attr("cy", pos.y),
                                  attr("r", index === 0 ? 11 : 7),
                                  h.Class(node.path === model.desiredPath ? "selected-node" : ""),
                                ],
                                [],
                              ),
                              h.title([], [node.title, "\n", node.path]),
                              ...(data.nodes.length < 35 || model.zoom > 1.3 || index < 8
                                ? [
                                    h.text(
                                      [
                                        attr("x", pos.x + 12),
                                        attr("y", pos.y + 5),
                                        h.Class("graph-label"),
                                      ],
                                      [
                                        node.title.length > 25
                                          ? `${node.title.slice(0, 24)}…`
                                          : node.title,
                                      ],
                                    ),
                                  ]
                                : []),
                            ],
                          );
                        }),
                      ],
                    ),
                  ],
                ),
                h.details(
                  [h.Open(true), h.Class("graph-list")],
                  [
                    h.summary([], ["Nodes as a list"]),
                    h.ul(
                      [],
                      data.nodes.map((node) =>
                        h.li(
                          [],
                          [
                            link(node),
                            h.small([h.Class("provenance")], [`${node.bundle} / ${node.path}`]),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
                data.edges.some((edge) => edge.broken || edge.external)
                  ? h.div(
                      [h.Class("connections")],
                      [
                        h.h2([], ["Unavailable and external links"]),
                        h.ul(
                          [],
                          data.edges
                            .filter((edge) => edge.broken || edge.external)
                            .map((edge) =>
                              h.li(
                                [h.Class(edge.broken ? "missing" : "")],
                                [
                                  `${edge.from} → ${edge.label || edge.to} · ${edge.broken ? "missing" : "external"} · ${edge.to}`,
                                ],
                              ),
                            ),
                        ),
                      ],
                    )
                  : null,
              ],
            )
          : null,
      ],
    );
  }
  function review() {
    const status = model.status,
      preview = model.gitPreview;
    return h.main(
      [h.Class("review-page")],
      [
        h.h1([], ["Review memory changes"]),
        h.p(
          [],
          [
            "Select the memory files to include, inspect their diff, then create a pull request. Your current checkout and unrelated changes stay in place.",
          ],
        ),
        error("status"),
        busy("status") ? h.p([h.Role("status")], ["Reading Git status…"]) : null,
        status
          ? h.p(
              [h.Class("provenance")],
              [
                `${status.root ?? source?.root ?? ""} · ${status.branch ?? "no branch"} · ${status.remote ?? "no remote"}`,
              ],
            )
          : null,
        status && !status.available
          ? h.p(
              [h.Class("notice")],
              [status.reason ?? "Git review is unavailable for this bundle."],
            )
          : null,
        status?.available
          ? h.div(
              [],
              [
                status.files.length
                  ? h.ul(
                      [h.Class("git-files")],
                      status.files.map((file) =>
                        h.li(
                          [],
                          [
                            h.label(
                              [h.Class("check")],
                              [
                                h.input([
                                  h.Type("checkbox"),
                                  h.Checked(model.selectedPaths.includes(file.path)),
                                  h.OnChange(() => ({ _tag: "SelectPath", path: file.path })),
                                ]),
                                h.span([h.Class("provenance")], [file.path]),
                                h.small([], [file.status]),
                              ],
                            ),
                          ],
                        ),
                      ),
                    )
                  : h.p(
                      [],
                      ["No changed memory files. Save an edit in the wiki to start a review."],
                    ),
                input(
                  "Base branch, optional",
                  model.base,
                  (value) => ({ _tag: "ReviewField", field: "base", value }),
                  [h.Placeholder("Repository default branch")],
                ),
                button(
                  busy("preview") ? "Preparing diff…" : "Preview selected changes",
                  { _tag: "GitPreview" },
                  !model.selectedPaths.length || busy("preview"),
                  "primary",
                ),
              ],
            )
          : null,
        error("preview"),
        preview
          ? h.div(
              [h.Class("submission")],
              [
                h.p(
                  [],
                  [
                    `${preview.paths.length} selected files to ${preview.repository}, base branch ${preview.baseRef}. Submission branch: ${preview.branch}.`,
                  ],
                ),
                h.p([h.Class("provenance")], [`Base commit: ${preview.base}`]),
                h.small(
                  [h.Class("muted")],
                  [
                    `Preview expires ${new Date(preview.expiresAt).toLocaleString()}. Refresh the preview if files change.`,
                  ],
                ),
                preview.warnings.length
                  ? h.ul(
                      [h.Class("diagnostics")],
                      preview.warnings.map((warning) => h.li([], [warning])),
                    )
                  : null,
                h.pre(
                  [h.Class("git-diff")],
                  [preview.diff || "No diff for these paths against this base."],
                ),
                input(
                  "Pull request title",
                  model.title,
                  (value) => ({ _tag: "ReviewField", field: "title", value }),
                  [h.Required(true)],
                ),
                h.label(
                  [h.Class("field")],
                  [
                    h.span([], ["Pull request description, optional"]),
                    h.textarea([
                      h.Value(model.body),
                      h.OnInput((value) => ({ _tag: "ReviewField", field: "body", value })),
                    ]),
                  ],
                ),
                h.p(
                  [h.Class("muted")],
                  [
                    "Creating the pull request commits and pushes only this previewed selection. It does not merge the pull request.",
                  ],
                ),
                error("pr"),
                model.errors.pr
                  ? h.div(
                      [h.Class("notice")],
                      [
                        h.p(
                          [],
                          [
                            "The preview and your edits are kept. Retry the same submission after fixing the reported problem. If gh is unavailable, install GitHub CLI and run gh auth login in your terminal, then retry.",
                          ],
                        ),
                        h.p(
                          [],
                          [
                            "You can also commit these memory files and submit them through your usual Git workflow.",
                          ],
                        ),
                      ],
                    )
                  : null,
                model.pr
                  ? h.p(
                      [h.Class("notice")],
                      [
                        h.a(
                          [h.Href(model.pr.url), h.Target("_blank"), h.Rel("noopener noreferrer")],
                          ["Open pull request"],
                        ),
                        h.small([], [` · ${model.pr.branch}`]),
                      ],
                    )
                  : button(
                      busy("pr")
                        ? "Creating pull request…"
                        : model.errors.pr
                          ? "Retry pull request"
                          : "Create pull request",
                      { _tag: "Publish" },
                      busy("pr") || !model.title.trim() || !preview.diff,
                      "primary",
                    ),
              ],
            )
          : null,
      ],
    );
  }
  return h.div(
    [h.Class("app")],
    [
      h.header(
        [h.Class("app-header")],
        [
          h.a(
            [
              h.Class("brand"),
              h.Href("/wiki"),
              h.OnClick({ _tag: "View", view: "wiki" }, { defaultAction: "Prevent" }),
            ],
            ["OKF memory"],
          ),
          h.nav(
            [h.Attribute("aria-label", "Views")],
            [
              button(
                "Wiki",
                { _tag: "View", view: "wiki" },
                false,
                model.view === "wiki" ? "active" : "",
              ),
              button(
                "Graph",
                { _tag: "View", view: "graph" },
                false,
                model.view === "graph" ? "active" : "",
              ),
              button(
                "Review changes",
                { _tag: "View", view: "review" },
                !model.bundle,
                model.view === "review" ? "active" : "",
              ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class("scope-bar")],
        [
          h.label(
            [h.Class("source-select")],
            [
              h.span([], ["Source bundle"]),
              h.select(
                [
                  h.Value(model.bundle),
                  h.OnChange((bundle) => ({ _tag: "Scope", bundle })),
                  h.Disabled(!model.context?.bundles.length),
                ],
                model.context?.bundles.map((bundle) =>
                  h.option(
                    [h.Value(bundle.name), h.Selected(bundle.name === model.bundle)],
                    [`${bundle.name} · ${bundle.kind}${bundle.writable ? "" : " · read only"}`],
                  ),
                ) ?? [],
              ),
            ],
          ),
          h.div(
            [h.Class("scope-detail")],
            [
              h.span(
                [],
                [
                  source?.kind === "personal"
                    ? "Personal memory"
                    : source?.kind === "repository"
                      ? "Repository memory"
                      : "Explicit bundle",
                ],
              ),
              h.small([h.Class("provenance")], [source?.root ?? "No source selected"]),
            ],
          ),
          button("Refresh", { _tag: "Refresh" }, model.busy.length > 0),
        ],
      ),
      h.form(
        [h.Class("search-bar"), h.OnSubmit({ _tag: "Search" })],
        [
          h.label(
            [h.Class("search-field")],
            [
              h.span([h.Class("sr-only")], ["Search selected source"]),
              h.input([
                h.Type("search"),
                h.Value(model.query),
                h.OnInput((value) => ({ _tag: "Query", value })),
                h.Placeholder("Search this source by title, tag, path, or words…"),
              ]),
            ],
          ),
          h.button([h.Type("submit"), h.Disabled(!model.bundle || busy("search"))], ["Search"]),
          button("Check bundle", { _tag: "Validate" }, !model.bundle || busy("validation")),
        ],
      ),
      notices,
      model.validation
        ? h.details(
            [h.Open(true), h.Class("validation")],
            [
              h.summary(
                [],
                [
                  `Checked ${model.validation.files} files · ${model.validation.errors} errors · ${model.validation.warnings} warnings`,
                ],
              ),
              h.ul(
                [],
                model.validation.diagnostics.map((item) =>
                  h.li([], [`${item.path}: ${item.message}`]),
                ),
              ),
            ],
          )
        : null,
      error("validation"),
      model.view === "graph" ? graph() : model.view === "review" ? review() : wiki(),
      model.pendingIntent
        ? h.div(
            [h.Class("modal-backdrop")],
            [
              h.div(
                [
                  h.Class("modal"),
                  h.OnKeyDown((key) => (key === "Escape" ? { _tag: "Stay" } : { _tag: "Noop" })),
                  h.Role("dialog"),
                  h.Attribute("aria-modal", "true"),
                  h.Attribute("aria-labelledby", "unsaved-title"),
                ],
                [
                  h.h2([h.Id("unsaved-title")], ["Keep your unsaved draft?"]),
                  h.p(
                    [],
                    [
                      "Leaving this document will discard the draft. Copy it first if you want to keep a separate copy.",
                    ],
                  ),
                  h.div(
                    [h.Class("actions")],
                    [
                      button("Keep editing", { _tag: "Stay" }, false, "primary"),
                      button("Copy draft", { _tag: "Copy" }),
                      button("Discard and continue", { _tag: "Discard" }, false, "danger"),
                    ],
                  ),
                ],
              ),
            ],
          )
        : null,
      h.footer([], ["Local files remain the source of truth. No external content is fetched."]),
    ],
  );
}
