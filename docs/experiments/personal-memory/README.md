# Personal-memory delivery experiment

The operator approved a Codex GPT-6.1-Sol experiment at medium effort, a repeatable runner and a report in Scope. The question is whether agents find and correctly apply development memories with acceptable token use and elapsed time, including a corpus too large for practical instruction files. CLI use is diagnostic only.

This is a descriptive experiment with authored code fixtures and sanitized development rules. It does not establish effectiveness on real personal memories. Four tasks are repeated; 216 attempts do not mean 216 independent tasks. Human equivalence audits and semantic ratings remain pending.

Both schedules are complete: 216 primary attempts and 48 separate bounded attempts. See [results.md](results.md) for the findings and [report.html](report.html) for the interactive report. Regenerate the report from saved repository evidence without model calls:

```sh
node benchmarks/personal-report.mjs docs/experiments/personal-memory/evidence/primary /tmp/personal-memory-report.html docs/experiments/personal-memory/evidence/bounded
```

Published in Scope as **Personal memory retrieval experiment**, named `personal-memory-retrieval-20261004-1ad354e5`, ID `okf-personal-memory-20261004-1ad354e5`. The desktop returned revision 74 after adding the CLI setup instructions and the agreed plan for separate Codex and Claude toggles in Scope. Its content hash matches this report, and the hub queue is empty. See [current update evidence](evidence/scope-agent-setup-update.json), the [plain-language update](evidence/scope-eli5-update.json) and the [original publication receipt](evidence/scope-publication.json).

## Run and repeat

Use Node 26 and the repository dependencies. Installed, authenticated Codex and an installed `irudd-okf` executable are required. The native OKF skill comes from this checkout. No global skill installation or actual personal-bundle access is needed.

```sh
npm ci
npm run check
node benchmarks/personal.mjs --output /tmp/personal-memory-study --concurrency 2
node benchmarks/personal-bounded.mjs --output /tmp/personal-memory-bounded
node benchmarks/personal-report.mjs /tmp/personal-memory-study /tmp/personal-memory-report.html /tmp/personal-memory-bounded
irudd-scope add /tmp/personal-memory-report.html --title "Personal memory experiment"
```

The default schedule has nine methods, four tasks, corpus sizes 100 and 5000, and three repetitions. Relevant notes occupy the beginning, middle and end of the flattened corpus. Both scales and methods are shuffled within each task block using the recorded seed. Fixed task-relevant text is identical across corpus sizes and delivery methods.

Placement changes with repetition, so placement and run order are confounded. This schedule can show that a trial succeeded with an end-position note, but cannot estimate a separate causal placement effect.

Use `--dry-run` to freeze without inference. `--limit N` executes the next N planned cells. Repeat the exact original configuration with `--resume` to continue an unchanged study. A changed runner, skill, installed CLI, runtime version or configuration requires a new output directory. Failed cells are preserved and never silently retried. Interrupted cells are marked failed; resume checks ownership before removing their recorded temporary directories. If cleanup fails, the ledger retains the path and error.

`--methods`, `--tasks`, `--counts`, `--repeats`, `--seed`, `--timeout-ms`, `--sandbox` and `--concurrency` permit a separately frozen experiment. The study described here uses `workspace-write`, 180 seconds per trial and concurrency two. Timings therefore include shared service and host conditions. Single-session timing replication is available with concurrency one. This per-trial timeout censors long attempts; unavailable usage remains null.

## Methods

| Method | Delivery |
| --- | --- |
| `none` | No personal memory content or locator. |
| `oracle` | Applicable notes supplied directly in the task prompt. This is a diagnostic reference. |
| `flat` | All rules in global `AGENTS.md`. This tests full global injection, with no enforced truncation. |
| `global` | Short global instruction pointing to the personal bundle and root index. |
| `skill` | Unmodified installed native OKF skill, with the personal bundle registered in isolated configuration. No extra locator is added. |
| `symlink` | Repository instruction and `.okf/personal` symlink. Retrieval uses ordinary file tools. |
| `search` | Global locator with an explicit `rg` recipe. |
| `suggest` | Up to three paths suggested by the installed OKF search engine from visible task words. The agent must read and assess them. |
| `grouped` | Rules stored directly in eight native skills grouped by topic. |

The file engine rejects symlink roots and skips symlinked subdirectories. The symlink method does not claim CLI support. Its link and target contents are recorded independently. Ordinary search can traverse the explicit linked directory or use `rg -L`.

The configured `project_doc_max_bytes=32768` does not truncate global `AGENTS.md` in the tested Codex 0.160.0 runtime. A separate offline loopback request capture sent no credentials and performed no inference: its 1,321,562-byte request contained all 4,994 archive entries in the 5,000-concept corpus. The 100-concept rules occupy less than 32 KiB; 5,000 exceed 1 MiB. These sizes test practical instruction growth, not an enforced instruction cap. The frozen runner's `expected_flat_loaded_facts` field was calculated from an incorrect truncation assumption and must not be treated as observed context. Preserve it as historical instrumentation metadata. The live schedule was not changed after this finding.

Reproduce that runtime diagnostic without inference with `node benchmarks/personal-instruction-probe.mjs /tmp/new-instruction-capture.json`. It sends the first request to a rejecting loopback HTTP server, copies no authentication file, and retains only request metadata. Its expected runtime exit is nonzero. It does not measure the paid study's provider requests.

Repeat the probe when Codex changes. The recorded client finding applies to version 0.160.0. The independent bounded capture predates a failure-cleanup fix and records that wrapper's earlier source hash; its complete-rule cap is unchanged. All three live large bounded usage cells have the same instruction hashes as their corresponding offline captures.

