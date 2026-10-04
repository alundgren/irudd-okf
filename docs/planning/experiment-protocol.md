# Controlled experiments for OKF agent memory

Status: research protocol, before benchmark runs  
Prepared: 2026-10-04  
Research window: 2026-10-04  
Proposed run default: current Codex harness with `gpt-6.1-sol` at `high` effort, subject to exact availability recheck and version capture during preregistration. Record context limit and all measured prompt traces before the confirmatory run. `/tmp/irudd-okf-planning-models.json` remains a planning snapshot, not a benchmark run record.

## Decision this protocol supports

Test whether an agent can maintain and use thousands of small, scoped repository rules through OKF files, with and without an optional CLI plus skill, while preserving task quality and rule coverage. The comparison includes the instruction layouts developers already use: nested `AGENTS.md` files and linked documents, plus native agent skills whose trigger descriptions remain in the prompt context.

The product must not add a field or runtime policy that ranks rules as critical, mandatory, advisory, or higher priority. It must not silently decide which bundle wins a conflict. Those choices are experimental usage conventions. The experiment may tell the agent to follow repository guidance or to ask when personal and repository guidance conflict, then measure both behaviors. Evaluator annotations may identify which facts apply to a task, but those annotations stay out of agent-visible files and prompts.

The README's design premise is scoped, inspectable Markdown memory with progressive disclosure. This protocol tests that premise. It does not assume a retrieval or performance advantage.

## Questions and hypotheses

Primary questions:

1. At 100, 1,000, and 10,000 concepts, how much repository rule coverage and task quality does each guidance method preserve?
2. Does OKF reduce context sent to the model while keeping rule coverage and answer or patch quality within a predeclared acceptable range?
3. How do path-based routing and agent-initiated retrieval examples affect use of OKF files?
4. Does a personal bundle add useful preferences or cause false answers and wrong edits when it conflicts with repository information?
5. Can agents add useful rules after a failed task without creating duplicates, unsupported claims, or stale entries?

Hypotheses are directional, not results: progressive retrieval may reduce context use at scale; too many trigger descriptions or irrelevant rules may reduce rule coverage; a locator or CLI may reduce discovery time; more exposed rules may increase compliance with applicable rules while also raising distraction. No outcome is presumed.

## Study structure

Run three studies with distinct claims. Do not mix them into one averaged score.

### 1. Natural corpus audit

Inspect the guidance already present in selected repositories. Count files, tokens, nested scopes, trigger descriptions, links, repeated rules, contradictory statements, and stale references. Record which parts are actively used by the repository's supported agent setup. This describes real layouts and guides sampling. It does not estimate the causal effect of OKF.

### 2. Equal-information delivery study

For each selected repository, create one source-backed concept set and render equivalent content as:

- Nested `AGENTS.md` with links to the same source documents.
- Native Codex skills. Use repository-local `.agents/skills` and the supported discovery and activation behavior. The visible list can be shortened or omit entries at scale, so capture the actual list the runtime loaded. Keep full instructions in `SKILL.md` and reference files.
- OKF files with a short nested `AGENTS.md` locator explaining that task guidance lives in the relevant OKF files. Test path routing and agent-initiated retrieval examples as separate subconditions.
- OKF CLI plus skill. Keep the same OKF bundle and locator, then allow the CLI's context, search, and read commands through the skill.

Transformations may reorganize, split, or rephrase guidance for the target format, but may not add facts, remove obligations, alter examples' meanings, or change conflicts. Keep a source-span map for every transformed concept. Two reviewers compare each transformation with its source. Adjudicate disagreements before runs. Independently review all facts used by scored tasks plus a random sample of the remaining facts.

