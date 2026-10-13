# Discover commands

The installed executable owns the command reference. Start with context and format
inspection, then load only the commands needed for the current task.

```sh
irudd-okf context
irudd-okf bundle inspect repo
irudd-okf cli search "accepted search read"
irudd-okf cli schema search
irudd-okf cli schema read
```

`search`, `list`, `browse` and default `read` return accepted memory. Search matches
explicit applicability: global always, machine or repository only when its ID is
provided. A bundle alias selects files, not applicability. `read --current` and
`change read` expose proposed text for review. They do not authorize its use as a
procedure.

Discover `change propose`, `change list`, `change read`, `change review` and
`change undo` for authorized maintenance. Their JSON schemas come from the core
request contracts. Changes retain exact raw bytes, source hashes and actor/reason.
Undo creates a pending restoration. Rejection restores accepted bytes and keeps
the rejected draft in portable history.

`memory-bundle.json`, `memory-history.json` and Markdown travel together. Git is
optional. The ignored `.irudd-okf` directory contains runtime locks and recovery
journals, not accepted knowledge. An older CLI refuses newer bundle writes.

The format version is independent of the CLI version. `migration guide BUNDLE`
gives instructions for the installed version and lists ambiguous fields. Preview
before applying. Resolve classification, stable identity and applicability
explicitly; malformed YAML requires an explicit repaired candidate. Original
bytes stay in history and recovery. The marker changes after all other migration
outputs succeed.
