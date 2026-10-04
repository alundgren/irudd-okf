#!/usr/bin/env bash
set -euo pipefail

okf_install() (
  local repository="https://github.com/alundgren/irudd-okf.git"
  local root="${OKF_INSTALL_ROOT:-$HOME/.local/share/irudd-okf}"
  local bin="${OKF_INSTALL_DIR:-$HOME/.local/bin}"
  local source vp vp_version vp_home="${VP_HOME:-$HOME/.vite-plus}"
  [ "$#" = 0 ] || { echo "Usage: install.sh" >&2; return 1; }
  case "$(uname -s)" in Linux|Darwin) ;; *) echo "irudd-okf supports Linux and macOS." >&2; return 1 ;; esac
  case "$root" in /*) ;; *) echo "OKF_INSTALL_ROOT must be absolute." >&2; return 1 ;; esac
  case "$bin" in /*) ;; *) echo "OKF_INSTALL_DIR must be absolute." >&2; return 1 ;; esac
  command -v git >/dev/null || { echo "Install Git, then run this installer again." >&2; return 1; }
  command -v curl >/dev/null || { echo "Install curl, then run this installer again." >&2; return 1; }
  mkdir -p "$root"
  mkdir "$root/.install-lock" 2>/dev/null || {
    echo "Another installation may be running. If it has stopped, remove $root/.install-lock and retry." >&2; return 1;
  }
  trap 'rm -f "$root/.install-lock/vite-plus.sh"; rmdir "$root/.install-lock"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  source="$root/source"
  export GIT_TERMINAL_PROMPT=0
  if [ ! -e "$source" ]; then
    echo "Cloning irudd-okf main…" >&2
    git clone --branch main --single-branch "$repository" "$source"
  fi
  [ "$(git -C "$source" config --get remote.origin.url)" = "$repository" ] || {
    echo "The installation clone has a different Git remote. Move it aside and retry." >&2; return 1;
  }
  [ "$(git -C "$source" branch --show-current)" = main ] && [ -z "$(git -C "$source" status --porcelain)" ] || {
    echo "The installation clone must be clean and on main. Keep local work in another checkout." >&2; return 1;
  }
  git -C "$source" fetch --no-tags origin main:refs/remotes/origin/main
  git -C "$source" merge-base --is-ancestor HEAD origin/main || {
    echo "Local main contains commits absent from origin/main. Keep local work in another checkout." >&2; return 1;
  }
  git -C "$source" -c core.hooksPath=/dev/null merge --ff-only origin/main

  vp="${OKF_VP:-$(type -P vp || true)}"
  if [ -z "$vp" ]; then
    for vp in "$HOME/.vite-plus/bin/vp" "$HOME/.local/share/vite-plus/bin/vp"; do
      [ ! -x "$vp" ] || break
    done
  fi
  if [ ! -x "$vp" ]; then
    vp_version="$(sed -n 's/.*"vite-plus": "\([^"]*\)".*/\1/p' "$source/package.json")"
    [ -n "$vp_version" ] || { echo "The source does not specify a Vite+ version." >&2; return 1; }
    echo "Installing Vite+ to build irudd-okf…" >&2
    curl -fsSL --connect-timeout 15 --max-time 120 https://vite.plus/install.sh -o "$root/.install-lock/vite-plus.sh"
    VP_HOME="$vp_home" VP_VERSION="$vp_version" VP_NODE_MANAGER=no CI=true bash "$root/.install-lock/vite-plus.sh"
    vp="$vp_home/bin/vp"
  fi
  [ -x "$vp" ] || { echo "Vite+ installation did not create an executable." >&2; return 1; }
  vp="$(cd "$(dirname "$vp")" && printf '%s/%s' "$(pwd -P)" "$(basename "$vp")")"
  export PATH="$(dirname "$vp"):$PATH" OKF_VP="$vp" OKF_SETUP_PATH=1
  cd "$source"
  "$vp" install --frozen-lockfile
  "$vp" run --no-cache install:cli "$bin"
  echo "Open a new terminal, then run irudd-okf context." >&2
)

okf_install "$@"
