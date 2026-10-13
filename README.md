# irudd-okf

Local, scoped knowledge for coding agents and the people working with them.
Store small rules, decisions and lessons as ordinary Open Knowledge Format
Markdown. Search a few relevant files instead of loading the entire corpus.
The CLI manages revisions and review. An editor and `rg` can inspect the same
portable files; external edits enter review before ordinary recall changes.

The CLI reads and updates portable memory files. Scope provides the Librarian
library and review queue. Agents discover operations through command search and
schemas rather than loading a command catalogue into their skill.

Bundles stay separate. Each result identifies its bundle and path. There is
no implicit search of sibling repositories, embeddings service or encoded
rule precedence. Repository guidance decides how agents use its memories.

## Install

Windows 11 is supported on x64. Linux with glibc and macOS are supported on
x64 and arm64.

On Windows, run this in 64-bit PowerShell after installing Git for Windows:

```powershell
irm https://raw.githubusercontent.com/alundgren/irudd-okf/main/install.ps1 | iex
```

The Windows installer builds from its own clone in
`%LOCALAPPDATA%\irudd-okf\source`, installs Vite+ if needed, and puts
`irudd-okf.exe` in `%LOCALAPPDATA%\irudd-okf\bin`. It adds that directory to
your user PATH. Open a new terminal after installing. Windows arm64 is not
supported.

On Linux or macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/alundgren/irudd-okf/main/install.sh | bash
```

The Unix installer keeps its own clone in `~/.local/share/irudd-okf/source`, installs
Vite+ if needed, and builds the CLI locally. It installs into `~/.local/bin`
and adds that directory to your bash or zsh login profile. Git and curl are
required. Open a new terminal after installing.

The executable includes its Node runtime and agent skills.
Run `irudd-okf licenses` to read the included runtime and dependency notices.

## Release packages

Tagged releases include `irudd-okf-windows-x64.zip`, plus Linux and macOS
archives for x64 and arm64. Each archive includes the standalone executable,
README, product license and dependency notices. No installed Node is needed
to run it. `SHA256SUMS` contains the SHA-256 checksum of each archive.

For a portable Windows installation, download the ZIP from
[GitHub Releases](https://github.com/alundgren/irudd-okf/releases) and extract it:

```powershell
Expand-Archive .\irudd-okf-windows-x64.zip -DestinationPath .\irudd-okf
.\irudd-okf\irudd-okf.exe --version
```

Source installations support `irudd-okf upgrade`. Portable release executables
have no source installation record; replace them with a newer release archive
or use the installer above to enable source upgrades.

## Try it

From your project's directory:

```sh
irudd-okf init .okf
irudd-okf context
irudd-okf search "test artifacts" --scope repo --limit 5
irudd-okf cli search "review pending memory changes"
```

Command output is JSON. Use `cli search` to find an operation, then `cli schema`
to inspect its arguments, request file and result contract before running it.
The CLI runs without a browser, server or model service. Scope supplies the
human library and calls the same installed CLI.

Set `OKF_INSTALL_ROOT` to change where the installer keeps its clone, or
`OKF_INSTALL_DIR` to change the executable's location. The installer records
the clone, commit, and Vite+ path beside the executable for future upgrades.

Run `irudd-okf upgrade` from any directory to fetch `origin/main` in that clone.
When `main` has changed, it fast-forwards the clone, installs dependencies with
`vp`, rebuilds, and replaces the executable. It prints JSON such as
`{"previous":"0.1.0","current":"0.2.0","updated":true}` and exits 0 on
success or non-zero on failure. Otherwise it reports `updated: false`
without rebuilding. Local edits, a different branch, or local commits absent
from `origin/main` stop the upgrade. A dependency or build failure leaves the
installed executable intact; run `upgrade` again to retry.

`irudd-okf upgrade --check` exits 0 and prints JSON such as
`{"current":"0.1.0","latest":"0.2.0","updateAvailable":true}`. It leaves the
installation clone, Git refs, and installed files untouched. It reads upstream
metadata in a temporary repository that it removes after checking. Both modes
detect updates by commit, so a change on `main` is available even when the
package version stays the same. Git or network failures exit non-zero.
Scope can run `--check` daily, then run `upgrade` when `updateAvailable` is true.
If an older CLI rejects `--check`, Scope should show
`irudd-okf is too old for automatic upgrades`.

Remove the executable, its installation record, and the installation root to
uninstall. On Windows, also remove the installation directory from your user PATH. Your bundles and configuration remain ordinary files.

## Files and agent discovery

A concept needs YAML frontmatter with a nonempty `type`. Library memories also
need a stable ID, memory kind, stage and explicit applicability. Other fields and
unknown types are preserved during repair and migration. `index.md` and `log.md` are reserved at every
level. The implementation targets OKF v0.2 independently and uses no
OKF-specific dependency.

```markdown
---
type: Rule
title: Clean test artifacts
tags: [testing]
memory:
  id: clean-test-artifacts
  kind: procedural
  stage: bronze
  applicability:
    type: repository
    id: example-project
