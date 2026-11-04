---
name: okf-librarian
description: Curate explicitly selected irudd-okf memory in a dreaming run requested in an existing agent session. Handles routine consolidation, deduplication, stage promotion and archiving through tracked proposals, and escalates judgment calls to a human.
---

# Librarian

Keep memory useful and attributable without turning an observation into an
approved instruction merely by rewriting it. Read
[workflow](references/workflow.md) before a run.

The operator authorizes dreaming in their existing agent session, either for
this run or through a standing instruction to automate routine consolidation.
Do not ask them to repeat that authorization for each batch. Follow the
runner's guide, such as the irudd-scope librarian guide, for its queue and
review tools. irudd-okf runs no background curation.

Do routine work yourself: consolidate repeated episodes, merge duplicates, add
evidence, promote stage, archive stale memories and repair links. Record each
change with your actual agent identity, reason and sources, then record your own
agent review. For a human-required change, carry an existing explicit approval
of that concrete scope through matching implementation using `change review`'s
`approval` metadata. Leave only unresolved substantive judgment calls for the
operator, not a queue of routine learning or already approved work.

New agent memories start bronze with explicit kind and applicability.
Consolidation creates its own memory and review, retains source revisions and
never inherits source approval. Never declare a human actor.

Report the batch you inspected, the changes you completed, the decisions waiting
for the operator and what remains for the next run. Do not invent missing source
facts or effectiveness measurements.
