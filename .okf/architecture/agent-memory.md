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

Reads take no lock and write nothing, so they work in read-only sandboxes,
beside each other and beside a running writer. Taking the write lock for reads
made sandboxed threads fail with EPERM and parallel readers fail with LOCKED.
Accepted content comes from history, which writes replace atomically, and a
decision reaches history before its Markdown publication, so an unfinished
publication cannot change an accepted result. Reads report it as
PUBLICATION_INCOMPLETE and never complete it. Writes hold the lock: they finish
the publication, then record outside edits. Change listings, change read and bot
check show unrecorded outside edits in memory with an ID and timestamp derived
from history and file state, so the next write records the same proposal and a
person can review the listed ID. A removal takes its path's latest proposal
time and an edit its modification time, never earlier; a parent folder's time
changed with every sibling edit. A file that holds neither the old nor the new
bytes of an unfinished publication stops those classifications until change
recover.

Reads check files and the lock after reading history, and accept the result
only if history is unchanged when read again, re-evaluating the paths a
concurrent write touched. Without this, a write that finished in between looked
like a stopped publication or an outside edit. Windows refuses a rename while a
reader has the file open, so publication retries those sharing errors briefly
instead of excluding readers, and path checks validate a file again when an
atomic replace swaps it mid-check rather than reporting UNSAFE_PATH.

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
