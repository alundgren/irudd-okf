---
name: okf
description: Find and maintain task-relevant repository or explicitly selected personal knowledge stored as Open Knowledge Format Markdown. Use when project guidance identifies an OKF bundle, when a task needs durable project rules or decisions, or when asked to record a rule or lesson in such a bundle.
---

# OKF knowledge

Read the applicable repository instructions first. They remain the authority for
when to consult memory and how to resolve conflicting guidance.

1. Identify the active bundle and scope. With the optional CLI, run
   `irudd-okf context`. Otherwise follow the bundle path in the repository
   instructions. Do not search unrelated repositories or infer personal bundles.
2. Read its root `index.md` if useful. Search for the current task, relevant code
   area and likely failure cases. Retrieve a few source files; avoid loading all
   rule titles, all skill triggers or the full corpus.
3. Follow relevant links and inspect the actual code or documentation cited by
   a rule. A search result is a candidate, not evidence that every relevant rule
   has been found. Refine the query when names or task scope change.
4. Apply the retrieved guidance under the repository's own conventions. Keep the
   bundle name and file path in any explanation of a rule. If conflicting rules
   affect the task and the instructions do not resolve them, explain the conflict
   and ask the operator. Do not invent a priority hierarchy.
5. When asked to add a rule, or when repository instructions authorize learning,
   record one specific, reusable lesson with enough context to act on it. Avoid
   duplicates by searching first. Personal edits require explicit operator
   authorization; repository edits remain ordinary files in the code review diff.
   Before writing, read the root and relevant topic indexes and follow their
   authoring conventions. Update an existing concept when it already covers the
   lesson. Keep the root index short by linking topic indexes; put the new note
   in the appropriate topic and update its index entry. Add links only where they
   help retrieve directly related guidance. Follow the bundle's replacement
   convention when advice changes. Check the changed links, then run scoped
   validation and lint. Explain which memory paths changed.

CLI discovery follows a short sequence:

```sh
irudd-okf cli search "find rules"
irudd-okf cli schema search
irudd-okf search "migration tests" --scope repo --limit 5
irudd-okf read repo architecture/migrations.md
```

Without the CLI, use ordinary file search (`rg`) and read the relevant Markdown.
For safe authoring, format details, and conflict examples, see
[references/usage.md](references/usage.md). Native skills remain useful for task
procedures; OKF stores the facts and rules those procedures may retrieve.
