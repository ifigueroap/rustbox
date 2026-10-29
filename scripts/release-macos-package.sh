#!/bin/bash
# Copy the universal macOS bundles to stable artifact names.
set -euo pipefail

BUNDLE="src-tauri/target/universal-apple-darwin/release/bundle"
DMG=$(find "$BUNDLE/dmg" -type f -name '*.dmg' | head -n 1)
if [ -z "$DMG" ]; then
  echo "DMG was not produced"
  find "$BUNDLE" -type f | head -n 100
  exit 1
fi
cp "$DMG" rustbox-macos-universal.dmg
APP=$(find "$BUNDLE/macos" -maxdepth 1 -type d -name '*.app' | head -n 1)
if [ -z "$APP" ]; then
  echo ".app bundle was not produced"
  find "$BUNDLE" | head -n 100
  exit 1
fi
SIGNED=$(find "$BUNDLE/macos" -maxdepth 1 -type f -name '*.app.tar.gz' ! -name '*.sig' | head -n 1)
SIG=$(find "$BUNDLE/macos" -maxdepth 1 -type f -name '*.app.tar.gz.sig' | head -n 1)
if [ -z "$SIGNED" ] || [ -z "$SIG" ]; then
  echo "signed macOS updater archive was not produced"
  find "$BUNDLE/macos" -maxdepth 2 | head -n 100
  exit 1
fi
# Publish the archive Tauri signed. Repacking it would invalidate the signature.
cp "$SIGNED" rustbox-macos-universal.app.tar.gz
cp "$SIG" rustbox-macos-universal.app.tar.gz.sig
