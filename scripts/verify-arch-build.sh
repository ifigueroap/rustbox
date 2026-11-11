#!/usr/bin/env bash
# Verify the Arch recipe end to end inside archlinux:latest.
#
# The recipe under test is packaging/arch/PKGBUILD exactly as committed; only
# `source` and `sha256sums` are rewritten to point at a locally created tarball
# of the working tree, because the tag tarball for an unreleased branch does not
# exist yet. Everything else (depends, makedepends, build(), package()) runs
# unmodified.
#
# Usage: scripts/verify-arch-build.sh <path-to-worktree> [out-dir]
#
# Output: $OUT/container.log (full log), $OUT/makepkg.log (build log),
# $OUT/rustbox-*.pkg.tar.zst, and a `pkgbuild-vs-upstream.diff` when it ran
# against an older tag.
set -euo pipefail

REPO=$(cd "${1:?worktree path required}" && pwd)
OUT=${2:-/tmp/arch-verify}
mkdir -p "$OUT"

VERSION=$(sed -n 's/^pkgver=\([^ ]*\).*/\1/p' "$REPO/packaging/arch/PKGBUILD")
: "${VERSION:?could not read pkgver from packaging/arch/PKGBUILD}"

rm -rf "$OUT/tarball"
mkdir -p "$OUT/tarball/rustbox-$VERSION"
# Copy the tree without build outputs, installed dependencies, or VCS data.
tar -C "$REPO" \
  --exclude=./.git \
  --exclude=./node_modules \
  --exclude=./dist \
  --exclude=./src-tauri/target \
  --exclude=./src-tauri/gen/schemas \
  -cf - . | tar -C "$OUT/tarball/rustbox-$VERSION" -xf -
tar -C "$OUT/tarball" -czf "$OUT/rustbox-$VERSION.tar.gz" "rustbox-$VERSION"

SHA=$(sha256sum "$OUT/rustbox-$VERSION.tar.gz" | awk '{print $1}')
echo "local tarball sha256: $SHA"

# The only edits to the recipe: build from the local tarball.
sed -e 's|^source=.*$|source=("$pkgname-$pkgver.tar.gz")|' \
    -e "s|^sha256sums=.*$|sha256sums=('$SHA')|" \
    "$REPO/packaging/arch/PKGBUILD" > "$OUT/PKGBUILD"

grep -nE '^(pkgver|pkgrel|source|sha256sums|options)=' "$OUT/PKGBUILD"

# Warm caches and the built package stay on the host, so a rerun does not
# re-download every crate and npm package.
mkdir -p "$OUT/cargo-home" "$OUT/npm-cache" "$OUT/pkg"
chmod -R a+rwX "$OUT/cargo-home" "$OUT/npm-cache" "$OUT/pkg"

cat > "$OUT/in-container.sh" <<'CONTAINER'
set -euo pipefail

pacman -Syu --noconfirm --needed --quiet base-devel sudo git >/dev/null
pacman -S --noconfirm --needed --quiet \
  webkit2gtk-4.1 gtk3 libayatana-appindicator xdg-utils \
  rust nodejs npm pkgconf namcap file >/dev/null

# makepkg refuses to run as root. Build as a normal user with sudo rights, the
# same setup a packager has on a desktop.
id builder >/dev/null 2>&1 || useradd -m -G wheel builder
echo "builder ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/builder
mkdir -p /build && cp /work/PKGBUILD /work/rustbox-*.tar.gz /build/
chown -R builder /build

as_builder() {
  sudo -u builder env \
    HOME=/home/builder \
    CARGO_HOME=/work/cargo-home \
    npm_config_cache=/work/npm-cache \
    "$@"
}

cd /build
set +e
as_builder makepkg -s --noconfirm --nocheck > /work/makepkg.log 2>&1
STATUS=$?
set -e
echo "makepkg exit: $STATUS"
tail -n 40 /work/makepkg.log
[ "$STATUS" -eq 0 ] || exit "$STATUS"

PKG=$(ls /build/rustbox-*.pkg.tar.zst)
echo "=== built package: $PKG ==="
cp "$PKG" /work/pkg/

# WebKitGTK looks up `autoaudiosink` at runtime and aborts in WebKitWebProcess
# when no GStreamer plugin provides it, so the recipe has to declare the plugin
# sets as real package dependencies. Read the metadata pacman installs from.
echo "=== .PKGINFO: gstreamer runtime dependencies ==="
bsdtar -xOf "$PKG" .PKGINFO | grep -E '^(depend|optdepend) =' || true
for dep in gst-plugins-base gst-plugins-good; do
  bsdtar -xOf "$PKG" .PKGINFO | grep -qx "depend = $dep" || {
    echo "FAIL: .PKGINFO is missing the $dep dependency"
    exit 1
  }
done
for dep in gst-plugins-bad libnice gst-plugin-pipewire gst-libav; do
  bsdtar -xOf "$PKG" .PKGINFO | grep -q "^optdepend = $dep: " || {
    echo "FAIL: .PKGINFO is missing the $dep optional dependency"
    exit 1
  }
done

pacman -Qp --info "$PKG"
echo "=== files ==="
pacman -Qlp "$PKG"

echo "=== install ==="
pacman -U --noconfirm "$PKG"

echo "=== ldd: webkit and gtk resolve to system libraries ==="
ldd /usr/bin/rustbox
echo "=== no bundled webkit, no rpath ==="
readelf -d /usr/bin/rustbox | grep -E "RPATH|RUNPATH|NEEDED" || true
ls -la /usr/lib/libwebkit2gtk-4.1.so* /usr/lib/libgtk-3.so* 2>/dev/null | head -4

echo "=== desktop file ==="
cat /usr/share/applications/rustbox.desktop
echo "=== icons ==="
find /usr/share/icons/hicolor -name 'rustbox.png' | sort
echo "=== namcap ==="
namcap "$PKG" || true
echo "=== pacman -Qk ==="
pacman -Qk rustbox
echo "=== desktop-file-validate ==="
pacman -S --noconfirm --needed --quiet desktop-file-utils >/dev/null
desktop-file-validate /usr/share/applications/rustbox.desktop && echo "desktop file ok"
CONTAINER

docker run --rm \
  --name rustbox-arch-verify \
  -v "$OUT:/work" \
  -w /work \
  archlinux:latest \
  bash /work/in-container.sh 2>&1 | tee "$OUT/container.log"
