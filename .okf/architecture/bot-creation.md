---
type: Decision
title: Bots are created by interview and checked before acceptance
description: The creator skill grills the user and proposes; core checks drafts and pending revisions with the resolver's rules.
tags: [architecture, bots, skills, agents]
---

`skills/bot-creator` is an ordinary authoring skill, not a builder app or a
form. It finds facts itself, asks the user only for decisions in
dependency-ordered rounds with recommendations, and challenges vague or
contradictory answers with concrete examples. Nothing is proposed until the
user confirms the brief and the exact proposal list, and a consequential open
decision keeps the draft unfinished. The definition stores the bot's working
instructions, stance and memory targets; the interview, the transcript and any
invented biography stay out. The creator proposes under its own agent identity,
never the new bot's, and changes another bot only by a separate confirmed
proposal. Activation stays manual.

`bot check` is the validation path for drafts and pending proposals. Core
overlays the bundle's latest pending revisions and the request's drafts onto
accepted documents and runs the same catalog and reference evaluation as
`bot resolve`. Candidates are review material: the check publishes nothing,
returns paths rather than memory content, and lists in `requires` which
unaccepted revisions a bot depends on so the approved work can be completed.
Two co-created bots that name each other therefore check as ready before either
is accepted.

A catalog candidate is compared with the accepted catalog and every undecided
catalog proposal since then, superseded ones included. Removing or re-pointing
any of those registrations is a top-level error whatever `--id` selects, so a
creator that rebuilt the catalog from stale bytes cannot silently unregister
another bot. Intent is explicit and exact: each confirmation names an ID and the new
definition path, or null for a removal, and covers only that change. A
confirmed change still cannot break another bot: any bot the candidate leaves
unusable, such as one whose collaborator is unregistered, is a top-level error
whatever `--id` selects. Identity checks call the same `identityConflict` rule that
`change review` uses, so a check never passes a revision acceptance refuses.

Core does not force a person's decision on seeded initial notes, because they
are ordinary memories. After one approval of the complete brief and saved-change
list, the creator checks and accepts the matching definition, registration,
starting notes and navigation through tracked review. It records its actual agent
identity and `approval` metadata citing the existing conversation, concrete scope
and exact implementation revisions, never a fabricated human review. Proposal IDs
generated afterward do not require another approval or Scope click. Pending
supporting notes use ordinary agent review or the same scoped approval. Substantive
deviations require a decision about the difference; unrelated pending revisions,
including borrowed edits in shared files, cannot be accepted by this scope.
A definition accepted without its seeded note
resolves with `complete: false` rather than borrowing the pending text.

Collaborators and memory in other libraries are checked only against their
accepted revisions. Drafts' pinned `sources` are left to `change review`.
