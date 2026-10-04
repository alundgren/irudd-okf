# irudd-okf — exploration handoff

## Goal

Explore a small, transparent, MIT-licensed agent-memory/runtime system built around Google's **Open Knowledge Format (OKF)**.

The motivating use case is coding agents working across several repositories while having two explicit sources of durable memory:

1. **Repository memory** — an OKF bundle committed with each repository.
2. **Personal/shared memory** — a separate OKF bundle containing stable preferences, tools, conventions, workflows, etc.

An agent working in repository A should operate against:

```text
personal bundle + repository A bundle
```

An agent working in repository B should operate against:

```text
personal bundle + repository B bundle
```

It should *not* automatically see knowledge from unrelated repositories.

The important property is that memory scope is explicit and inspectable rather than being determined by a global semantic-memory system.

---

# Core idea

Example layout:

```text
~/knowledge/me/
└── .okf/
    ├── index.md
    ├── preferences/
    ├── tools/
    ├── workflows/
    └── ...

~/src/project-a/
├── .okf/
│   ├── index.md
│   ├── architecture/
│   ├── decisions/
│   ├── domain/
│   └── gotchas/
└── src/

~/src/project-b/
├── .okf/
│   └── ...
└── src/
```

At runtime:

```text
                         ~/knowledge/me/.okf
                                 │
                                 │ shared read scope
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼

       repo-a/.okf        repo-b/.okf        repo-c/.okf
              │                  │                  │
              ▼                  ▼                  ▼
          Agent A            Agent B            Agent C

        effective           effective           effective
         memory              memory              memory

        me + A              me + B              me + C
```

Do not merge these into one physical bundle.

Composition should happen at the runtime/search layer.

---

# What OKF provides

OKF v0.2 is deliberately small.

A bundle is essentially:

```text
directory
  ├── index.md
  ├── foo.md
  └── subdirectory/
      ├── index.md
      └── bar.md
```

Concepts are Markdown documents with YAML frontmatter:

```markdown
---
type: Decision
title: Use SQLite for agent state
description: Why this project stores local state in SQLite.
tags: [architecture, persistence]
---

# Decision

Use SQLite...

Related: [Agent runtime](../architecture/agent-runtime.md)
```

OKF deliberately does **not** prescribe:

- database
- vector store
- embeddings
- search implementation
- agent framework
- model provider
- serving infrastructure
- runtime

The format is intended to work directly from files and git.

That distinction is central to this project:

```text
OKF
=
portable storage / interchange format

irudd-okf
=
runtime and workflow around OKF
```

---

# Interesting part of irudd-okf

Do **not** start by trying to build "another OKF implementation".

The interesting question is:

> What is the smallest useful runtime that makes OKF practical as durable memory for coding agents?

In particular:

## 1. Bundle discovery

Given a working directory:

```text
~/src/foo
```

discover:

```text
repo bundle:
~/src/foo/.okf

shared bundles:
~/knowledge/me/.okf
```

Potential configuration:

```yaml
bundles:
  me: ~/.config/irudd-okf/me
  repo: ./.okf

scope:
  default:
    - me
    - repo
```

Exact config format is TBD.

Avoid baking unnecessary configuration machinery into v1.

---

## 2. Scoped retrieval

The important abstraction may be something like:

```text
search("database migrations", scope=["me", "repo"])
```

rather than:

```text
search every piece of memory ever created
```

The runtime should make the active bundle set obvious.

Potential CLI:

```bash
irudd-okf context
```

Output:

```text
Active OKF bundles:

  me    ~/.config/irudd-okf/me
  repo  /Users/me/src/foo/.okf
```

And:

```bash
irudd-okf search "database migrations"
```

searches only those bundles.

Possibly:

```bash
irudd-okf search @repo "database migrations"
irudd-okf search @me "typescript preferences"
```

Do not decide syntax before testing what agents naturally work well with.

---

# Progressive disclosure

A core design principle should be:

> Never inject the whole memory corpus into model context.

An agent should first receive a tiny map/index.

For example:

```text
1. Read bundle index.
2. Search for concepts relevant to the current task.
3. Read only the handful of matching concepts.
4. Perform work.
5. Update memory if something durable was learned.
```

Conceptually:

```text
          query
            │
            ▼
      ┌─────────────┐
      │ bundle index│
      └──────┬──────┘
             │
             ▼
          search
             │
       ┌─────┴─────┐
       ▼           ▼
    concept     concept
       │           │
       └─────┬─────┘
             ▼
        model context
```

