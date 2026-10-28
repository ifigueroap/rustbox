#!/bin/bash
# Build the universal macOS app and disk image.
# Signing is optional: every Apple secret must be set, or the build is ad-hoc
# signed. This script never prints secret values.
set -euo pipefail

sign=1
if [ -z "${APPLE_CERTIFICATE:-}" ]; then
  echo "Apple secret APPLE_CERTIFICATE is not set; building with an ad-hoc signature"
  sign=0
elif [ -z "${APPLE_CERTIFICATE_PASSWORD:-}" ]; then
  echo "Apple secret APPLE_CERTIFICATE_PASSWORD is not set; building with an ad-hoc signature"
  sign=0
elif [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "Apple secret APPLE_SIGNING_IDENTITY is not set; building with an ad-hoc signature"
  sign=0
elif [ -z "${APPLE_ID:-}" ]; then
  echo "Apple secret APPLE_ID is not set; building with an ad-hoc signature"
  sign=0
elif [ -z "${APPLE_PASSWORD:-}" ]; then
  echo "Apple secret APPLE_PASSWORD is not set; building with an ad-hoc signature"
  sign=0
elif [ -z "${APPLE_TEAM_ID:-}" ]; then
  echo "Apple secret APPLE_TEAM_ID is not set; building with an ad-hoc signature"
  sign=0
fi

P12=""
KEYCHAIN=""
cleanup() {
  if [ -n "$KEYCHAIN" ]; then
    security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  fi
  if [ -n "$P12" ]; then
    rm -f "$P12"
  fi
}
trap cleanup EXIT

if [ "$sign" -eq 0 ]; then
  unset APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
  export APPLE_SIGNING_IDENTITY="-"
else
  echo "Apple signing secrets are present; importing the certificate into a temporary keychain"
  P12="${RUNNER_TEMP:-/tmp}/rustbox-certificate.p12"
  KEYCHAIN="${RUNNER_TEMP:-/tmp}/rustbox-signing.keychain-db"
  KEYCHAIN_PASSWORD=$(openssl rand -base64 32)
  export RUSTBOX_P12="$P12"
  python3 -c 'import base64, os, pathlib; pathlib.Path(os.environ["RUSTBOX_P12"]).write_bytes(base64.b64decode(os.environ["APPLE_CERTIFICATE"].strip()))'
  unset RUSTBOX_P12
  security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
  security default-keychain -s "$KEYCHAIN"
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
  security set-keychain-settings -t 3600 -u "$KEYCHAIN"
  existing=$(security list-keychains -d user | sed 's/^[[:space:]]*//;s/"//g')
  # shellcheck disable=SC2086
  security list-keychains -d user -s "$KEYCHAIN" $existing
  security import "$P12" -k "$KEYCHAIN" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/productsign -T /usr/bin/productbuild
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
  rm -f "$P12"
  P12=""
  echo "Certificate imported"
fi

npm run tauri build -- --target universal-apple-darwin --bundles dmg,app
