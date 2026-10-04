---
type: Decision
title: One file engine for all clients
description: Keep portable Markdown as authority and implement OKF independently.
tags: [architecture, effect, okf]
---

Core owns bundle selection, document parsing, lexical retrieval, links and file
mutation. The CLI and local Foldkit UI call the same core APIs. Their contracts
live in `packages/core/src/contracts.ts`.

Use Effect 4.0 for product operations. Generic syntax libraries are allowed;
an OKF-specific dependency or copied reference implementation is outside scope.
Runtime bundle registration stays outside portable OKF directories.

Do not infer rule precedence from a bundle alias or metadata field. Users write
their own repository conventions.