At each target scale, freeze one canonical set of 100, 1,000, or 10,000 concept IDs. Render that exact set in every arm at that scale. The task's applicable concepts and relevant facts must be identical in every arm. Use an isolated Codex home with identical configuration for each run. Leave global `AGENTS.md` empty in repository-only tests; expose only the assigned personal bundle in personal-plus-repository tests. Fix the launch working directory for each task and use that same repository-relative directory in every arm. Codex builds the instruction chain once at session startup from global configuration, then repository root through the launch directory, with a default combined project-file limit of 32 KiB. A nested file below the launch directory is not automatically added when the agent later enters that directory. If the task needs such a file, the native arm must read it explicitly; apply equivalent retrieval directions to the other arms. Capture the actual loaded instruction chain, byte counts, and any truncation. The other arms intentionally transform the same source-backed concepts for their own mechanism. Record those differences as treatment, not as extra or missing facts. Do not compare an unmodified natural corpus with a transformed corpus as if they delivered equal information.

Keep the actual fact set, task prompt, working tree, launch directory, tool set, model settings, and available context limit constant across delivery methods. Freeze user-global instructions and skills too, and exclude unassigned personal knowledge. Keep locator text and examples short and equal in token budget where possible. Log any unavoidable difference, especially the skill registry's context cap, description shortening, omitted entries, and system-level discovery behavior. The skills arm uses native Codex discovery and activation without rewriting trigger descriptions to imitate OKF search. For synthetic 10,000-rule stress, distinguish three things: metadata present in Codex's initial skill list, metadata shortened or omitted by its context cap, and a skill the agent successfully invokes and reads. Include one-skill-per-rule metadata as a deliberate upper-bound comparison and a grouped-by-category skill set as a practical sensitivity check. Neither layout is presented as a recommendation for ordinary skill authoring.

### 3. Maintenance and personal-scope study

Use separate tasks to test updates across sessions, duplicate and obsolete entries, spontaneous rule creation, explicit user capture, agent-proposed capture with review, and personal-versus-repository conflicts. Do not let one run update a corpus used by another run. Clone a fresh bundle per run and preserve every before/after diff.

## Repository candidates

These are verified candidates, not a final benchmark set. `gh` read-only inspection on 2026-10-04 confirmed the named files on the listed commits. Pin all source trees and task worktrees before data preparation. Recheck license and path existence at freeze time.

