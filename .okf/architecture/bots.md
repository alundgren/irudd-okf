---
type: Decision
title: Bots are accepted definitions in an explicit catalog
description: Resolve complete named bots from accepted library memory without roles, inference or pinned targets.
tags: [architecture, bots, memory, agents]
---

A bot is one complete definition, not a role or template. Each library
registers bots in the accepted `bots/catalog.md`; entries pair a stable ID
(the definition's memory ID) with a relative definition path. Visible names
are literal strings and are matched exactly. Core owns catalog reading,
validation and resolution so the CLI, activation skill and Scope all use the
same `BotCatalog` and `ResolvedBot` contracts.

Core requires a person's decision for every creation, edit and removal of a
document typed as a bot catalog or definition, before or after the change, and
rechecks this at review. Any proposal for `bots/catalog.md` (compared
case-insensitively) counts too, whatever its type: an ordinary note there
would block every unscoped resolution. Kind alone is not enough: an agent-created memory
does not ordinarily need a person, so an agent could otherwise register a bot
that reads any memory. The resolver still requires procedural kind. Pending
catalog or definition revisions never affect discovery.

An unavailable registration that still has an accepted name counts as a
namesake, and a library whose catalog cannot be enumerated blocks unscoped
resolution. Otherwise a broken or unreadable bot would silently yield to a
bot with the same name in another library.

Memory targets name a stable bundle ID (or the definition's own library), a
path and explicit repository or machine applicability. Never derive memory from
a bot name, bundle alias or the working directory. A missing bundle, note or
collaborator is a diagnostic; resolution never substitutes other memory or
another bot.

Targets are destinations resolved to the current accepted revision. Do not put
them in `sources` or `derived_from`: those pin evidence revisions, and an
accepted update would exclude the definition from recall.

Library reads take the bundle write lock, so two concurrent CLI reads of one
library can fail with `LOCKED`. Retry after the other command finishes. A
locked library is reported as `BOT_LIBRARY_LOCKED`, not as damage, and an
unscoped resolve blocked only by locks fails with `LOCKED`. With
`--scope`, resolution reads only that library and libraries its references
name, so an unrelated locked library does not block it.
