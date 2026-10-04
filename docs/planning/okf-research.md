# OKF research for runtime planning

Research accessed 2026-10-04. GitHub material was read through `gh` CLI. Repository links below pin the inspected commits where possible, so later changes to `main` do not silently change the evidence.

## Findings that affect the product boundary

OKF v0.2 is a file interchange format. It deliberately leaves storage, serving, search, and query infrastructure to consumers. A bundle is an independently portable directory of Markdown concepts, and a concept's identity is its path within that bundle with `.md` removed. Nothing in v0.2 defines how an application discovers several bundles, merges their content, or decides which bundle applies to a task. Those are runtime decisions.

For this product, the useful boundary is therefore: keep every bundle intact and identify the source bundle on every search result, read, edit, and provenance display. An invocation in repository A can compose the personal bundle with A's bundle; an invocation in B can compose personal with B. Search and graph traversal must stay within the selected set. Do not crawl sibling repositories or combine their documents just because they share a machine. Existing OKF links resolve inside their own bundle; cross-bundle links are unnecessary for this initial runtime.

Rules fit the existing concept model without an OKF-specific rule taxonomy. A user can write `type: Rule`, or any other descriptive type, and use ordinary paths, tags, body links, and optional producer-defined metadata. The core must not impose a priority field, precedence order, or rule vocabulary. The format permits custom fields and unknown type values, and a user's rules remain ordinary readable Markdown even without the CLI. Agent Skills can provide task procedures and teach an agent how to query this store; they complement durable bundle content rather than replacing it.

## v0.2 conformance checklist

Use this as the strict format validator boundary. The words in parentheses distinguish the spec's actual conformance rules from its recommendations.

- A bundle is a directory tree. It can be a Git repository, archive, or subdirectory of a larger repository. The filesystem is enough to consume it.
- Every `.md` file except reserved `index.md` and `log.md` files is a concept. Each concept must start with parseable YAML frontmatter and have a non-empty `type` field. `type` is the only always-required concept key. A concept with only `type` is conformant.
- `index.md` and `log.md` are reserved at every directory level and cannot be concept documents. An index may be absent. When present, it is Markdown organized under headings; entries should link to concepts or subdirectories and should include concept descriptions. A consumer may synthesize an index.
- Index files have no frontmatter except the bundle-root `index.md`, which may declare `okf_version: "0.2"`. The current text does not permit other index frontmatter keys. A root bundle descriptor is an upstream proposal, not v0.2 behavior.
- A log may be absent. When present, it is a Markdown list of date-grouped entries, newest first, with ISO `YYYY-MM-DD` headings. The bold event label is a convention, not a requirement.
- `title`, `description`, `resource`, and `tags` are recommended and optional. Body sections are free-form; there are no required headings. `Schema`, `Examples`, and `Computation` have conventional meaning when applicable.
- Type values are unregistered. Consumers must tolerate an unknown type as a generic concept. Producers may add any frontmatter key; consumers should preserve unknown keys when round-tripping and must not reject unknown fields.
- Concept links are standard Markdown links. A link target can be bundle-root-relative using a leading `/` (recommended) or an ordinary relative path. A link asserts a relationship, but the relationship kind is in surrounding prose. Broken targets are permitted and consumers must tolerate them. The spec does not define extra identity or traversal semantics for URL fragments/anchors.
- Path-valued resource fields accept absolute URLs, leading-slash bundle-relative paths, or relative paths. `sources[].resource` can also be a descriptive scope instead of a resolvable path. `references/` is a convention, not a required directory.
- Provenance (`sources`), trust (`generated`, `verified`), lifecycle (`status`, `stale_after`), and attested-computation fields are optional families. If used, producers should follow their field rules. Missing optional families never make a concept invalid. Consumers must treat a bare `verified: {by, at}` mapping as a one-item list. Trust tiers are advisory; `verified` is not access control. Missing `status` means `stable`. A concept is stale at or after `stale_after`.
- Timestamp-valued OKF fields use ISO 8601 datetimes with an explicit UTC offset. Actor identifiers use `<producer>/<version>`, `human:<id>`, or `process:<id>`; consumers use `human:` when deriving the human-reviewed tier.
- `Attested Computation` is the one specialized built-in type described in v0.2. It requires `runtime`; its execution/receipt/verdict protocol and runtime artifacts are not fully standardized. Do not treat it as a general rule mechanism.
- Conformance does not require optional metadata, a known type, valid links, or an index. Consumer guidance says to treat other constraints as soft guidance and not reject a bundle for these omissions.

For implementation planning, distinguish a spec conformance validator from optional quality checks. Broken-link reports, orphan detection, index drift, duplicate tags, preferred types, required descriptions, custom profile lint, and an application's own rule authoring guidance may be useful warnings, but they are not OKF conformance failures.

## Discovery and multi-bundle proposals

