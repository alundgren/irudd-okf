---
type: Decision
title: Install and upgrade from a separate source clone
description: Install from a separate source clone, update from main, and publish validated native release packages.
tags: [cli, installation, upgrades, vite]
---

Offer `install.sh` for Linux and macOS, and `install.ps1` for Windows 11 x64.
Both installers manage a separate clone on main, install Vite+ when absent,
and build the CLI locally. Unix installation configures bash or zsh PATH;
Windows installation adds its bin directory to the user PATH. Users should not
need to clone, change directories, install dependencies, build, or set PATH
themselves.

Tagged releases also provide portable executables for Windows x64, Linux x64
and arm64, and macOS x64 and arm64. Extract and run the standalone smoke checks
on every archive before publishing the complete set with SHA-256 checksums.
Portable executables have no source installation record and need a new archive
to update. Source installations continue to upgrade from main.

Windows cannot overwrite the executable running `upgrade`. Rename that file
before publishing the new executable. A previous executable that Windows still
has open remains beside the installation until the next installation removes it.

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
