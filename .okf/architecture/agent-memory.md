---
type: Decision
title: Keep memory profile behavior in the file engine
description: Share namespace, evidence, review, lifecycle, and maintenance behavior across all clients.
tags: [architecture, memory, agents]
---

The canonical root memory-policy.md activates an agent memory profile. Generic
OKF bundles remain supported. Keep profile discovery, namespace selection,
content digests, source revision checks, dynamic time evaluation, diagnostics,
and protected mutations in core. CLI and browser clients consume the shared
contracts rather than implement their own memory rules.

A read selection adds shared memory to the selected namespace union. It does
not select a write destination or authorize access to an inactive bundle.
Each write has one namespace; absent destination means shared. Processing stage,
approval, and namespace do not decide instruction precedence.

Approval and verification bind to a content digest that includes production
provenance and decision-relevant metadata. Source revisions are recorded for
derived memories. Changed or rejected evidence requires review; a historical
episode becoming expired does not itself make its facts false.

Maintenance and migration previews cover supporting reads and the complete
file inventory. Journal progress before writing files, expose recovery through
core contracts, and preserve external edits on restart. Raw repair access and
optimistic whole-file hashes remain available. See [file edit guidance](../gotchas/edits.md)
and [runtime ownership](runtime.md).
