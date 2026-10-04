# Personal memory retrieval results

Completed on October 4, 2026 with Codex 0.160.0, GPT-6.1-Sol and medium effort. The primary schedule had 216 attempts: 203 completed, 194 passed the frozen behavior checks, nine completed with behavior failures and 13 timed out. The separate bounded schedule had 48 completed attempts, 46 passing and two behavior failures. No actual personal memories or machine-wide instructions were changed.

The useful comparison is the usage task: without memory, none of its six trials passed. Its required rules preserve unavailable counts, count cached input once and reject invalid counts. Draft recovery also passed without memory, making it an inferable control. Repository export limits and pagination supply control cases rather than evidence of personal-memory benefit.

## Primary usage task

Each entry represents three placements of the same authored task. Token and time medians cover completed trials, including incorrect completions. Tokens include recurring cached input and output; they are not billed cost or peak context.

| Delivery | Passing, 100 concepts | Passing, 5,000 concepts | Large-corpus median tokens | Large-corpus median seconds |
| --- | ---: | ---: | ---: | ---: |
| No personal memory | 0/3 | 0/3 | 56,847 | 65.1 |
| Relevant notes supplied | 3/3 | 3/3 | 45,559 | 48.0 |
| Full global rule injection | 3/3 | 0/3 | Unavailable | All timed out at 180 seconds |
| Global bundle locator | 3/3 | 3/3 | 92,777 | 70.1 |
| Installed OKF skill alone | 2/3 | 1/3 | 58,543 | 81.5 |
| Repository symlink locator | 3/3 | 3/3 | 58,453 | 68.1 |
| Locator and search recipe | 3/3 | 3/3 | 57,858 | 62.4 |
| Suggested candidate paths | 3/3 | 3/3 | 46,969 | 56.4 |
| Rules in grouped skills | 3/3 | 3/3 | 73,631 | 63.5 |

Suggested paths used about half the median total tokens of the bare global locator while both passed all three large-corpus trials. The explicit search recipe also passed all three and used fewer tokens than the bare locator. These are descriptive observations from one task; they do not establish a general speed or token advantage.

The skill registry exposed the installed OKF skill, but three failed usage candidates had no observed skill or memory reads. Absence of an observed read is inconclusive about startup context. The skill's low completed-trial token median includes incorrect solutions; its one passing large usage trial used 143,246 tokens. Ordinary file access counts as successful memory use when the final code applies the rules correctly.

All 12 large full-injection trials timed out. A further timeout occurred in the large skill export control, whose trace ended after ordinary repository enumeration. Its cause is unknown. The full-injection timeouts do not establish why the runtime failed or a native context limit.

## Separate imposed instruction budget

The second schedule physically limited global instructions to 32,768 bytes, including shared instructions and headers. It retained the largest complete-rule prefix without relevance selection. A global locator was chosen as the reference before the primary schedule completed. Do not pool phases or interpret cross-phase timing differences as treatment effects.

| Delivery | Passing usage trials, 100 concepts | Passing usage trials, 5,000 concepts |
| --- | ---: | ---: |
| Capped global instructions | 3/3 | 1/3 |
| Global bundle locator | 3/3 | 3/3 |

The two large capped failures had neither current nor obsolete usage guidance in their retained prefix. The beginning-placement trial retained the guidance and passed. All 36 bounded control attempts passed. This demonstrates the tested prefix-budget tradeoff. It does not measure Codex's native instruction capacity: a separate offline capture found that `project_doc_max_bytes=32768` did not truncate global instructions in Codex 0.160.0.

## Integration direction

Use a short global locator, a focused ordinary-search recipe and a small bundle root index as the next integration candidate. The root index should explain concept files, project scope and replacement links. That explanation helps after discovery; a locator or skill must first expose the bundle's location. OKF permits a root index but does not ensure automatic discovery.

Keep a native skill as an additional retrieval option rather than relying on it alone. A repository symlink locator is another working file-access option, but the current OKF engine rejects symlink roots and skips symlink directories. Register the actual personal directory for CLI access. Suggested candidate paths warrant a later caller integration trial; supplying paths is a different intervention from adding global wording.

See [instruction-candidates.md](instruction-candidates.md) for the tested wording and [research.md](research.md) for Google's format and existing integration research. This experiment informed the integration choice; it did not implement Scope memory sync or install anything globally.

## Evidence and limits

An independent reviewer agent verified all 264 terminal records against saved per-cell results, raw usage events and process elapsed time. It verified the frozen schedules and source hashes, reconstructed every capped input and regraded selected candidates. This is an agent audit; human ratings remain unavailable.

Four authored tasks and three repetitions are not 264 independent development tasks. The corpus contains authored distractors, not 5,000 audited personal memories. Placement and run order are confounded. Two passing usage candidates differ on explicitly null fields; the frozen rule and tests do not resolve that case, so the original scores remain unchanged. Complete provider prompts, per-request context, exact dated model release and billed cost are unavailable. Timings include shared service conditions with two concurrent sessions.

The [interactive report](report.html) keeps both phases separate and exposes task, corpus size, correctness, token accounting, elapsed time and individual failure evidence. [README.md](README.md) documents paid reruns and offline report regeneration. Sanitized ledgers, frozen identities and all capped instruction sidecars are retained as reviewable files under [evidence/](evidence/README.md), which also records the local directories holding raw process and candidate evidence.
