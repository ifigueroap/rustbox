# Rustbox

Rustbox is a desktop shell for web apps, in the same family as Rambox and Ferdium. One window holds a sidebar of services. Each service is its own system webview with its own cookies and storage, so two accounts of the same site can stay signed in side by side.

It is built with stable [Tauri 2](https://v2.tauri.app/) (Rust) and the operating system's webview: WebView2 on Windows, WebKitGTK on Linux. macOS is not packaged yet.

## Features

- Sidebar of services. Selecting one shows that service and leaves the others alive in the background.
- A separate persistent data directory per service.
- Built-in presets: WhatsApp Web, Slack, Discord, Zulip (you supply the server URL), Telegram Web, Grok, ChatGPT, and Claude.
- Custom services with a name, an http(s) URL, and an optional icon (emoji, short monogram, or image URL). Add, edit, remove, and drag to reorder. The list is stored in a JSON config file.
- Per-service user-agent override. The default is a current desktop Chrome UA, which is what WhatsApp Web and similar sites check for when the underlying engine is WebKit.
- An injected script that forwards `Notification` and service-worker notifications to native OS notifications, and reports unread counts for the sidebar badge.
- Links that leave the service open in the system browser. Sign-in popups try to stay inside the app and share that service's session.

Multiple webviews in one window use Tauri's `unstable` feature. That API is shipped in stable Tauri 2 releases, but it is still marked unstable and can change between minor versions.

## Known limitations

- **WebKitGTK (Linux).** The Chrome user agent gets past the common "please use Chrome" check, including WhatsApp Web's user-agent gate. It does not make WebKit identical to Chrome. Some sites still mis-render, block features, or fail login because they fingerprint the engine. The Windows WebView2 build is the closer match to Chrome. Service pages are also reparented onto a GTK fixed container: Tauri otherwise packs each extra WebKit view into the window's vertical box, which splits the shell in half.
- **macOS is not in this release.** Tauri's `data_directory` (the per-service session folder) is unsupported on macOS; that platform needs `dataStoreIdentifier` instead. There is no macOS bundle or CI target yet.
- **Notifications.** The page's `Notification` constructor and `ServiceWorkerRegistration.showNotification` are forwarded to the OS. Clicks, actions, and replies are not delivered back into the page. A service that never uses those APIs, the document title, or the Badging API will not show a badge.
- **Unread badges** come from `(n)` / `[n]` in the document title (numbers above 999 are ignored) and from `navigator.setAppBadge`. Title parsing can miss counts that a site only draws in the page, and it can briefly clear while a page is loading.
- **External links.** Normal cross-site anchor clicks, middle-clicks, and `window.open` to other sites open in the system browser. Navigations that stay in the same registrable domain, plus a short list of sign-in hosts, stay in the service webview so OAuth redirects keep working. `on_navigation` cannot tell a main frame from an iframe, so arbitrary cross-site *redirects* (as opposed to link clicks and `window.open`) are allowed inside the webview.
- **Sign-in popups** are separate windows that try to reuse the service's data directory. WebView2 and WebKitGTK sometimes refuse a second webview on the same directory. When that happens the URL is opened in the system browser instead, and the login may not come back into Rustbox.
- **Remote pages are not given the shell API.** A service page can only ask Rustbox to show a notification, set its own badge, or open an http(s) URL. Those calls are rate-limited. On Linux, Tauri cannot tell an iframe from the webview itself, so an embedded frame on a service page has the same three calls.
- **Windows portable exe.** `rustbox-windows-x64.exe` does not bundle an installer. It expects the [WebView2 Evergreen runtime](https://developer.microsoft.com/microsoft-edge/webview2/), which current Windows 10 and 11 already have.
- **Linux tarball.** `rustbox-linux-x64.tar.gz` is the raw binary. It needs GTK 3 and WebKitGTK 4.1 (`libwebkit2gtk-4.1-0`) on the machine. The AppImage bundles those libraries. Running an AppImage still needs FUSE (`libfuse2` on some distributions).
- The shell UI and the release workflow are covered by unit tests and CI builds. A local Linux run loaded `https://example.com/` in a kept-alive child webview with its own data directory; the page contents landed in that session's cache and the shell kept its full height. Interactive checks against WhatsApp, Slack, and the other presets were not run, and the Windows exe is produced by CI rather than by a local Windows session. Notification clicks and OAuth popup session sharing were not exercised.

## Prerequisites

- Rust stable (1.90 or newer) and Cargo
- Node.js 20 or newer
- On Linux, GTK 3 and WebKitGTK 4.1 development packages. On Ubuntu or Debian:

```sh
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf \
  libssl-dev \
  libxdo-dev \
  build-essential \
  pkg-config \
  file
```

- On Windows, the [Microsoft C++ build tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and the WebView2 runtime

## Develop

```sh
npm install
npm run tauri dev
```

`npm run tauri dev` starts Vite and the Rust shell. Child webviews are created when you select a service. DevTools for those webviews are enabled in debug builds.

Useful checks:

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Build a local binary

```sh
npm run tauri build
```

On Linux this also tries to produce the configured bundles (AppImage, and deb/rpm when the extra tools exist). The application binary itself is `src-tauri/target/release/rustbox` (or `rustbox.exe` on Windows). A portable Windows exe without an installer is that `rustbox.exe`; pass `--no-bundle` to skip NSIS/MSI:

```sh
npm run tauri build -- --no-bundle
```

Linux AppImage only:

```sh
npm run tauri build -- --bundles appimage
```

## Configuration and sessions

The shell writes `config.json` the first time it runs.

| Platform | Config | Session folders |
| --- | --- | --- |
| Linux | `~/.config/com.ifigueroa.rustbox/config.json` | `~/.local/share/com.ifigueroa.rustbox/services/<id>/` |
| Windows | `%APPDATA%\com.ifigueroa.rustbox\config.json` | `%APPDATA%\com.ifigueroa.rustbox\services\<id>/` |

Exact paths are shown at the bottom of the add-service panel. Quit Rustbox before editing the file by hand; the running app overwrites it when the sidebar changes.

```json
{
  "version": 1,
  "activeId": null,
  "services": [
    {
      "id": "0f5b1c2a-3d4e-4f60-9a1b-2c3d4e5f6071",
      "name": "WhatsApp",
      "url": "https://web.whatsapp.com/",
      "icon": null,
      "userAgent": null,
      "preset": "whatsapp"
    }
  ]
}
```

`userAgent: null` means the default Chrome UA. A second WhatsApp entry gets a new id and a new session folder. Removing a service deletes that folder (or on the next launch, if the webview still had the files open).

Zulip has no default URL. Add it from the preset card and enter the server, for example `https://your-org.zulipchat.com`.

## Releases

`.github/workflows/release.yml` runs on tags that start with `v` and from the Actions tab (`workflow_dispatch`). A tag build publishes a GitHub Release with:

- `rustbox-windows-x64.exe`
- `rustbox-linux-x64.AppImage`
- `rustbox-linux-x64.tar.gz`

`workflow_dispatch` builds the same artifacts and uploads them to the workflow run without creating a release. Linux packages are built on Ubuntu 22.04 so the binary is not tied to a newer glibc.

## Layout

- `src/` — sidebar UI (Vite, no framework)
- `src-tauri/src/runtime.rs` — webview creation, badges, notifications, external links
- `src-tauri/src/policy.rs` — which URLs stay in the app, unread-title parsing
- `src-tauri/src/inject.js` — script injected into every service webview
- `src-tauri/src/presets.rs` — built-in services
- `src-tauri/src/config.rs` — `config.json`

## License

MIT. Copyright 2026 Ismael Figueroa.
