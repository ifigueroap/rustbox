#!/bin/bash
# Point TAURI_SIGNING_PRIVATE_KEY at a key file for the bundler.
#
# A published build (tag or workflow_dispatch) must use the repository secret.
# A pull request build may mint an ephemeral key so the bundler can still
# produce .sig files. Those artifacts are not uploaded to a GitHub Release.
set -euo pipefail

event="${GITHUB_EVENT_NAME:-}"
dest="${RUNNER_TEMP:-/tmp}/rustbox-updater.key"
umask 077

if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  printf '%s' "$TAURI_SIGNING_PRIVATE_KEY" > "$dest"
  echo "Using the repository updater signing key"
else
  if [ "$event" != "pull_request" ]; then
    echo "TAURI_SIGNING_PRIVATE_KEY is required to sign updater artifacts for a release"
    exit 1
  fi
  echo "No repository updater signing key; generating an ephemeral key. This pull request will not publish."
  npm run tauri -- signer generate -w "$dest" -f --ci --password ""
fi

if [ ! -s "$dest" ]; then
  echo "updater signing key file was not written"
  exit 1
fi

if [ -n "${GITHUB_ENV:-}" ]; then
  echo "TAURI_SIGNING_PRIVATE_KEY=$dest" >> "$GITHUB_ENV"
  echo "TAURI_SIGNING_PRIVATE_KEY_PASSWORD=${TAURI_SIGNING_PRIVATE_KEY_PASSWORD-}" >> "$GITHUB_ENV"
fi
