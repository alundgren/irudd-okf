# Memory library

irudd-okf stores memory in local Markdown and portable JSON history. It is a CLI
and file engine. Scope supplies the human review UI. The existing agent session acts as librarian
when requested. No model or background worker runs inside irudd-okf.

Start with `context`, then `bundle inspect BUNDLE`. Inspect reports bundle root,
name, stable id, formatVersion, cliVersion, supportedFormatVersion and status:
current, migration-required, newer or invalid. Bundle format version 2 is
independent of software releases.

The executable owns the command reference. `cli browse` navigates command groups. Use `cli search "task terms"`, then
`cli schema COMMAND` for exact input schemas, outputs, examples, errors and
mutation disclosure. Discover `browse`, `search` and `read` for retrieval, `change`
commands for maintenance, and `migration guide` for format adoption.

## Memory fields

```markdown
---
type: Memory
title: Build locally before publication
memory:
  id: build-before-publication
  kind: procedural
  stage: bronze
  applicability: {type: repository, id: explicit-project-id}
---
Run the project's documented build and checks before publishing a change.
```

Kind is procedural, episodic or semantic. Stage is bronze, silver or gold, and is
independent of review. Agent creations start bronze. Applicability is global,
machine with an explicit id, or repository with an explicit id. Global memories
match every selected context. Scoped memories match only the corresponding
`--machine ID` or `--repository ID`. A bundle alias selects files and grants no
implicit applicability. Tags can describe topics.

## Accepted retrieval and proposals

`search`, `list`, `browse`, `index` and default `read` use accepted revisions.
`read --current` and `change read` explicitly expose proposed text for review.
Pending creation has no accepted recall. Pending edits and removals retain the
previous accepted memory. Rejection restores accepted bytes and retains the exact
rejected draft in history. External Markdown edits and removals become tracked
proposals and cannot replace accepted recall by bypassing the CLI.

`change propose BUNDLE --file REQUEST.json` records path, raw or null for removal,
expectedHash of the current file or null for new files, actor `{type,id}`, reason
and optional sources. Use requestId for durable retries. Mutations enforce
optimistic hashes and keep their publication intent until Markdown publication
completes. `change list` returns bounded pages; unreviewed older candidates become superseded
with replacementChangeId when the same path is revised. `change read` shows exact before and
after bytes, immutable revisionHash, sources, humanRequired and review history.

`change review BUNDLE ID --file REQUEST.json` accepts or rejects with
expectedRevisionHash, decision, actor, reason and all exact source revisions.
Human actors require operator:true. This records declared identity, without
claiming authentication. Agent and human events remain separately visible; the
latest human decision controls a reviewed proposal.

Agents may assess routine changes: new memories, edits to facts and episodes,
added evidence, stage changes, archiving and lifecycle dates. These need a human
decision:

- Changes to what a procedure says, including its kind, metadata, body and its
  archive, expiry or deprecation. Stage, `stale_after`, sources and
  `derived_from` are not part of the procedure text.
- Applicability changes, external edits and malformed files. While an external
  edit, a migration or a person's own proposal is pending for a file, every
  newer proposal for that file needs a human too.
- Updates that leave out an earlier source or depend on a corrected source.
  A source that only changed stage or lifecycle dates still counts as kept.
- Removals, unless the memory is a fact or episode whose exact accepted revision
  is a source of another accepted memory that is retained, not archived, expired
  or deprecated, has valid sources and has the same or global applicability.
  `change review` checks this again, so a removal becomes human-required if the
  citing memory is archived first.

Removing a file that already has a pending removal records a new proposal under
the current rules and supersedes the old one.

Trust labels describe the current revision. An agent-reviewed stage change to a
human-reviewed memory shows `machine-confirmed`, because no person saw the new
bytes. The library does not apply the profile setting `gold_review: human`;
agents can promote to gold.

Local source metadata and derived_from references automatically become source
guards, so a caller cannot omit them. Sources identify stable bundle/memory IDs
and exact raw hashes. Pending source changes retain accepted evidence. An accepted
source correction invalidates old dependent recall and requires a fresh proposal
and review. Historical accepted source bytes remain available after removal.
Consolidation creates its own memory, provenance and review; it inherits no source
approval. `change undo` restores retained before bytes as a fresh pending change,
including accepted removals. `change inspect` reads interrupted publication state
without acquiring the write lock. `change recover` verifies that a recorded writer
has stopped, retains lock evidence and resumes its intent. Intervening external
bytes become another pending revision and supersede the interrupted candidate.

## Files and migration

Sync memory-bundle.json, memory-history.json and Markdown together. The ignored
.irudd-okf directory holds runtime locks and recovery journals. A plain local
bundle works without Git. Personal mutations require --authorize-personal and an authorized task or
standing installed authorization for pending capture. Librarian dreaming begins
only when the operator requests it in an existing agent session. Generic OKF files remain accessible, but new
library semantics require explicit migration.

`migration guide BUNDLE` gives instructions for the installed CLI and lists
ambiguous note fields. Supply decisions keyed by path to `migration preview`.
Stable IDs, kind, stage and applicability must be explicit when absent. Unknown
YAML and comments remain; malformed YAML needs an explicitly repaired raw
candidate. Preview shows original/proposed bytes. Apply validates candidates again,
retains recovery and original bytes, and publishes the marker last. Migration
supports 10,000 Markdown documents and preview JSON up to 64 MB. The immutable
preview is retained once; a compact progress journal records completion. Interrupted
apply can resume the same preview using the maintenance journal. Migrated memories
remain pending until reviewed. Newer bundle versions reject writes from older
CLIs.

Optional legacy profile operations apply to generic bundles. Structured old review,
maintenance and rename operations cannot bypass pending proposal rules in a
versioned library. Use tracked changes for metadata, lifecycle and navigation edits.

Selective Git Markdown publication is unavailable for versioned libraries. Sync
the full bundle, including marker and portable revision history.