---

Remove generated test artifacts before committing. Check `git status` after
the test run so unexpected files are visible in the review diff.
```

Teach agents where the bundle is with a short applicable `AGENTS.md` locator.
For example: “Project rules and decisions live in `.okf/`. Consult the index
and search task-relevant files before changing code. Add a small concept when
asked to record a rule. Review memory edits with the code diff.” Adapt this
example to your own repository.

```sh
irudd-okf cli search "find project rules"
irudd-okf cli schema search
irudd-okf search "migration tests" --scope repo --limit 5
irudd-okf read repo architecture/migrations.md
irudd-okf validate
irudd-okf lint
irudd-okf skill install .agents/skills
```

Command results are JSON. Diagnostics go to stderr. The small
[agent skill](skills/okf/SKILL.md) explains command discovery and accepted recall.
Native skills remain useful for task procedures. Nothing injects the entire
memory corpus or all its triggers into the agent's context.

With Vite+ installed, install the skill globally from GitHub for Codex and
Claude Code:

```sh
vp dlx skills add alundgren/irudd-okf --skill okf --global --agent codex claude-code --yes
```

`vp dlx` uses the workspace's selected package manager, including pnpm.
Omit `--agent codex claude-code --yes` to choose agents interactively.
Install the CLI executable separately using the command in [Try it](#try-it).

## Personal plus repository knowledge

Repository `.okf` discovery stays inside the current Git repository. Named
personal bundles are opt-in registrations in
`~/.config/irudd-okf/config.json` (or `$XDG_CONFIG_HOME`).

```sh
irudd-okf init ~/knowledge/me/.okf
irudd-okf bundle add me ~/knowledge/me/.okf --activate
irudd-okf context
irudd-okf search "test cleanup"
irudd-okf search "editor preferences" --scope me
```

Use `--bundle NAME=ROOT` to select an explicit invocation scope. Repository
configuration cannot silently activate folders outside its Git root. Runtime
registrations are separate from the OKF format, and files are never physically
merged. Personal writes through the CLI require `--authorize-personal`. Scope supplies
that authorization for a deliberate memory edit.

## Machine-wide agent instructions

Install a short owned section for each provider you want to use with an active
personal bundle. Preview the instruction text and destination before installing:

```sh
irudd-okf instructions install codex personal --dry-run
irudd-okf instructions install codex personal
irudd-okf instructions install claude personal
irudd-okf instructions status codex
irudd-okf instructions remove claude
```

Replace `personal` with the active alias shown by `context`. Installation and
updates replace only the section between the `irudd-okf personal-memory` markers.
Repeated installation is a no-op. Removal leaves other instructions intact.
On Unix, existing file permissions are preserved. Windows instruction and
recovery files inherit their directory's permissions. Changed files have a
recovery copy. `--dry-run` also works for removal and writes nothing. No memory content
is copied into the instruction file, and no skill installation is required.

Codex uses `~/.codex/AGENTS.md`, respecting `CODEX_HOME`. Claude uses
`~/.claude/CLAUDE.md`, respecting `CLAUDE_CONFIG_DIR`. The CLI reports a nonempty
Codex `AGENTS.override.md` as shadowing the shared file and refuses installation
until the override is reconciled. Incomplete or duplicate markers, symbolic
links and non-UTF-8 instruction files are left unchanged. Start a new provider
session to load the updated instructions. See the official
[Codex instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
and [Claude memory documentation](https://code.claude.com/docs/en/memory).

Scope should call these commands on each machine after registering its synced
`personal` bundle, with separate Codex and Claude toggles. Turning one toggle
off should remove only that provider's section. CLI JSON gives Scope the target,
installed state, shadowing, preview text and whether anything changed. Scope's
toggle integration is a later change; this CLI does not enable it automatically.

## Organizing new memories

The owned instruction and OKF skill tell agents to read the root and relevant
topic indexes before writing, search for duplicates, update an existing concept
when appropriate, and review note and index edits together. The root index
links topics; topic indexes link notes. Relative links connect related guidance
and replacements. Existing authoring conventions remain in charge. `init`
creates a small guide for new bundles and never replaces an existing index.

Run `irudd-okf lint --scope personal` after an authorized memory edit. In addition
to broken links, it reports `UNINDEXED_CONCEPT` for notes with no Markdown-link
route from an authored root index. These are optional quality warnings, not
format errors; bundles without a root index remain valid. Lint does not prove
that a note is useful, unique or in the best topic. Ordinary file edits remain
supported and personal writes still require explicit authorization.

The authoring checklist and navigation lint help maintain files and links.
They do not guarantee that an agent will follow every instruction or organize
notes well.

## Library memory

Memory classification has separate fields for kind, applicability, curation
stage, and review. Kind is procedural, episodic, or semantic. Applicability is
global, a particular machine, or a particular repository. A repository ID is
independent of its checkout path. Topics remain tags.

Agent-created memories start bronze and pending review. Silver contains
normalized, attributable knowledge; gold contains curated guidance with checked
evidence and limits. Promotion does not grant human approval or widen
applicability.

Pending edits and removals preserve the last accepted revision for ordinary
recall. The change commands expose the exact proposal, supporting sources,
review decisions and recovery history. Routine librarian decisions record an
agent reviewer. Changes requiring human judgment remain pending. A derived
procedure or fact retains source revisions and receives its own review.

Ask your existing coding agent to run a dreaming loop. Scope's permanent
Librarian tab shows the human review queue and completed overview. Conversation
stays in your agent session. No model service or memory maintenance process runs
by default. Scope reminds you weekly to initiate the loop. The reminder is on
by default and can be disabled in Scope Settings.

```sh
irudd-okf bundle inspect repo
irudd-okf cli search "review a pending memory change"
irudd-okf cli schema change review
irudd-okf skill install /path/to/agent-skills --name okf-librarian
```

The installed command schema describes current request files and results.
Read the [memory guide](docs/agent-memory.md) for authoring, review, evidence,
applicability and recovery.

## Bundle format versions

A portable `memory-bundle.json` identifies the library bundle and its format.
The format version is separate from the executable's software version. Before
using a bundle, agents inspect its format and the installed CLI's support.

```sh
irudd-okf bundle inspect repo
irudd-okf migration guide repo
```

The CLI supplies migration instructions for its installed version. Prepare a
preview, resolve unknown classifications and applicability with the person
using the library, then apply the agreed changes. Migration retains original
bytes and recovery state and updates the format marker after completion.
An unversioned bundle needs migration; a newer bundle needs a compatible CLI.
Upgrading the executable does not silently migrate memory files.

## Optional Git publication

Local bundles require no Git repository or remote. When synchronizing a library,
include its Markdown, `memory-bundle.json`, and `memory-history.json` together.
The manifest and history are canonical library data; leaving them out loses
accepted revisions and review evidence on the receiving machine. Runtime locks
and recovery files in `.irudd-okf/` stay local.

The selective `git preview` and `git pr` commands support generic OKF bundles.
They refuse current-format libraries because publishing selected Markdown alone
cannot preserve the complete library state. Use full portable-bundle sync for a
library, or review the complete bundle alongside your repository changes.

For a generic OKF bundle in Git:

```sh
irudd-okf git status repo
irudd-okf git preview repo --paths gotchas/test-artifacts.md --base origin/main
irudd-okf git pr PREVIEW_TOKEN --title "Record test cleanup rule"
```

Fetch the intended base first. A changed source file or target branch requires
a fresh preview. Failed publication retains its token and isolated worktree;
retry the same token after resolving the reported error. Preview state remains
local under `$XDG_STATE_HOME/irudd-okf` or `~/.local/state/irudd-okf`.

## Development

The product uses Effect 4.0 and Vite+ 1.0. Node 26.10 is the build runtime.
Generic YAML and Markdown libraries handle syntax; own code implements OKF
semantics.

```sh
npm ci
npm run check
npm run build
node scripts/native-smoke.mjs
npm run okf -- context
```

Native CI executes the built client on Windows x64, and on Linux and macOS,
each on x64 and arm64. Windows CI uses an x64 Windows Server 2025 runner.
It tests the PowerShell installer, user PATH, source upgrades, and replacement
of the running executable. Windows 11 desktop execution is not a separate CI job.
All native jobs extract their release archive and repeat the standalone smoke
checks. A pushed `v*` tag publishes all five packages and `SHA256SUMS` only
after native validation succeeds.

Native validation exercises the CLI and its embedded skills without Node on
PATH. Library journeys and agent review sessions are validated in irudd-scope.
