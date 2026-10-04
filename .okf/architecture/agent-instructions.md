---
type: Decision
title: CLI owns provider instruction sections
description: Keep machine setup in one CLI operation and portable authoring conventions in the bundle.
tags: [agents, setup, indexes, writing]
---

The CLI owns the short personal-memory section in each provider's global
instruction file. Scope supplies the registered personal bundle and invokes
provider-specific install, status and remove commands on each machine. Scope
uses separate Codex and Claude toggles; it should not duplicate section editing
or enable providers just because Git sync is active.

Preserve instructions outside our markers, reject ambiguous markers and known
symlink targets, and preserve existing permissions. Recheck the observed file
before atomic replacement and retain a private recovery copy. A nonempty Codex
global override prevents installation in the shared AGENTS.md until reconciled.
Preview and status must not create provider directories or touch memory files.

The managed text directs authorized authors to read root and topic indexes,
search duplicates and update the relevant index and links. The bundle's root
index owns its authoring conventions. New-bundle initialization includes a
guide; existing indexes are never replaced by setup. Retrieval effectiveness of
new wording requires a fresh experiment rather than reusing earlier scores.

Core lint can detect concepts disconnected from an authored root index through
Markdown links. This is optional quality guidance, not an OKF requirement or a
semantic review. Missing root indexes remain valid. Keep this diagnostic in the
shared file engine so CLI and UI consumers use the same link resolution.
