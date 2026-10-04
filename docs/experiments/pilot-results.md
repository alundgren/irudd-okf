# Instrumentation pilot on 2026-10-04

Two synthetic tasks at 100 concepts compared nested AGENTS.md plus linked documents with OKF files plus a path locator. Each task used the same prompt, applicable facts and package working directory. The seeded order was OKF then nested for both task blocks. Four original read-only trials were blocked by the host sandbox's filesystem mount lock. The raw blocked records remain in [read-only artifacts](artifacts/read-only-blocked/results.json).

An explicitly recorded answer-only retry bypassed the OS sandbox in fresh private fixture copies. It used Codex 0.160.0, requested `gpt-6.1-sol`, high effort, ephemeral sessions, ignored user config and execpolicy rules, and the same 32768-byte project instruction limit. Four cells completed actual guidance reads. No repository files changed.

| Task | Delivery | Runtime input | Cached input | Output | Seconds | Completed tool calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Architecture review | OKF files | 113806 | 91264 | 1037 | 48.53 | 16 |
| Architecture review | Nested guidance | 92405 | 73088 | 769 | 37.85 | 5 |
| Submission UX review | OKF files | 112942 | 95744 | 694 | 36.66 | 5 |
| Submission UX review | Nested guidance | 91310 | 76416 | 617 | 35.01 | 5 |

These are completed-turn runtime usage counts, including recurring context across calls. Cached tokens remain input context. They are not measurements of peak logical context or invoiced cost. Automatic keyword screens found the requested policy terms in all four outputs. Human task correctness, coverage and equivalence ratings are pending.

The pilot proves that the runner can collect real usage, tool traces, answers, diffs, randomization and anonymous rater packets. It supports no claim about OKF efficacy or equivalence. There is one observation per cell, no calibrated confidence interval and no confirmatory run. OKF used more input and time in these observations; averaging or interpreting that as a general effect would be unjustified.

Global house skills and remote plugin tools remained available despite the isolated Codex home. Full system prompts, initial native skill registry, full instruction chain, per-request context, selected context capacity and exact underlying model release were not exposed by JSONL. The retry also lacked physical filesystem and network isolation. Before a causal study, fix those issues and complete two-human transformation checks and blinded grading. The published pilot tasks are excluded from future held-out confirmatory tasks.

The [raw retry artifacts](artifacts/unsandboxed-pilot/results.json), [descriptive analysis](artifacts/pilot-analysis.json), [canonical freeze](artifacts/evaluator-freeze/freeze.json) and per-run trace, answer and patch files are committed. Canonical policies, source maps and task rubrics are evaluator artifacts, never contents of the launched fixture. The run's generated-inventory hashes identify the exact initial layout. The pilot preceded adding physical case directories to the generator; the current generator retains its policy facts but those extra source files mean a regenerated tree has a different hash. Preserve that distinction when reproducing the archived trial.

The separate [engineering run](artifacts/engineering-b802aa5.json) measured the core at `b802aa5`, Node 26.10.0, Linux x64 and DO-Premium-AMD CPU on 10000 synthetic concepts. Full scan was 5504 ms, median search 262 ms, p95 search 487 ms, default search response 5745 bytes and final RSS 368214016 bytes. This misses the provisional 2-second scan and 250-ms p95 search targets. Response size stayed below 8 KiB. These local timings are engineering results and do not estimate model context or task quality.

The pinned Vercel AI SDK natural corpus audit downloaded commit `15f1a4d0531ac641a4a4d9cc602c0536c1906834` through gh, inspected 9128 source files and recorded 610 guidance or document files plus three unfollowed symbolic links. [Provenance](artifacts/oss-audit-summary.json) records archive and license hashes. GitHub reported license SPDX `NOASSERTION`, so license review remains unresolved. Third-party source text remains outside this repository. Atomic source-backed concept counts and semantic transformations are pending; 610 files do not imply 610 concepts.
