# Agent instructions

## Project scope

Rustbox is a Tauri 2 desktop shell for multiple web services, with a TypeScript frontend and Rust backend. The frontend lives in `src/`; native configuration, commands, webviews, and platform integration live in `src-tauri/src/`. It is separate from the Omarchy/Hyprland Omabox plugin.

Before changing behavior, read the relevant README section and inspect both sides of the frontend/backend contract. Keep command names, serialized camelCase data, snapshots, event handling, and Tauri permissions in sync.

## Architecture and data

- A service has its own persistent webview session. Keep session data keyed by the stable service id and preserve cookies, local storage, and cache when switching services or reloading. Removing a service intentionally deletes its session; preserve that behavior unless the request changes it.
- Configuration and migrations are handled in `src-tauri/src/config.rs`. Preserve existing service lists and settings during migration; do not silently discard a readable legacy config or session directory.
- Keep navigation, popup, external-link, login-provider, unread-title, and user-agent policy centralized in `src-tauri/src/policy.rs`. Validate URLs before opening them externally.
- Keep sound and notification behavior aligned with Do Not Disturb and per-service settings. The injected webview script is in `src-tauri/src/inject.js`.
- When adding a Tauri command, update the invoke handler and the relevant capability/permission files under `src-tauri/capabilities/` and `src-tauri/permissions/` as needed. Do not grant a webview broader native access than the feature requires.
- Preserve the Linux GTK/WebKit host workaround in `linux_host.rs` when changing webview geometry or lifecycle. Windows uses WebView2. macOS is not currently built or tested; do not claim support based only on compilation.
- Avoid logging service URLs with embedded credentials, config contents, cookies, or other session data.

## Releases

- Keep app versions aligned across `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the Rustbox package entry in `src-tauri/Cargo.lock`.
- Preserve the `x-release-please-version` markers in the Cargo manifests/lockfile. `cargo update` can remove the lockfile marker.
- Pull request titles must use the Conventional Commit types configured in `.github/workflows/pull-request.yml`; release automation uses squash-merge commit titles.

## Checks

Available project checks include:

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
node scripts/check-release-versions.mjs
```

GUI behavior requires a desktop environment with the relevant system webview. Linux builds need WebKitGTK 4.1; Windows portable builds need WebView2. Distinguish compilation/unit checks from interactive platform verification, and do not claim untested platform behavior.
