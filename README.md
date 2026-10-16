# Rustbox

Rustbox is a desktop shell for web apps. It keeps WhatsApp, Slack, Discord, Zulip, Telegram, Grok, ChatGPT, Claude, and any other site you add in one window. Each service has its own webview, its own persistent session, and a sidebar icon.

The shell is [Tauri](https://v2.tauri.app/) 2 on the system webview: WebView2 on Windows and WebKitGTK 4.1 on Linux. Several webviews in one window use Tauri's `unstable` feature.

## Run it from a release

Published builds are portable. There is no installer.

- **Windows:** download `rustbox-windows-x64.exe` and run it. Windows 11 and current Windows 10 already include the WebView2 runtime this executable needs.
- **Linux AppImage:** `chmod +x rustbox-linux-x64.AppImage` and run it.
- **Linux binary:** extract `rustbox-linux-x64.tar.gz` and run `./rustbox`.

Linux builds still need WebKitGTK 4.1 on the machine (`libwebkit2gtk-4.1-0`). The AppImage does not vendor WebKit. On Debian or Ubuntu:

```bash
sudo apt-get install libwebkit2gtk-4.1-0 libgtk-3-0
```

## Develop

Install Rust (stable), Node.js 22, and the Tauri Linux packages if you are on Linux:

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf build-essential libssl-dev
```

Windows development needs the Visual Studio C++ build tools and the WebView2 runtime. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev
```

A production build:

```bash
# Linux: AppImage plus the raw binary in src-tauri/target/release
npm run tauri build -- --bundles appimage

# Windows: portable exe, no installer
npm run tauri build -- --no-bundle
```

The Windows executable is `src-tauri/target/release/rustbox.exe` (or under `target/<triple>/release` when you pass `--target`).

Unit tests for config, unread-title parsing, and link policy:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Regenerate the app icon from the source drawing:

```bash
python3 scripts/gen-icon.py
npm run tauri icon src-tauri/app-icon.png
```

## Using the app

The sidebar lists services by name and icon. Collapse it to an icon rail; the icons stay centered, the names stay on the tooltips, and that choice is saved in `config.json`. Click **rustbox** at the top of the sidebar to open the desk: a card for each service with its icon, unread count, and Open, Edit, and Remove actions, plus the app version. Click a service to show it. The webview stays alive when you switch away, so logins and drafts are still there when you come back.

Right-click a service in the sidebar to turn that service's sound or its badges and desktop notifications on or off. **Do not disturb**, under the service list, pauses sound and notifications for every service until you turn it off. Those choices are saved in `config.json`. A service with sound off shows a small mark on its icon. While Do not disturb is on, the control is filled in. Sound mutes that service's page audio. The operating system's own toast sound, when a notification is still allowed, follows the system settings.

**Add** opens the services dialog:

- Presets: WhatsApp Web, Slack, Discord, Zulip, Telegram Web, Grok, ChatGPT, and Claude. Each preset uses a brand icon bundled with the app, so the sidebar still shows it offline. Zulip asks for your server URL, for example `https://your-org.zulipchat.com`.
- A custom service is a name, an `http` or `https` URL, an optional icon (image URL or a short emoji), a color, and a user-agent setting. With no icon of its own, Rustbox tries that site's favicon and falls back to a letter.
- Drag icons in the sidebar to reorder. Remove deletes that service's saved session.

Adding the same preset twice creates a second isolated account (`WhatsApp` and `WhatsApp 2`).

### Keyboard

These chords work from the desk and from inside a service. On macOS, use Command instead of Ctrl. They follow the current sidebar order and are not saved separately.

| Shortcut | Action |
| --- | --- |
| Ctrl+1 … Ctrl+9 | Open that service, first through ninth |
| Ctrl+Tab | Next service. From the desk, this opens the first one |
| Ctrl+Shift+Tab | Previous service. From the desk, this opens the last one |
| Ctrl+Shift+D | Open the desk |

A number past the end of the list does nothing. Ctrl+0 is left for the service page's own zoom.

### Tray

While Rustbox is running it keeps a tray icon, using the app icon. Left-click or double-click shows and focuses the window. The menu has **Show window**, **Hide window**, and **Quit**. On Linux the panel does not deliver that click, so use **Show window** there.

### Where data lives

The dialog shows the live paths. They follow the bundle id `app.rustbox.desktop`:

| | Linux | Windows |
| --- | --- | --- |
| Config | `~/.config/app.rustbox.desktop/config.json` | `%APPDATA%\app.rustbox.desktop\config.json` |
| Sessions | `~/.local/share/app.rustbox.desktop/sessions/<id>/` | `%APPDATA%\app.rustbox.desktop\sessions\<id>\` |

`config.json` stores names, URLs, order, icons, user-agent settings, whether the sidebar is collapsed, per-service sound and notification switches, and Do not disturb. Cookies, `localStorage`, and cache live in the session directory for that service id, not in the shared webview profile. The portable Windows `.exe` and the Linux AppImage use these same directories, not a folder next to the file.

The first published build used the bundle id `com.ifigueroa.rustbox` and stored sessions in `services/<id>`. Rustbox copies that older config forward when the current `config.json` is missing or its service list is empty, and an older file that actually has services exists. A current config that already lists services is left as it is. The search also checks `config.json.bak` beside either id, the data directory, and on Windows the LocalAppData folder. The older files are not deleted.

### User agent

Every service uses a recent Chrome user agent by default (Chrome 155 as of October 2026), because sites such as WhatsApp Web reject the WebKit user agent. Turn the checkbox off to use the system webview's own agent, or type a custom string to replace the built-in Chrome string. The override is stored per service. Changing the URL or the user agent reloads that service's webview and keeps the same session directory.

### Notifications and badges

A script injected into each service webview wraps `window.Notification` and forwards the title and body to a native OS notification. The notification is attributed to the service (`Slack: New message`). Each service is limited to 6 notifications per 20 seconds. Turning notifications off for a service, or turning on Do not disturb, drops those notifications and hides the unread badge. The count is still tracked, so the badge comes back when you allow notifications again.

The same script mutes `audio` and `video` elements and suspends `AudioContext` while that service's sound is off, or while Do not disturb is on. On Linux the WebKit view is muted as well.

Unread badges are parsed from the document title, which is how these apps usually report them: `(3) WhatsApp`, `Slack (12)`, `[4] Telegram`. A leading `•` with no number counts as one. The badge appears after that service's webview has been created, and it updates while the webview is hidden.

### Links

Ordinary clicks that leave the service's site open in the system browser. Same-site links stay in the webview. Clicks to a short list of login providers (Google, Microsoft, Apple, Okta, and similar) also stay in the webview so redirect sign-in can finish. Middle-click, modifier-click, and `target="_blank"` open in the system browser, except login-provider popups, which the webview is allowed to open. `mailto:` and `tel:` links open externally.

## Releases

Versions follow [Conventional Commits](https://www.conventionalcommits.org/). `.github/workflows/pull-request.yml` checks the pull request title. Squash-merge so that title becomes the commit on `master`. [Release Please](https://github.com/googleapis/release-please) reads that message.

| Pull request title | Next version |
| --- | --- |
| `fix: ...` | patch (`0.1.1` → `0.1.2`) |
| `feat: ...` | minor (`0.1.1` → `0.2.0`) |
| `feat!: ...`, `fix!: ...`, or a `BREAKING CHANGE:` footer | major (`0.1.1` → `1.0.0`) |
| `chore:`, `ci:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `build:`, `revert:` | no release |

A scope is optional (`fix(sidebar): ...`). This mapping is the default Release Please strategy, including before 1.0.0: a breaking change on `0.1.x` releases `1.0.0`.

On every push to `master`, `.github/workflows/release-please.yml` runs Release Please. After a releasable commit, it opens a release pull request that bumps `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the `rustbox` entry in `src-tauri/Cargo.lock`, and writes `CHANGELOG.md`. Merging that pull request creates the tag `vX.Y.Z` and a GitHub Release whose notes are the changelog. The same workflow then starts `.github/workflows/release.yml` on that tag.

`release.yml` also runs when a `v*` tag is pushed and on manual `workflow_dispatch`. It builds:

- `rustbox-windows-x64.exe` on `windows-latest`
- `rustbox-linux-x64.AppImage` and `rustbox-linux-x64.tar.gz` on `ubuntu-22.04`

and uploads them to the GitHub Release. A tag-triggered run requires the tag to match `version` in `src-tauri/tauri.conf.json` (`v0.1.1` for version `0.1.1`). If the release already has notes, the workflow leaves them in place and only adds the build assets.

The Cargo version lines Release Please rewrites are marked with `x-release-please-version`. Keep that comment on the package version in `src-tauri/Cargo.toml` and on the `rustbox` version in `src-tauri/Cargo.lock`. `cargo update` rewrites the lockfile and drops the comment; put it back on the `rustbox` version line before merging. `node scripts/check-release-versions.mjs` checks that the versions match and that both markers are present.

Release Please uses the workflow `GITHUB_TOKEN`. No extra secret is required. In the repository Actions settings:

- Workflow permissions must allow Actions to read and write repository contents. The workflows request `contents: write` themselves.
- **Allow GitHub Actions to create and approve pull requests** must be enabled, or Release Please cannot open the release pull request.

A tag created with `GITHUB_TOKEN` does not start `release.yml` on its own. Release Please dispatches it with `workflow_dispatch` on the new tag, which `GITHUB_TOKEN` is allowed to do. A tag you push yourself still starts `release.yml` directly. If GitHub holds checks on a pull request that Actions opened, approve that workflow run so the release pull request can merge.

## Known limitations

- **macOS is not built or tested.** The code selects a WebKit data-store id on macOS because `data_directory` is unavailable there, but there is no macOS workflow.
- **Multiple webviews depend on Tauri's `unstable` API.** That API is the supported way to keep more than one webview in a single window, and it can still change. On Linux, Tauri currently packs those children into a vertical box and ignores the requested position, so Rustbox moves the shell and each service onto a single `GtkFixed` after creation.
- **Linux is WebKit, not Chrome.** The Chrome user agent fixes the simple rejection check. WhatsApp Web and other sites can still refuse the session after inspecting browser features, service workers, or codecs. WebKitGTK 4.1 also has to be installed on the host.
- **Windows portable builds need WebView2.** The `.exe` does not embed the runtime. Toasts from an unpackaged executable sometimes fail to register with Windows even when the in-app badge still updates.
- **Notification forwarding covers the page `Notification` constructor.** Service-worker push notifications are not forwarded. Linux needs a running notification daemon.
- **Badges depend on the page title.** A service that shows an unread count only inside the page, with a static title, will not get a badge. Counts start at zero each launch until that webview loads.
- **Popup OAuth is best-effort.** Redirect sign-in stays inside the webview. A login flow that depends on `window.opener` in a popup can still fail because the popup does not share the service session.
- **External-link handling is click and `window.open` based.** A script that assigns `location` to another site stays in the webview, so a login redirect is not kicked out to the browser.
- **Downloads, camera, microphone, and screen sharing** use whatever the system webview allows. They were not exercised in testing.
- **Interactive testing was on Linux.** Adding a preset, saving `config.json`, creating that service's session directory, and loading Telegram Web were checked. GUI checks did not cover notification toasts, drag-reorder, removing a service, or signing in to WhatsApp, Slack, or the other presets. The Windows executable is built by CI and was not run.
