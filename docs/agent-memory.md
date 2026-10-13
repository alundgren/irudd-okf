# Agent memory

An agent memory profile adds authoring, retrieval, review, and lifecycle
conventions to ordinary OKF files. The files remain readable without the CLI.
Generic OKF bundles remain supported. New bundles include the profile;
adopting it in an existing bundle uses a reviewed migration.

## Shared and selected memories

A note has one namespace. Missing namespace means shared. An agent can select
several namespaces, and the engine always adds shared to that selection.

```sh
irudd-okf bootstrap repo
irudd-okf namespaces repo
irudd-okf search "migration failures" --scope repo --namespace payments --namespace platform
```

Without namespace selection, retrieval considers all eligible namespaces.
Query terms and topic filters still determine relevance. Shared eligibility
does not mean every result contains the entire shared corpus. Read the compact
shared policy at startup, regardless of namespace selection. The installed
agent instructions and OKF skill describe the file-only equivalent.

The existing `--scope` selects a bundle. Namespaces never activate another
bundle or authorize personal memory access. They organize retrieval rather
than enforce filesystem permissions. Avoid storing confidential material in a
repository that an agent can read.

A write accepts one namespace through its metadata or the write option. If both
are present, they must agree. With neither present, the destination is shared.
Read selection does not set a write default. Unknown namespaces produce a
diagnostic or command error rather than silently creating a misspelled category.

## Profile policy

The canonical policy is `memory-policy.md` at the bundle root, linked from
`index.md`. It has `type: Memory policy` and a `memory_policy` mapping. For
example, its configuration can declare:

```yaml
memory_policy:
  name: agent-memory
  version: 1
  namespaces: [shared, payments, platform]
  topics: [memory, migrations, deployment, testing]
  task_retention_days: 30
  review_interval_days: 90
  gold_review: any
```

The integer identifies the profile schema. It does not limit the available
workflows. The registry includes shared; an omitted note namespace means shared.
Edit the policy through the same protected
file workflow as other notes when registering namespaces or topic vocabulary.

Only the canonical policy activates the profile. A missing policy means generic
OKF mode. A malformed or unsupported policy reports an error; the engine does
not silently pick another policy-like note. Exact reads and raw repairs remain
available. Root index frontmatter still declares only `okf_version`; the profile
does not add unsupported fields to reserved index files.

## Memory kinds and processing stages

| Kind | Content | Required context |
| --- | --- | --- |
| Procedural | Instructions for acting | Trigger, prerequisites, applicability, steps, and result check |
| Episodic | A particular event or task | Occurrence time, situation, actions, and observed outcome |
| Semantic | Facts, relationships, definitions, and current decisions | Relevant entities, evidence, and validity conditions |

Keep existing concept types such as `Rule`, `Incident`, and `Decision`. Use
`memory.kind` for this classification. Split a note when its events, facts, and
instructions have different evidence or lifetimes. Record unsuccessful
approaches and distinguish observation from inference.

`memory.stage` describes processing independently of memory kind and approval:

| Stage | Meaning |
| --- | --- |
| Bronze | Source observations with minimal interpretation |
| Silver | Normalized, attributable knowledge with duplicates addressed |
| Gold | Curated knowledge or procedures with checked evidence and resolved contradictions |

The policy's `gold_review` can permit machine or human review with `any`, or
require human review with `human`. Missing or insufficient current review is
reported for a gold note. An agent-authored gold note is
not automatically human-reviewed. Raw transcripts, screenshots, and run logs
belong in retained external artifacts, not in product commits.

## Authoring conventions

New profile notes need a type, title, description, useful topic tags, explicit
status, production actor/time, and memory kind/stage. Evidence-derived claims
need sources. Task episodes need a task reference and occurrence time. Notes
whose truth needs periodic checking use `stale_after`; notes with a known end
to usefulness use `memory.expires_at`.

Use tags for subjects. Store namespace, approval, processing, and lifetime in
their structured fields instead of encoding potentially contradictory tags.

Keep a route from the root index through the appropriate topic index to each
note. Add source links, prerequisites that affect application, and replacement
links for obsolete guidance. There is no required count of related links.

One episode could contain:

```yaml
type: Incident
title: Migration task stopped on an old client request
description: A task-specific record of the request that prevented migration.
tags: [migrations]
status: stable
generated:
  by: task-agent/model-version
  at: "2026-10-13T10:00:00Z"
sources:
  - id: task-record
    resource: https://example.invalid/tasks/42
memory:
  kind: episodic
  stage: bronze
  namespace: payments
  occurred_at: "2026-10-13T09:30:00Z"
  task:
    reference: https://example.invalid/tasks/42
    state: open
```

