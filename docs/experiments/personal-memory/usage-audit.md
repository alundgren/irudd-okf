# Completed usage-task audit

An independent reviewer agent checked all 54 usage-task records against saved subprocess evidence, including token fields and elapsed-time reconstruction. It regraded the three failed skill candidates and two successful file-retrieval candidates, and ran additional semantic probes. This is an agent audit; human ratings remain unavailable.

| Method | Passing trials, 100 concepts | Passing trials, 5,000 concepts |
| --- | ---: | ---: |
| No memory | 0/3 | 0/3 |
| Relevant notes supplied | 3/3 | 3/3 |
| Full global injection | 3/3 | 0/3; all timed out |
| Global bundle locator | 3/3 | 3/3 |
| Installed OKF skill | 2/3 | 1/3 |
| Repository symlink locator | 3/3 | 3/3 |
| Locator and search recipe | 3/3 | 3/3 |
| Suggested candidate paths | 3/3 | 3/3 |
| Grouped native skills | 3/3 | 3/3 |

The 5,000-concept suggested-path condition has a completed-trial median of 46,969 total tokens; the global locator has 92,777. Both pass all three trials. Totals include recurring cached input and output. They are not billed cost or peak context. These are three placements of one authored task, with placement and run order confounded.

Candidates `cell-0015`, `cell-0080` and `cell-0160` each passed only 1/4 frozen checks. They default unavailable counts to zero, trust supplied totals and fail invalid-count rejection. No skill or memory read was observed in their recorded commands. The native registry did expose the skill. Complete startup exposure remains unavailable.

The sampled global-locator candidate `cell-0076` and suggested-path candidate `cell-0073` each passed 4/4 checks. Recorded command output contains the current usage rule and its obsolete predecessor. Their code preserves missing values, counts cached input once and rejects the invalid values included in the checks.

The extra probes found a contract gap: those two passing candidates differ on explicit `null` count fields. The frozen rule does not resolve that case clearly, and the tests do not score it. Preserve the original scores and disclose this limit. A later benchmark should specify the desired treatment of explicit null fields before adding coverage.

All 54 usage attempts finished: 51 completed and three large global-injection attempts timed out. This audit does not certify the other tasks, the bounded phase, real personal memories or general coding effectiveness.