| Repository | Frozen candidate commit | Verified examples | Suggested role |
| --- | --- | --- | --- |
| [vercel/next.js](https://github.com/vercel/next.js/tree/ba80ee48fc319735151c3ad6d9bb9a8180c9f09e) | `ba80ee48fc319735151c3ad6d9bb9a8180c9f09e` | Root `AGENTS.md`, nested `packages/next/AGENTS.md`, `.agents/skills/`, `skills/`, `docs/03-architecture/`, `contributing/` | Large JS/Rust monorepo with nested rules and skills |
| [supabase/supabase](https://github.com/supabase/supabase/tree/7353782724d837be316f0f6f87471ed176ab4bfd) | `7353782724d837be316f0f6f87471ed176ab4bfd` | Root `AGENTS.md`, nested `apps/docs/AGENTS.md`, `apps/studio/AGENTS.md`, `.agents/skills/`, architecture documents | Multiple apps, distinct scopes, skills and docs |
| [vercel/ai](https://github.com/vercel/ai/tree/15f1a4d0531ac641a4a4d9cc602c0536c1906834) | `15f1a4d0531ac641a4a4d9cc602c0536c1906834` | Root `AGENTS.md`, nested `packages/ai/AGENTS.md`, `skills/`, `architecture/`, `contributing/` | SDK with decision and provider guidance |
| [biomejs/biome](https://github.com/biomejs/biome/tree/21fb018647d7c7de35690d4c2b3a1a6b9fea7882) | `21fb018647d7c7de35690d4c2b3a1a6b9fea7882` | Root `AGENTS.md`, `.claude/skills/`, skill references, crate-level contributing documents | Rust-heavy project with skills linked directly from agent guidance |
| [microsoft/vscode](https://github.com/microsoft/vscode/tree/4cc4da802681c8859d7e81f63ab202f253112b60) | `4cc4da802681c8859d7e81f63ab202f253112b60` | Root `AGENTS.md`, many nested `AGENTS.md`, many `.github/skills/`, architecture and contributing material | High-scale stress sample; stratify tasks by subsystem |
| [denoland/deno](https://github.com/denoland/deno/tree/b4f08f127652d8442b4d3dbabc277aca3840bc1d) | `b4f08f127652d8442b4d3dbabc277aca3840bc1d` | `CLAUDE.md`, `.claude/skills/`, `doc/architecture.md`, contribution guide | Alternate instruction filename; useful only if runtime supports it |

Prefer four core repositories chosen to cover at least three languages and a range of project sizes. Use VS Code as a high-scale stress sample, not as the sole basis for conclusions. The final set should include repositories with real nested guidance, linked docs, and task-relevant skills. Do not silently convert unsupported native instruction files such as `CLAUDE.md` into `AGENTS.md` and call that the repository's existing baseline.

## Concept corpus and scale

A concept is one independently testable instruction or fact with a source path and source span. Keep concepts small enough that a task can need one or a few of them. A concept can have links or related concepts, but those do not count as new facts by themselves.

Create two corpora per repository:

- **Natural corpus:** the unmodified guidance and knowledge already in the pinned tree.
- **Controlled corpus:** a human-audited, equal-information representation used in all delivery methods.

The source-backed study has 100, 1,000, and 10,000 concept targets. Build each available source-backed level from pinned repository material by splitting guidance and documentation into atomic, human-reviewed statements. Record provenance. Never fill a shortfall with repeated filler or unrelated repository facts. If the OSS sources do not contain 10,000 distinct, usable concepts, report that source-backed cell as unavailable and retain the separate synthetic fixture below. The 10,000-rule question stays in the study even if OSS documentation cannot provide that corpus size.

### Synthetic 10,000-rule stress fixture

Build a separate 10,000-rule fixture for load, retrieval, relevance, and memory-quality stress. Mark every file and concept as synthetic and benchmark-only. It does not describe upstream project facts. Anchor rules to real paths and actual subsystem names in a frozen fork, but phrase them as new policy extensions for that fork, for example a new testing expectation under a real package path. State that the extensions apply only to the benchmark fork. Give every arm the same 10,000 rule IDs and text at the 10,000 level, and the same nested subsets of 100 and 1,000 IDs at the smaller levels.

Cover varied, realistic categories such as tests, architecture, UX, accessibility, formatting, build and release steps, data handling, API compatibility, documentation, and debugging. Vary repository, package, directory, and file scopes. Include lexical near-matches with distinct meanings and scopes, such as similar package names or test commands. Rules must be unique and useful; do not use synonym swaps or duplicate filler to reach the count. Use a small rule grammar only to keep wording consistent, then have independent reviewers inspect every generated instance for meaning, conflict, support within the fork, and uniqueness. Preserve an audit trail back to the category template and real path that motivated it.

Keep task prompts, answer keys, hidden tests, and expected patches out of the fixture. Author tasks only after rule text and file layout are frozen. Task authors must not copy a rule's exact wording or give the rule's specific action as a hint; the task should require applying the relevant policy to a new change. Scan all files visible to the agent for solution leakage. Because the policy statements are synthetic, results from this fixture support claims about interface capacity and retrieval under controlled conditions only. Any claim about real-world memory quality or coding behavior requires corroboration in the natural or source-backed OSS study.

For each controlled corpus, keep a fixed set of task-relevant concepts and the same near-match and irrelevant concepts across all methods at a given scale. Grow the 100 and 1,000 sets as nested subsets of the 10,000 fixture where applicable. Keep the preregistered near-match-to-other-distractor ratio fixed across methods and scales; the applicable fraction falls as distractors grow. Also run a separate relevance stress test that varies the proportion of applicable concepts while keeping the total count fixed. Sample context positions so the relevant concept appears near the beginning, middle, or end of delivered material when a method loads large text. This separates corpus size, distractor relevance, and position effects.

Use concept IDs only in evaluator files. They must not reveal importance, order, or expected precedence to the agent. Do not add priority or authority fields to OKF frontmatter, names, paths, or locator text.

## Tasks and held-out ground truth

Use two task classes.

### Answer-only tasks

Create factual questions about repository structure, build/test practices, architecture, UX guidance, and workflows. Include direct lookup, two-concept synthesis, path-scoped routing, a near-match distractor, and an unanswerable question. Require concise answers with source paths or quotations. Score factual accuracy, rule coverage, appropriate uncertainty, and unsupported statements.

### Code tasks

Create short, realistic changes tied to a specific subsystem and one or more source-backed concepts. Tasks should require the agent to discover and follow relevant guidance, not repeat it. Include hidden tests and human acceptance criteria. A task may test UX guidance through a review artifact or text change; do not use subjective UI quality alone as its success signal.

Task authors must freeze each prompt and ground-truth rubric before running any model. Prefer new tasks authored against the pinned commit by maintainers or independent engineers, rather than public benchmark prompts with visible solutions. Remove repository history, branches, reflogs, patch refs, and network access from task worktrees unless a given task needs them; document any exception. Scan task text and accessible files for solution leakage. Hidden checks should reject common incomplete or incorrect patches, not require irrelevant implementation details.

Use the same task prompt and initial repository tree across every delivery method for a paired comparison. Blind task graders to delivery method. Keep evaluator-only source maps, expected concepts, hidden tests, and solution notes outside the agent workspace.

Use 12 held-out pilot tasks per core repository, kept out of confirmatory results. After the blinded pilot, calculate repetitions for the predeclared uncertainty range. Then target at least 30 held-out task families per repository for the confirmatory set, increasing that count if the power calculation requires it. Cover answer-only and code tasks and each guidance domain. If budget limits the run, report the reduced power and keep confidence intervals rather than calling a null difference equal performance.

## Personal and repository bundle conditions

Run repository-only tasks first, then a balanced subset with `personal + current repository`. Personal concepts must be stable preferences or workflow defaults that can plausibly apply across repositories. Do not mix facts from another repository into the personal bundle.

Construct controlled conflict cases such as a personal preferred package manager versus a repository's documented lockfile and scripts, or a personal preferred UI pattern versus an explicit local component convention. Test two explicit conventions as separate arms:

- `repo-wins`: follow repository-local facts for repository behavior; apply personal preference only where compatible.
- `ask-on-conflict`: identify the mismatch and ask the user before acting when the task depends on choosing.

The product does not encode either convention. Randomize which convention the task prompt states. Also include no-conflict cases to measure whether bundle composition adds noise when there is no dispute. Score wrong repository facts, unnecessary questions, failure to ask under the stated convention, correct use of compatible preferences, and safe stops separately. A safe stop is an agent that identifies a material conflict and avoids making a dependent change while requesting clarification under the `ask-on-conflict` convention. Count questions that do not affect the requested action as unnecessary. Report each conflict type and convention separately; a single pooled score can hide the choice's effect.

## Retrieval instructions and CLI fairness

The realistic OKF setup has a short nested `AGENTS.md` that says task guidance is stored in OKF files. Compare two equally short locator variants:

1. **Path routing:** names relevant folders and says to read the matching file for the task area.
2. **Agent-initiated retrieval:** gives examples of when to search and read concepts, including how to state that no result was found.

Keep one CLI+skill variant available as requested. Its skill should expose only the CLI's documented context, search, and read workflow. Log every command, query, result count, returned text, and elapsed time. Apply the same retrieval cap across raw-file and CLI conditions when practical. If retrieval budgets differ because one method exposes more text by design, report the difference and do not attribute it solely to the format.

Use identical tool access in all arms. Do not give the CLI arm extra code tools, network access, or hidden indexes. Where native runtimes place all skill names and descriptions into context, capture the actual descriptions injected into each run, even if the full skill is never activated. Read token counts from request traces or provider usage records and count actual file or CLI output from tool traces. Do not estimate loaded context from files on disk. If the chosen runtime cannot expose the actual prompt/context and usage records, mark context-cost comparisons incomplete for that runtime rather than reporting a reconstructed estimate.

## Write and maintenance conditions

Compare these write conventions on separate cloned corpora:

1. Read-only memory.
2. Explicit user capture: the task provides a rule and asks the agent to save it to the repository bundle.
3. Agent capture: the agent notices a durable fact after a mistake and drafts a repository rule for human review.
4. Agent may add or edit a rule without prior review, tested only in the isolated benchmark fork.

Do not treat one convention as product policy. In explicit-authorization tasks, authorization is in the task text. Personal bundle writes remain unauthorized unless the task says otherwise. Capture the memory diff alongside the code diff and score it before and after human review.

For multi-session tests, prepare a controlled sequence: an initial task reveals a durable repository fact; a later task reuses it; a following task changes the relevant repository behavior and makes the old guidance obsolete; a final task tests whether the agent updates rather than duplicates it. Use new agent sessions for each task, preserving only the assigned memory files and repository state. Include seeded duplicates and contradictory entries as a separate maintenance condition, with their location and age hidden from the agent.

Score every created or edited concept for source support, correctness, usefulness to a future task, duplication, obsolescence, scope, provenance, and clarity. Count both harmful additions and useful omissions. Measure whether an agent follows existing guidance after a contradiction appears; do not silently resolve the conflict for it.

## Model, runtime, and execution controls

Use current Codex as the first runtime and `gpt-6.1-sol` at `high` reasoning effort as the proposed first model. Recheck that exact model and effort are available in the Codex runtime when preregistering. If unavailable, stop and record a replacement before any confirmatory run. Record provider, exact model identifier/version, reasoning effort, Codex version, system prompt, tool descriptions, sampling settings, context limit, prompt cache behavior, retry policy, stop rules, and the runtime's actual loaded-context and usage traces. Fix the context limit and capture format during preregistration. The saved planning snapshot lists scout `gpt-6-luna` at `high` and reviewer `gpt-6.1-sol` at `xhigh`; those are planning roles, not run settings.

Start a fresh conversation and clean worktree for every run. Do not reuse hidden conversation state or memory from a prior arm. Randomize condition order within repository/task blocks. Interleave runs over time to reduce provider drift. If deterministic seeds are supported, record them; otherwise use independent fresh runs. Keep parallelism fixed and low enough to avoid rate limiting. Record all timeouts, tool errors, retries, and incomplete runs, and apply predeclared exclusion rules to every arm.

If possible, disable prompt caching for the main run. If the provider cannot disable it, report cached and uncached input tokens separately by run and include all billed input in the cost estimate. Do not compare only cache misses for one arm with cached requests for another. Repeated runs still use fresh conversations even when infrastructure caches shared prompt prefixes.

## Measures

Primary outcomes, reported first:

- **Applicable-rule coverage:** proportion of evaluator-marked applicable concepts followed in the answer or patch. Evaluator tags are never agent-visible.
- **Task correctness:** answer key score or patch acceptance. For code tasks, report hidden-test pass rate and blinded human acceptance separately.
- **Instruction compliance by evaluator severity:** rate of violations of source guidance the evaluator judges applicable, split by blinded task-severity labels such as task-blocking, safety-impacting, and routine preference. These labels support evaluation only. They are not product classifications and are not exposed in OKF.
- **Memory quality:** rate of supported, useful, correctly scoped additions; duplicate, stale, contradictory, and unsupported concepts; and successful update of changed knowledge.

Secondary outcomes:

- **Unique tool content:** exact tool-returned text, deduplicated within a run by content hash; report file and CLI content separately.
- **Recurring billed tokens:** provider-reported input and output tokens summed across all model calls, including repeated prompts. Report total plus input and output subtotals, with cached and uncached input separated.
- **Peak logical context:** the exact input-token count for the largest model request in a run, taken from request/runtime traces. If the selected runtime cannot expose the required trace or usage record, mark the metric unavailable; do not estimate it from files on disk.
- Report system/tool descriptions, loaded skill metadata, read file content, CLI output, and prior turns as separate context sources where traces permit.
- End-to-end wall time; model wait, CLI/filesystem retrieval time, and tool execution time where available.
- Retrieval recall/precision against evaluator tags, rank of each applicable concept, number of concepts read, and retrieved irrelevant text.
- Number of tool calls, retries, errors, patches, files changed, and questions asked.
- Estimated inference cost using provider-published prices current on the run date: sum each token category multiplied by its corresponding published rate, plus separately reported tool/runtime charges. Preserve the inputs and formula. Do not insert current prices into this plan.

Report quality against context and time, not a single opaque efficiency score. Include outcomes per repository, delivery method, concept scale, task class, relevance level, personal-bundle convention, and write convention.

## Judging and analysis

Use two independent human raters for answers, patches, rule coverage, and memory changes. Hide arm labels and strip metadata that identifies the format where possible. Reconcile disagreements through a third adjudicator. Record the rubric and disagreement rate. Test outputs with the same hidden tests and lint/build commands for all paired arms.

The unit of assignment is a fresh agent run. Pair delivery methods by repository, task, and corpus scale. Separately pair each delivery method with itself across 100, 1,000, and 10,000 scales by identical task ID. Randomize delivery method within repository/task blocks. For inference, use a mixed-effects logistic model for binary correctness/coverage outcomes and suitable count or continuous models for tokens and time, with repository and task-family clustering. Also report paired bootstrap 95% confidence intervals, resampling task families within repositories. Do not treat repeated runs of one task as independent tasks.

Predeclare one primary comparison and primary endpoints before the full run. Report all cells and confidence intervals, including failures. Apply multiple-comparison correction to exploratory contrasts. Do not tune retrieval wording on held-out tasks. Any tuning uses a separate development set and is frozen before evaluation.

Provisional preregistration thresholds:

- At each concept scale and task class, the lower bound of the paired 95% confidence interval for OKF minus the native nested `AGENTS.md` baseline should be no worse than -2 percentage points for applicable-rule coverage and -3 points for task correctness.
- Independently of cross-arm comparisons, compare each method with itself at 100 vs 1,000 and 1,000 vs 10,000 concepts. Use the identical task IDs, prompt, working tree, launch directory, and applicable concept IDs; only the corpus's non-applicable concepts grow. For each arm and each adjacent 10x step, the lower paired 95% confidence bound for coverage change should be at least -2 points and task-correctness change at least -3 points. For the cumulative 100-to-10,000 comparison, use provisional bounds of -4 points for coverage and -6 points for task correctness. These within-arm gates detect degradation shared by every delivery method.
- For evaluator-labeled task-blocking or safety-impacting rule violations, require no increase in the observed rate and an upper paired 95% confidence bound no greater than +1 point. Also report each task-severity group separately; an aggregate pass cannot erase a severe subgroup regression.
- For memory quality, cap the upper 95% confidence bound for added unsupported or duplicate concepts at +2 points versus the native baseline. Report missed useful updates and retained obsolete rules separately.
- Provisional marginal-context cap: for each 10x corpus increase with relevant facts fixed, unique retrieved content, recurring billed input tokens, and peak logical context should grow by no more than 25% at the median and 50% at the 95th percentile. Calibrate same-scale measurement variability with the pilot; if variability exceeds these caps, revise and document per-metric bounds before the confirmatory run. Report each context measure separately.
- A practical cross-arm context-efficiency signal is at least 25% lower median recurring billed input tokens at 1,000 and 10,000 concepts than the native nested `AGENTS.md` baseline, with no more than a 10% increase in median end-to-end time. Report task quality and within-arm scale-growth gates first; savings do not offset a quality failure.

These margins are proposed, not established standards. Freeze them with a short rationale before confirmatory runs; revise them if the pilot shows the intervals are not feasible, and document the reason. This protocol does not add an owner-approval gate. Evaluate each scale, adjacent-scale transition, task class, and severity group against its own bound so gains on easy questions or shared deterioration cannot hide a quality drop.

## Threats to validity and controls

- **Native corpus differences:** real repositories have different quality and instruction size. Audit them first. Preserve native files and automatic nested loading in the natural setup; use paired, equal-information transformations for causal comparisons.
- **Transformation loss or additions:** maintain source spans, independent review, and a fixed task-independent transformation procedure.
- **Skill familiarity and runtime behavior:** pin the supported runtime and capture the descriptions actually loaded and tool activity from runtime traces. Report if the skill system differs from another tool's discovery behavior.
- **Unequal retrieval tuning:** freeze locator text, skill descriptions, CLI ranking, and query prompts on a development set only.
- **Task leakage:** author held-out tasks after snapshot, hide evaluator files, remove future refs, and inspect task text for solution hints.
- **Test weakness:** use hidden tests plus blinded code review and acceptance criteria.
- **Long-context position effects:** move relevant items across positions and keep irrelevant content proportional; report context lengths and positions.
- **Shared scale deterioration:** compare adjacent corpus sizes within every arm using identical tasks and applicable concepts; do not rely only on between-arm comparisons at each size.
- **Instruction loading differences:** keep launch directory identical within each paired task; capture the actual Codex startup chain and byte truncation. Explicitly read nested files below that directory when the task requires them.
- **Skill metadata omission:** report which descriptions Codex included, shortened, or omitted separately from successful skill invocations and rule use.
- **Repository scope leakage:** keep per-repository concepts in that repository bundle; put only truly cross-repository preferences in personal memory.
- **Conflicts that depend on taste:** state the applicable test convention in task text and report the two conventions separately.
- **Model/service drift:** interleave conditions, record exact versions and timestamps, and repeat a small reference set through the run.
- **Caching:** report cache reads and fresh input tokens separately.
- **Human writing and review effects:** blind graders, use two raters, and report agreement. Keep evaluator severity labels out of product data.
- **Synthetic fixture validity:** synthetic 10,000-rule outcomes apply only to controlled load and retrieval behavior; require corroboration from natural or source-backed OSS tasks before making real-world claims.
- **10,000-concept source scarcity:** do not pad natural corpora with invented facts; retain the benchmark-only synthetic 10,000-rule stress fixture as a separate study.

## Run sequence and stop points

1. Recheck exact availability of `gpt-6.1-sol` at `high` in current Codex; freeze repository commits, license records, file inventory, and task worktrees.
2. Complete the natural corpus audit and publish concept-count distributions.
3. Build and audit equal-information transformations and source-span maps.
4. Freeze task prompts, rubrics, hidden tests, retrieval settings, model/runtime/context settings, exclusions, non-inferiority margins, and analysis code.
5. Run the 12-task-per-repository blinded feasibility pilot. Adjust power and fix technical issues; do not include pilot tasks in confirmatory results.
6. Run 30 or more confirmatory tasks per repository, the synthetic scale fixture, then personal-bundle and maintenance subsets.
7. Blind-judge outputs, run hidden checks, and analyze all predeclared comparisons.
8. Publish manifests, raw per-run metrics, exclusions, analysis code, repository SHAs, transformations, and limitations. Respect repository licenses and do not republish source material beyond what those licenses allow.

Stop and repair the protocol before continuing if an arm sees additional facts, any transformation fails equivalence review, the hidden test is exposed, the CLI can read outside assigned bundle scope, personal information leaks between repository runs, or a benchmark task has a visible solution.

## Research sources

Accessed 2026-10-04. Findings below are limited to the authors' described settings.

- Liu et al., [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172), TACL 2024. Their controlled QA tests varied context length, distractor documents, and answer position; they report performance sensitivity to position and that adding retrieved documents can yield diminishing task gains. This motivates controlled position and distractor factors, not a claim that current coding agents have the same curve.
- Hsieh et al., [RULER: What's the Real Context Size of Your Long-Context Language Models?](https://arxiv.org/abs/2404.06654), 2024. Synthetic evaluations vary sequence length, task complexity, and distractor needles. It motivates testing beyond a single retrieval example, but its synthetic tasks are not repository work.
- Gloaguen et al., [Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?](https://www.sri.inf.ethz.ch/publications/gloaguen2026agentsmd), ICLR 2026 Workshop on Memory for LLM-Based Agentic Systems. In its tested SWE-bench tasks with generated context files and its developer-context issue collection, the authors report no task-success improvement and over 20% higher inference cost. This result concerns those context-file conditions; it does not establish that all context files raise cost or settle the value of searchable OKF at 10,000 concepts.
- Lulla et al., [On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents](https://arxiv.org/abs/2601.20404), JAWs 2026. In a study of 10 repositories and 124 pull requests with one agent/model setup, they compare runs with and without a root `AGENTS.md` and report 28.64% lower median runtime and 16.58% fewer output tokens with comparable task completion behavior. The authors' conditions differ from Gloaguen et al.'s; together these results argue for measuring the actual product workflow instead of applying either finding universally.
- Aleithan et al., [SWE-Bench+: Enhanced Coding Benchmark for LLMs](https://arxiv.org/abs/2410.06992), 2024. The authors report solution leakage and weak tests in inspected SWE-bench patches. This motivates newly authored held-out tasks, hidden acceptance checks, and leakage review.
- [OpenAI Codex documentation: Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), accessed 2026-10-04. Codex builds the instruction chain once at session startup from repository root to launch directory, combines up to the default 32 KiB, and does not automatically load files below that launch directory. The protocol fixes launch paths and captures the actual chain and truncation.
- [OpenAI Codex documentation: Build skills](https://learn.chatgpt.com/docs/build-skills), accessed 2026-10-04. Codex discovers local skills from repository `.agents/skills` locations and presents metadata before loading the full skill. The initial list has a 2% context or 8,000-character cap, descriptions can be shortened, and entries can be omitted. The native Codex skill arm must capture the actual list and usage trace, not infer it from files. This is distinct from the OpenAI API's hosted skill attachments.
- [OpenAI Developers: Testing Agent Skills Systematically with Evals](https://developers.openai.com/blog/eval-skills), accessed 2026-10-04. It describes Codex JSONL event traces and token-usage fields for evaluating skills. Use the local Codex behavior described above rather than treating API-hosted skill loading as the local comparator.
- [OpenAI API documentation: Skills](https://developers.openai.com/api/docs/guides/tools-skills), accessed 2026-10-04. This covers Responses API and Agents API skill attachment behavior. It is included only for distinguishing hosted API skills from Codex's local discovery mechanism.

## Executable defaults and remaining choices

- First runtime/model default: current Codex with `gpt-6.1-sol` at `high`, after exact availability recheck.
- Core repositories: Next.js, Supabase, Vercel AI SDK, and Biome. Use VS Code as a supplemental high-scale sample. Confirm task suitability and licenses during freeze.
- Scale: 100 and 1,000 source-backed concepts where available; always retain a distinct synthetic, human-audited 10,000-rule fixture. Use source-backed 10,000 only where a repository genuinely supplies enough concepts.
- Pilot/confirmatory task counts: 12 held-out pilot tasks per core repository; at least 30 confirmatory tasks per repository, raised as needed by pilot-based power analysis.
- Context limit and trace format: choose and freeze them during preregistration; use actual Codex prompt and usage traces.
- Thresholds: use the provisional bounds above unless the pilot requires a documented revision.
- Personal conflicts: test both `repo-wins` and `ask-on-conflict`; neither becomes product policy.
- Memory writes: compare read-only, explicit user capture, agent proposal with human review, and isolated spontaneous-write trials.
