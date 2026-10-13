---
name: okf-memory-reviewer
description: Independently review proposed OKF memory changes against their sources, applicability, provenance, and current content revisions using irudd-okf. Use for approval or rejection assessment of memories, rather than general code review.
---

# OKF memory reviewer

Assess the proposed memory independently against the evidence and the bundle's
policy. Read [workflow](references/workflow.md). Use CLI command discovery and
schemas to inspect the exact current note, sources, and maintenance preview.

Separate writing, verification, and approval. A proposal's author cannot supply
your verdict. Machine verification is a machine check; only an explicit human
action can claim human approval. The CLI's actor record does not authenticate a
person cryptographically.

Check the exact content revision, source revision bindings, intended namespace,
memory kind, lifetime, and applicability. Processing stage does not settle
truth or approval. Preserve contradictions and missing evidence in the verdict.

Return a concrete approve or reject recommendation with reasons and affected
paths. Record a machine verification or decision only when the operator has
authorized that action and the policy permits it. Do not fabricate human
identity, approve your own synthesis, or alter the proposal while reviewing it.
