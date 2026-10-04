#!/usr/bin/env bash
set -euo pipefail

# Install only the executable. Bundles and personal configuration are untouched.
okf_repo="alundgren/irudd-okf"
okf_version="${OKF_VERSION:-latest}"
okf_directory="${OKF_INSTALL_DIR:-${HOME}/.local/bin}"
okf_base="${OKF_DOWNLOAD_BASE:-https://github.com/${okf_repo}/releases}"
okf_system="$(uname -s)"
okf_arch="$(uname -m)"
case "$okf_system" in Linux) okf_system=linux;; Darwin) okf_system=darwin;; *) echo "Supported systems: Linux and macOS." >&2; exit 1;; esac
case "$okf_arch" in x86_64|amd64) okf_arch=x64;; arm64|aarch64) okf_arch=arm64;; *) echo "Supported processors: x64 and arm64." >&2; exit 1;; esac
if [ "$okf_system" = linux ] && command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | head -n 1 | grep -qi musl; then
  echo "This release supports glibc Linux. Build from source on musl systems." >&2; exit 1
fi
if [ "$okf_version" = latest ]; then
  okf_url="${okf_base}/latest/download"
else
  case "$okf_version" in v[0-9]*|[0-9]*) ;; *) echo "Invalid OKF_VERSION." >&2; exit 1;; esac
  case "$okf_version" in *[!A-Za-z0-9._-]*) echo "Invalid OKF_VERSION." >&2; exit 1;; esac
  okf_url="${okf_base}/download/${okf_version}"
fi
okf_asset="irudd-okf-${okf_system}-${okf_arch}.tar.gz"
okf_temp="$(mktemp -d)"
okf_stage=""
trap 'rm -rf "$okf_temp"; if [ -n "$okf_stage" ]; then rm -f "$okf_stage"; fi' EXIT
curl --fail --location --silent --show-error "${okf_url}/${okf_asset}" --output "${okf_temp}/${okf_asset}"
curl --fail --location --silent --show-error "${okf_url}/SHA256SUMS" --output "${okf_temp}/SHA256SUMS"
okf_expected="$(awk -v asset="$okf_asset" '$2 == asset { print $1 }' "${okf_temp}/SHA256SUMS")"
if [[ ! "$okf_expected" =~ ^[a-fA-F0-9]{64}$ ]]; then echo "Missing or invalid release checksum." >&2; exit 1; fi
if command -v sha256sum >/dev/null 2>&1; then
  okf_actual="$(sha256sum "${okf_temp}/${okf_asset}" | awk '{ print $1 }')"
else
  okf_actual="$(shasum -a 256 "${okf_temp}/${okf_asset}" | awk '{ print $1 }')"
fi
if [ "$okf_actual" != "$okf_expected" ]; then echo "Checksum mismatch; installation cancelled." >&2; exit 1; fi
okf_members="$(tar -tzf "${okf_temp}/${okf_asset}")"
if [ "$okf_members" != irudd-okf ]; then echo "Unexpected release archive contents." >&2; exit 1; fi
tar -xzf "${okf_temp}/${okf_asset}" -C "$okf_temp"
if [ ! -f "${okf_temp}/irudd-okf" ] || [ -L "${okf_temp}/irudd-okf" ]; then echo "Invalid executable archive." >&2; exit 1; fi
chmod 755 "${okf_temp}/irudd-okf"
"${okf_temp}/irudd-okf" --version >/dev/null
mkdir -p "$okf_directory"
okf_stage="$(mktemp "${okf_directory}/.irudd-okf.XXXXXX")"
cp "${okf_temp}/irudd-okf" "$okf_stage"
chmod 755 "$okf_stage"
mv -f "$okf_stage" "${okf_directory}/irudd-okf"
okf_stage=""
echo "Installed ${okf_directory}/irudd-okf" >&2
case ":${PATH}:" in *":${okf_directory}:"*) ;; *) echo "Add ${okf_directory} to PATH." >&2;; esac
echo "Run: irudd-okf context" >&2