This is more interesting than blindly implementing RAG.

Initially prefer boring deterministic search:

- paths
- titles
- descriptions
- tags
- Markdown content
- links/backlinks

Possibly BM25 later.

Do **not** begin with embeddings or a vector database unless experiments demonstrate a need.

---

# Reads vs writes

Treat personal and repository memory asymmetrically.

Default policy:

```text
READ

repo bundle       yes
personal bundle   yes


WRITE

repo bundle       normal
personal bundle   conservative
```

Examples:

### Repository memory

An agent learns:

> Invoice event timestamps represent ingestion time, not accounting date.

Write:

```text
repo/.okf/domain/invoice-timestamps.md
```

### Personal memory

An agent learns:

> The user generally does not want GPL-family dependencies.

Potentially write:

```text
me/.okf/preferences/licenses.md
```

The second category should be substantially harder to create accidentally.

Explore whether personal-memory writes should require:

- explicit agent intent
- higher confidence
- user confirmation
- a different command
- or simply an agent-policy rule

Do not assume the answer yet.

---

# Git should be part of the model

Repository OKF exists **inside the repository specifically so normal software-engineering workflows apply**.

That gives us:

```text
diff
history
blame
branches
PR review
reverts
merge conflict resolution
```

Memory changes should therefore look like ordinary source changes.

Example:

```diff
 .okf/architecture/database.md
 .okf/decisions/queue.md
 src/queue/worker.ts
```

A reviewer can inspect the code change and the resulting durable knowledge change together.

This may be significantly more useful than hiding memory updates behind a service API.

---

# Multi-bundle semantics

The Google OKF specification currently primarily defines behavior **inside an individual bundle**.

Do not invent cross-bundle links unless there is a strong reason.

Prefer:

```text
me bundle
     +
repo bundle
```

as independent search/read sources.

Rather than:

```text
repo concept
   ↓ cross-bundle magic
me concept
```

The composition layer belongs to irudd-okf.

This also avoids making bundles less portable.

There is already an open upstream proposal discussing discovery in multi-bundle agent runtimes, which is directly relevant to this design.

See references below.

---

# Potential MVP

Keep the first implementation extremely small.

## Commands worth prototyping

```bash
irudd-okf init
irudd-okf context
irudd-okf index
irudd-okf search <query>
irudd-okf read <concept>
irudd-okf validate
```

Possibly:

```bash
irudd-okf add
irudd-okf update
```

but agents can initially write Markdown directly.

That is actually a useful experiment:

> Does the runtime need write APIs at all?

If agents can safely manipulate OKF files themselves, the library may only need discovery, search and validation.

---

# Agent integration

Explore multiple interfaces without coupling the core to one agent.

Possible consumers:

```text
Codex
Claude Code
custom agents
MCP clients
shell-based agents
```

Potential integration mechanisms:

```text
CLI
Agent Skill
AGENTS.md instructions
MCP
library API
```

Start with the CLI because it is transparent and universally usable.

An agent could be instructed:

```text
At the start of a task:

1. Run `irudd-okf context`.
2. Search active OKF bundles for knowledge relevant to the task.
3. Read only relevant concepts.

While working:

4. Treat repository OKF as durable project knowledge.
5. Update it when discovering information likely to matter in future sessions.
6. Avoid recording transient implementation details.

Personal OKF:

7. Read when useful.
8. Only update it for genuinely cross-project, durable knowledge.
```

---

# Possible library API

Illustrative only:

```ts
const runtime = await OkfRuntime.open({
  cwd: process.cwd(),
  bundles: {
    me: "~/.config/irudd-okf/me",
    repo: ".okf",
  },
})

const results = await runtime.search({
  query: "database migration strategy",
  bundles: ["me", "repo"],
  limit: 5,
})
```

Avoid committing to this API until CLI experiments establish the actual abstractions.

---

# Viewer

A viewer would be useful, but is **not MVP infrastructure**.

Eventually something like:

```text
┌─────────────────────────────────────────────────────┐
│ me + irudd-okf                                      │
├───────────────┬─────────────────────────────────────┤
│ bundles       │                                     │
│               │              graph                  │
│ ● me          │                                     │
│ ● repo        │                                     │
│               │                                     │
├───────────────┼─────────────────────────────────────┤
│ concepts      │ selected concept                    │
│               │                                     │
│ architecture  │ Markdown                            │
│ decisions     │ metadata                            │
│ workflows     │ backlinks                           │
└───────────────┴─────────────────────────────────────┘
```

