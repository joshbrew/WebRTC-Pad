#!/bin/sh
# Sourced by launchers; install only inside this project when Node is missing.
pad_node_ready() {
  command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=9)?0:1)' >/dev/null 2>&1
}
if [ -x "$project_dir/.local/node/bin/node" ]; then
  PATH="$project_dir/.local/node/bin:$PATH"; export PATH
fi
if ! pad_node_ready; then
  if [ "${pad_install_node:-0}" != 1 ]; then
    printf '%s\n' 'Use the Host or Join shortcut in your platform folder to install Node.js.'; exit 1
  fi
  command -v curl >/dev/null 2>&1 || { printf '%s\n' 'Install curl, then run setup again.'; exit 1; }
  case "$(uname -s)" in Darwin) pad_os=darwin;; Linux) pad_os=linux;; *) printf '%s\n' 'Use the Windows installer on this platform.'; exit 1;; esac
  case "$(uname -m)" in x86_64|amd64) pad_arch=x64;; arm64|aarch64) pad_arch=arm64;; *) printf '%s\n' 'Install Node.js manually for this processor.'; exit 1;; esac
  mkdir -p "$project_dir/.local/node-download" "$project_dir/.local/node"
  pad_list="$project_dir/.local/node-download/SHASUMS256.txt"
  curl --fail --location --proto '=https' --tlsv1.2 --output "$pad_list" 'https://nodejs.org/download/release/latest-v22.x/SHASUMS256.txt'
  pad_asset=$(awk -v suffix="-$pad_os-$pad_arch.tar.gz" 'length($1)==64 && substr($2,length($2)-length(suffix)+1)==suffix { print $2; exit }' "$pad_list")
  case "$pad_asset" in node-v22.*-"$pad_os"-"$pad_arch".tar.gz) ;; *) printf '%s\n' 'No supported official Node.js download found.'; exit 1;; esac
  pad_version=${pad_asset#node-}; pad_version=${pad_version%%-*}
  pad_archive="$project_dir/.local/node-download/$pad_asset"
  printf '%s\n' 'Installing official Node.js into this project only; no administrator password is needed.'
  curl --fail --location --proto '=https' --tlsv1.2 --output "$pad_archive" "https://nodejs.org/download/release/$pad_version/$pad_asset"
  pad_expected=$(awk -v file="$pad_asset" '$2==file { print $1 }' "$pad_list")
  if command -v sha256sum >/dev/null 2>&1; then pad_actual=$(sha256sum "$pad_archive" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then pad_actual=$(shasum -a 256 "$pad_archive" | awk '{print $1}')
  else printf '%s\n' 'A SHA-256 checksum tool is required (sha256sum or shasum).'; exit 1; fi
  [ "$pad_actual" = "$pad_expected" ] || { printf '%s\n' 'Node download checksum did not match. Nothing was installed.'; exit 1; }
  tar -xzf "$pad_archive" -C "$project_dir/.local/node" --strip-components=1
  PATH="$project_dir/.local/node/bin:$PATH"; export PATH
  pad_node_ready || { printf '%s\n' 'This Node build cannot run here. Install Node for your distribution manually.'; exit 1; }
fi
