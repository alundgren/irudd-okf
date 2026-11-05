# Writing and proposing a bot definition

## Place and identity

- **Library.** Use the library the user chose. Identify it with `bundle
  inspect` and keep its stable `id` for cross-library references. A personal
  library needs no Git repository or working directory.
- **Stable ID.** Derive a lowercase, hyphenated ID from the literal name, for
  example `game1: playtester` becomes `game1-playtester`. Check `bot list` and
  `read --current` so it is not already used.
- **Paths.** The definition lives at `bots/ID.md` and is registered in
  `bots/catalog.md` with `{id: ID, definition: ID.md}`. Add the entry to the
  current bytes from `read LIBRARY bots/catalog.md --current`, not the accepted
  revision, so that pending entries from other proposals are kept. Use that
  read's hash as `expectedHash`. When the library has no catalog, propose a new
  one:

  ```yaml
  ---
  type: Bot catalog
  title: Bots
  memory: {id: bot-catalog, kind: procedural, stage: bronze, applicability: {type: global}}
  bots:
    - {id: game1-playtester, definition: game1-playtester.md}
  ---
  Bots registered in this library.
  ```
- **Memory destinations.** Prefer one directory for the bot's own notes, such
  as `game1/playtester`, and point shared targets at the directory or note the
  collaborators already use. Use the repository or machine ID that existing
  notes for that project carry. Propose a new ID only when none exists, and
  list it in the brief.

## Definition

```yaml
---
type: Bot definition
title: "game1: playtester"
memory: {id: game1-playtester, kind: procedural, stage: bronze, applicability: {type: global}}
bot:
  name: "game1: playtester"
  purpose: One line the bot list shows.
  identity: |
    Who the bot is in this library and its agreed stance or tone. No invented
    biography, credentials or experience.
  instructions: |
    Responsibilities and boundaries, including what it must not do.
    Decision rights: who decides what.
    Good and bad results, with the agreed examples.
    Handoffs: what goes to which collaborator, and where.
    Knowledge and authority: what wins when sources disagree.
    Memory: read and refresh at the agreed points; propose writes with your
    actual agent identity as actor and persona {bot: ID} in the note. Check and
    accept routine supported observations and consolidation yourself within
    authorized targets. Carry an existing conversational approval through its
    matching implementation; ask only for a new substantive decision. Never
    invent human review or treat pending proposals as accepted.
    Corrections and conflicts: what to do when corrected or contradicted.
  collaborators:
    - bot: game1-coordinator
      handoff: What passes to it and through which memory.
  memory:
    - id: own-notes
      role: own
      path: game1/playtester
      repository: game1
      read: When the bot is activated and when asked to refresh.
      write: Propose, check and accept routine notes after a verified session.
    - id: direction
      role: shared
      path: game1/shared/direction.md
      repository: game1
      read: When activated and before each session.
      write: Never edit; send direction questions to the coordinator.
  workspace: |
    Required tools, environments and isolation.
  tests: |
    The representative trial and what a pass looks like.
---
Two or three sentences for reviewers: what the bot is for, the initial notes
proposed with it and their sources, and the date the user confirmed the brief.
```

- `identity` holds stance only; `instructions` holds operational rules. Do not
  mix them.
- Use block style as shown. Rule text often contains commas or colons, which
  break flow mappings such as `{read: ..., write: ...}`.
- Write instructions in the second person as working rules. Leave out the
  interview, its questions and the conversation transcript.
- `bot resolve`, and activation through it, returns the `bot` fields, not the
  Markdown body, so everything the bot must do belongs in those fields.
- A `.md` memory target must already exist; point at a directory when notes
  will appear later. Targets are destinations, so never add them to `sources`
  or `derived_from`.
- Name collaborators by stable ID, plus `bundle` when they live in another
  library. Every collaborator must already be registered or be proposed with
  this bot.

## Initial knowledge

Seed only facts with a source: an accepted note, a project file or the user's
own statement in this conversation. Use `template` for a valid note, start it
at bronze with explicit applicability, cite the source in the note, and mark
unknowns as unknown. Do not seed guesses, the brief or the transcript.

## Check

Write the drafts to a JSON file outside the repository and check them:

```json
{"drafts": [{"path": "bots/game1-playtester.md", "raw": "..."}, {"path": "bots/catalog.md", "raw": "..."}], "confirmedRegistrationChanges": [{"id": "old-helper", "path": null}]}
```

