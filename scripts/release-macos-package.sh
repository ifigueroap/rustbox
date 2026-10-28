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
COPYFILE_DISABLE=1 tar -C "$BUNDLE/macos" -czf rustbox-macos-universal.app.tar.gz "$(basename "$APP")"
