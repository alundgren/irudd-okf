# irudd-okf product plan

Agreed scope, 2026-10-04. This is an implementation plan for a complete local product. The application and agent benchmarks have not been implemented or run. Research and isolated stack probes support the recommendations below.

## What we are trying to learn

Can a repository accumulate thousands of small rules, facts, preferences, and lessons without forcing agents to read them all or causing relevant guidance to disappear from their work?

The product provides portable files, scoped retrieval, agent instructions, and a human editor. It does not assign rule importance, dictate instruction precedence, or promise that search makes every rule discoverable. Usage examples earn recommendations through experiments. Native skills continue to handle procedures and can point to the knowledge store.

The complete product is a Linux/macOS CLI distributed as a standalone executable, an agent skill with a file-only fallback, opt-in composition of personal and repository bundles, and an optional local wiki/graph editor with GitHub PR submission. OKF files and Git remain the source of truth. An agent needs neither a running server nor the CLI to use them.

## The everyday experience

An operator tells an agent, "That test left files behind again. Add a rule to clean up test artifacts." A short instruction in the applicable `AGENTS.md` explains the repository's chosen rule convention and where its OKF usage guide lives. The agent searches existing concepts, edits an existing rule or creates a small new concept, and includes the change in the normal repository diff. It can use `rg`, `cat`, and its editor, or use the optional CLI for discovery, search, and validation.

On a future test task, the agent follows the usage guide to retrieve applicable knowledge. A person can start `irudd-okf serve`, search or browse the wiki, inspect a selected concept's connections in the graph, edit its Markdown, review a diff, and save it. If the bundle is in a GitHub repository, they can submit selected memory edits as a PR. Personal memory is visible only when explicitly configured; changing it requires an explicit operator request or a human edit.

One installation works in different repositories. In A it can expose `me + A`; in B, `me + B`. It never finds repository C by scanning neighboring folders. This is selection of retrieval sources, not an operating-system sandbox for the agent.

## Decisions and remaining experiments

