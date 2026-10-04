---
type: Rule
title: Keep viewer drafts attached to their source directory
tags: [ui, drafts, bundles]
---

Bind a recovered browser draft to the canonical bundle directory and file path.
A bundle alias alone is insufficient: another checkout can reuse `repo` and the
same relative path. Confirm the loaded context before restoring or saving.

Rename previews must include every affected file. If a backlink changes after
preview, ask the operator to review a fresh diff before applying the rename.

These cases were reproduced and checked against the local viewer during product
validation. See [file edit guidance](edits.md).
