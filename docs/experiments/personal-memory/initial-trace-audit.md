# Initial trace audit

Agent-authored, read-only review of the first usage-task repetition in the saved study at
`~/.local/state/irudd-okf/experiments/personal-20261004`. It covers repetition
0 across all nine methods at 100 and 5,000 concepts. These are initial cases,
not a ranking.

| Concepts | Method | Cell | Hidden checks | Total tokens | Seconds | Trace evidence |
| ---: | --- | --- | ---: | ---: | ---: | --- |
| 100 | none | cell-0005 | 1/4 | 56,795 | 62.43 | No memory commands or rule text in completed command output |
| 100 | oracle | cell-0001 | 4/4 | 45,620 | 49.15 | Relevant notes supplied; no memory commands |
| 100 | flat | cell-0004 | 4/4 | 67,341 | 46.08 | No memory commands; actual injected instruction chain unavailable |
| 100 | global | cell-0003 | 4/4 | 48,161 | 58.77 | Read current and obsolete usage notes after index/search commands |
| 100 | skill | cell-0011 | 4/4 | 137,208 | 110.85 | Read installed `okf` skill and current usage note; skill read observed |
| 100 | symlink | cell-0010 | 4/4 | 58,747 | 58.01 | Read current and obsolete usage notes through `.okf/personal` |
| 100 | search | cell-0014 | 4/4 | 47,866 | 52.69 | Used `rg`, then read current and obsolete usage notes |
| 100 | suggest | cell-0017 | 4/4 | 46,974 | 54.89 | Read current and obsolete notes from suggested paths |
| 100 | grouped | cell-0009 | 4/4 | 52,712 | 54.84 | Read personal metrics and testing skill files; relevant text observed |
| 5,000 | none | cell-0000 | 1/4 | 56,555 | 64.00 | No memory commands or rule text in completed command output |
| 5,000 | oracle | cell-0016 | 4/4 | 45,510 | 46.73 | Relevant notes supplied; no memory commands |
| 5,000 | flat | cell-0002 | No grade | unavailable | 180.03 | Timed out before a completed turn; no score or token total |
| 5,000 | global | cell-0013 | 4/4 | 60,759 | 76.35 | Read current and obsolete usage notes after index/search commands |
| 5,000 | skill | cell-0015 | 1/4 | 45,739 | 50.81 | Registry listed `okf` enabled, but no read was observed in recorded commands |
| 5,000 | symlink | cell-0012 | 4/4 | 58,453 | 69.39 | Read current and obsolete usage notes through `.okf/personal` |
| 5,000 | search | cell-0008 | 4/4 | 54,597 | 55.34 | Used `rg`, then read current and obsolete usage notes |
| 5,000 | suggest | cell-0006 | 4/4 | 47,067 | 58.52 | Read current and obsolete notes from suggested paths |
| 5,000 | grouped | cell-0007 | 4/4 | 125,013 | 64.39 | Read personal metrics skill and testing skill; relevant text observed |

Every correctly graded usage candidate preserves missing values as `null`,
keeps real zero counts, rejects invalid supplied values, and totals input plus
output without adding cached input again. The successful candidates reached that
same behavior by different routes: `cell-0001` received the relevant notes,
`cell-0004` was prepared with flat instructions, and the memory-bearing methods
with command evidence read the current rule. Their command output also exposes
the obsolete zero-default note where reported. For `cell-0004`, the saved trace
does not capture the actual injected instruction text.

The two no-memory candidates (cells `cell-0000` and `cell-0005`) returned zero
for missing counts and accepted a supplied `total_tokens`. Each passed only
“cached input is not counted twice.” Both failed “missing values remain
unavailable,” “zero and partial cached counts,” and “invalid supplied counts
rejected.” Their traces show repository-file inspection and visible tests, but
no personal-memory commands or memory text. The completed answer in `cell-0000`
explicitly says it will default missing counts to zero. The resulting code uses
`?? 0` and searches for nonnegative values, so invalid values are skipped rather
than rejected.

The large skill candidate (`cell-0015`) has the same failure pattern. Its
registry record lists one enabled, user-scoped `okf` skill, but `skill_read_observed`
is false. Its three completed shell calls only list/read repository files and
run the visible test; none reads `SKILL.md` or a memory file. The answer says it
will default missing counts to zero, and the saved candidate does so. By
contrast, `cell-0011` records a successful read of the installed skill and the
current usage rule. Registry availability alone did not mean the skill body
was read in `cell-0015`.

`cell-0002` is a runtime failure, not an incorrect graded answer. Its runtime
reached the 180-second timeout without a completed turn. The saved candidate
remains the original zero-returning stub; the grader did not score it.

One no-memory draft case, `cell-0023`, completed with no memory commands and
passed all five hidden checks. The prompt already names the current record,
expected version, proposed text, and saved/conflict outcomes. The candidate
uses an exact version comparison, returns the existing raw text and proposed
draft on conflict, and returns the proposed text on save. This result shows the
draft task is substantially inferable from its prompt and ordinary optimistic
editing semantics; it is not evidence that memory improved that answer.

Limits: each method-size entry here is one synthetic task repetition. The
5,000-concept corpus contains generated distractors, not 5,000 audited real
memories. Hidden checks are authored fixture tests; human semantic ratings are
absent. Total tokens include recurring cached input and output. Elapsed seconds
include the Codex process and candidate-path lookup where applicable, but omit
fixture setup, registry preflight, and grading. Full provider context, actual
injected instruction text, billed cost, and per-command duration are unavailable.
The flat-instruction candidate passed at 100 concepts, but this trace does not
confirm the exact instruction text Codex loaded.