Google's current `knowledge-catalog/okf/SPEC.md` says that a root index may carry only `okf_version` frontmatter. The open [#302 proposal](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/302) identifies the missing first hop when a runtime mounts several bundles and proposes optional bundle-level `title` and `description`, exposed before reading root-index bodies or concepts. It leaves bundle IDs and revision pins to consumers, and permits either root-index frontmatter or a sidecar as possible storage. At the accessed date, #302 was open and had no comments. This is a proposal, not a spec requirement.

Related discussions also remain proposals:

- [#96, orientation hints](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/96) proposes optional `purpose`, `task`, and `audience`. Its [multi-bundle comment](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/96#issuecomment-5312950092) makes the bundle-level discovery concern explicit. [PR #189](https://github.com/GoogleCloudPlatform/knowledge-catalog/pull/189) would add those hints as optional concept fields, but was still open and unmerged. Do not present them as adopted spec fields.
- [#212, `okf_profile`](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/212) proposes an optional domain-profile declaration and asks whether root-index producer keys are legal. Its practical motivation is producer-side lint and domain conventions without making consumer rejection rules or a central type registry.
- [#214, collection metadata](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/214) reports a deployment of roughly 36 bundles and 4,370 concepts where source repository/revision and collection license do not fit naturally on every concept. It proposes a sidecar with bundle defaults, but explicitly describes that as a prototype and asks where such metadata should live.

These threads are useful evidence that runtimes and producers want bundle-level descriptions, profile declarations, and collection provenance. They do not establish a settled format. Keep runtime bundle references, selected scope, and source revision outside OKF until the spec changes. Never silently put consumer-defined frontmatter onto `index.md` and call it conformant.

## Existing implementations and use cases

### Google's sample bundles

The official [knowledge-catalog samples](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/58e16bdb7a34430f055ea57e84655cff37000c03/okf/bundles) include GA4, Stack Overflow, Bitcoin, and Acme Retail. These are publisher examples, not evidence of unrelated production use. They demonstrate nested indexes and small concepts for tables, metrics, joins, policies, and computations. The Acme Retail sample links a `Revenue` concept to a finance policy and an attested computation, records `sources`, `generated`, `verified`, and `stale_after`, and explains the constrained calculation in Markdown. Its root index is a plain Markdown directory map. Google's repository also includes generated `viz.html` files, which show that a graph can be an output view rather than bundle storage.

Practical lesson: first-hop indexes work for browsing within a selected bundle; they cannot identify which one of several mounted bundles matters. Search results and a graph view can make links useful, but the HTML visualizer is generated tooling and not part of OKF.

### `serradura/okf`

The [serradura/okf repository](https://github.com/serradura/okf/tree/cfb7ffac7fef37d56e97b5b7dd8fe97ffc648c7c) is an independent implementation that documents its own ecosystem in `.okf`. It has a Ruby library/CLI, lexical search, validation and lint, an interactive graph, TUI, MCP tools, and an Agent Skill. Its README describes repository-local Markdown, PR review, search/index progressive disclosure, CI checks, and multiple bundles registered for named lookup. The live graph is at [demo.okfgem.com](https://demo.okfgem.com), but its implementation and license are Apache-2.0; study behavior, do not copy code or spec text into an MIT implementation.

Useful product observations: an index and a search command offer different ways to navigate; validation can remain a deterministic local command; an Agent Skill can teach curation while the content stays plain files. Its bundle registry is application-level machinery, not OKF. The project's own comparison also distinguishes durable curated team knowledge from standing instructions and an agent's private automatic memory.

### `jkroepke/okf-crossplane-v2`

The [Crossplane v2 catalog](https://github.com/jkroepke/okf-crossplane-v2/tree/15c708624a0a017be48a80ca690c76f3adac2fd5) is an independent technical documentation corpus. It groups concepts about APIs, providers, security, testing, and examples. Its README describes concept pages with source provenance and keyed citations, version-pinned sources, a starter route through several related documents, incremental contribution, a companion skill, MCP queries, and an optional self-hosted service. The catalog's purpose is to connect Go APIs, CRDs, tests, examples, docs, and real repositories without replacing them.

Practical lesson: searchable concepts need provenance readers can follow back to actual code and docs; a curated route can guide a task while preserving separate concepts. The hosted MCP is an optional deployment choice with availability and access-control caveats, not part of the format. This is a useful docs-catalog example, though its app server relies on an external ingestion package and DuckDB.

### `zosmaai/pi-llm-wiki`

The [pi-llm-wiki repository](https://github.com/zosmaai/pi-llm-wiki/tree/9bb4daa4105f0f58b23c5957671437160acda9c6) is an MIT-licensed Obsidian-compatible knowledge/wiki app with native OKF v0.2 support. It accepts existing vaults without automatic migration, generates deterministic indexes and logs, supports full-text search and linting, and exposes the same knowledge model through native agent tools and MCP. Its README describes a personal fallback vault plus a project vault and searches both for recall.

Practical lesson: an editable wiki UI can maintain the files as authority while producing indexes and search metadata. The personal-plus-project recall model demonstrates the exact useful pairing, but its always-on personal fallback can also expose personal results in projects that did not explicitly select that bundle. For irudd-okf, show selected bundle names and scope with every result and do not infer sibling or unrelated project bundles.

## Implications for irudd-okf planning

- Store user and repository knowledge as ordinary OKF files that remain readable and editable with an editor and Git. A local graph/wiki editor can be a view over those files, not a required service or proprietary storage layer.
- Make the active bundle set visible. Include a bundle label, bundle root, concept path, and repository revision or working-tree state in results and provenance views. Filesystem path alone is insufficient when `preferences.md` exists in both personal and project bundles.
- Keep each search, link traversal, and UI view constrained to the selected bundles. Personal plus current repository is a product selection rule, not an OKF rule. Do not merge bundle files or cross-link them by global path.
- Let users author thousands of concepts and rule-like concepts with existing free-string `type`, tags, indexes, and normal Markdown links. The app may offer search filters or user-defined conventions as optional affordances. It must not require priority metadata or assign rule precedence.
- Preserve arbitrary YAML values and unknown keys on read/edit/round-trip. Keep a faithful Markdown export so content remains useful when the runtime is absent.
- Separate strict v0.2 format conformance from opt-in authoring lint and app-specific help. This keeps bundles interoperable while still allowing local conventions and skills to guide authoring.
- Treat native Skills as instructions about when and how an agent uses a bundle. Keep durable facts and user-authored rules in OKF concepts. A skill can refer to CLI operations without making the files dependent on that CLI.

## Sources and inspected versions

All repository and issue content below was inspected on 2026-10-04 using `gh` CLI. `main` was resolved to the commit shown in the citation.

| Source | Inspected version | What it supports |
| --- | --- | --- |
| [GoogleCloudPlatform/knowledge-catalog `okf/SPEC.md`](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/58e16bdb7a34430f055ea57e84655cff37000c03/okf/SPEC.md) | v0.2, commit `58e16bdb7a34430f055ea57e84655cff37000c03` | Conformance, fields, reserved files, links, trust/lifecycle, indexes, versioning |
| [GoogleCloudPlatform/open-knowledge-format](https://github.com/GoogleCloudPlatform/open-knowledge-format/tree/ad30107c31c06aec8a7d5636e0d1058118604e6f) | commit `ad30107c31c06aec8a7d5636e0d1058118604e6f` | Official introduction and format goals |
| [knowledge-catalog issue #302](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/302) | opened 2026-08-17; open, no comments at access | Bundle descriptor proposal and pre-load discovery concern |
| [knowledge-catalog issue #96](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/96) and [PR #189](https://github.com/GoogleCloudPlatform/knowledge-catalog/pull/189) | #96 open; #189 open/unmerged at access | Optional orientation-hint proposal and multi-bundle comment |
| [knowledge-catalog issue #212](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/212) | open at access | Optional profile proposal; root-index metadata ambiguity |
| [knowledge-catalog issue #214](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/214) | open at access | Collection-level provenance/licensing needs and sidecar prototype |
| [knowledge-catalog sample bundles](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/58e16bdb7a34430f055ea57e84655cff37000c03/okf/bundles) | commit `58e16bdb7a34430f055ea57e84655cff37000c03` | GA4, Stack Overflow, Bitcoin, Acme Retail sample content and generated views |
| [serradura/okf](https://github.com/serradura/okf/tree/cfb7ffac7fef37d56e97b5b7dd8fe97ffc648c7c) | commit `cfb7ffac7fef37d56e97b5b7dd8fe97ffc648c7c` | Independent CLI, search, lint, graph/TUI, MCP, Skill and self-documenting bundle |
| [jkroepke/okf-crossplane-v2](https://github.com/jkroepke/okf-crossplane-v2/tree/15c708624a0a017be48a80ca690c76f3adac2fd5) | commit `15c708624a0a017be48a80ca690c76f3adac2fd5` | Version-aware technical documentation catalog, routes, citations, MCP/Skill |
| [zosmaai/pi-llm-wiki](https://github.com/zosmaai/pi-llm-wiki/tree/9bb4daa4105f0f58b23c5957671437160acda9c6) | commit `9bb4daa4105f0f58b23c5957671437160acda9c6` | Wiki editor workflows, generated indexes, search/lint and personal/project recall |

The source repositories `open-knowledge-format`, `knowledge-catalog`, and `serradura/okf` report Apache-2.0. `pi-llm-wiki` reports MIT. `okf-crossplane-v2` reports Apache-2.0. This research uses source descriptions and file examples as evidence; it does not copy implementation code.