The separately frozen bounded phase uses the same four tasks, two sizes and three placements for 48 attempts: capped global instructions and the unmodified global-locator reference. The reference was selected before the primary schedule completed. The cap includes common instructions and headers and retains only complete rules in original order, without selecting for relevance. It is an imposed budget, not Codex's native capacity limit. Never pool its results with the primary phase or compare timing across phases as a randomized treatment effect.

`personal-bounded.mjs` records the complete wrapper source hash and phase protocol digest bound to the core study freeze. Each capped cell retains actual instruction text, bytes, hash and retained titles in `bounded-instructions.stdout.txt`. The wrapper checks read-only instruction integrity before restoring the prepared file. The core `request.json` instruction hash describes preparation; use the capped sidecar for runtime input. The same `--dry-run` and `--resume` behavior applies. Changing its source requires a new study directory.

A small root `index.md` explains Markdown concepts, project scope, obsolete entries and replacement links. Topic indexes remain short. The bundle description helps after discovery; the locator or native skill must make that discovery happen first. No condition loads all rule titles into the root index.

## Tasks and scoring

- `usage` checks unavailable metrics, cached-input accounting, numeric validation and replacement of obsolete zero-default advice.
- `draft` checks exact optimistic versions, preservation of raw malformed documents and retained conflict drafts.
- `exports` checks resistance to personal defaults and obsolete advice when repository guidance sets the complete behavior. It does not demonstrate personal-memory retrieval.
- `pagination` checks avoidance of unrelated project advice. No personal rule applies.

The usage and draft rules adapt repository evidence in `.okf/experiments/evidence.md` and `.okf/gotchas/edits.md`. The function APIs, scope traps, obsolete entries and archive-project distractors are authored benchmark material. Five thousand documents are not five thousand audited real memories. Each large corpus adds unique project-scoped distractors while keeping the same applicable facts.

Hidden behavioral tests run outside the session directory against the resulting module. The application module is explicitly self-contained; tests may be added. Test modifications cannot change hidden grading. The grader uses a type-aware comparison, including array lengths, and checks missing-value `NaN` and sparse-array false positives. A passing result means passing these checks, not independent human certification or exhaustive correctness.

Every session has a fresh fixture, home, Codex home and explicitly scoped personal configuration. Auth is copied privately, removed in `finally`, and the owned directory is deleted after the trial. Apps, plugins, web search, hooks and delegation are disabled. Actual `skills/list` preflight verifies the selected native registry. System skills and household skills are excluded. The inventory is evidence of available skills, not a complete captured system prompt.

The OS sandbox is `workspace-write`; evaluator files remain outside the fixture and are never included in prompts. This is an exploratory local setup, not a security proof against a compromised runtime. Abrupt process termination can bypass cleanup until resume. Do not publish credential copies or inspect their values.

## Measurements and retained evidence

The runner reuses `benchmarks/lib.mjs` process execution and `benchmarks/metrics.mjs` runtime usage parsing. It records input, cached input, uncached input, output, total input plus output, wall seconds, code changes, hidden checks, available skills and observed memory commands. Totals include recurring cached context; they are not peak context or invoices.

Candidate-path search time is included in the suggestion method's elapsed time. Fixture preparation, registry preflight and hidden grading are experiment overhead. Failed attempts remain in correctness denominators but have no invented token total. Successful-only medians are separate from all completed-trial medians. Full request context, the actual injected instruction chain, a dated underlying model release and billed cost remain unavailable.

An exact full rule body observed in a completed command output is strong retrieval evidence. Its absence is inconclusive: a rule may have been supplied in startup instructions or returned through another representation. Source inspection commands, file enumeration and CLI invocation alone do not prove application. The code checks are the primary outcome.

Each output directory contains `freeze.json`, its digest, `results.json`, `summary.json` and per-cell requests, raw subprocess streams, runtime traces, registries, answers, candidate modules, patches, changed tests, process exits and grading results. The freeze includes runner and skill hashes, installed CLI bytes/version, runtime version, corpus configuration and the complete schedule. Report generation is separate and can run again without model calls.

The first live instrumentation preflight completed normally but was incorrectly classified because Codex added tests. Its unchanged historical record is retained separately and excluded from the main comparison. Later harness changes fixed that classification and grading defects before the main schedule was frozen.

## Prior work

Grepglint's `docs/agent-wording.md` records two failed calls in a 40-task treatment comparison, a later zero-call wording pair and one successful skill-driven search with correctness still ungraded. Its isolation and accounting informed this design; the current OKF subprocess and trace parser provide the shared implementation. The older OKF answer-only pilot also lacks human correctness ratings and is not merged with this study.

Google Cloud introduced OKF on June 12, 2026 as a portable Markdown format. Retrieval is a consumer choice. [Google announcement](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing).

[PrecisionMemBench](https://github.com/tenurehq/precisionmembench) includes an OKF consumer and useful scope, obsolete-memory and noise cases. It measures retrieval records, not final coding outcomes, and discloses adapter and provider changes. [ContextBench](https://arxiv.org/abs/2602.05892) measures coding-agent context acquisition and utilization. Neither establishes effectiveness for synced personal OKF development memories.

The independent proposal agent, given none of the operator's proposed treatments, suggested ordinary-search support, bundle root descriptions and optional task-triggered suggestions. Those ideas are represented here. No production sync changes or machine-wide instruction edits are part of this experiment.

See [research.md](research.md) for commit-pinned format and integration sources, [initial-trace-audit.md](initial-trace-audit.md) for the first-repetition code and retrieval audit, [usage-audit.md](usage-audit.md) for the completed usage-task audit, and [evidence/](evidence/) for the offline instruction-capture diagnostics. Human ratings remain unavailable; the trace audit is an independent agent audit.
