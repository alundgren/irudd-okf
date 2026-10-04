# Executable experiments

These commands implement the approved [protocol](../planning/experiment-protocol.md). They produce synthetic fixtures, raw run artifacts, hidden evaluator records, natural-corpus inventories and local retrieval timings. They do not establish that OKF improves agent performance.

Use the repository's pinned Node 26 and installed dependencies. The commands use Effect 4 for asynchronous operations. They require no additional root dependencies.

```bash
node --test benchmarks/test/*.test.mjs
node benchmarks/main.mjs generate --workspace /tmp/okf-fixtures --evaluator /tmp/okf-hidden --count 100
node benchmarks/main.mjs run --workspace /tmp/okf-fixtures --evaluator /tmp/okf-hidden --artifacts /tmp/okf-runs --arms nested,okf-path --tasks architecture,ux-gotcha
node benchmarks/main.mjs analyze --inputs /tmp/okf-runs/results.json --output /tmp/okf-summary.json
TMPDIR=/tmp/okf-loader node --import tsx benchmarks/engineering.ts /tmp/okf-engineering.json
```

Create the loader directory before the engineering command if the host's shared tsx cache is inaccessible. Every generated arm directory must be new. Use separate workspace and evaluator destinations for each scale. Generate 100, 1000 and 10000 with the same seed to keep the smaller canonical sets as exact subsets. The task prompts, relevant concepts and launch directory stay fixed. Additional concepts are unique, path-specific synthetic policies for directories created in the benchmark fork. Human review of all generated rules is pending, so this fixture is suitable for instrumentation and engineering checks only.

`--arms` accepts `nested`, `flat`, `skills`, `skills-grouped`, `okf-path`, `okf-retrieval` and `okf-cli`. Nested instructions link architecture, UX and other documents. Flat instructions retain all text and use the runtime's real 32768-byte project-instruction cap; their manifest records expected overflow, while actual truncation remains unavailable without full prompt capture. Native skill files expose descriptions and keep procedures in SKILL.md. One skill per rule is an upper-bound stress condition; category groups are the practical comparison. OKF uses plain indexes and concept files. The CLI variant adds a native workflow skill and requires a separately installed `irudd-okf` command. Every command names assigned bundles explicitly to exclude unrelated global configuration. If the executable is missing, the CLI treatment is unavailable. It must not silently become a file-only trial.

Freeze records contain canonical hashes, transformed text hashes, per-concept source maps, file hashes, explicit active scope assignments, pending equivalence review and seeded arm ordering. Exact text equality is automated; two-human semantic equivalence review remains pending. Synthetic source provenance points to the generator, not to an upstream OSS repository. No source-backed 10000-concept corpus is claimed.

Freeze version 2 hashes the exact augmented hidden tasks, including prompts, checks and applicable concept IDs, as both file bytes and parsed data. It also binds canonical data and every arm manifest by digest. `freeze.sha256` checks the freeze file itself. The runner verifies all evaluator digests and every selected arm's files before creating attempt artifacts or launching a model, then checks the fresh copy again. `generate` prints the freeze digest. Record that digest outside the mutable evaluator directory and pass `run --freeze-hash DIGEST` to pin it externally. The adjacent checksum alone detects edits to the freeze file but cannot authenticate a jointly replaced freeze and checksum. Checksums provide integrity checks, not signed provenance.

The tasks cover payment architecture, an accessibility gotcha, sibling package guidance, personal conflicts and explicit memory updates. `--personal` adds only an assigned preference directory. `--convention repo-wins` or `--convention ask-on-conflict` states an experimental usage convention in the task prompt. These conventions add no ranking fields or product conflict policy. Memory-update tasks use fresh mutable copies and preserve tracked diffs and newly created files.

The runner creates a fresh repository for each cell with one synthetic initial commit and no remote. It verifies frozen files before launch. Every arm launches at the same `packages/checkout` directory. Each Codex run has a new private CODEX_HOME, blank global AGENTS.md and an auth file copied only inside that temporary private directory, then deleted. User configuration and execpolicy rules are ignored. The exact executable version, argv, requested model and effort are recorded. A JSONL-only runtime may still inject remote plugins or system tools; the run records observed MCP calls and this remains a contamination limitation until the complete tool list is captured.

