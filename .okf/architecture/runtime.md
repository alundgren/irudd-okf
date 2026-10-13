---
type: Decision
title: One file engine for all clients
description: Keep portable Markdown as authority and implement OKF independently.
tags: [architecture, effect, okf]
---

Core owns bundle selection, document parsing, lexical retrieval, links and file
mutation. The CLI calls the core APIs and returns structured JSON. Scope owns
the library UI and calls the installed CLI. File contracts live in
`packages/core/src/contracts.ts`; Scope owns its review session and view state.

Use Effect 4.0 for product operations. Generic syntax libraries are allowed;
an OKF-specific dependency or copied reference implementation is outside scope.
Runtime bundle registration stays outside portable OKF directories.

Do not infer rule precedence from a bundle alias or metadata field. Users write
their own repository conventions.
