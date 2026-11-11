# Rustbox

Rustbox is a desktop shell for web apps. It keeps WhatsApp, Slack, Discord, Zulip, Telegram, Grok, ChatGPT, Claude, and any other site you add in one window. Each service has its own webview, its own persistent session, and a sidebar icon. Services are grouped into workspaces, named sets like Work, Teaching, and Personal, that you switch between from a rail at the far left; a service can appear in more than one while keeping a single session.

The shell is [Tauri](https://v2.tauri.app/) 2 on the system webview: WebView2 on Windows, WKWebView on macOS, and WebKitGTK 4.1 on Linux. Several webviews in one window use Tauri's `unstable` feature.

## Run it from a release

Published builds include a Windows installer and portable executable, a Linux AppImage and binary, a universal macOS disk image and app archive, and an Arch Linux package recipe.

- **Windows installer:** download `rustbox-windows-x64-setup.exe`. It offers **Just me** and **All users**. On an administrator account Windows asks for approval first, then shows the choice. Just me installs under the current account; when an older per-user copy is already installed, that choice upgrades it in place. All users installs to Program Files. A standard account does not see All users and installs for the current user only. Either choice uses the same app id `app.rustbox.desktop` as the portable executable, so each person's config and sessions stay in their own `%APPDATA%\app.rustbox.desktop`. A machine-wide install does not move or share that folder. Choosing All users when a per-user copy is already installed removes that copy's program files and does not delete AppData. An upgrade replaces program files and does not delete services. The installer creates a Start Menu shortcut and an uninstaller. The uninstaller removes services and sessions only if you check **Delete app data**; leave that unchecked to keep them. Windows 11 and current Windows 10 already include the WebView2 runtime it needs.
- **Windows portable:** download `rustbox-windows-x64.exe` and run it. It also needs WebView2.
- **Linux AppImage:** `chmod +x rustbox-linux-x64.AppImage` and run it.
- **Linux binary:** extract `rustbox-linux-x64.tar.gz` and run `./rustbox`.
- **Arch Linux and Omarchy:** install from source against the system WebKitGTK with the one-liner in [Arch Linux / Omarchy](#arch-linux--omarchy). The AppImage's bundled WebKitGTK can abort on a newer Mesa, so this is the recommended Linux install there.
- **macOS disk image:** download `rustbox-macos-universal.dmg`, open it, and drag Rustbox to Applications. The same file runs on Apple Silicon and Intel. macOS 14 or newer is required.
- **macOS app archive:** extract `rustbox-macos-universal.app.tar.gz` and open `Rustbox.app`.

The published macOS build is ad-hoc signed unless the release workflow has Apple signing secrets. Gatekeeper then quarantines the download. The first time, right-click Rustbox, choose **Open**, and confirm. Or clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/Rustbox.app
```

Use the path of the app you opened if it is not in Applications.

## Arch Linux / Omarchy

The AppImage is built on Ubuntu 22.04 and carries that distribution's WebKitGTK. On Arch and Omarchy the bundled `WebKitWebProcess` can abort as soon as it meets a newer Mesa or GL stack, which shows up as a SIGABRT in `systemd-coredump`. An Arch package builds Rustbox against the system WebKitGTK instead, so the web engine and the graphics driver are the ones pacman already maintains for the rest of the desktop. That build keeps WebKitGTK's DMA-BUF renderer and depends on `gst-plugins-base` and `gst-plugins-good`, because WebKitGTK aborts in `WebKitWebProcess` the first time a page plays audio when no installed GStreamer plugin provides `autoaudiosink`; `gst-plugins-bad` and `gst-libav` add codecs for voice notes and video.

Install it with one command. Nothing is cloned and the release asset is the recipe:

```bash
d=$(mktemp -d) && cd "$d" && curl -fsSLO https://github.com/ifigueroap/rustbox/releases/latest/download/PKGBUILD && makepkg -si
```

`makepkg` downloads the source tarball for the latest tag, installs `webkit2gtk-4.1`, `gtk3`, `libayatana-appindicator`, `xdg-utils`, `gst-plugins-base`, `gst-plugins-good`, and the build dependencies, compiles the app, and hands the result to `pacman`. Rustbox lands in `/usr/bin/rustbox` with a desktop entry and hicolor icons, so it appears in your launcher. The first build takes a while because it compiles the app; later updates reuse the build cache.

Updates are the same command. Rerun it whenever you want the newer release, or run `pacman -Syu` after rebuilding. Rustbox itself does not touch files pacman owns: when a release is newer and the copy is a package install, the update dialog names the version and shows the command instead of offering **Download and install**. The AppImage keeps its own updater.

Uninstall with pacman:

```bash
sudo pacman -R rustbox
```

Your services, sessions, and settings live in `~/.config/app.rustbox.desktop/` and `~/.local/share/app.rustbox.desktop/`, which pacman never touches. Removing the package keeps them, so a later reinstall comes back to the same setup; delete those two directories yourself if you want a clean slate.

The package is intentionally not on the AUR yet. The GitHub release asset is the only distribution channel, and `packaging/arch/PKGBUILD` in this repository is the recipe it is rendered from. Every release sets `pkgver` to the tag, resets `pkgrel`, and computes the checksum of that tag's tarball, so the asset always matches the release it came from.

### WebKitGTK on Wayland

The AppImage is the only build that sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` at startup, and only when the variable is unset. WebKitGTK 2.42 and later draw through DMA-BUF, and its renderer is what aborts when the web engine, the compositor, and Mesa disagree. The AppImage carries Ubuntu 22.04's WebKitGTK, so on Arch with a newer Mesa that disagreement is a crash, and the software path avoids it.

A package build leaves the variable alone. It links the distribution's WebKitGTK, which was built against the same Mesa the desktop already runs, so DMA-BUF works and is much faster; forcing the software path there makes heavy pages crawl and typing in WhatsApp Web keep a whole core busy. Set the variable yourself to any value to keep your choice, in either build:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 rustbox
```

Rustbox never overwrites a value you set, and the log line at startup says when its own default was applied.

### GStreamer plugins

WebKitGTK builds its audio pipeline from GStreamer plugins at runtime. The first time a page plays audio it asks for `autoaudiosink`, and a native install with no plugin providing that element aborts in `WebKitWebProcess`: the log shows `no such element factory "autoaudiosink"`, a `GLib-GObject-CRITICAL` about a NULL instance, and then SIGABRT. The Arch package depends on `gst-plugins-base` and `gst-plugins-good`, which provide it. Optional packages add call support and codecs:

| Package | Why install it |
| --- | --- |
| `gst-plugins-bad` | Extra codecs and the WebRTC pieces some call and screen-share pages use |
| `libnice` | ICE transport for WebRTC calls ([Arch file list](https://archlinux.org/packages/extra/x86_64/libnice/files/)) |
| `gst-plugin-pipewire` | PipeWire camera and media capture ([Arch package](https://archlinux.org/packages/extra/x86_64/gst-plugin-pipewire/)) |
| `gst-libav` | H.264, AAC, and other patent-encumbered codecs behind voice notes and video |

```bash
sudo pacman -S gst-plugins-bad libnice gst-plugin-pipewire gst-libav
```

On Debian or Ubuntu the equivalent runtime packages are `gstreamer1.0-plugins-base`, `gstreamer1.0-plugins-good`, `gstreamer1.0-plugins-bad`, and `gstreamer1.0-libav`. The AppImage is not affected: it does not link the distribution's WebKitGTK, and it brings the plugins that engine was built against.

Linux builds still need WebKitGTK 4.1 on the machine (`libwebkit2gtk-4.1-0`). The AppImage does not vendor WebKit. On Debian or Ubuntu:

```bash
sudo apt-get install libwebkit2gtk-4.1-0 libgtk-3-0
```

## Develop

Install Rust (stable), Node.js 22, and the Tauri Linux packages if you are on Linux:

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf build-essential libssl-dev
```

Windows development needs the Visual Studio C++ build tools and the WebView2 runtime. macOS development needs Xcode and the command-line tools. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev
```

A production build:

```bash
# Linux: AppImage plus the raw binary in src-tauri/target/release
npm run tauri build -- --bundles appimage

# Windows: portable executable
npm run tauri build -- --no-bundle

# Windows: NSIS setup installer
npm run tauri build -- --bundles nsis

# macOS: universal disk image and .app (Apple Silicon and Intel)
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin --bundles dmg,app
```

The Windows executable is `src-tauri/target/release/rustbox.exe` (or under `target/<triple>/release` when you pass `--target`). On macOS the bundles are under `src-tauri/target/universal-apple-darwin/release/bundle/`. A local macOS build ad-hoc signs (`signingIdentity` is `-` in `tauri.macos.conf.json`) unless `APPLE_SIGNING_IDENTITY` is set.

Unit tests for config, workspace migration and membership, Do not disturb resolution, unread-title parsing, and link policy:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Frontend tests run in jsdom with [Vitest](https://vitest.dev). They mount the real `index.html` and drive `src/shell.ts` with fake snapshots, so the rail, switcher, and dialog regressions are covered without a desktop:

```bash
npm test
```

`tests/workspace-rail.test.ts` reproduces the 0.5.0 rail bug directly: one workspace, then two, then back to one, checking that `#workspace-list` and `#workspace-add` survive and that the sidebar still paints. `tests/workspace-editor.test.ts` asserts that Save dismisses the dialog even when the re-render throws, that a double click creates one workspace, and that a rejected save keeps the dialog open with an inline error. `tests/service-dialog.test.ts` covers the services dialog: adding a preset, the Zulip server-URL step, and a custom service each dismiss the dialog and bring the new service up instead of restoring the one the dialog suspended; a rejected create keeps the dialog and its values for a retry; and editing saves and closes the same way.

For a visual check without the native shell, `mock/backend.mjs` is a browser stand-in for the Tauri commands, and `mock/verify.mjs` drives it in Chrome through the whole workspace flow and writes screenshots. A small Vite plugin serves `/mock/index.html` as the real `index.html` with only the entry script swapped, so the markup can never drift. With `npm run dev` running:

```bash
npm install --prefix /tmp/pptr puppeteer-core
PUPPETEER_CORE=/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js \
  node mock/verify.mjs
```

`puppeteer-core` is deliberately not a project dependency; it is only needed for that visual check.

Regenerate the app icon from the source drawing:

```bash
python3 scripts/gen-icon.py
npm run tauri icon src-tauri/app-icon.png
```

## Using the app

The sidebar lists services by name and icon. Drag rows with the pointer to reorder them; Escape cancels. The workspace rail supports the same gesture. A service’s context menu also offers **Move up** and **Move down**. Service order is global across workspaces: moving a visible service moves only that service in the full list, preserving the relative order of every other service, including hidden ones. Collapse it to an icon rail; the icons stay centered, the names stay on the tooltips, and that choice is saved in `config.json`. Click **rustbox** at the top of the sidebar to open the desk. The header is the workspace name, a line saying how many services it holds, and two actions on the same line as the title: **New workspace** and **Add service**. Each service is a card with its icon, an unread tag, and Open, Edit, and Remove. **No unread** is a muted tag. A count uses the copper accent, and the same accent is the sidebar badge.

**Settings** is the gear in the sidebar's bottom control row, next to Do not disturb, the collapse button, and the rail button. The same dialog opens from **Settings…** in the tray and from Ctrl+, (Command+, on macOS). It suspends the open service webview, the same way the other shell dialogs do, and restores that service when it closes. Escape and Close dismiss it.

**Appearance** holds **Theme** (**Auto**, **Light**, or **Dark**), **Language** (**System**, **English**, or **Español**), and **Show workspace rail**. Auto follows the operating system's color preference and uses the same tag colors. The choice is saved in `config.json`. System follows the webview locale (`navigator.language`) and, when that is empty, the operating-system locale: any `es` locale uses Spanish, and every other locale uses English. The choice is saved as `language` in `config.json` and applies immediately, including the tray menu. **Window** holds **Close to tray**, on by default: closing the window hides Rustbox and keeps loaded services running, subject to the hibernation setting below. Quit from the tray menu, or press Ctrl+Q, to exit. Turn the setting off if closing the window should quit.

**Startup** holds **Start Rustbox when I log in** (off by default) and **Start hidden in the tray**. Hidden startup requires autostart and a working tray; it adds `--hidden` to the login entry only. Manual launches without `--hidden` show the window, and a second launch shows the existing instance. Hidden launches load services for notifications and badges; use the tray icon or **Show** to open the window. If tray creation or background service loading fails, Rustbox shows the window. Login startup reflects the OS registration when Rustbox starts; errors appear in Settings.

**Updates** holds the automatic check and **Check now**. **About** shows the version and opens the releases page in the system browser.

**Import & export** in Settings saves a portable JSON backup using a native Save dialog. **Import…** opens a backup and offers **Merge**, **Replace**, or **Cancel** after validation. Merge adds services and workspaces whose IDs are missing, preserves existing entries, and keeps your current global settings. Replace restores the entire configuration and first copies the current `config.json` to `config.json.bak` beside it (overwriting the previous backup). Changes apply immediately, including appearance, workspaces, tray, and Do not disturb; replaced webviews reopen with their new settings when selected. Import never deletes session directories, even for services absent from the imported configuration. Reimporting the same service IDs can reuse those sessions.

Click a service to show it. By default the webview stays alive when you switch away, so logins and drafts are still there when you come back.

In **Settings → Window**, **Hibernate background services after** offers **Off** (default), **5**, **15**, **30**, or **60 minutes**. Rustbox checks every 30 seconds and destroys eligible background webviews to release resources. **Also hibernate services of inactive workspaces** appears when hibernation is enabled and is off by default: without it, only background services belonging to the current workspace qualify. Right-click a service and enable **Never hibernate** to exempt it (off by default). The active service is always protected, including when shared with other workspaces; every service still has just one webview and session. Opening Home or a shell dialog makes the previously visible service background; opening it again restarts its background timer the next time you leave it. The selected service stays protected when the whole window loses focus or hides to the tray.

Sleeping services show a small moon and dimmed icon and retain their last known unread count, dimmed, in the sidebar and Home. Click one to recreate it at its saved URL through the normal webview creation path. Cookies, local storage, and cache stay in the same persistent session; hibernation never removes the session directory. Unsaved in-page state, such as a draft kept only in memory, can be lost. Turning hibernation off or enabling Never hibernate leaves already sleeping services asleep until opened. Maintenance wakes a sleeping service hidden and restarts its idle timer; changing spellcheck leaves it asleep and applies the preference when it next wakes.

**Edit** opens a dialog over the desk, so the other cards stay the same size. **Add service** is the same kind of dialog. Both dialogs also choose which workspaces the service belongs to; see [Workspaces](#workspaces).

Right-click a service in the sidebar to turn that service's sound or its badges and desktop notifications on or off, reload its page, copy its URL, or open that URL in the system browser. Reload keeps the saved session. **Do not disturb**, under the service list, pauses sound and notifications for every service until you turn it off. It hides unread badges without adding an active highlight or other status mark; service sound-off marks are hidden while Do not disturb is on. Per-service choices, workspace choices, and both Do not disturb switches are saved in `config.json`. Sound mutes that service's page audio. The operating system's own toast sound, when a notification is still allowed, follows the system settings.

Scheduled Do not disturb is available as a compact editor in Settings and in each workspace editor. Enable it, select weekday chips, and add local-time windows. Overnight windows belong to their start day: Friday 19:00–08:00 runs through Saturday morning. Equal start and end times are invalid. Rules combine, including overlapping windows. An enabled schedule with rules controls its scope; outside its windows DnD is off. A manual toggle wins until the next start or end of **any** rule in that scope, even an overlapping rule. That override and its expiry instant are saved and survive restart. Disabling a schedule keeps the currently effective state as the manual choice. With no enabled rules, manual switches behave as before. Global DnD still wins over workspace choices, service notification bypasses still apply, and Home keeps unread counts in a muted style.

**Service maintenance:** the sidebar context menu and **Edit** both offer **Clear cache and reload**, **Log out (clear session)**, and **Spellcheck**. In the editor, clearing actions are grouped under **Maintenance**. Cache clearing keeps cookies, logins, and local storage. Logout asks for confirmation in a Rustbox dialog, then clears all browsing data for that service, including local drafts, and reloads its configured URL. A service shared across workspaces has one session, so the action applies everywhere it appears; other services are unaffected. Spellcheck saves a per-service choice and recreates its webview, keeping the session. Close service popups before maintenance; a failure appears in the app and can be retried.

**Add** opens the services dialog:

- Presets: WhatsApp Web, Slack, Discord, Zulip, Telegram Web, Grok, ChatGPT, and Claude. Each preset uses a brand icon bundled with the app, so the sidebar still shows it offline. Slack and Zulip use their custom workspace or organization icon when available. Zulip asks for your server URL, for example `https://your-org.zulipchat.com`.
- Adding a service dismisses the dialog and opens it. The dialog hides the service webview that was showing, so creating one never brings that older service back. A rejected create keeps the dialog open with the reason and your values, ready for another try.
- A custom service is a name, an `http` or `https` URL, an optional icon, an accent color, and a user-agent setting. The icon can be an image URL, a short emoji, or a PNG, SVG, ICO, JPG, or WebP file. A chosen file is copied into the app data `icons` folder; Rustbox does not keep the original path. **Use preset or favicon** clears a custom icon. **Accent color** is the sidebar highlight and the letter fallback, with a hex field and **Use brand default**. A full-color icon keeps its own picture. With no icon of its own, Rustbox tries that site's favicon and falls back to a letter.
- Drag icons in the sidebar to reorder. **Remove** asks in a Rustbox dialog, then deletes that service's saved session.

Adding the same preset twice creates a second isolated account (`WhatsApp` and `WhatsApp 2`).

### Keyboard

With a service open, **Ctrl/Cmd+F** opens a compact find strip above its page. The strip reserves 44 logical pixels by moving and shrinking the native service webview. Type to search, use **Enter** / **Shift+Enter** or the arrows for the next / previous match, and **Escape** or Close to clear highlights and return focus to the service. It shows the current match and total, or **No matches**. Switching services, opening a shell dialog, or reloading from the service menu closes the strip. Search text is not saved.

**Ctrl/Cmd+plus** (or **=**), **Ctrl/Cmd+minus**, and **Ctrl/Cmd+0** control the active service's native page zoom from **50% to 300%**. A brief percentage appears in the sidebar. Each service remembers its level across page loads, webview recreation, and restarts. **Reset zoom** in its sidebar context menu returns it to 100%. Rustbox owns these zoom chords and disables the webview's additional zoom-by-hotkey handler.

These chords work from the desk and from inside a service. On macOS, use Command instead of Ctrl. They follow the current sidebar order and are not saved separately.

| Shortcut | Action |
| --- | --- |
| Ctrl+1 … Ctrl+9 | Open that service in the current workspace, first through ninth |
| Ctrl+Tab | Next service in the current workspace. From the desk, this opens the first one |
| Ctrl+Shift+Tab | Previous service in the current workspace. From the desk, this opens the last one |
| Ctrl+Alt+1 … Ctrl+Alt+9 | Switch to that workspace, first through ninth in the rail |
| Ctrl+Shift+D | Open the desk |
| Ctrl+, | Open Settings |
| Ctrl+F | Find in the active service page |
| Ctrl+plus / Ctrl+= | Zoom in the active service |
| Ctrl+minus | Zoom out the active service |
| Ctrl+0 | Reset the active service to 100% |
| Ctrl+Q | Quit Rustbox |

A service or workspace number past the end of the list does nothing. Find and zoom require an active service; Ctrl+0 resets that service's remembered zoom. The service chords only ever reach services in the active workspace, so switching workspaces and then pressing Ctrl+1 always lands in the sidebar you can see.

### Tray

While Rustbox is running it keeps one tray icon, drawn from the app's 32×32 icon. A copper dot and a tooltip count appear when there are unread messages (hidden while Do not disturb is on, and always excluding services that a workspace's Do not disturb has silenced). Left-click toggles the same window: show and focus, or hide. The menu has **Show window**, **Hide window**, **Workspaces** with one **Do not disturb** item per workspace, the global **Do not disturb**, **Close window to tray**, **Settings…**, **Check for updates**, and **Quit**. **Settings…** shows the window and opens Settings. When a newer release is available the update item reads **Update available: vX.Y.Z** and opens the update dialog. **Check for updates** still runs a check, or opens that dialog when a release is already waiting. Closing the window hides it when that setting is on, which is the default, and does not itself destroy service webviews; the optional idle timer still applies to background services. **Quit** and Ctrl+Q (Command+Q on macOS) are what exit the process. Starting Rustbox again while it is hidden focuses the existing window instead of opening a second copy, so a restart does not add another tray icon. On a Linux desktop whose tray does not send an activate click, use **Show window**. On macOS the icon is in the menu bar. It stays the color mark, not a template image, so it does not take on the menu bar's light or dark style. Left-click still toggles the window and the menu is on right-click. Clicking the Dock icon while the window is hidden shows it again.

### Where data lives

The dialog shows the live paths. They follow the bundle id `app.rustbox.desktop`:

| | Linux | Windows | macOS |
| --- | --- | --- | --- |
| Config | `~/.config/app.rustbox.desktop/config.json` | `%APPDATA%\app.rustbox.desktop\config.json` | `~/Library/Application Support/app.rustbox.desktop/config.json` |
| Sessions | `~/.local/share/app.rustbox.desktop/sessions/<id>/` | `%APPDATA%\app.rustbox.desktop\sessions\<id>\` | `~/Library/Application Support/app.rustbox.desktop/sessions/<id>/` |

The export wrapper uses `format: "rustbox-config"`, format `version: 1`, `appVersion`, `config`, and `icons`. The config contains the user configuration described below; local service and workspace icons are embedded as byte arrays and restored with fresh local tokens. Imports accept HTTP(S) service URLs and validate icon types, IDs, and workspace references. The backup contains no session data. No additional settings keys are needed in `config.json`.

`config.json` stores names, URLs, order, icons, user-agent settings, whether the sidebar is collapsed, the appearance preference, the language preference (`system`, `en`, or `es`), per-service sound and notification switches, optional per-service `spellcheckEnabled` (absent means the platform default), optional per-service `zoom` (a numeric scale from `0.5` to `3.0`, default `1.0`, omitted when it is `1.0`), the workspace list with its names, icons, colors, and Do not disturb switches, which workspace and service were last active, whether the workspace rail is shown, Do not disturb, whether closing the window hides to the tray, the startup preferences `startAtLogin` and `startHidden` (both default to `false` for existing files), `hibernateAfterMinutes` (`0`, `5`, `15`, `30`, or `60`; default `0`/Off), `hibernateInactiveWorkspaces` (default `false`), each service’s `neverHibernate` (default `false`) and `mediaPermission` (`ask`, `allow`, or `deny`; default `ask`), and an `updates` object (`autoCheck`, `lastCheckedAt`, `skippedVersion`, `notifiedVersion`). Global configuration and each workspace also store `dndSchedule` (default `{ "enabled": false, "rules": [] }`) and `dndOverride` (default `null`). Each rule stores `days` (`mon` through `sun`), `startMinute` and `endMinute` (0–1439, displayed as HH:MM). An override stores `value` and `expiresAtUnix` in seconds. Older files need no changes. The config `version` stays `1`. Missing hibernation fields default to Off/false, preserving services, workspace memberships, and session ids. Hibernated state and idle timestamps are runtime-only and reset on launch. Notification click-to-open adds no settings or migration: it uses the saved workspace memberships and last-active selection. Services without `zoom` still load at 100%; their ids, sessions, workspace membership, and other settings are preserved. Hand-edited numeric zoom values snap to the nearest supported step when loaded. A file from before updates existed loads unchanged and checks automatically. A chosen icon is stored as `local:<id>.<ext>` plus the file under the data directory's `icons` folder, not as a path on disk. On Linux and Windows, cookies, `localStorage`, and cache live in the session directory for that service id, not in the shared webview profile. On macOS, WKWebView cannot use that directory. Each service gets a website data store id from its service id, which WebKit honors on macOS 14 and later and ignores on older systems by sharing one store. Rustbox still creates the sessions folder. Removing a service deletes that folder and does not call WebKit's data-store removal, so the WebKit store can remain under `~/Library/WebKit/`. The portable Windows `.exe`, a Just me install, an All users install, the Linux AppImage, and the macOS app use these same per-user directories, not a folder next to the program file. Installing or upgrading does not wipe them.

An optional per-service `spellcheckEnabled` boolean records an explicit spellcheck choice; when absent, the webview keeps its existing platform default. Old configs keep their services, sessions, and workspaces unchanged.

For **Log out (clear session)**, Linux waits for WebKit’s native all-data clear, retaining the profile directory because Tauri retains its WebContext. Windows destroys the webview, waits for native destruction, and retries deletion briefly while WebView2 releases file locks. macOS explicitly removes the identified WKWebView data store on macOS 14+. Cache-only clearing uses WebKit’s disk/memory cache types on Linux and macOS; on Windows it removes only `EBWebView/Default/Cache`, `EBWebView/Default/Code Cache`, and `EBWebView/Default/GPUCache` inside the service profile. Cookies, local storage, IndexedDB, and service-worker CacheStorage remain during cache-only maintenance.

### User agent

Every service uses a recent Chrome user agent by default (Chrome 155 as of October 2026), because sites such as WhatsApp Web reject the WebKit user agent. Turn the checkbox off to use the system webview's own agent, or type a custom string to replace the built-in Chrome string. The override is stored per service. Changing the URL or the user agent reloads that service's webview and keeps the same session directory.

### Notifications and badges

A script injected into each service webview wraps `window.Notification` and forwards the title and body to a native OS notification. The notification is attributed to the service (`Slack: New message`). Each service is limited to 6 notifications per 20 seconds. Turning notifications off for a service, or silencing it, drops those notifications and hides the unread badge. The count is still tracked, so the badge comes back when you allow notifications again. A service is silenced when global Do not disturb is on, or when every workspace that lists it is in Do not disturb.

On Linux, clicking a service notification asks Rustbox to show, unminimize, and focus its window and open that service. This needs a notification daemon that supports the default action. On Windows, activation of an on-screen toast does the same while Rustbox is running, using the installed app's AppUserModelID. The current workspace stays selected if it contains the service; otherwise Rustbox selects the first workspace in rail order that contains it. A service pinned to all workspaces keeps the current workspace. Clicking a notification for a removed service does nothing. Existing Do not disturb, per-service notification, and **Notify even in Do not disturb** policies still apply when sending notifications.

Sessions stay with their service ids when a notification opens a service. If click-capable delivery cannot start or reports a delivery error, Rustbox tries the existing plugin notification path; that fallback has no service click action.

The same script mutes `audio` and `video` elements and suspends `AudioContext` while that service's sound is off or while the service is silenced. On Linux the WebKit view is muted as well. On macOS the native WKWebView is not muted; only that script runs, and it was not exercised inside WKWebView.

Unread badges are parsed from the document title, which is how these apps usually report them: `(3) WhatsApp`, `Slack (12)`, `[4] Telegram`. A leading `•` with no number counts as one. The badge appears after that service's webview has been created, and it updates while the webview is hidden.

### Links

Ordinary clicks that leave the service's site open in the system browser. Same-site links stay in the webview. Clicks to a short list of login providers (Google, Microsoft, Apple, Okta, and similar) also stay in the webview so redirect sign-in can finish. Middle-click, modifier-click, and `target="_blank"` open in the system browser, except login-provider popups, which the webview is allowed to open. `mailto:` and `tel:` links open externally.

## Workspaces

A workspace is a named grouping of services: Work, Teaching, Personal, or whatever you need. The rail at the far left of the window switches between them, using the same pattern as Slack or Discord. The rail shows one icon per workspace, highlights the active one, and ends with **+** for a new workspace. Each workspace has a name, an emoji or image icon, an accent color, and its own **Do not disturb** switch.

**A service can belong to more than one workspace.** It is still one service with one webview and one session in `sessions/<id>/`. Switching workspaces alone never reloads it; it simply appears in each workspace that lists it. With hibernation enabled, an idle service can later unload and lose unsaved in-memory drafts, while keeping its persistent login. Adding the same preset twice still creates two separate accounts with separate sessions.

Use **Edit** on a service to change its membership. The **Workspaces** section lists one checkbox per workspace, plus **All workspaces**. Checking All workspaces overrides the individual boxes and also includes workspaces you create later. A service must belong to at least one workspace or be pinned to all; the dialog disables Save and says so otherwise. **Add service** puts a new service in the workspace you are looking at, and you can widen that afterwards.

The sidebar and the desk show only the active workspace. The desk also has an **All services** toggle so you can see every card at once, with a tag naming each service's workspaces. Right-click a workspace icon for **Rename**, **Edit icon and color**, **Do not disturb**, **Move up** and **Move down**, and **Delete workspace**. Drag the icons to reorder them. Deleting a workspace never deletes a service or its session; a service left with no workspace moves to the first remaining workspace, and the last workspace cannot be deleted.

### Collapsing the rail

The rail is a 48px strip. It hides itself while you have only one workspace, and you can collapse it any time from the **rail button** in the sidebar's bottom control row, next to the sidebar chevron. The same switch is **Show workspace rail** in Settings; both write the same `workspaceRailHidden` key in `config.json`, so they stay in step. The button's tooltip reads **Hide workspace rail** or **Show workspace rail** to match its state, and the tray menu's **Workspaces** submenu is unaffected either way.

While the rail is collapsed, the top of the sidebar shows the active workspace as a compact chip: its initial or icon, its name, and a caret. Click it for a popup listing every workspace with its unread badge and Do not disturb mark, plus **New workspace**. The list is drawn by the shell, so Rustbox hides the open service webview while it is up — a child webview would paint over it — and puts that service back when the list closes (click outside, Escape, or a choice). Click a row to switch; right-click one for the same menu the rail icons offer. **Ctrl/Cmd+Alt+1..9** keeps switching by position whether the rail is showing or not.

Rename, icon and color, new workspace, include services, and delete confirmation use the same hide-and-restore step, including when they are opened from the rail or the chip while a service is showing. The service comes back when the dialog closes. **Delete workspace** and **Remove** use that same dialog. The title is the question (**Delete workspace?** or **Remove service?**), **Cancel** is focused, and the confirming button is **Delete** or **Remove** in the danger color. Escape, Cancel, Close, or a click on the dimmed backdrop leaves the workspace and its services in place. Enter activates the focused button, so it cancels while **Cancel** is focused. The rail's **+** is **New workspace**; the sidebar's **+** is **Add a service**.

### Starting a workspace from existing services

A new workspace starts empty, so the sidebar and the desk both say **No services in this workspace yet** rather than showing a blank column. From there, **Add service** opens the normal service dialog, and **Include existing services…** opens a short multi-select of services that are not in this workspace yet. Ticked services are added to it and stay in every workspace they were already in; nothing is removed and no session moves. Services pinned to **All workspaces** already appear everywhere, so they are not listed.

The same optional picker is a step in the **New workspace** dialog: tick any services that should be included from the start.

### Workspace Do not disturb

Each workspace can be put in Do not disturb from its rail context menu, or from the **Workspaces** submenu in the tray menu. The global **Do not disturb** on the sidebar always overrides everything.

A service that is only in one workspace is silenced when that workspace is. A service shared by several workspaces is silenced only when **every** workspace that lists it is in Do not disturb. In other words a service keeps its sound, notifications, and badge as long as one workspace that contains it is awake, and its own per-service mute still applies on top. A workspace in Do not disturb hides its own rail badge, the same way global Do not disturb hides service badges. The tray tooltip and dot total exclude silenced services.

### Upgrading to workspaces

A `config.json` written before workspaces existed has no `workspaces` key. On first run after the upgrade, Rustbox reads it and adds one workspace named **Main** that contains every existing service, then saves the file. Sessions are not moved or copied: each service keeps the same id and the same `sessions/<id>` folder, so logins survive. Nothing is dropped, including services added by hand.

The layout is written with `schemaVersion: 2` and additive keys only (`workspaces`, `activeWorkspaceId`, `workspaceRailHidden`, plus `workspaces` and `allWorkspaces` on each service). `version` stays at `1`, which is what an older build checks, so an older Rustbox still reads the file and lists every service; it simply ignores the workspace keys. Older builds that write the file back keep the keys they do not know about only as far as their own serializer allows, so if you downgrade, expect the workspace layout to fall back to a single workspace on the next upgrade rather than a crash.

The first published build used the bundle id `com.ifigueroa.rustbox` and stored sessions in `services/<id>`. Rustbox copies that older config forward when the current `config.json` is missing or its service list is empty, and an older file that actually has services exists. That config then goes through the same one-workspace migration. A current config that already lists services is left as it is. The search also checks `config.json.bak` beside either id, the data directory, and on Windows the LocalAppData folder. The older files are not deleted.

## Updates

Rustbox checks GitHub for a newer release and then waits for you. Nothing is downloaded or installed until you choose **Download and install**, and the app does not restart until you choose **Restart to update**.

The only request a check makes is a GET of `latest.json` on this repository's GitHub Releases:

`https://github.com/ifigueroap/rustbox/releases/latest/download/latest.json`

That request carries whatever an ordinary HTTPS client sends (the address you connect from, and a user agent). Rustbox adds no account, no install id, and no other telemetry. The file is the [Tauri updater static manifest](https://v2.tauri.app/plugin/updater/): a version, notes, a date, and one signature plus download URL per platform. `darwin-x86_64` and `darwin-aarch64` both point at the universal `rustbox-macos-universal.app.tar.gz`.

A check runs about 10 seconds after startup and then every 6 hours, while **Check for updates automatically** is on (the default). **Check now** in Settings, and **Check for updates** in the tray, run the same request immediately. A network failure is recorded as an error in that settings row and does not open a dialog or a notification. The app never offers a downgrade. **Skip this version** hides that version from automatic checks only; a manual check still shows it, and a newer version shows up on its own.

When a release is newer, a small badge appears in the sidebar footer. The dialog lists the version and the release notes, formatted from the changelog. Links in those notes open in the browser. **Download and install** uses the updater plugin, which checks the minisign signature before replacing the app bundle. **Open release page** opens the GitHub release in your browser. **Later** dismisses the dialog and leaves the badge. Service webviews are hidden while the dialog is open, the same way the workspace editor is, so the dialog is not painted underneath a service.

These installs can replace themselves:

- Windows NSIS setup (`rustbox-windows-x64-setup.exe`)
- Linux AppImage (`rustbox-linux-x64.AppImage`)
- macOS app (`rustbox-macos-universal.app.tar.gz`, from the disk image or the archive once it is the signed updater archive)

The portable Windows executable (`rustbox-windows-x64.exe`) and the Linux tar.gz binary (`rustbox-linux-x64.tar.gz`) are notify-only. Their dialog offers **Open release page** so you can replace the file yourself. An update never deletes services or sessions; those stay in the per-user config and session directories. On Windows, leave the installer's **Delete app data** box unchecked.

The Arch package is notify-only for a different reason: pacman owns `/usr/bin/rustbox`, `/usr/share/applications/rustbox.desktop`, and the icons, so downloading a new binary into place would leave the package database describing files that no longer exist. Its dialog says the release is available and shows the update command from [Arch Linux / Omarchy](#arch-linux--omarchy) instead of **Download and install**. Detection is by install kind: Linux, no `APPIMAGE`, and no `deb` or `rpm` bundle marker means a package build. The AppImage sets `APPIMAGE` and keeps its own updater.

The first time a version is found by an automatic check, Rustbox shows one native notification, and not again for that version. Do not disturb suppresses it until a later check runs with Do not disturb off.

Updater artifacts are signed with the minisign key pair whose public half is in `src-tauri/tauri.conf.json`. The private key and its password live only in the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the password is empty). A local `tauri build` that produces bundles needs that private key in the environment or the bundler stops. `tauri dev` does not.

The published macOS build is ad-hoc signed unless Apple signing secrets are configured. Gatekeeper quarantines that download. The first time, right-click Rustbox, choose **Open**, and confirm.

## Releases

Versions follow [Conventional Commits](https://www.conventionalcommits.org/). `.github/workflows/pull-request.yml` checks the pull request title. Squash-merge so that title becomes the commit on `master`. [Release Please](https://github.com/googleapis/release-please) reads that message.

| Pull request title | Next version |
| --- | --- |
| `fix: ...` | patch (`0.1.1` → `0.1.2`) |
| `feat: ...` | minor (`0.1.1` → `0.2.0`) |
| `feat!: ...`, `fix!: ...`, or a `BREAKING CHANGE:` footer | major (`0.1.1` → `1.0.0`) |
| `chore:`, `ci:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `build:`, `revert:` | no release |

A scope is optional (`fix(sidebar): ...`). This mapping is the default Release Please strategy, including before 1.0.0: a breaking change on `0.1.x` releases `1.0.0`.

On every push to `master`, `.github/workflows/release-please.yml` runs Release Please. After a releasable commit, it opens a release pull request that bumps `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `packaging/arch/PKGBUILD`, and the `rustbox` entry in `src-tauri/Cargo.lock`, and writes `CHANGELOG.md`. Merging that pull request creates the tag `vX.Y.Z` and a GitHub Release whose notes are the changelog. The same workflow then starts `.github/workflows/release.yml` on that tag.

`release.yml` also runs when a `v*` tag is pushed and on manual `workflow_dispatch`. Those runs build:

- `rustbox-windows-x64-setup.exe` (NSIS installer) and its `.sig`, plus `rustbox-windows-x64.exe` (portable, notify-only) on `windows-latest`
- `rustbox-linux-x64.AppImage` and its `.sig`, plus `rustbox-linux-x64.tar.gz` (notify-only) on `ubuntu-22.04`
- `rustbox-macos-universal.dmg` and `rustbox-macos-universal.app.tar.gz` with its `.sig` on `macos-latest` (one universal binary, Apple Silicon and Intel)

and upload them to the GitHub Release, along with `latest.json` once every platform build has succeeded. The macOS archive that is published is the archive Tauri signed, so the signature matches the bytes. A pull request runs the macOS job (tests, the universal disk image, and the signed app archive) and a dry run of the `latest.json` generator, and does not publish. If the repository signing key is missing on that pull request, the macOS job mints an ephemeral key so the bundler can still emit `.sig` files. A tag or manual run refuses to build updater artifacts without `TAURI_SIGNING_PRIVATE_KEY`. A tag-triggered run requires the tag to match `version` in `src-tauri/tauri.conf.json` (`v0.1.1` for version `0.1.1`). If the release already has notes, the workflow leaves them in place and only adds the build assets. Those notes are also copied into `latest.json`.

The Publish job also uploads `PKGBUILD`, the Arch recipe from [Arch Linux / Omarchy](#arch-linux--omarchy), rendered for that tag. `scripts/render-arch-pkgbuild.mjs` downloads `https://github.com/ifigueroap/rustbox/archive/refs/tags/vX.Y.Z.tar.gz`, sets `pkgver` to the tag, resets `pkgrel=1`, and writes that tarball's `sha256sums`, then checks the result with `bash -n` and a set of grep assertions. The in-repo `packaging/arch/PKGBUILD` is the template: its dependencies, build steps, and installed files are what ships, and Release Please keeps only its `pkgver` in step. `node scripts/render-arch-pkgbuild.mjs --self-test` and `node scripts/check-release-versions.mjs` cover both. The release asset, not the file in the repository, is what the install one-liner fetches, so a stale in-repo copy cannot install a different tree than the one that was tagged.

The versions Release Please rewrites are marked with `x-release-please-version`. Keep that comment on the package version in `src-tauri/Cargo.toml`, on the `rustbox` version in `src-tauri/Cargo.lock`, and on `pkgver` in `packaging/arch/PKGBUILD`. `cargo update` rewrites the lockfile and drops the comment; put it back on the `rustbox` version line before merging. `node scripts/check-release-versions.mjs` checks that every one of those versions matches, that the three markers are present, and that the Arch recipe is still installable.

Release Please uses the workflow `GITHUB_TOKEN`. No extra secret is required. In the repository Actions settings:

- Workflow permissions must allow Actions to read and write repository contents. The workflows request `contents: write` themselves.
- **Allow GitHub Actions to create and approve pull requests** must be enabled, or Release Please cannot open the release pull request.

A tag created with `GITHUB_TOKEN` does not start `release.yml` on its own. Release Please dispatches it with `workflow_dispatch` on the new tag, which `GITHUB_TOKEN` is allowed to do. A tag you push yourself still starts `release.yml` directly. If GitHub holds checks on a pull request that Actions opened, approve that workflow run so the release pull request can merge.

## Adding a language

Shell copy lives in `src/i18n/`. `en.ts` is the source catalog. `t(key, params)` replaces `{placeholders}`, chooses `one` or `other` from a `{ count }` plural, and falls back to English when a translation is missing. Dates use `Intl` for the active locale (`es-419` for Spanish).

To add a language:

1. Copy `src/i18n/en.ts` to `src/i18n/<code>.ts` and translate every string. Keep the same keys and placeholders.
2. Register the catalog in `src/i18n/index.ts` and add the code to the `Locale` union. `resolveLocale` maps that language's BCP 47 tags onto it.
3. Add the same code to the Rust `Locale` enum in `src-tauri/src/i18n.rs`, translate the tray menu and the update notification there, and add an option to the Language select in `index.html`.
4. Add the preference to `LanguagePreference` in `src-tauri/src/config.rs` so it can be saved. `system` stays the default. A missing `language` field still loads as `system`, and existing services are left in place.

The tray menu is rebuilt from the active locale when the setting changes, and again when the shell resolves `system` from `navigator.language`.

## Known limitations

- **Find and zoom have no interactive platform verification yet.** The DOM search, shell controls, shortcut forwarding, config compatibility, and zoom decisions have automated tests. Native strip placement, focus transfer, range scrolling/highlight rendering, and `Webview::set_zoom` still need desktop checks on Linux WebKitGTK 4.1 (including Hyprland), Windows WebView2, and macOS WKWebView. Full native compilation could not run in the feature's development environment because GTK/GLib development tools were absent.
- **Find searches loaded page text.** It is case-insensitive and literal, and can span inline elements. It excludes hidden content, editable fields, iframe contents, shadow DOM, and canvas text. Virtualized or unloaded messages are unavailable until the site renders them. Typing or stepping through matches rescans the current DOM; counts do not update continuously while idle. Engines with CSS Custom Highlight support show all matches; older engines or pages blocking the highlight stylesheet use the selected match only.
- **Configuration backups exclude sessions.** Cookies, storage, caches, logins, and page drafts are not exported. Sign in again on a new machine. Keep exports private: they contain service URLs and configuration. Imports are limited to 32 MiB and 24 workspaces; only export format version 1 is supported. Session directories left by replacement remain on disk; importing does not silently remove them. Native file dialogs and live import behavior have not been interactively verified on Windows or macOS.
- **Schedules require Rustbox to be running.** Indicators and page audio refresh within 15 seconds of a boundary or resume; notification gating reads the current clock immediately. Windows follow the system local clock. Override expiry uses elapsed minute arithmetic, so a daylight-saving or timezone change during an override can shift its expiry relative to local wall time; the schedule itself follows local weekdays and times. Interactive schedule, sleep/resume, and timezone-change behavior has not been verified on a desktop.
- **Login startup depends on the installed path and desktop.** Linux writes `$HOME/.config/autostart/rustbox.desktop`; a custom `XDG_CONFIG_HOME` is not honored by the auto-launch crate. The entry uses the package executable (normally `/usr/bin/rustbox`) or `$APPIMAGE` for an AppImage. Keep the AppImage or portable Windows executable at that path; after moving it, toggle login startup off and on. The desktop must honor XDG autostart and provide a usable tray; some Linux desktops can accept a tray icon without displaying it. Windows uses the current user’s registry Run key; macOS uses a LaunchAgent. Login startup and hidden-window behavior have not been tested interactively on any platform; macOS runtime behavior remains untested.
- **Service maintenance has not been run interactively on any platform.** Linux uses WebKitGTK 4.1 native data-manager clearing, Windows uses WebView2 profile folders, and macOS uses the identified WKWebView data store. Cache-only clearing intentionally leaves service-worker CacheStorage, so an offline app may still serve saved resources. If WebView2 retains file locks beyond the retry window, the action reports failure and a logout may have partially removed data; close popups and retry. macOS maintenance refuses non-UUID legacy ids to avoid clearing a shared fallback store.
- **Spellcheck depends on the engine and installed dictionaries.** Linux uses the per-service WebKit context setting. WebView2 and WKWebView use injected HTML `spellcheck` attributes because Tauri exposes no portable native toggle; site-specific editors, closed shadow roots, or engine settings may override or ignore them. An absent config field leaves platform behavior unchanged. Changing the toggle reloads the page and can lose unsaved in-memory edits. None of these spellcheck paths has been tested interactively.
- **macOS builds are produced and not run.** CI compiles the app, runs `cargo test`, and uploads a universal `.dmg` and `.app.tar.gz`. Nobody has launched that bundle on a Mac from this repository. Tray clicks, close-to-tray, the Dock icon, single-instance focus, notifications, and the injected script inside WKWebView are untested. Signing and notarization run only when `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` are all set; otherwise the build is ad-hoc signed and must not fail for the missing secrets. An ad-hoc signature was not notarized.
- **macOS service sessions need macOS 14.** WKWebView has no data directory. Rustbox passes a 16-byte data-store id derived from the service UUID. WebKit uses a separate store on macOS 14 and later; on older systems every service would share the default store, so the bundle's minimum version is 14.0. Removing a service does not delete that WebKit store.
- **macOS service pages are WKWebView.** The Chrome user agent is only a string (`Macintosh; Intel Mac OS X 10_15_7`). Sites can still reject the session after inspecting WebKit. The injected script is the same one Linux and Windows use. It was not run in WKWebView, so link handling, shortcuts, notification forwarding, and sound muting there are unchecked. Command is accepted wherever Ctrl is: Command+1 through Command+9, Command+Tab, Command+Alt+1 through Command+Alt+9, Command+Shift+D, and Command+Q.
- **Multiple webviews depend on Tauri's `unstable` API.** That API is the supported way to keep more than one webview in a single window, and it can still change. On Linux, Tauri currently packs those children into a vertical box and ignores the requested position, so Rustbox moves the shell and each service onto a single `GtkFixed` after creation. Each service sits in its own windowed `GtkEventBox`: GTK positions that container and WebKit keeps a local `(0, 0)` allocation for drawing and input. The container follows the service's visibility so hidden services do not intercept shell or service clicks. A non-measuring overlay lets the fixed host shrink; its allocation callback gives services the exact available size instead of WebKit's previous natural size. Resize and monitor scale changes re-sync the logical bounds. This placement has been checked on X11 at `GDK_SCALE=1` and `2`; the reported Hyprland pointer offset still needs verification on Wayland, including fractional monitor scaling. macOS uses the webview bounds API instead, and that placement was not checked on a Mac.
- **Linux is WebKit, not Chrome.** The Chrome user agent fixes the simple rejection check. WhatsApp Web and other sites can still refuse the session after inspecting browser features, service workers, or codecs. WebKitGTK 4.1 also has to be installed on the host.
- **Windows builds need WebView2.** The installer and portable executable do not embed the runtime. Toasts from the portable executable sometimes fail to register with Windows even when the in-app badge still updates.
- **Notification forwarding covers the page `Notification` constructor.** Service-worker push notifications are not forwarded. Linux needs a running notification daemon. Click-to-open needs its default-action support; a compositor such as Hyprland can restrict focus requests. Linux requests a 30-second toast timeout and caps waiting notification workers at 32, even if a daemon ignores expiry or never reports closing; further notifications use the plugin fallback without click handling until a slot is free. Windows click handling covers on-screen toasts while Rustbox is running, not Action Center history or relaunch after quitting; portable/development builds may lack the registered AppUserModelID and fall back to ordinary notifications. macOS keeps plugin notifications without service click-to-open; no WKWebView or notification-center delegate behavior is claimed. Native notification clicks have not been tested interactively on Linux/WebKitGTK 4.1, Windows/WebView2, or macOS/WKWebView.
- **Badges depend on the page title.** A service that shows an unread count only inside the page, with a static title, will not get a badge. Counts start at zero each launch until that webview loads. A service in several workspaces shows the same count everywhere, because it is the same webview.
- **Workspace switching keeps services running by default.** Switching alone does not suspend services; the optional idle policy below governs hibernation.
- **Hibernation pauses service activity.** Sleeping services stop forwarding notifications and updating unread counts; dimmed counts are stale until the service wakes. Background audio, calls, and unsaved page state may be interrupted or lost. Hibernation is Off by default; switching workspaces alone keeps services running unless the idle policy is enabled and the service qualifies. Inactive-workspace services require the additional opt-in. Destruction/recreation uses WebKitGTK 4.1 on Linux, WebView2 on Windows, and WKWebView on macOS; hibernation runtime behavior and memory release have not been interactively verified on any of these platforms.
- **The rail needs a second workspace.** With one workspace the rail and the sidebar's switcher chip are both hidden, and the desk's **New workspace** button is the way to create the second one. The workspace list is capped at 24.
- **Popup OAuth is best-effort.** Redirect sign-in stays inside the webview. A login flow that depends on `window.opener` in a popup can still fail because the popup does not share the service session.
- **External-link handling is click and `window.open` based.** A script that assigns `location` to another site stays in the webview, so a login redirect is not kicked out to the browser.
- **Camera and microphone:** Linux and Windows show a Rustbox Allow / Deny prompt, with **Remember for this service**. The service editor offers **Ask**, **Always allow**, and **Always deny**; remembered decisions are included in configuration backups. These choices cover the whole service webview, including embedded frames and sites reached by navigation. Linux enables WebKit media streams and WebRTC; calls also need the GStreamer packages above. macOS includes camera/microphone usage descriptions but retains wry’s WKUIDelegate and the operating system permission flow: the Rustbox prompt and per-service media setting are not enforced there. No interactive media capture behavior has been verified on any platform. Downloads and screen sharing remain subject to the system webview; this change does not add screen-sharing permission handling.
- **The updater has not been run against a real GitHub Release.** The check, the dialog, and `latest.json` generation are covered by unit tests. Replacing an installed NSIS app, AppImage, or macOS app, verifying the signature with the repository private key, and the native notification are not. After the next release is published, install the previous version, open it, and use **Check now** (or wait about 10 seconds). The badge should name the new version. **Download and install**, then **Restart to update**, should come back on that version with services and sessions still there. The portable exe, the Linux tar.gz, and the Arch package should offer only **Open release page**, with the Arch one also naming the update command.
- **Interactive testing was on Linux.** Adding a preset, saving `config.json`, creating that service's session directory, loading Telegram Web, and switching between three workspaces with a shared and an all-pinned service were checked. GUI checks did not cover notification toasts, drag-reorder, removing a service, signing in to WhatsApp, Slack, or the other presets, or the tray's per-workspace Do not disturb items. The Windows and macOS builds are produced by CI and were not run.
- **The Arch package is verified by building it, not by using it.** `makepkg -si` was run in `archlinux:latest` and the installed binary was checked with `ldd` to link the distribution's `libwebkit2gtk-4.1`, and the built package's `.PKGINFO` is checked for the GStreamer dependencies. The packaged app has not been launched. A full run needs a Wayland or X session, a tray, and a notification daemon. The first install on Omarchy is the interactive check: the WebKit renderer should stay up, the audio path should load `autoaudiosink` instead of aborting, and the update dialog on a package build should show the pacman command rather than **Download and install**.
- **`WEBKIT_DISABLE_DMABUF_RENDERER=1` is an AppImage workaround, not a fix.** It moves WebKitGTK off the DMA-BUF path, which is where the crash from the bundled WebKitGTK comes from, at some cost to drawing performance and input latency: on a machine where DMA-BUF works, it made typing in WhatsApp Web slow enough to run the web process at about 67% CPU. Only the AppImage sets it, and only when unset; a package or native build keeps DMA-BUF. Set the variable to `0` to opt out of the AppImage default, or to `1` to force the software path anywhere; Rustbox never overwrites a value you set.
- **A native Linux install needs GStreamer good plugins.** WebKitGTK resolves `autoaudiosink` at runtime and aborts `WebKitWebProcess` the first time a page plays audio when no installed plugin provides it, which shows up as a SIGABRT in `systemd-coredump` with a `no such element factory "autoaudiosink"` warning just before it. The Arch package depends on `gst-plugins-base` and `gst-plugins-good`; `gst-plugins-bad` and `gst-libav` are optional and add codecs for voice notes and video.
