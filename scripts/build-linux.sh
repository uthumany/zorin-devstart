#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "Zorin DevStart packages are supported only on x86_64/amd64; found $(uname -m)." >&2
  exit 1
fi

# Keep locally tracked release assets untouched; build into an isolated target tree.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/src-tauri/target/build-linux}"
rm -rf "$CARGO_TARGET_DIR/release/bundle/deb" "$CARGO_TARGET_DIR/release/bundle/appimage"

# Do not enable update installation in development or ordinary local builds.
export VITE_DEVSTART_SIGNED_UPDATER=false
build_args=(build --bundles deb,appimage)
release_config=""
if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" || -n "${TAURI_UPDATER_PUBLIC_KEY:-}" ]]; then
  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" || -z "${TAURI_UPDATER_PUBLIC_KEY:-}" ]]; then
    echo "Signed release builds require both TAURI_SIGNING_PRIVATE_KEY and TAURI_UPDATER_PUBLIC_KEY." >&2
    exit 1
  fi

  export VITE_DEVSTART_SIGNED_UPDATER=true
  release_config="$(mktemp --suffix=.json "${TMPDIR:-/tmp}/zorin-devstart-updater.XXXXXX")"
  trap 'unlink "$release_config" 2>/dev/null || true' EXIT
  python3 - "$release_config" <<'PY'
import json
import os
import sys

config = {
    "bundle": {"createUpdaterArtifacts": True},
    "plugins": {
        "updater": {
            "pubkey": os.environ["TAURI_UPDATER_PUBLIC_KEY"],
            "requireSignedVersion": True,
            "endpoints": [
                "https://github.com/uthumany/zorin-devstart/releases/latest/download/latest.json"
            ],
        }
    },
}
with open(sys.argv[1], "w", encoding="utf-8") as config_file:
    json.dump(config, config_file)
PY
  build_args+=(--config "$release_config")
fi

npm run tauri -- "${build_args[@]}"
bash scripts/assert-linux-bundles.sh
