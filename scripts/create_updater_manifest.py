#!/usr/bin/env python3
"""Create the static Tauri updater manifest for a signed DevStart AppImage."""
from __future__ import annotations

import argparse
import base64
import binascii
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

REPOSITORY = "uthumany/zorin-devstart"
VERSION_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)
APPIMAGE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*_amd64\.AppImage$")


def build_manifest(version: str, tag: str, repository: str, appimage_name: str, signature_path: Path) -> dict[str, object]:
    if not VERSION_PATTERN.fullmatch(version):
        raise ValueError(f"Invalid semantic app version: {version}")
    if tag != f"v{version}":
        raise ValueError(f"Release tag {tag!r} must match app version as v{version}")
    if repository != REPOSITORY:
        raise ValueError(f"Unexpected release repository: {repository}")
    if not APPIMAGE_PATTERN.fullmatch(appimage_name) or ".." in appimage_name:
        raise ValueError(f"Unsafe or unsupported AppImage filename: {appimage_name}")

    signature = signature_path.read_text(encoding="ascii").strip()
    if not signature:
        raise ValueError("The AppImage signature file is empty")
    try:
        base64.b64decode(signature, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("The AppImage signature file is not valid base64") from error

    encoded_asset = quote(appimage_name, safe="._-")
    url = f"https://github.com/{repository}/releases/download/{tag}/{encoded_asset}"
    published_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return {
        "version": version,
        "notes": "Signed Linux AppImage update.",
        "pub_date": published_at,
        "platforms": {
            "linux-x86_64-appimage": {
                "url": url,
                "signature": signature,
            }
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="SemVer app version, without the leading v")
    parser.add_argument("--tag", required=True, help="GitHub release tag, for example v0.1.2")
    parser.add_argument("--repository", required=True, help="GitHub owner/repository")
    parser.add_argument("--appimage", required=True, help="Published amd64 AppImage filename")
    parser.add_argument("--signature", required=True, type=Path, help="Path to the final AppImage .sig file")
    parser.add_argument("--output", required=True, type=Path, help="Output latest.json path")
    args = parser.parse_args()

    manifest = build_manifest(args.version, args.tag, args.repository, args.appimage, args.signature)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