Evaluator files and gold checks are outside agent workspaces and are never passed to an adapter. Codex read-only mode does not prevent all reads outside the workspace. Treat this as evaluator separation, not a security boundary. A confirmatory study needs enforced filesystem and network isolation and an audited tool list.

The default pilot uses Codex read-only. `--unsafe-pilot` explicitly bypasses its OS sandbox for synthetic answer-only instrumentation tasks when the host sandbox is broken. It rejects memory-update tasks. Record this exception in every run and keep results separate from sandboxed trials. This option removes physical filesystem enforcement and is unsuitable for confirmatory isolation claims.

Run artifacts include request text, JSONL trace, stderr, answer, patch, new-file contents, randomization order, actual usage, missing-context reasons and automatic screening checks. Input, output, cached and uncached tokens come from completed-turn runtime usage. Full logical context, actual instruction injection, native skill omissions, context capacity and exact underlying model release stay null when unavailable. File bytes and cumulative input tokens never substitute for peak logical context. Unique tool text bytes are a diagnostic count only. Provider billing detail and cost are unavailable without separately frozen rates and provider records.

Every scheduled cell enters the results ledger before execution. Artifact directories must be new so another run cannot overwrite earlier evidence. Nonzero adapter exits, spawn errors, invalid adapter JSON and timeouts retain their request, raw adapter stdout and stderr, failure details, actual signal and timeout flag. They receive no machine coverage score. The runner persists each cell before continuing and returns a failing CLI exit status when any cell did not complete. Timeouts send SIGTERM to an owned process group, escalate to SIGKILL after 100 ms, then close inherited streams at a bounded deadline. Ordinary descendants are included; a process that creates another group can escape that cleanup boundary, which is one reason confirmatory runs need external process and filesystem isolation.

Blind rating packets have anonymous filenames and remove guidance path citations. Two rater scores and adjudication are null until humans complete them. Answers or diffs can still reveal the treatment; raters should record their guess before grading. Automated string checks are screening checks and cannot confirm semantic quality. Scale analysis requires completed cells with verified freezes and intact comparison records. It compares exact prompts, rubrics, fixed fact text, source opportunity, personal scope and convention, runtime version, requested model and effort, adapter digest, command and execution settings. Duplicate cells, failures, missing identities and mismatches produce explicit rejection records with null deltas. It produces descriptive results without significance or non-inferiority claims.

## External adapters

`run --adapter /absolute/path/to/executable` supplies one JSON object on stdin. The executable runs with the fixed task cwd. Input schema:

```json
{"version":1,"cwd":"/fresh/repository/packages/checkout","workspace":"/fresh/repository","prompt":"task text","writable":false,"timeout_ms":180000,"unsafe_pilot":false}
```

Return exactly one JSON object on stdout:

```json
{"version":1,"code":0,"stdout":"JSONL runtime events\n","stderr":"","runtime_version":"exact installed version","model":"exact requested model","effort":"high","wall_time_ms":1000}
```

Codex-style `turn.completed.usage` and `item.completed.item` events produce usage and tool metrics. An adapter can supply actual provider context events as `{"type":"request.context","logical_context_tokens":123}`. If another runtime uses different fields, convert actual trace records to these events and retain the original trace alongside them. Never estimate logical context from file lengths.

## OSS corpus audit

```bash
node benchmarks/main.mjs download --repository vercel/ai --destination /tmp/okf-third-party-ai
mkdir -p /tmp/okf-third-party-ai/source
tar -xzf /tmp/okf-third-party-ai/source.tar.gz --strip-components=1 -C /tmp/okf-third-party-ai/source
node benchmarks/main.mjs audit --source /tmp/okf-third-party-ai/source --output /tmp/okf-third-party-ai/audit.json
```

The downloader accepts only pinned candidates in the planning manifest. It uses `gh api` for the pinned license and archive, records hashes and SPDX identification, and refuses destinations inside this MIT repository. Keep upstream archives and extracted text outside the repository, preserve notices and review the actual license before publishing transformations. `NOASSERTION` is an unresolved license result. The audit records actual files, links, nesting, skills and exact duplicate hashes. Token counts, stale-link review, contradictions and concept extraction remain pending rather than being inferred from bytes or file counts.

The engineering command measures the actual core store separately on 10000 synthetic concepts. It records CPU, runtime, RSS, full scan and repeated search durations. A poor timing is a product engineering finding; it says nothing about causal agent task quality.