| Decision | Recommendation | Evidence or next test |
| --- | --- | --- |
| Storage | Independently implemented OKF v0.2 files; runtime configuration outside bundles | [Official specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/58e16bdb7a34430f055ea57e84655cff37000c03/okf/SPEC.md) |
| Multi-bundle support | Opt-in named mounts with source labels; no physical merge | [Upstream #302](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/302) is an open proposal; related runtimes demonstrate composition |
| Search | Deterministic metadata/body lexical retrieval first; benchmark weighted search and BM25 | No evidence yet that this retrieves thousands of rules reliably |
| Rule conventions | Optional examples authored as ordinary concepts; no compulsory taxonomy, priority, or precedence fields | User agreement; compare examples in controlled experiments |
| Agent entry point | One small instruction plus a skill; files remain independently usable | Compare with nested instructions and native-skill trigger catalogs |
| UI | Foldkit 0.165.0 and Effect 4.0.0, two focused views | Published peer dependencies match; isolated browser/build probe recorded separately |
| Distribution | Vite+ 1.0 packaging using Node SEA; own installer and release matrix | [Vite+ pack](https://viteplus.dev/guide/pack), [tsdown executable support](https://tsdown.dev/options/exe); experimental, release validation required |
| PR submission | Use installed `git` and `gh`; isolate selected memory edits | User action authorizes one previewed commit and PR; preserve unrelated work |

Research notes are `okf-research.md`, `stack-research.md`, and `experiment-protocol.md`. They distinguish observed facts from proposed designs and include source/version pins.

## Architecture

Use one small workspace, with modules grouped by responsibility rather than an interface for every function.

| Package or directory | Owns | Does not own |
| --- | --- | --- |
| `packages/core` | File parsing/round trips, bundle references, indexes/links, discovery, search, validation and edit operations | Agent policy, process entry points, UI or GitHub authentication |
| `packages/cli` | Effect CLI commands, command catalog, local HTTP service, asset loading, Git/gh process calls, installation integration | A second parser or search implementation |
| `packages/web` | Foldkit model/update/view, search/wiki/graph/edit/review flows | Filesystem access, Git credentials or independent business rules |
| `skills/okf` | Portable usage instructions and references, CLI discovery, file fallback, curation examples | An agent-specific memory service or mandatory rule hierarchy |
| `examples` | Ordinary bundles and optional tested usage conventions | Product-enforced precedence or test answer keys |
| `benchmarks` | Frozen corpus/task manifests, adapters, observations, hidden checks and analysis | Production retrieval defaults selected from held-out test results |

Core operations use Effect 4 for I/O, services, typed errors, cancellation and scoped resources. Pure parsing/ranking helpers stay ordinary TypeScript functions. Effect Schema validates runtime configuration and public request/results. CLI parsing comes from `effect/cli`, HTTP from `effect/http` and `effect/http-api`, processes from `effect/process`, and Node adapters from `@effect/platform-node`. Avoid pulling legacy Effect 3 packages into this stack. Browser adapters use `@effect/platform-browser@4.0.0`.

Use general-purpose permissively licensed YAML, Markdown and search libraries when they reduce work. Candidate libraries are `yaml`, `markdown-it` or `micromark`, and `minisearch`; audit licenses and actual bundle requirements before selection. No OKF library, parser, runtime, viewer or SDK dependency is allowed. Google and independent OKF implementations are behavioral references only. Do not vendor their code or specification text. Preserve this repository's MIT license and ship required third-party notices for generic libraries and the embedded Node runtime.

Keep public CLI/HTTP results versioned. A concept is identified by `{bundle, conceptPath}`; `conceptPath` follows OKF path identity rather than title. It includes a source file path and content hash. Two bundles can both contain `rules/test-artifacts.md` without collision. CLI IDs and mount names are consumer configuration, not new OKF metadata.

## Files, parsing and compatibility

Implement the actual spec, not the handoff's illustrative schema. `type` is the only always-required concept field. `index.md` and `log.md` are reserved at every level; indexes and logs may be absent. A root index may declare `okf_version`, but current v0.2 does not standardize the proposed multi-bundle descriptor. Unknown types and fields must remain usable. Broken links are tolerated by consumers and can produce optional quality warnings. Optional metadata families have their documented semantics; the specialized Attested Computation type needs separate conformance coverage.

Store the original Markdown and frontmatter document alongside parsed fields. Body-only edits preserve the frontmatter bytes. Metadata edits use a YAML document representation that preserves unknown keys and comments where possible. Saving a no-op must preserve bytes. Provide raw Markdown editing even when structured metadata cannot be displayed. Do not rewrite every concept because one field changed. Handle LF/CRLF, Unicode, empty descriptions, arbitrary nested producer metadata, aliases within resource limits, unsupported syntax and parse failures explicitly.

Resolve root-relative and ordinary relative links within their source bundle. External URLs remain external and are not fetched to construct the graph. Indexes are navigational documents, not concepts. Display unavailable link targets without dropping the source concept. Fragment handling is a viewer navigation feature rather than an invented identity rule. `verified` or trust metadata is information to display, not authority to execute instructions or code. The product does not execute attested computations, Markdown scripts, shell blocks, or YAML tags.

`validate` reports spec conformance separately from optional `lint` warnings such as broken links, stale lifecycle metadata, index drift or suspected duplicate titles. A broken link must not make the whole bundle invalid. Producer-defined fields are not rejected by an application schema. No custom rule profile is enabled implicitly.

## Bundle discovery and composition

Use JSON runtime configuration rather than executable TypeScript configuration. A global file at `~/.config/irudd-okf/config.json` stores explicitly registered bundles and selected defaults. Repository configuration at `.irudd-okf.json` describes repository-local mounts. Neither file is OKF bundle content. Declare a configuration version, reject invalid paths clearly, and document relative-path anchoring.

```json
{
  "version": 1,
  "bundles": [{ "name": "me", "path": "~/knowledge/me/.okf" }],
  "active": ["me"]
}
```

By default, a Git checkout contributes its root `.okf` if it exists. Explicit repository configuration can select additional bundles in a monorepo. Outside Git, an explicit `--bundle-path` or a `.okf` in the current folder works. Do not scan outside the current repository for other bundles. Registering a personal bundle is an opt-in operation; repository configuration must not silently enable personal mounts or read arbitrary outside directories. Explicit command arguments can mount another folder for that invocation.

`context` reports the effective roots, their configuration sources, selected aliases, Git root/branch if present, and missing mounts. An explicitly selected missing bundle fails instead of silently returning incomplete results. No bundle found is a clear empty state with initialization instructions. Name collisions are configuration errors, not precedence decisions.

Every command resolves its scope once. `search`, `read`, graph data and HTTP edits use that resolved scope. Disable a bundle before retrieval and it disappears from results and link traversal. A UI's toggles change its session only; persisting defaults is a separate configuration action. Re-resolve when switching repositories or starting a new invocation. A served session remains attached to the folders selected at startup. Runtime aliases do not make cross-bundle links part of portable OKF.

## Retrieval that earns its context

Start with ranked lexical results over title, description, tags, type, path and body. Search returns small metadata records with match reasons and optional short snippets, not entire concepts. `read` loads selected Markdown. Support exact/path/type/tag/bundle filters and stable pagination. A no-match result says so; it does not invent an answer. A future richer search method must preserve bundle provenance, filters and file-only usability.

Test metadata weighting, BM25 and `rg` on frozen relevance judgments before picking defaults. Any synonym map or expansion must be versioned and developed on training corpora. No embeddings, hosted model or vector database is required for the complete first product. Reconsider only after observed retrieval failures justify an optional experiment.

For a one-shot CLI, benchmark full scan and a disposable content-hash cache. Start with an in-memory index in the server and invalidate it on file changes; a local persisted index is a rebuildable optimization, never the knowledge store. Handle create, edit, delete, rename and changes made by agents/editors outside the UI. Do not return stale content after a confirmed save. A process or filesystem change must not silently broaden active scope.

Target a practical 10,000-concept corpus. Provisional implementation targets are warm search p95 under 250 ms, a fresh full scan/index under 2 s on a declared reference machine, and metadata result pages under 8 KiB for the default 10 results. These are engineering targets to measure, not established performance. Record startup time, memory and binary size too. Poor results lead to cache/index changes or narrower supported claims, not fabricated benchmark wins.

## CLI and command discovery

The full program name is `irudd-okf`. Keep the initial command vocabulary small even though command discovery is available.

| Command | Behavior |
| --- | --- |
| `init [path]` | Preview and create a minimal bundle; never replace existing files |
| `context` | Show active mounts, exact roots and how selection happened |
| `bundle list/add/remove` | Inspect or explicitly change runtime configuration; no bundle deletion |
| `index --bundle repo [path]` | Read an authored index or synthesize a bounded directory listing |
| `search "task or terms" --bundle repo --limit 10` | Return ranked metadata and source paths within selected bundles |
| `read --bundle repo rules/test-artifacts.md` | Return the selected concept, metadata and content hash |
| `validate` / `lint` | Report conformance errors separately from optional quality warnings |
| `serve` | Start a loopback-only editor and graph/wiki views; process ends on Ctrl-C |
| `git status/diff/pr` | Inspect changes and explicitly submit selected memory edits |
| `skill install --target PATH` | Preview and copy the bundled skill to an explicit location; no hidden user-instruction edits |
| `cli search "what I need to do"` | Search the local command catalog with bounded results |
| `schema search` or `schema git pr` | Describe command arguments, effects, result fields and examples as JSON |

Adopt Cloudflare's search/inspect/execute pattern, not its API generation machinery. Root and group help mention `cli search`; unknown commands suggest nearby commands. One command-definition registry supplies parsing metadata, help, search text and JSON schemas. For this command count, a small data registry is enough. Do not build an OpenAPI generator or thousands of aliases.

Machine results go to stdout, diagnostics and progress to stderr. Non-terminal output is compact JSON; provide explicit `--format json|text` without requiring it for agents. Raw Markdown uses an explicit raw output mode. Errors have stable codes and nonzero exits. Proposed exit categories are success 0, argument/config 2, conformance 3, edit conflict 4, external Git/gh failure 5. Schema output identifies local writes, remote writes and read-only commands. `--dry-run` is supported for configuration/init/skill/PR mutations. JSON schemas describe this CLI's actual inputs and outputs rather than copying Cloudflare API-request fields.

## Skill and file-only usage

Ship one `SKILL.md` with a short trigger description and progressively loaded references. Its entry instructions explain how to identify scope, search, read source concepts and record durable findings. It teaches `cli search` and `schema` so the agent need not ingest the complete command manual. It also explains how to follow indexes, use `rg` and edit Markdown when the CLI is absent. Native agent instruction precedence remains the host's behavior.

A draft repository entry can be as small as:

```markdown
Repository rules and lessons are OKF concepts in `.okf`.
Read `.okf/usage.md` for this repository's usage convention.
Use ordinary file tools or the optional `irudd-okf` CLI to find relevant entries.
When asked to add a rule, update an existing relevant concept or add a new one.
Include repository memory changes in the normal diff.
```

This is a test candidate, not a known successful recipe. A nested `packages/ui/AGENTS.md` can point to a narrower usage guide or an index using repository-relative paths. Keep the locator small. Do not list thousands of rule titles or native-skill triggers in the always-loaded instruction.

Example conventions to compare are task-driven search, searching before each kind of work, following a small index route, and path-specific nested locators. A repository-wins conflict convention is an optional authored example. Another example asks the operator when sources disagree. The skill must not install a hidden preference order. Personal writes require an explicit operator request; no inference about enduring personal preferences from a single repository incident.

## Wiki and graph

One locally served application has separate `/wiki` and `/graph` routes. Keep the primary jobs distinct. Wiki is for finding, reading and editing knowledge. Graph is for understanding links around a selected concept. Both use the same source data, selection model and editor, and can open the same concept in the other view.

Wiki opens with search and an authored index or bounded folder listing. Show title, bundle, source path and relevant backlinks with the concept. The edit flow offers raw Markdown, a preview, a diff, save and cancel. Create, rename and delete are supported. Metadata helpers are optional and preserve unknown YAML. Rename previews affected internal links; delete displays referring documents. Users choose whether to update links, since broken links are valid OKF. Do not hide invalid files; explain the parse issue and offer raw editing.

Graph opens with a selected concept and a bounded neighborhood. At 10,000 entries it does not render every node by default. Offer search, one/two-hop expansion, type/tag filters and a bounded whole-bundle overview. Edges represent actual Markdown links, with external and unavailable destinations distinguished. No inferred relationships, cross-bundle magic or semantic clustering is presented as fact. A list of linked concepts provides an alternative to visual navigation. Layout positions are disposable view state, not concept metadata.

Handle empty bundles, no results, long titles/paths, unavailable mounts, malformed frontmatter, permission-denied saves, external edits, unsaved navigation and server disconnection. Keep unsaved text available for copying/download when the server goes away. On a changed source hash, show an explicit conflict view with original/current/draft text. Never overwrite the new file automatically. Personal-bundle edits are deliberate human operations; the UI shows the destination before save.

Use the house warm-paper palette, readable text and plain controls. Navigation and bundle selection are visible; do not turn every datum into a card. The product UI contains no implementation jargon beyond useful source paths and Git states. Graph color is secondary to labels and symbols. Fonts are bundled with their license or use system fonts. No third-party CDN, theme switch or online account is needed.

## Safe local serving and edits

Bind only to loopback for this product. Generate a per-process capability for the local UI, keep it out of ordinary request logs, and verify Host/Origin and authenticated mutation requests. A loopback address alone does not stop another web page from sending a request. Protect mutations from cross-site requests and DNS rebinding. Do not enable permissive CORS or remote binding as a convenience flag in the initial release.

Serve bundled local assets with a restrictive content policy. Render Markdown as text/allowed markup with raw HTML disabled or sanitized. Do not load remote images automatically. Clicking external links is a deliberate navigation. Resolve source paths against mounted bundle roots; reject traversal, symlink escapes and files outside the selected roots. Use argument arrays for `git`/`gh`, never shell interpolation. File permissions and credentials stay server-side.

Edits carry an expected content hash. Re-check immediately before write, write to a temporary file in the same folder, flush as appropriate and atomically rename. Never silently erase unknown metadata or overwrite external edits. Test the concurrency behavior on supported filesystems; do not imply that a file rename alone is a transactional compare-and-swap against uncooperative external writers. Track recently written versions and surface detected races. Recovery copies remain available after uncertain outcomes.

The ordinary CLI runs without a daemon. `serve` owns its watcher, HTTP listener and index through an Effect scope. Shutdown closes them. A stale browser session cannot write after the server exits. The tool is a local memory editor, not an execution service for bundle code.

## Git and GitHub PR submission

Detect Git membership from the mounted bundle folder, including `.git` pointer files and worktrees. A bundle can be in a standalone memory repository. Git history/diff remains available without GitHub. Non-Git bundles can save files normally. GitHub support depends on installed `git`, installed `gh`, an authenticated account, a suitable remote and permission to create a branch/PR. Missing prerequisites produce setup instructions and preserve local edits. Do not embed a token or build a new OAuth account system.

Saving edits changes files only. Submitting a PR is a separate human action. Preview exact selected files/diff, source revision, target repository/base branch, title and description. No automatic push, merge or PR creation on save. Memory files from different Git repositories require separate PRs; a global selection cannot mix them into one commit.

Prepare submission in a temporary Git worktree/branch. Include only explicitly selected memory edits, including additions/deletions, and preserve the current worktree, branch, index and uncommitted code. Capture original blobs/content hashes and validate the selected patch against the chosen base. A clean memory-only repository is the first supported case. If existing uncommitted code or another branch's changes are needed to interpret the memory, offer adding the memory to that existing code PR or selecting a compatible branch. Do not quietly create a misleading memory-only PR against an unrelated base.

Use `git` for the selected commit/push and `gh pr create --body-file` for creation. Show the returned PR URL. Track a submission ID with repository/branch/base/commit/PR state locally so an uncertain response is reconciled by reads before retry. Keep prepared commits/branches after a failed push or PR creation; offer retry and cleanup. Do not erase recovery state on an authentication failure. No automatic merge, unrelated staging or force push.

## Standalone releases and installer

Build web assets with `vp build`, then package the CLI with `vp pack` and Node SEA assets. Vite+ 1.0 includes executable support, but it is experimental. Use a pinned Node 26 release in CI; the packaging docs require at least 25.7.0. A user's installed CLI requires no Node, npm, Bun or `vp`. Developers build from source with the documented Vite+ workflow.

Embed the generated viewer asset manifest and all JS/CSS/font assets; support the same asset provider during source development. Avoid runtime imports left outside the executable. Keep generic dependencies without native addons where practical. Test macOS arm64 and x64, and Linux glibc arm64 and x64 on native runners. Alpine/musl is not a silent part of the Linux support claim; add it only with its own tested artifact. Set and document minimum macOS/glibc versions based on actual release-runner validation. Cross-compilation alone does not validate execution or macOS signing.

Distribute archives, checksums, a release manifest and third-party notices through GitHub Releases. Sign release provenance/checksums where the selected release workflow supports verification. Validate macOS signing/notarization on real machines; ad-hoc signing is not equivalent to a notarized release. Include the embedded Node version in `--version`/doctor output and rebuild releases for runtime security updates.

The proposed installation endpoint is a future stable HTTPS URL under a controlled domain. Its exact hostname is an implementation/release decision; no live installer is claimed here:

```bash
curl -fsSL https://<owned-host>/irudd-okf/install.sh | bash
```

The installer detects OS/architecture and downloads the matching pinned version or latest release manifest, verifies the archive checksum, extracts into a private temporary directory and atomically installs into `~/.local/bin` by default. It needs no sudo and supports an explicit install directory and version. Support macOS's `shasum -a 256` and Linux's `sha256sum`; select archive members explicitly rather than trusting paths. Handle unsupported systems, offline download failure, checksum mismatch, existing binaries and paths with spaces. Print PATH guidance without editing shell startup files automatically. Provide an inspect/download-first alternative. Checksums obtained from the same release server detect corruption; independent authenticity requires verified signatures/attestations and their trust material.

Also publish an npm package as an optional route and document `vp build`/`vp pack` for source builds. Add `doctor`, explicit upgrade and uninstall commands only when the ownership of installed files is recorded. Uninstall removes the installed program/skill only when explicitly selected; never delete bundle files. Self-update is opt-in and atomic, with previous-version recovery. This product has no telemetry by default.

## Experiments and usage examples

The detailed controlled protocol is in `experiment-protocol.md`. It is a plan, not evidence that this system already works. Primary research on repository context and long-context behavior motivates the comparisons but does not prove an OKF advantage.

Run two separate studies. In the natural-corpus study, freeze real open-source repositories, preserve their facts, and faithfully transform guidance into each comparable representation. In the scale study, add the same audited rule set to every arm at 100, 1,000 and 10,000 rules, keeping the same relevant rules and tasks while increasing realistic distractors. A tiny renamed corpus and repeated filler do not demonstrate behavior at useful scale.

Compare original nested `AGENTS.md` with linked docs, native skills with descriptions/triggers in context, OKF through ordinary file tools, and OKF through CLI plus skill. A compact always-loaded reference can diagnose the ceiling where it fits; at larger sizes record overflow rather than silently truncating it. Keep task, code, relevant knowledge, agent model/effort, tool permissions, launch working directory and starting state paired. Codex discovers its startup instruction chain from repository root to launch directory; do not assume it injects nested files below that directory when editing. Record actual loaded instruction/skill tokens, cap-related omissions and later reads. Treat native host instruction-loading differences as measured behavior, not as interchangeable runtimes.

Use real code-change tasks as the primary outcome and answer-only retrieval tasks as a cheaper diagnostic. Write hidden task acceptance checks and relevant-rule judgments before transformation and execution. Some requirements need architectural/manual review because tests alone miss them. Score task correctness, relevant-rule coverage, unsupported claims, contradictions, source citations and inappropriate scope exposure. Count safe clarification and unnecessary clarification separately. In a task where all relevant guidance is already discoverable, equal accuracy with less context is useful; fewer tokens with missed rules is not a win.

Add held-out conflict trials comparing repository-wins and ask-the-operator usage guides, with identical facts. Label such conventions as examples, not product behavior. Add longitudinal capture/update trials for duplicates, contradictions, obsolete guidance and accumulation. Agent repository edits remain in diffs. Personal writes are tested as requiring explicit authorization. Do not mix mutable memory into the read-only retrieval experiment.

Record total input/output tokens, logical context introduced, cached/uncached billing tokens when exposed, peak context, tool calls, wall time, retrieval latency, clarification pauses and cost using recorded provider rates. Do not call cached tokens free context. Keep cold and warm-cache results separate. Fresh sessions and randomized arm order control contamination. Publish task/repo-level results, repetitions and paired uncertainty intervals rather than one aggregate win percentage. A model change is a new benchmark version.

Begin with a small pilot to check instrumentation and tasks. Choose sample size through pilot variance, then preregister the held-out confirmatory study. Measure paired changes within each OKF arm from 100 to 1,000 and 10,000 concepts with tasks and applicable rules fixed. This catches deterioration even when every competing method also deteriorates. Preregister quality margins and a bound on additional context caused by corpus growth. Relative comparisons against native methods answer a separate question. The initial hypothesis is stable task/rule accuracy with growth and bounded retrieval/context overhead, not a promise of zero loss. Report failures by rule/task category. An underpowered inconclusive result cannot be labeled “known to work.”

Publish successful examples with exact tested model/runtime, corpus size, task types, versions, uncertainty and failure cases. If the outcome is negative, ship the useful file/editor tools while accurately stating that scalable agent rule recall remains unproven, or revise the retrieval/usage example and rerun held-out tests.

## Implementation sequence

Each stage is independently reviewable. Run repository-standard validation for the changes, plus the specific checks below. Do not run the entire expensive agent matrix for every formatting change.

| Stage | Deliverable | Depends on | Completion evidence |
| --- | --- | --- | --- |
| 0. Freeze contracts and build assumptions | Spec/version references, public result/error contracts, config format, dependency/license decision, CI Node pin | This plan | Strict-vs-lint fixtures agreed; native packaging and Foldkit probes reproduced; install support matrix recorded |
| 1. Portable bundle core | Parser, original-text round trips, indexes, links, conformance/lint, content hashes | 0 | Fixtures cover reserved files, unknown types/metadata, broken links, Unicode, malformed files and optional metadata; no-op saves preserve bytes |
| 2. Scope and agent CLI | Context, explicit bundle configuration, index/read, command registry/search/schema, skill with file fallback | 1 | A/B repository isolation, missing-mount errors, duplicate paths, nested cwd and worktree discovery pass; CLI-free workflow demonstrated |
| 3. Search and scale instrumentation | Lexical/weighted/BM25 comparison, bounded results, disposable cache, pilot manifest tooling | 2 | Frozen relevance set; 10k performance measurements; invalidation tests; no whole corpus injected by default |
| 4. Local wiki editor | Effect HTTP contracts, embedded assets, Foldkit wiki/search/create/edit/rename/delete/diff | 2, 3 | Full edit/cancel/conflict/recovery flows; external file changes; loopback mutation protections; unchanged metadata preserved |
| 5. Graph view | Selected-concept graph, actual-link neighborhoods, filtering, keyboard/list alternatives | 4 | Broken/external links, 10k bounded view, cross-view concept navigation and no unrelated bundle results |
| 6. Git review and PR | Git status/history/diff, selected-patch worktree preparation, gh-backed submission/retry | 4 | Clean/non-Git/dirty/detached/worktree cases; unrelated staged/code changes unchanged; push/PR failure recovery and retry reconciliation |
| 7. Release and install | Four native artifacts, embedded UI, installer, notices, upgrade/uninstall ownership, npm option | 2, 4, 5, 6 | Native Linux/macOS install/search/serve/edit smoke tests without external JS runtime; checksum/offline/PATH tests; signing status documented |
| 8. Controlled benchmark pilot | Frozen candidates/tasks, faithful transformed corpora, adapters and observations | 2, 3 | No fact imbalance or gold-answer leakage; actual loaded-token accounting; hidden checks and blind rubric dry run |
| 9. Confirmatory studies | Growth, discovery/skill baselines, conflict and memory-maintenance results | 8 | Preregistered held-out analysis with per-task/repo uncertainty; no fabricated or cherry-picked claims |
| 10. Tested examples and complete release | Usage guides, short nested locators, practical tutorials, caveats, stable release docs | 7, 9 | Fresh operator/agent can install, author, retrieve, edit and review; each recommended recipe states tested scope and limitations |

Stages 4–7 can progress alongside experiment design after CLI contracts stabilize. If the experiments fail, preserve the negative result and revise examples rather than turning a product policy into a substitute for evidence.

## Agent implementation handoff

Start from this worktree and retain the README as historical handoff. The confirmed scope in this plan takes precedence over its earlier “tiny experiment only” scope. No GitHub writes, commits, PRs, application implementation or live benchmark runs were performed for this planning task. Future implementation should explicitly authorize its repository/PR targets and merge policy.

Before implementation, read the current approved Scope revision and its feedback decisions, this product plan, the three research notes and the experiment manifest. Revalidate pinned dependencies and the OKF spec before changing the compatibility target. Preserve user work. Implement stages as coherent changes and keep examples labeled candidate until they have evidence. Do not impose the hierarchy or precedence proposals rejected during grilling.

The important unresolved items are empirical discovery quality at 10k rules, how often agents retrieve before acting, conflict handling, memory capture quality, native platform release validation, release-domain/signing ownership and exact installer hostname. These are explicit work items with evidence requirements, not questions blocking this plan. Hosted companion apps, remote editing, sync, agent accounts, a compulsory daemon, embeddings and replacing native skills remain outside this product's first complete release.
