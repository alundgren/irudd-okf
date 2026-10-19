# Librarian workflow

A dreaming run processes routine memory work on its own and asks the person
only about changes that need their judgment. Most runs should end with a few
human decisions and a list of completed agent work, not a long review queue.

## Start the run

Run `context` and `bundle inspect` for the explicit bundle. Discover commands
with `cli search` and read `cli schema` before using an unfamiliar operation.
Read the root index and relevant topic indexes. Follow the runner's guide, such
as the irudd-scope librarian guide, for its queue and review tools.

Choose a bounded batch: for example, the pending changes plus one topic folder or
the 30 most recently changed memories. Finish that batch and report what you left
for the next run instead of rereading the whole bundle.

Proposals left pending by an earlier run keep the review requirement recorded
when they were made. Propose the same bytes again so core records a fresh
proposal with the current rules; the old one becomes superseded.

## Look for work

For each memory in the batch, check:

- Duplicates: two memories that state the same lesson. Lexical similarity is a
  reason to compare them, not proof that they mean the same thing.
- Repeated episodes: several episodes that show the same fact or the same steps.
- Contradictions: memories that disagree. Keep both and escalate unless the
  evidence clearly settles it.
- Stale or expired memories, and memories whose sources changed.
- Stage: whether the work already done on a memory supports a higher stage.
- Broken index entries and links.

For task episodes, check the task's actual state only through sources or tools
the run is allowed to use. Unknown task state stays unknown. Do not close a task
because its last update is old.

## Do routine work

Routine work needs no human decision. Propose it and record your own agent
review with the reason and evidence. Core accepts an agent review only when the
change is not human-required.

- Consolidate repeated episodes into a fact or procedure. Create the new memory
  at bronze with its own id, kind and applicability. Cite every episode it uses
  in `sources` or `memory.derived_from`. Keep failed attempts and
  counterexamples; one success does not prove a procedure fits every task.
- Merge duplicates. Keep the better memory, add the other as a source, accept
  that update, then delete the duplicate. Deleting a fact or episode is routine
  only after a retained, accepted memory with matching or global applicability
  cites its exact revision. Deleting a procedure always needs a human.
- Delete consolidated episodes the same way, after the consolidated memory is
  accepted.
- Add evidence to an existing memory. Every update must list the memory's
  current sources again; leaving one out counts as removing evidence and needs a
  human. Stage and archive changes on a cited memory keep its dependents valid.
- Promote stage by the work done: silver for normalized, attributable knowledge
  with sources; gold for curated guidance with checked evidence and stated limits.
  A stage change does not grant human approval and never widens applicability.
- Archive stale or obsolete memories by setting `memory.archived_at`, and add
  `memory.replaced_by` when a newer memory covers the lesson.
- Repair index entries and links. Each file is its own proposal; propose the
  memory first and its index edit second.

## Escalate judgment calls

Present these for a human decision with the exact before and after, the reason
and the evidence:

- Changing what a procedure tells an agent to do, or changing a memory's kind
  to or from procedural.
- Changing applicability.
- Deleting a procedure, or deleting a memory no retained memory cites.
- Replacing or removing a memory's sources.
- Un-archiving or extending the expiry of a procedure.
- Contradictions the evidence does not settle, and anything you are unsure about.

Core marks most of these as human-required and rejects an agent review of them.
Escalate the rest yourself.

## Finish

Validate and lint the bundle after the batch. Report what you changed, what is
waiting for the person, and what you left for the next run. A repeat run with no
new evidence should make no changes. A passing format check does not prove the
claims are true. Keep run reports outside the repository.

Restore a removal with `change undo`, which creates a fresh pending proposal.
Never erase history.
