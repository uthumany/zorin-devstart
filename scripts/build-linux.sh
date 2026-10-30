#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "Zorin DevStart packages are supported only on x86_64/amd64; found $(uname -m)." >&2
  exit 1
fi

# Keep locally tracked release assets untouched; build into an isolated target tree.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/src-tauri/target/build-linux}"
rm -rf "$CARGO_TARGET_DIR/release/bundle/deb" "$CARGO_TARGET_DIR/release/bundle/appimage"
npm run tauri -- build --bundles deb,appimage
bash scripts/assert-linux-bundles.sh
