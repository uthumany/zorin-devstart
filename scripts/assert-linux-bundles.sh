#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "Expected an x86_64 build host, found $(uname -m)." >&2
  exit 1
fi

target_dir="${CARGO_TARGET_DIR:-src-tauri/target}"
deb_dir="$target_dir/release/bundle/deb"
appimage_dir="$target_dir/release/bundle/appimage"
shopt -s nullglob
debs=("$deb_dir"/*_amd64.deb)
images=("$appimage_dir"/*_amd64.AppImage)
if [[ ${#debs[@]} -ne 1 || ${#images[@]} -ne 1 ]]; then
  echo "Expected exactly one amd64 .deb and one amd64 .AppImage; found ${#debs[@]} and ${#images[@]}." >&2
  printf 'Debian bundles: %s\n' "${debs[@]:-none}"
  printf 'AppImage bundles: %s\n' "${images[@]:-none}"
  exit 1
fi

architecture=$(dpkg-deb -f "${debs[0]}" Architecture)
if [[ "$architecture" != "amd64" ]]; then
  echo "Expected Debian package architecture amd64, found $architecture." >&2
  exit 1
fi
if ! file "${images[0]}" | grep -Eq 'x86-64|x86_64'; then
  echo "AppImage does not contain an x86_64 executable: ${images[0]}" >&2
  file "${images[0]}" >&2 || true
  exit 1
fi
printf 'Verified x86_64 packages:\n  %s\n  %s\n' "${debs[0]}" "${images[0]}"
