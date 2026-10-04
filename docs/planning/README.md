# Product planning handoff

The confirmed outcome was unattended research and a Scope plan for a complete irudd-okf product. This planning work is complete. Product implementation and live agent benchmarks are subsequent work.

Open the named Scope plan **irudd-okf-product-plan**, titled **irudd-okf: product and experiments**. Artifact ID is `2d552b5f-0056-4fcd-b2d8-e976a6ea1096`. The verified published revision is 73. `scope-publication.json` records the matching local/published SHA-256.

The presentation starts with high-level diagrams and summaries, then has separate pages for workflows, architecture, CLI/UI, experiments, implementation steps, research and the full agent packet. Its Markdown notes and example experiment manifest are downloadable inside the HTML.

## Local files

- [HTML presentation](irudd-okf-product-plan.html)
- [Complete product plan](product-plan.md)
- [OKF specification, multi-bundle discussions and practical uses](okf-research.md)
- [Stack research and feasibility results](stack-research.md)
- [Controlled experiment protocol](experiment-protocol.md)
- [Example experiment manifest](experiment-manifest.example.json)
- [Small reproducible build/browser probe](probes/)
- [Published artifact identity and checksum](scope-publication.json)
- [Validation record](validation.json)

The original repository README remains the historical handoff. The confirmed product scope here supersedes its earlier experiment-only boundary. Work was prepared on `t3code/okf-agent-memory-plan` in `/home/dev/.t3/worktrees/irudd-okf/t3code-48104fb4`. No commits, GitHub writes, PRs, merges or live benchmark runs were made.

## Consequential decisions

- OKF files remain independently usable with normal file tools. The CLI and served UI are optional.
- Named personal bundles plus the current repository compose at runtime, outside the format. No sibling-repository discovery or physical bundle merge.
- The product does not encode rule importance or precedence. Experiments compare authored usage conventions and publish recommendations with their tested limits.
- Native skills remain complementary. The main benchmark includes the growth and omission of skill trigger metadata, alongside nested instructions and linked documents.
- Agent repository-memory edits belong in ordinary diffs; personal-memory writes require explicit operator authorization.
- Plan for Effect 4, Foldkit, Vite+ standalone packaging, Linux/macOS installation and local graph/wiki editing with explicit GitHub PR submission.
- Generic permissive parsing/search dependencies are allowed. OKF-specific third-party code dependencies are excluded.

## Validation and review

An independent reviewer found two material experiment issues: relative comparisons could hide shared deterioration, and the native baseline overstated automatic nested instruction loading. Both were corrected and rechecked. The protocol now tests growth within each arm with fixed tasks/relevant rules, and records actual startup instructions, launch cwd, caps, omissions and later reads. A minor distractor-ratio ambiguity was also clarified.

The small Foldkit/Effect 4 example type-checked, built and updated state after a Chromium click without browser errors. Vite+ packaged an Effect CLI and embedded HTML on Linux x64. The executable ran with an empty environment and no usable PATH. The probe measured 151,198,845 bytes; macOS, Linux arm64, signing/notarization and the complete embedded server are untested release requirements.

The presentation passed eight-page navigation, graph/wiki switching, edit/diff/save preview, PR preview, corpus-size controls and downloads. The final embedded protocol matches the local source. There were no browser errors or external requests, and the mobile page had no horizontal document overflow.

## Feedback connection and resumption

The Scope skill's T3 adapter is connected through the managed user service `scope-plan-irudd-okf-product-plan.service`. Its log confirmed `Listening for submitted feedback on irudd-okf-product-plan`. The linked T3 thread is `ed9800a9-9285-4896-ac68-5b6f449af241`; it was verified against this worktree. The private feedback session expires 2026-10-11. Credentials are stored outside the repository and are not part of this packet.

When resuming review, run `irudd-scope plan read irudd-okf-product-plan`. Retrieve a submitted round with `plan feedback`, inspect its packet/screenshots, and respond using `plan guide`'s contract. Preserve revision checks and stable request IDs. If automatic delivery is unavailable, paste Scope's Copy agent request into the session. Stop the feedback service when collaboration on the plan ends.

For implementation, first read the approved Scope revision and feedback decisions. Stage 0 freezes format/build/API assumptions. Follow the remaining stages and their evidence requirements. Recheck versions before implementation, retain empirical questions as tests, and do not claim scalable rule recall until the studies support it. Future implementation needs its own explicit GitHub target and merge authorization.
