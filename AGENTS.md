# Agent instructions

## Project scope

Rustbox is a Tauri 2 desktop shell for multiple web services, with a TypeScript frontend and Rust backend. The frontend lives in `src/`; native configuration, commands, webviews, and platform integration live in `src-tauri/src/`. It is separate from the Omarchy/Hyprland Omabox plugin.

Before changing behavior, read the relevant README section and inspect both sides of the frontend/backend contract. Keep command names, serialized camelCase data, snapshots, event handling, and Tauri permissions in sync.

## Architecture and data

- A service has its own persistent webview session. Keep session data keyed by the stable service id and preserve cookies, local storage, and cache when switching services or reloading. Removing a service intentionally deletes its session; preserve that behavior unless the request changes it.
- Configuration and migrations are handled in `src-tauri/src/config.rs`. Preserve existing service lists and settings during migration; do not silently discard a readable legacy config or session directory.
- Keep navigation, popup, external-link, login-provider, unread-title, and user-agent policy centralized in `src-tauri/src/policy.rs`. Validate URLs before opening them externally.
- Keep sound and notification behavior aligned with Do Not Disturb and per-service settings. The injected webview script is in `src-tauri/src/inject.js`.
- Updater installs are limited to bundles the app can replace: NSIS, AppImage, and macOS `.app`. A Linux install with no bundle marker and no `APPIMAGE` is treated as package-managed (`updates::package_managed`), reports `packageManaged` in the snapshot, and must stay notify-only. Keep the Arch PKGBUILD and the shell's `PACKAGE_UPDATE_COMMAND` in the README's wording when either changes.
- When adding a Tauri command, update the invoke handler and the relevant capability/permission files under `src-tauri/capabilities/` and `src-tauri/permissions/` as needed. Do not grant a webview broader native access than the feature requires.
- Preserve the Linux GTK/WebKit host workaround in `linux_host.rs` when changing webview geometry or lifecycle. `prepare_environment` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` only for the AppImage, whose bundled WebKitGTK is older than the host's Mesa, and only when the variable is unset; a package or native install keeps DMA-BUF, which is much faster, so do not make the default unconditional. It must run before any window or webview exists, and it must never overwrite a value the user set. Native installs also need the GStreamer good plugins: WebKitGTK looks up `autoaudiosink` at runtime and aborts `WebKitWebProcess` the first time a page plays audio when the plugin is missing, which is why the Arch PKGBUILD depends on `gst-plugins-base` and `gst-plugins-good`. Windows uses WebView2. macOS release CI builds a universal bundle; interactive macOS behavior is not tested, so do not claim runtime support from compilation or a green bundle alone.
- Avoid logging service URLs with embedded credentials, config contents, cookies, or other session data.

## Releases

- Keep app versions aligned across `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `packaging/arch/PKGBUILD`, and the Rustbox package entry in `src-tauri/Cargo.lock`.
- Preserve the `x-release-please-version` markers in the Cargo manifests/lockfile and on `pkgver` in `packaging/arch/PKGBUILD`. `cargo update` can remove the lockfile marker.
- Pull request titles must use the Conventional Commit types configured in `.github/workflows/pull-request.yml`; release automation uses squash-merge commit titles.
- `packaging/arch/PKGBUILD` is the source of truth for the Arch package. The release Publish job renders it for the tag with `scripts/render-arch-pkgbuild.mjs` (pkgver, pkgrel, tag-tarball checksum) and uploads the result as the `PKGBUILD` release asset, which is what the README one-liner downloads. Change the recipe, not the rendered output, and keep `build()` producing a binary at `src-tauri/target/release/rustbox` because `package()` installs that path.

## Checks

Available project checks include:

```sh
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
node scripts/check-release-versions.mjs
node scripts/render-arch-pkgbuild.mjs --self-test
```

`scripts/verify-arch-build.sh <worktree>` runs `makepkg` in `archlinux:latest` against the current tree, checks the packaged binary links the distribution's `libwebkit2gtk-4.1`, and fails unless the built package's `.PKGINFO` lists the GStreamer `depend`/`optdepend` entries. It needs Docker. It rewrites only `source` and `sha256sums` to a local tarball; the rest of the recipe is what ships.

GUI behavior requires a desktop environment with the relevant system webview. Linux builds need WebKitGTK 4.1; Windows portable builds need WebView2. Distinguish compilation/unit checks from interactive platform verification, and do not claim untested platform behavior.
