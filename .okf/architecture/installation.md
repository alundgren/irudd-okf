---
type: Decision
title: Install and upgrade from a separate source clone
description: Build the CLI locally with Vite+ and update from main without release archives.
tags: [cli, installation, upgrades, vite]
---

Install from a clean, separate clone on main with `vp install --frozen-lockfile`
and `vp run install:cli`. Keep the clone and the installation record beside
the executable. Do not add GitHub release downloads or archive assembly.

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
