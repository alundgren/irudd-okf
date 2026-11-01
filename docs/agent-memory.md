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
  edit, a migration or a person's own proposal is pending for a file, agent
  proposals for that file fail with `HUMAN_DECISION_PENDING`; present the
  pending change instead.
- Creating, editing or removing a bot catalog or bot definition, judged by the
  type before and after the change.
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

## Bot definitions

A bot is one complete named definition stored as accepted library memory. There
are no reusable roles, templates or inheritance. Each library registers its bots
in `bots/catalog.md`, an accepted memory with `type: Bot catalog`:

```markdown
---
type: Bot catalog
title: Bots
memory: {id: bot-catalog, kind: procedural, stage: bronze, applicability: {type: global}}
bots:
  - {id: game1-playtester, definition: game1-playtester.md}
---
```

Each entry pairs a stable bot ID with a definition path relative to the catalog.
The definition's memory ID must equal that ID. A definition has
`type: Bot definition` and a `bot` mapping:

```yaml
memory: {id: game1-playtester, kind: procedural, stage: bronze, applicability: {type: global}}
bot:
  name: "game1: playtester"        # literal visible name; spaces and colons allowed
  purpose: Plays game1 and turns observations into feedback.
  identity: |                      # persona and soul
    ...
  instructions: |                  # operational instructions
    ...
  collaborators:                   # stable bot IDs; bundle defaults to this library
    - {bot: game1-coordinator, handoff: Send accepted feedback to the coordinator.}
  memory:                          # explicit targets; nothing is inferred
    - id: own-notes
      role: own                    # own or shared
      path: game1/playtester       # a directory prefix or one .md note
      repository: game1            # applicability context used when reading
      read: On activation and when asked to refresh.
      write: Propose an observation after a verified playtest.
  workspace: Optional workspace guidance.
  tests: Optional test guidance.
```

A memory target may name another library by its stable bundle ID (`bundle`,
from `bundle inspect`); otherwise it reads the definition's own library. Targets
select accepted memories with the declared `repository` or `machine`
applicability plus global memories. Bundle aliases, bot names and the working
directory never select memory.

A person decides every creation, edit and removal of a catalog or definition,
including a definition for an entry that is already registered, and every
proposal at `bots/catalog.md` whatever its type. Agents cannot
accept or reject these changes. Both documents must also be procedural.

`bot list` reads accepted catalogs in every selected library and returns names,
short purposes, stable IDs, accepted definition revisions and diagnostics. It
returns no memory content. `bot resolve NAME` matches the name exactly and
returns the accepted definition, collaborators and the current accepted
documents of each memory target. `--id ID` resolves a stable ID; `--scope
BUNDLE` enumerates only that library; other libraries are read only when a
memory target or collaborator names them. Unknown names (`BOT_NOT_FOUND`),
shared names (`BOT_NAME_AMBIGUOUS`) and registrations whose definition is
missing, pending, invalid or excluded (`BOT_UNAVAILABLE`) fail without
selecting another bot. An unavailable registration whose accepted definition
still declares a name counts as a namesake, so it makes that name ambiguous
rather than letting another library's bot answer. Registrations without an
accepted name are listed in error details or as a `BOT_UNNAMED_REGISTRATIONS`
warning. When a library cannot be read, or its catalog is invalid or in an
unsupported format, `bot list` reports it and an unscoped `bot resolve` fails
with `BOT_CATALOG_INCOMPLETE`; use `--scope` for a readable library. Broken
memory or collaborator references appear in `diagnostics` with
`complete: false`; no other memory is substituted.

Pending catalog and definition changes never replace accepted ones. Memory
targets are destinations, not provenance: each resolution reads their current
accepted revision, and accepting a memory update leaves the definition
unchanged. Use `sources` or `derived_from` only for evidence pinned to an exact
revision.

A bot's memory proposals keep the actual run as actor `{type, id}`. Record the
persona separately in the note, for example `persona: {bot: game1-playtester}`.

### Creating and checking bots

The `bot-creator` skill interviews the user, confirms a brief with them and then
proposes the definition, catalog entry and any sourced initial notes under the
creator's own agent identity. It stores the bot's working instructions, not the
interview. While a consequential decision is open, it proposes nothing. It
changes another bot only through a separate proposal the user confirmed.

`bot check BUNDLE [--id ID] [--file REQUEST.json]` validates a bot before a
person accepts it. The optional request is `{"drafts": [{"path", "raw"}],
"confirmedRegistrationChanges": [{"id", "path"}]}`. The check evaluates that library as if
its pending proposals and the drafts were accepted, then applies the resolver's
rules: required fields, procedural kind, catalog registration, ID match, unique
names across the selected libraries, collaborators and memory targets. A target
note must have an accepted or candidate revision; an empty target directory is
a warning. It also applies the identity rules acceptance enforces, reporting
`MEMORY_ID_CONFLICT` or `DUPLICATE_MEMORY_ID` for a candidate that review would
refuse.

When a catalog candidate is present, the check compares it with the accepted
catalog and with every catalog proposal since then that no person decided,
including superseded ones. Each registration it removes or points elsewhere is
a top-level `BOT_CATALOG_REGISTRATION_REMOVED` or
`BOT_CATALOG_REGISTRATION_CHANGED` diagnostic, whatever `--id` selects. It is
an error unless `confirmedRegistrationChanges` names that exact change: the ID
and the new definition path in the bundle, or `null` for a removal. A
confirmation covers only that change, and one that matches nothing is a
`BOT_CATALOG_CONFIRMATION_UNUSED` warning. Confirmations are reserved for
changes the user confirmed; include them again when checking the pending
proposals. Any other bot in the library that the candidate leaves unusable, for
example because its collaborator is no longer registered or its entry points at
a missing definition, is a top-level `BOT_CATALOG_BREAKS_BOT` error that no
confirmation removes. Build catalog edits from `read --current` bytes so
pending entries survive. Each bot lists in `requires` the unaccepted
revisions it depends on, which a person should accept together. `candidates`
shows each pending revision's change ID and actor. Additional error codes are
`BOT_CHECK_UNREGISTERED` (no catalog entry registers a definition),
`BOT_NAME_DUPLICATE`, `BOT_CHECK_CANDIDATE_INVALID` (a draft is not a valid
library memory) and `BOT_CHECK_EMPTY`. A registration whose definition exists
nowhere has state `missing`. `ready` is true only when no checked bot and no
top-level diagnostic has an error.

The check proposes and accepts nothing, and returns paths without memory
content. Collaborators and memory in other libraries must already be
accepted there. Pinned `sources` of drafts are not checked; `change review`
still verifies them.