```sh
irudd-okf bot check LIBRARY --id game1-playtester --file drafts.json
```

The check treats the library as if its pending proposals and these drafts were
accepted. It reports missing or invalid fields, an unregistered definition, an
ID mismatch, a duplicate name, unknown collaborators and memory targets with no
accepted or proposed note. It also applies the identity rules acceptance
enforces: a memory keeps its first ID (`MEMORY_ID_CONFLICT`) and no two
memories share one (`DUPLICATE_MEMORY_ID`).

Whatever `--id` selects, the top-level diagnostics report every accepted or
undecided catalog entry your catalog removes or re-points
(`BOT_CATALOG_REGISTRATION_REMOVED`, `BOT_CATALOG_REGISTRATION_CHANGED`).
These are errors unless `confirmedRegistrationChanges` names that exact change:
the ID and the definition path in the library it will point at, or `null` for
a removal. Fill it only with changes the user confirmed separately; a
confirmation that matches nothing is reported as
`BOT_CATALOG_CONFIRMATION_UNUSED`. `BOT_CATALOG_BREAKS_BOT` is an error for any
other bot your catalog leaves unusable, such as one whose collaborator you
unregister or an entry re-pointed to a missing definition. No confirmation
excuses it. After proposing, check again with a file holding only the
confirmations.

`requires` lists the unaccepted revisions the bot depends on. A
`BOT_MEMORY_EMPTY` warning on a new own-notes directory is expected. Continue
only when `ready` is true.

## Propose

Propose the notes first, then the definition, then the catalog. Each request:

```json
{"path": "bots/game1-playtester.md", "raw": "...", "expectedHash": null, "actor": {"type": "agent", "id": "YOUR-ACTUAL-RUN-ID"}, "reason": "Create game1: playtester from the brief the user confirmed."}
```

- For an update, `expectedHash` is the current file hash from `read --current`.
  If the propose fails with `CONFLICT`, another proposal arrived: read the
  current bytes again, rebuild the edit and check again.
- The actor is your own run, never the new bot, another bot or a person.
- A personal library also needs `--authorize-personal`, which standing
  instructions or the user's explicit agreement to this proposal list must
  allow.
- Core marks bot catalogs and definitions as requiring a human decision. The
  user's confirmed brief supplies that decision; carry it through agent
  execution below rather than leaving another review chore.

## Complete the approved work

Discover `cli schema change review`. Use your actual agent identity, the exact
`expectedRevisionHash` and full `sources` from `change read`. Add `approval` for
the already approved brief, with its conversation reference, concrete scope and
only the matching implementation paths/revision hashes. Construct this bounded
list after proposals exist; the user need not approve IDs or hashes. Example:

```json
{"expectedRevisionHash": "PROPOSAL_REVISION_HASH", "decision": "accept", "actor": {"type": "agent", "id": "YOUR-ACTUAL-RUN-ID"}, "reason": "Checked this implementation against the confirmed brief and sources.", "sources": [], "approval": {"reference": "conversation/session-id: user's yes following the complete brief", "scope": "Create the agreed playtester, register it, and save its sourced starting note and navigation.", "changes": [{"path": "bots/game1-playtester.md", "revisionHash": "PROPOSAL_REVISION_HASH"}]}}
```

Include all and only your matching approved revisions in `approval.changes` and
reuse that list for the corresponding review calls. Supporting notes that are
routine may instead use ordinary agent review. Do not declare a human actor or
set `operator: true`: the user approved the brief, and you checked the generated
bytes. History records both facts without granting a human-reviewed trust label.
This is an attribution of existing approval, not a request for new approval or
a requirement to prepare another document for the user.

An old approval list cannot accept a changed revision or an unrelated path.
After a conflict or repair, compare the new bytes to the brief before binding
the new revision. Storage-only repairs within scope need no further approval;
substantive deviations need the user's decision about that difference. The CLI
checks exact revisions and sources; the agent is responsible for judging
whether implementation matches the brief. Never invent approval from mere
interest in making a bot or from an incomplete interview.

For a resumed creation, read the already pending proposals and the original
approved brief, verify they match, and finish their acceptance. Do not re-propose
unchanged bytes or restart the interview just because an earlier skill stopped
at a queue. An older CLI without `approval` support needs this repository's
updated CLI; do not fall back to impersonating a human.
