---
okf_version: "0.2"
---

# Project knowledge

- [Runtime and file ownership](architecture/runtime.md): Share file semantics across CLI and UI.
- [Source installation and upgrades](architecture/installation.md): Build locally from a separate clone and check main without changing it.
- [Provider instructions and authoring](architecture/agent-instructions.md): Manage one section per provider and keep notes connected to topic indexes.
- [Agent memory profiles](architecture/agent-memory.md): Keep shared retrieval, evidence revisions, review, and lifecycle in core; reads take no lock and write nothing.
- [Named bot definitions](architecture/bots.md): Resolve accepted bots from an explicit catalog without inference; activate one only through the manual-only bot skill.
- [Bot creation and checks](architecture/bot-creation.md): Interview before proposing; check drafts with the resolver's rules.
- [Safe memory edits](gotchas/edits.md): Keep raw text and recover from conflicts.
