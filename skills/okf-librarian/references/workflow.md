# Librarian workflow

## Establish the job

Use the task's explicit bundle, namespaces, mode, and permitted actions. Do not
search unrelated bundles or infer permission from a note. Shared records are
included in namespace retrieval. Namespace filtering is organization, not file
access control.

Read the root and relevant topic indexes and the canonical memory policy. Use
CLI discovery and per-command schemas for profile, bootstrap, audit, templates,
tasks, lifecycle, and maintenance operations. A generic bundle without a profile
remains readable. Propose a migration separately when requested; do not silently
classify every legacy note or replace its conventions.

Choose a bounded batch suitable for the scheduled run. Finish the selected batch
and report the rest rather than repeatedly searching the entire corpus.

## Audit mode

Audit may inspect excluded notes and exact source documents. Check profile
diagnostics, expired or stale notes, current review decisions, changed source
revisions, index reachability, missing replacement links, duplicate candidates,
and unresolved contradictions. A lexical similarity is a reason to compare two
notes, not evidence that they mean the same thing.

For task episodes, check the task's actual state only through sources or tools
authorized in the job. Unknown task state stays unknown. Do not close a task
because its last update is old. Keep event occurrence time separate from note
production time.

Produce a report without memory mutations. Reports should identify concrete
paths, the problem, evidence, and the proposed next action. Keep unavailable
evidence and measurements explicit.

## Propose mode

Search before adding a durable memory. Compare related notes and update one
that already covers the same lesson, preserving its revision history.

For each proposed consolidation:

- Determine whether the result is an episode, fact, or procedure. Split mixed
  content when its claims have different applicability or lifetimes.
- Verify claims against actual evidence. Record source links and the source
  content revisions used. Distinguish observation from inference.
- Preserve unsuccessful approaches and counterexamples. One successful task
  does not prove a procedure applies to all tasks of that kind.
- Write one explicit output namespace. Keep source namespace membership unless
  the operator authorized publication to a broader audience.
- Give a procedure its trigger, prerequisites, steps, applicability, and result
  check. Give a fact its relevant entity and validity conditions. Give an episode
  its occurrence time, task context, actions, and observed outcome.
- Set processing stage according to the work done. Processing stage does not
  confer human approval. New synthesis starts with its own review pending.
- Update affected topic indexes and relevant links in the same proposal.

Use the CLI maintenance proposal and preview workflow to produce a concrete
diff. A proposal can contain new or revised notes and index edits. Include
observed whole-file hashes, a reason, and any unresolved questions. Store proposal
files outside the repository. Do not apply them in propose mode.

Changing or rejecting a source requires examining its dependents. Expiration
from recall alone does not make a historical observation false. Before deleting
source notes, preserve stable evidence or enough independently checked evidence
to support the remaining summaries. Do not delete notes based only on age,
absence of recent reads, or an assumed improvement in token usage.

## Apply mode

Apply only actions explicitly permitted by the operator's job. The mode does
not authorize personal writes, publication, human approval, or namespace
promotion by itself. For example, a job may allow index repair and archival
while requiring proposals for changed procedures.

Review the concrete preview and its affected paths. Use the protected CLI apply
operation; do not bypass a stale preview with raw filesystem writes. If the
current files differ, inspect the changes and prepare a fresh proposal under
the same permitted scope. Preserve external edits.

On interruption, use the recorded journal and recovery workflow. Identify
already-applied and conflicting paths before retrying. Do not delete a write
lock or journal until its owner and current state have been checked. Report a
conflict instead of overwriting another writer's work.
Use `maintenance inspect BUNDLE PREVIEW_HASH` first. If the writer stopped,
`maintenance recover BUNDLE PREVIEW_HASH` checks its saved owner and lock before
releasing it. Retry the same reviewed preview only after successful recovery.

Task completion can start the configured retention interval. Recheck stale
durable memories rather than giving every fact or rule a TTL. Archive obsolete
memories separately from expiration and preserve replacement links.

Validate and lint the selected bundle after applied changes. A repeat run with
no new evidence should produce no further changes. Report actual changes and
remaining work; a successful format check does not prove the claims are true.