This is illustrative metadata. The body must record the actual request,
actions, observed result, and unresolved information. The example URL is a
placeholder, not supporting evidence.

Use `template BUNDLE --file REQUEST.json` to generate the appropriate body
outline and metadata, then write the reviewed document with its observed file
hash. Inspect `cli schema template` for the request contract. The CLI does not
invent sources or classify legacy content for you.

## Verification and decisions

`generated` identifies the producer and production time. `verified` records
checks against evidence. `memory.reviews` records approval or rejection. These
are separate from stage and lifetime.

Review and verification events bind to a canonical content digest. The digest
uses SHA-256 over UTF-8 JSON containing projected metadata and exact Markdown
body bytes. Mapping keys are sorted recursively and array order is retained.
It includes production provenance, sources, namespace, applicability, and
lifecycle metadata. `verified` and `memory.reviews` are excluded to
avoid self-reference. Meaningful edits invalidate the previous confirmation.
The whole-file SHA-256 returned by `read` separately protects mutations.

Metadata must have an unambiguous JSON projection before it can be confirmed.
For example, YAML `.inf` cannot become JSON `null` and preserve an approval.
Such documents receive a projection diagnostic and an explicit digest marker;
review and verification refuse them until the raw metadata is repaired.

Unbound legacy verification is visible as history. It does not manufacture
approval of the current content revision. Source approvals do not transfer to
a summary. Rejected current revisions leave ordinary recall but stay inspectable.
Pending procedures remain proposals rather than approved instructions.

```sh
irudd-okf read repo migrations/client-compatibility.md
irudd-okf verify repo migrations/client-compatibility.md --actor process:source-check --method "Compared with the current client contract" --expected HASH
irudd-okf review repo migrations/client-compatibility.md --decision approve --actor human:reviewer --reason "Checked the evidence and applicability" --expected HASH --operator
```

Replace `HASH` with a fresh read result before each mutation. Record only checks
actually performed. A nonhuman reviewer records a machine decision. Human
review requires a deliberate operator action. Actor metadata and the operator
acknowledgement do not provide cryptographic identity authentication.

## Lifetime and task tracking

`stale_after` means recheck accuracy. `memory.expires_at` means stop returning the
note in ordinary recall at or after that UTC instant. Archival and deprecation
are separate operations; deletion removes stored content. Exact reads and audits
remain available for excluded notes.

The engine evaluates time on each retrieval, including cached notes. Bad date
metadata is reported and the raw document remains accessible. Read frequency
does not silently extend retention or count as verification.

Procedural and semantic memories without `stale_after` use their production
timestamp plus the policy's `review_interval_days` as the effective deadline.
Lint reports the missing explicit date. Migration fills that deterministic date
when the kind and production time are known; ambiguous dates remain unresolved.

Use `task BUNDLE PATH --file TASK.json --expected HASH` to record a known task
state. A task file can contain:

```json
{
  "task": {
    "reference": "https://example.invalid/tasks/42",
    "state": "completed",
    "completed_at": "2026-10-13T11:00:00Z"
  },
  "retentionDays": 30
}
```

Completion or cancellation starts the retention interval. Open tasks remain
available. A retention reason can preserve an important historical episode.
Explicit null clears a retention override or reason under the command's schema.
Unknown task state stays unknown; a scheduled agent may check an authorized task
service and record the result. Retrieval does not make network calls.

Lifecycle actions include archive, restore, expire, deprecate, clear-expiration,
and recheck. Use a replacement when deprecating guidance. Clearing expiration
and renewing a freshness deadline are explicit actions rather than side effects
of reading or approving a note. Inspect `cli schema lifecycle` for options.

## Evidence and consolidation

Standard `sources` names cited material. For a locally derived memory,
`memory.derived_from` records the source resource and content digest used:

```yaml
sources:
  - id: incident
    resource: /migrations/episode-42.md
memory:
  derived_from:
    - resource: /migrations/episode-42.md
      content_hash: "<source content digest from read>"
```

Source corrections, rejection, unavailable evidence, and cyclic derivations are
reported explicitly. An old note points to its replacement through
`memory.replaced_by`; the new note can use `memory.replaces` for prior guidance.
Retrieval expiration alone does not invalidate a historical
observation. Source links appear in the graph and participate in link checks and
rename repair.

