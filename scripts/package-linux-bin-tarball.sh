#!/usr/bin/env bash
# Pack the Arch -bin release asset from the unpatched Linux release binary.
#
# `tauri build --bundles appimage` leaves `target/release/rustbox` without the
# bundler's bundle-type patch. The AppImage copy is patched and is an updater
# target; this tarball deliberately uses the unpatched binary. Installed to
# `/usr/bin/rustbox` with no `APPIMAGE` variable, Rustbox treats that binary as
# package-managed and will not try to replace it with the AppImage.
#
# Layout (stable, not versioned, so the PKGBUILD can unpack it every release):
#
#   rustbox-linux-x64/rustbox
#   rustbox-linux-x64/LICENSE
#   rustbox-linux-x64/rustbox.desktop
#   rustbox-linux-x64/icons/hicolor/<size>/apps/rustbox.png
#
# Usage: scripts/package-linux-bin-tarball.sh <path-to-rustbox> <out.tar.gz>

set -euo pipefail

BIN=${1:?path to the rustbox binary}
OUT=${2:?output tar.gz path}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

if [ ! -f "$BIN" ]; then
  echo "rustbox binary not found: $BIN" >&2
  exit 1
fi
if [ ! -f "$ROOT/LICENSE" ]; then
  echo "LICENSE is missing from $ROOT" >&2
  exit 1
fi
if [ ! -f "$ROOT/packaging/arch/rustbox.desktop" ]; then
  echo "packaging/arch/rustbox.desktop is missing" >&2
  exit 1
fi

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
DEST="$STAGE/rustbox-linux-x64"

install -d "$DEST/icons/hicolor/32x32/apps"
install -d "$DEST/icons/hicolor/64x64/apps"
install -d "$DEST/icons/hicolor/128x128/apps"
install -d "$DEST/icons/hicolor/256x256/apps"
install -d "$DEST/icons/hicolor/512x512/apps"

install -m755 "$BIN" "$DEST/rustbox"
install -m644 "$ROOT/LICENSE" "$DEST/LICENSE"
install -m644 "$ROOT/packaging/arch/rustbox.desktop" "$DEST/rustbox.desktop"
install -m644 "$ROOT/src-tauri/icons/32x32.png" "$DEST/icons/hicolor/32x32/apps/rustbox.png"
install -m644 "$ROOT/src-tauri/icons/64x64.png" "$DEST/icons/hicolor/64x64/apps/rustbox.png"
install -m644 "$ROOT/src-tauri/icons/128x128.png" "$DEST/icons/hicolor/128x128/apps/rustbox.png"
# Same mapping the source package uses: the @2x icon is the 256px file, and
# icon.png is installed as 512.
install -m644 "$ROOT/src-tauri/icons/128x128@2x.png" "$DEST/icons/hicolor/256x256/apps/rustbox.png"
install -m644 "$ROOT/src-tauri/icons/icon.png" "$DEST/icons/hicolor/512x512/apps/rustbox.png"

mkdir -p "$(dirname "$OUT")"
tar -C "$STAGE" -czf "$OUT" rustbox-linux-x64

# `grep -q` would SIGPIPE tar under pipefail; list first.
tar -tzf "$OUT" > "$STAGE/listing"
required=(
  rustbox-linux-x64/rustbox
  rustbox-linux-x64/LICENSE
  rustbox-linux-x64/rustbox.desktop
  rustbox-linux-x64/icons/hicolor/32x32/apps/rustbox.png
  rustbox-linux-x64/icons/hicolor/64x64/apps/rustbox.png
  rustbox-linux-x64/icons/hicolor/128x128/apps/rustbox.png
  rustbox-linux-x64/icons/hicolor/256x256/apps/rustbox.png
  rustbox-linux-x64/icons/hicolor/512x512/apps/rustbox.png
)
for entry in "${required[@]}"; do
  if ! grep -qx "$entry" "$STAGE/listing"; then
    echo "bin tarball is missing $entry" >&2
    cat "$STAGE/listing" >&2
    exit 1
  fi
done
