#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 path/to/application.AppImage" >&2
  exit 2
fi

image=$(realpath "$1")
if [[ ! -f "$image" ]]; then
  echo "AppImage not found: $image" >&2
  exit 2
fi

for tool in unsquashfs mksquashfs; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool (install squashfs-tools)" >&2
    exit 2
  fi
done

offset=$("$image" --appimage-offset)
if [[ ! "$offset" =~ ^[0-9]+$ ]] || (( offset <= 0 || offset >= $(stat -c %s "$image") )); then
  echo "Could not determine a valid AppImage payload offset: $offset" >&2
  exit 1
fi

workdir=$(mktemp -d "${TMPDIR:-/tmp}/zorin-devstart-appimage.XXXXXX")
replacement=$(mktemp "${image}.XXXXXX")
cleanup() {
  rm -rf -- "$workdir"
  rm -f -- "$replacement"
}
trap cleanup EXIT

appdir="$workdir/AppDir"
unsquashfs -no-progress -o "$offset" -d "$appdir" "$image"

if [[ ! -x "$appdir/usr/bin/zorin-devstart" ]]; then
  echo "AppImage does not contain the expected Zorin DevStart AppDir" >&2
  exit 1
fi

# Use the system GTK/WebKitGTK runtime instead of carrying duplicate copies.
python3 - "$appdir" <<'PY'
from pathlib import Path
import shutil
import sys

appdir = Path(sys.argv[1])
shutil.rmtree(appdir / "usr/lib", ignore_errors=True)
docs = appdir / "usr/share/doc"
if docs.exists():
    shutil.rmtree(docs)
for path in (appdir / "AppRun.wrapped", appdir / "apprun-hooks"):
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    elif path.exists() or path.is_symlink():
        path.unlink()
PY

cat > "$appdir/AppRun" <<'APPRUN'
#!/usr/bin/env sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for library in libwebkit2gtk-4.1.so.0 libgtk-3.so.0; do
  if ! command -v ldconfig >/dev/null 2>&1 || ! ldconfig -p 2>/dev/null | grep -Fq "$library"; then
    printf 'Zorin DevStart needs the host %s runtime. Install the missing GTK/WebKitGTK dependencies, for example with:\n  sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0\n' "$library" >&2
    exit 127
  fi
done

exec "$HERE/usr/bin/zorin-devstart" "$@"
APPRUN
chmod 0755 "$appdir/AppRun"

payload="$workdir/payload.squashfs"
mksquashfs "$appdir" "$payload" -noappend -all-root -processors "$(nproc)" -comp zstd -b 1M -Xcompression-level 22 -no-progress

# Keep the AppImage type-2 runtime unchanged and append the new SquashFS payload.
head -c "$offset" "$image" > "$replacement"
cat "$payload" >> "$replacement"
chmod --reference="$image" "$replacement"

new_offset=$("$replacement" --appimage-offset)
if [[ "$new_offset" != "$offset" ]]; then
  echo "Repacked AppImage runtime offset changed unexpectedly: $new_offset (expected $offset)" >&2
  exit 1
fi
unsquashfs -o "$new_offset" -s "$replacement" >/dev/null

size=$(stat -c %s "$replacement")
limit=$((50 * 1024 * 1024))
if (( size >= limit )); then
  echo "Optimized AppImage is still too large: $size bytes (limit: less than $limit)" >&2
  exit 1
fi

mv -f -- "$replacement" "$image"
printf 'Optimized %s: %s bytes (%.2f MiB), below 50 MiB.\n' \
  "$(basename "$image")" "$size" "$(awk -v bytes="$size" 'BEGIN { printf "%.2f", bytes / 1048576 }')"
