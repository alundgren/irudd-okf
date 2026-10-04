---
type: Decision
title: Install and upgrade from a separate source clone
description: Build the CLI locally with Vite+ and update from main without release archives.
tags: [cli, installation, upgrades, vite]
---

Offer one install command, `curl` the root `install.sh` into `bash`. The
installer manages a separate clone on main, installs Vite+ when absent,
builds the CLI locally, and configures its bash or zsh PATH. Users should not
need to clone, change directories, install dependencies, build, or set PATH
themselves. Do not add GitHub release downloads or archive assembly.

The installed record identifies the source clone, commit, and Vite+ executable.
Use the recorded Vite+ path during upgrades so callers such as Scope do not
need a terminal's PATH. Preserve records from manual source installations
that relied on Vite+ being on PATH.

`irudd-okf upgrade --check` reports current and latest package versions plus
`updateAvailable`, without changing the clone, its Git refs, or installed
files. Any upstream metadata fetch uses a temporary repository. Plain
`upgrade` fast-forwards main, builds with Vite+, and reports previous and
current versions plus `updated`. Both commands detect changes by commit,
including when the package version is unchanged.

Preserve the installed executable on dependency or build failure. Compare
against the installed commit rather than only the clone's HEAD so retrying
still rebuilds after an unsuccessful update. Refuse to overwrite local edits,
switch branches, or discard commits absent from origin/main.
