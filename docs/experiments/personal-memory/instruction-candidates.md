# Instructions for a later integration

These are the locator instructions used by the experiment, with its temporary absolute path replaced by `BUNDLE_PATH`. Resolve that path separately on each machine. The experiment changed no machine-wide instructions.

## Global locator

```text
Personal development memories live in BUNDLE_PATH. Before editing, read index.md and search for task-relevant guidance. Retrieve a few applicable files; check scope and replacement links.
```

The experiment's common repository instructions also said that repository instructions override conflicting personal defaults and that personal guidance is read-only. Keep those policies with the integration.

## Locator with a search recipe

The `search` treatment added this sentence to the global locator above:

```text
Use rg -n -i 'task terms' 'BUNDLE_PATH' to locate candidate files, then read relevant Markdown. Refine terms if needed.
```

Replace `task terms` with words from the current task. This treatment passed all three large-corpus usage trials, with a median of 57,858 total tokens compared with 92,777 for the bare locator. That is a descriptive result on one authored task.

## Repository symlink locator

```text
When .okf/personal exists, consult its index.md and search its task-relevant Markdown before editing. Ordinary rg does not traverse directory symlinks by default; use an explicit .okf/personal/ search root or rg -L.
```

This variant uses ordinary file retrieval. The current OKF engine rejects symlink roots and skips symlinked subdirectories; its registered personal bundle should point to the actual directory.

Both variants assume the root index contains the experiment's short explanation: concept files are Markdown with YAML frontmatter; search the current task's terms, read a few matches, check project scope, and follow replacement links for obsolete rules. The format permits a root index but does not ensure automatic discovery. The locator supplies that discovery step.

Suggested candidate paths are a separate treatment: the caller searches visible task words and supplies up to three paths. It still asks the agent to inspect content and scope. This study does not establish that adding another sentence to a global instruction reproduces that caller-side treatment.
