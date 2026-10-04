# Working on irudd-okf

Read the product behavior in README.md. Architecture decisions and lessons live
in `.okf/`; consult its index and search task-relevant concepts before editing.
The optional CLI and skills/okf explain retrieval. Ordinary file search works
too. Keep memory changes in the code review diff.

Use Effect 4 throughout our product and Foldkit for the browser UI. Maintain
shared contracts in packages/core/src/contracts.ts. Keep CLI and UI dependent
on the file engine rather than implementing their own OKF semantics.
Do not add an OKF-specific dependency or copy upstream implementations.

Run npm run check and npm run build for product changes. Exercise native and
browser smoke scripts when packaging or user flows change. Claims about agent
effectiveness require actual measurements; preserve unavailable metrics when
reporting results.

Do not commit one-off reports, test-run data, evidence of work, logs, screenshots,
publication receipts, or similar generated artifacts to this repository. Write
transient outputs to temporary directories outside the repository. Use CI
artifacts when retention is needed, and put verification summaries in PR
descriptions.

For GitHub operations use gh. Delegated agents do not merge their own child PR;
the coordinator merges reviewed work into the task integration branch.

Use direct names and explanations. Follow the operator's global restrictions
on original software prose and code names.
