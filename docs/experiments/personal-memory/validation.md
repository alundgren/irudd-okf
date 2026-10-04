# Validation record

Final validation on October 4, 2026:

- `npm run check` passed: type checking and 57 repository tests passed, with two skipped. The standard test command also runs the standalone experiment suites, including seven personal-runner checks and four bounded-phase checks.
- `npm run build` passed.
- `git diff --check` passed.
- The final report regenerated from the repository's saved primary and bounded evidence without inference. Findings are bound to both parsed result ledgers by SHA-256.
- Browser checks found nine primary method rows and two bounded rows, the expected large usage medians, bounded correctness of 1/3 versus 3/3, working phase/size controls, no JavaScript errors and no page overflow at 390 pixels.
- An independent reviewer agent checked all 216 primary and 48 bounded terminal records against their frozen schedules, per-cell results, raw usage events and process elapsed time. All 24 capped sidecars reconstruct from the original full input and complete-rule prefix procedure; the three large capped usage input hashes match offline captures. Selected behavioral candidates were regraded. Human ratings remain unavailable.
- Final independent review found no claims or data blockers to publication. All 264 embedded report rows and 24 capped-input summaries match the saved evidence.
- Scope received the original report at revision 72. Its saved blob hash matched the original local HTML and the delivery queue was empty; the publication metadata is retained in `evidence/scope-publication.json`.

No additional paid model calls were needed for report generation or final validation. Product UI and packaging behavior were not changed by this experiment, so application smoke flows were not exercised.

The plain-language update adds three recommended steps, a ready-to-paste global instruction and an expandable study summary. Browser checks passed for the steps, copyable text, summary toggle, unchanged result tables and phase filters, with no JavaScript errors or page overflow at 390 pixels. JavaScript syntax and `git diff --check` passed. Scope received revision 73 with the matching updated content hash and an empty delivery queue; see `evidence/scope-eli5-update.json`. No model trials were rerun.

## Provider instructions and memory authoring

The subsequent product change adds CLI install, status and removal commands for independently managed Codex and Claude instruction sections. Scope will invoke these commands through separate per-machine provider toggles; the Scope settings UI is future work. No actual machine instruction files or personal memory contents were changed during implementation.

- `npm run check` passed: 79 tests passed, with two skipped, plus type checking and the standalone experiment suites.
- `npm run build` passed.
- The rebuilt native smoke passed, including preview, installation, repeat installation, status and removal for each provider in temporary profile directories.
- The browser application smoke passed against the real HTTP server and file engine.
- Repository OKF lint checked seven files with zero errors and zero warnings.
- Independent review found no remaining blockers. All 41 focused instruction and core tests passed, including 19 instruction tests covering markers, byte preservation, recovery, permissions and concurrent changes.
- The report's CLI setup section passed browser checks, including the separate-provider wording, unchanged bounded results, no JavaScript errors and no overflow at 390 pixels.
- `git diff --check` passed.

Two earlier full-suite runs failed because existing timeout tests allowed only 150 milliseconds for Node to start and install a signal handler. The test budget now allows two seconds, while still checking forced termination, descendant termination and retained partial output. Only test timing changed; frozen live experiment inputs and execution code remain intact.

The current global section, skill and new-bundle index guide explain authorized authoring: read the root and relevant topic indexes, search for an existing memory, maintain navigation and add useful relative links. Optional lint warns about concepts unreachable from the root index. These functional checks do not establish agent adherence or semantic quality. The skill used by the original paid trials is archived separately, and the new authoring wording has not undergone another effectiveness experiment.

Scope received revision 74 with a matching report content hash and an empty queue; see `evidence/scope-agent-setup-update.json`. No model trials were rerun.
