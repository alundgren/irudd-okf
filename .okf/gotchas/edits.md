---
type: Rule
title: Preserve raw files and draft recovery
description: A parser or stale read must not prevent access to a proposed edit.
tags: [editing, yaml, git, recovery]
---

Preserve unknown YAML fields, comments and untouched Markdown. A malformed
document must remain accessible as raw text. A failed optimistic write keeps
the draft for comparison. Check hashes again before publication.

Git PR preparation must validate directories in the selected base as well as
the current tree: `.okf` can be a symlink in an older commit. Keep the exact
target branch and resume partial publication using its retained journal.

Test partial file writes, invalid Markdown links, external edits and interrupted
publication. Ordinary success-path tests did not catch these cases during the
initial implementation review.

On macOS, normalize only verified, root-owned `/var`, `/tmp` and `/etc`
aliases to their standard `/private` destinations before checking directory
parents. Continue rejecting user-created symlinks. Native platform CI caught
this difference after Linux checks passed.

For browser draft source identity and review after changed backlinks, see
[viewer draft guidance](viewer-drafts.md).