Useful viewer features:

- switch bundles on/off
- graph concepts
- search
- tags/types
- backlinks
- raw frontmatter
- Markdown rendering
- source path
- git history/diff eventually

The viewer should expose the data rather than becoming the canonical storage mechanism.

---

# Search experiments

Before choosing retrieval architecture, create a realistic corpus and compare:

### A. grep/ripgrep

Simple lexical search.

### B. metadata-weighted search

Weight:

```text
title        high
description  high
tags         high
body         normal
path         normal
```

### C. BM25

Likely a strong candidate because the corpus consists of relatively small textual concepts.

### D. embeddings

Only test after establishing a baseline.

Questions to measure:

- Did the correct concept appear?
- At what rank?
- How many concepts had to enter model context?
- How fast is retrieval?
- How predictable is retrieval?
- Can a human understand why a result matched?

Favor transparent retrieval.

---

# Validation

Implement the actual OKF format rather than inventing a vaguely compatible Markdown convention.

Validation should eventually cover whatever OKF v0.2 requires, for example:

```text
frontmatter validity
required fields
concept identity/path rules
links
index structure
provenance/trust fields where applicable
lifecycle metadata
```

Follow the specification here rather than this handoff; this list is intentionally incomplete.

---

# Licensing

Target license for `irudd-okf`:

```text
MIT
```

Implement OKF independently from the published specification.

Do **not** copy Google's reference implementation, viewer implementation, specification text, or other source into this repository unless deliberately taking on the corresponding Apache-2.0 obligations.

The clean approach is:

```text
Google OKF specification
        │
        │ read as interoperability documentation
        ▼
independent implementation
        │
        ▼
irudd-okf — MIT
```

Implementing the format itself does not require adopting the license of Google's reference implementation.

Google's repositories and reference code are Apache-2.0 licensed.

When referring to OKF, describe irudd-okf as an independent implementation/runtime using the Open Knowledge Format.

Do not imply Google affiliation.

Avoid GPL-family dependencies.

---

# Starting technical assumptions

Likely stack:

```text
TypeScript
Vite+ / vite-plus
Effect where it genuinely helps
```

Prefer a small dependency surface.

For Markdown/frontmatter parsing, use established permissively licensed libraries rather than implementing YAML or Markdown parsers unnecessarily.

Storage should initially just be the filesystem.

No daemon should be required for the first prototype.

---

# Important questions to answer experimentally

The initial work should answer these rather than trying to ship a complete product.

## Retrieval

1. Is plain lexical/BM25 search good enough?
2. How important is `index.md` to an agent versus direct search?
3. Does combining `me + repo` create useful retrieval or noise?
4. Should results indicate their source bundle prominently?

## Memory creation

5. Can agents reliably decide what deserves durable memory?
6. Do they create too many concepts?
7. Do they update existing concepts or create duplicates?
8. Can simple linting detect obvious memory rot?

## Personal memory

9. How conservative should writes to `me` be?
10. Should repository agents ever write directly to it?
11. Would a proposal/review flow be better?

## Git

12. Are memory diffs useful during normal code review?
13. Do merge conflicts become a problem?
14. Can normal git history effectively act as memory history?

## Format

15. Is strict OKF compatibility useful or unnecessarily limiting?
16. Which parts of OKF v0.2 are valuable for coding-agent memory?
17. Where does irudd-okf need runtime concepts that intentionally live outside the OKF spec?

## Agent UX

18. CLI, skill, MCP, or some combination?
19. How little instruction is required before an agent uses it correctly?
20. Can weaker/fast agents retrieve context effectively without polluting the main model's context?

---

# Suggested first experiment

Do **not** start with an application.

Build:

```text
irudd-okf/
├── src/
│   ├── bundle/
│   ├── search/
│   └── cli/
├── fixtures/
│   ├── me/
│   ├── repo-a/
│   └── repo-b/
└── ...
```

Create perhaps:

```text
me:      20–30 concepts
repo-a:  30–50 concepts
repo-b:  30–50 concepts
```

Seed them with realistic coding knowledge.

Then implement only:

```bash
irudd-okf context
irudd-okf search
irudd-okf read
```