A librarian creates a separate durable fact or procedure from episodes. It checks
evidence and conditions, records source revisions, and starts its own review.
Consolidation preserves the namespace by default. Publication to shared or
another namespace needs an explicit decision. Similar wording alone does not
justify merging facts about different entities or environments.

## Audit, previews, and recovery

`audit` inspects excluded notes as well as current memories. It exposes profile,
freshness, review, source, and navigation diagnostics. A successful conformance
check does not prove a claim is true or a proposed consolidation is useful.

Maintenance proposals contain concrete file changes, observed hashes, a purpose,
and a reason. They can update memories and indexes together. Proposal files and
returned previews belong outside product commits. For example:

```json
{
  "version": 1,
  "bundle": "repo",
  "purpose": "consolidation",
  "reason": "Record the evidence-supported procedure and update its topic index.",
  "changes": [
    { "path": "migrations/procedure.md", "expectedHash": null, "raw": "<complete reviewed Markdown>" },
    { "path": "migrations/index.md", "expectedHash": "<observed file hash>", "raw": "<complete updated index>" }
  ]
}
```

```sh
irudd-okf maintenance preview --file /tmp/proposal.json
irudd-okf maintenance apply --file /tmp/preview.json
```

Save the returned preview JSON to the second file after inspecting its changes
and diagnostics. Preview guards cover affected files and supporting reads.
Changed sources, backlinks, or document inventory require a fresh preview.
Protected apply preserves
external edits and journals progress for restart. A retry distinguishes an
already-applied batch from a conflict. Keep journal and recovery evidence when
an operation reports a conflict; do not delete locks without inspecting their
owner and age. Inspect a retained batch through the CLI or wiki:

```sh
irudd-okf maintenance inspect repo PREVIEW_HASH
```

The inspection reports intended and current file states without overwriting
conflicting bytes. Personal applies require separate explicit authorization.

If an interrupted writer retained its lock, use the explicit recovery command:

```sh
irudd-okf maintenance recover repo PREVIEW_HASH
```

Recovery checks that the recorded owner process has stopped and that the lock
has not changed. It refuses live or uncertain owners. Inspect the batch again,
then retry the same reviewed preview. Keep recovery files outside publication;
new bundles ignore `.irudd-okf/`, and Git review rejects selecting those files.

Archive episodes before considering deletion. Do not delete an episode that is
the only remaining evidence for a durable memory. Repair references or retain
stable evidence through a reviewed maintenance proposal.

Migration uses the same preview/apply mechanism. Supply explicit decisions for
legacy kind, stage, provenance, and evidence where the existing file does not
provide them. Unresolved decisions are reported rather than fabricated. Unknown
metadata, comments, original evidence, and existing raw repair access are preserved.

## Scheduled agents

Install the portable personas in the skills directory used by your runner:

```sh
irudd-okf skill install /tmp/agent-skills --name okf-librarian
irudd-okf skill install /tmp/agent-skills --name okf-memory-reviewer
```

Use your actual runner's skills directory in place of the temporary example.
The native executable includes both personas. Installation preserves existing
customized destinations.

Give a scheduled agent a task such as:

```text
Use okf-librarian with irudd-okf to maintain bundle repo.
Select namespaces payments and platform, always including shared.
Mode: propose. Inspect one bounded batch of stale, expired, and changed-source
memories. Produce a concrete maintenance preview, without applying it.
Preserve evidence, failed cases, namespace membership, and approval history.
Write proposal and report files to the runner's external output directory.
Report unavailable task status and source evidence explicitly.
```

Audit mode makes no memory changes. Propose mode produces reviewable changes.
Apply mode executes only actions separately permitted by the job. Users can
allow index repairs and archival while keeping procedural changes under review.
The independent reviewer persona checks claims and the exact proposed revision.

The scheduler remains the user's existing runner, cron setup, or agent platform.
irudd-okf provides local files, CLI operations, personas, and protected proposals;
it does not require an embedded model service. No new schedule is installed by
writing a memory policy. A repeat run without new evidence should not create
another equivalent memory or repeatedly rewrite unchanged files.

## File-only use and compatibility

Without the CLI, read the root and shared policy, then search selected namespaces
plus shared. Check review revision bindings, evidence, and lifetime before relying
on a result. Ordinary editors cannot enforce all runtime retrieval conventions.

Generic `validate` checks OKF conformance. `lint` reports profile quality
conventions when the canonical policy activates them. Generic bundles, unknown
fields, and malformed documents remain available for inspection and repair.
Metadata never grants write authority or decides instruction precedence.
