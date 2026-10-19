---
type: Decision
title: Keep memory library rules in the file engine
description: Core owns applicability, accepted recall, immutable proposals and revision-bound review.
tags: [architecture, memory, agents]
---

The CLI calls the shared Effect core. Scope calls CLI JSON commands and persists
its own runs, queues and display selections. It does not implement memory rules.
Local file bundles need no Git, model service or background process.

Portable memory-bundle.json identifies the bundle and independent format version.
Portable memory-history.json retains immutable before/proposed bytes, declared
actors and reasons, source revisions, and separate agent/human decision events.
Sync those files with Markdown. Runtime locks and recovery journals remain in the
ignored .irudd-okf directory.

Every memory has a stable ID, explicit kind, independent bronze/silver/gold stage
and global, machine-ID or repository-ID applicability. Aliases and topics do not
imply scope. Agent creations start bronze. Pending edits and removals retain last
accepted recall. Default reads and navigation use accepted bytes; draft inspection
is explicit. External edits become proposals. Rejection restores accepted bytes
and retains its proposed revision. Undo creates a pending restoration.

Reviews bind an exact proposal and all accepted supporting source revisions.
Pending source drafts retain accepted evidence. Accepted source corrections require
fresh review of dependents. Historical evidence remains in immutable history after
removal. Human decisions remain distinct and agents cannot override them. Changes
to procedure text, applicability changes, external mutations, lost evidence and
removals of memories no retained memory cites require a deliberate operator
decision. Stage, archive and evidence bookkeeping stay routine so a librarian can
curate without asking about every file; docs/agent-memory.md lists the rules.

Migration preserves original bytes, requires explicit classification/applicability
and uses the protected journal. Validate candidates again during apply and publish
the version marker last. Newer bundle formats reject writes from older CLIs.