Test queries such as:

```text
"What package manager should I use?"

"Why does repo A use SQLite?"

"How are migrations handled?"

"What licenses should I avoid?"

"How does authentication work?"
```

Verify that:

```text
repo A agent = me + A
repo B agent = me + B
```

and that A-specific knowledge never leaks into B retrieval.

Once this is useful, add mutation/validation.

---

# Things explicitly out of scope initially

Avoid:

```text
vector database
hosted service
cloud dependency
accounts/auth
sync protocol
multi-user editing
automatic knowledge extraction
LLM-generated knowledge graphs
custom database
background daemon
elaborate UI
generic "second brain"
```

The project should earn complexity rather than starting with it.

---

# Reference implementations / material

## Official Google OKF repository

Repository:

```text
GoogleCloudPlatform/open-knowledge-format
```

This is currently the clearest top-level introduction.

Important statement from the README: OKF is intended to be a universal, vendor-neutral format based on Markdown + YAML frontmatter, with no required agent/framework/model/serving system.

The repository also contains Google's proof-of-concept producer and graph visualizer plus example bundles.

Important files/directories:

```text
README.md
SPEC.md
src/reference_agent/
bundles/
```

Example bundles include GA4, Stack Overflow, Bitcoin and Acme Retail.

---

## Official OKF v0.2 specification

Also currently available in:

```text
GoogleCloudPlatform/knowledge-catalog
okf/SPEC.md
```

Read this before implementing validation.

The spec explicitly describes itself as self-contained and says OKF does not prescribe storage, serving or query infrastructure.

That is an important architectural constraint for irudd-okf: runtime composition should remain outside the portable bundle format unless the upstream spec evolves.

---

## Multi-bundle runtime discussion

Very relevant upstream issue:

```text
GoogleCloudPlatform/knowledge-catalog
Issue #302

"Proposal: portable bundle descriptors for pre-load discovery
in multi-bundle agent runtimes"
```

Opened August 17, 2026.

The issue explicitly identifies this gap:

```text
OKF provides progressive disclosure within a bundle,
but not across a set of bundles.
```

This overlaps directly with the `me + current repo` problem.

Study it, but do not assume irudd-okf needs to adopt the proposed solution.

---

## serradura/okf

Repository:

```text
serradura/okf
```

This is currently the most useful independent implementation to study.

It provides:

```text
CLI
search
validation/linting
MCP
Agent Skill
Claude Code integration
TUI
interactive graph
bundle registry
```

The project documents itself using an OKF bundle and demonstrates the pattern of having agents retrieve only a small number of concepts rather than loading the entire corpus.

Do not copy its implementation; study its UX and architecture.

---

## Running OKF viewer

```text
demo.okfgem.com
```

This is the easiest way to see a real OKF bundle being navigated.

It exposes the `serradura/okf` project's own knowledge bundle through an interactive graph/viewer.

Useful for understanding:

- concepts
- links/backlinks
- file hierarchy
- graph representation
- search
- concept inspection

---

## Google's generated viewer

Google's sample bundles contain generated `viz.html` files.

Example:

```text
GoogleCloudPlatform/knowledge-catalog
okf/bundles/ga4/viz.html
```

Google's reference CLI also has a `visualize` command that generates a self-contained HTML graph view from an OKF bundle.

This is useful inspiration if irudd-okf eventually gets a viewer, but the Google viewer source is Apache-2.0: do not copy it into an otherwise MIT-only implementation.

---

## Licensing reference

Google's `knowledge-catalog` repository:

```text
GoogleCloudPlatform/knowledge-catalog
LICENSE.md
```

is Apache License 2.0.

Google's reference implementation files also carry explicit Apache-2.0 headers.

Use their specification as interoperability documentation and independently implement the behavior for the cleanest MIT-licensed `irudd-okf` codebase.

---

# Project philosophy

The project should stay aggressively understandable.

A useful test:

> If the memory system behaves strangely, can a developer understand why using normal filesystem, git and CLI tools?

Prefer:

```text
files
git
Markdown
YAML
explicit scopes
deterministic search
small context
```

over:

```text
opaque memory services
hidden embeddings
global semantic retrieval
automatic cross-project context
black-box ranking
```

The goal is not to make agents "remember everything".

The goal is to give them **small, durable, scoped, inspectable knowledge stores that humans and agents can maintain together**.
