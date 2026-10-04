# Saved experiment evidence

`primary/` contains the complete 216-cell result ledger, summary, frozen schedule and digest, plus conclusions bound to both result ledgers. `bounded/` contains the complete 48-cell ledger, summary, frozen schedule and digest, phase protocol and digest, and all 24 capped instruction sidecars. The report regenerates from these files without inference.

Full raw process streams, registry probes, candidate modules, patches, answers and grader evidence remain locally at:

```text
/home/dev/.local/state/irudd-okf/experiments/personal-20261004
/home/dev/.local/state/irudd-okf/experiments/personal-bounded-20261004
```

Each contains directories named by cell ID. Temporary homes and credential copies were removed after trials; the retained process artifacts do not require those temporary homes.

`global-instruction-capture.json` records the offline diagnostic showing global instructions were not truncated by the configured project-document budget. `bounded-instruction-capture.json` records the independent offline diagnostic of the imposed prefix cap. These captures retain metadata only, without inference or credentials. The bounded capture's wrapper hash predates a failure-cleanup fix; its cap procedure and the three large usage input hashes match the live bounded study.

All rule text in these artifacts is authored benchmark material. The result ledgers preserve unavailable fields rather than estimating them. Human ratings remain unavailable.

`primary/tested-skill/` preserves the original two skill files used in the frozen
study. The product skill subsequently gained authoring guidance. Those edits do
not change the saved scores; a new paid study requires a new frozen directory.
