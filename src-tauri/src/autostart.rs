//! Start Rustbox automatically at login, optionally hidden in the tray.
//!
//! This wraps the `auto-launch` crate directly instead of
//! `tauri-plugin-autostart`: that plugin fixes its startup `args` once, at
//! app setup, and reuses them for every later `enable()`. Turning "start
//! hidden" on or off has to rewrite the registered entry's arguments while
//! the app is already running, which `auto-launch` supports (its `enable()`
//! truncates and rewrites the XDG `.desktop` file, the Windows `Run` value,
//! or the macOS LaunchAgent plist every time) but the plugin's fixed-args
//! wrapper does not expose.
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use auto_launch::AutoLaunchBuilder;
use std::sync::atomic::{AtomicBool, Ordering};
static ERROR: AtomicBool = AtomicBool::new(false);
pub fn set_error(value: bool) {
    ERROR.store(value, Ordering::Relaxed);
}
pub fn has_error() -> bool {
    ERROR.load(Ordering::Relaxed)
}

/// Passed to the binary by the autostart entry so startup can skip showing
/// the window. `launched_hidden` reads it back from `std::env::args()`.
pub const HIDDEN_ARG: &str = "--hidden";

/// Registered name for the login entry: the XDG `.desktop` stem
/// (`~/.config/autostart/rustbox.desktop`), the Windows `Run` value name, and
/// the macOS LaunchAgent plist stem. Lowercase to match the launcher entry
/// the Arch package installs (`rustbox.desktop`).
pub const APP_NAME: &str = "rustbox";

/// True when argv carries the flag the autostart entry adds for a hidden launch.
pub fn launched_hidden<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|arg| arg.as_ref() == HIDDEN_ARG)
}

/// Never leave a launch invisible when tray creation failed.
pub fn should_start_hidden(hidden_flag: bool, tray_available: bool) -> bool {
    hidden_flag && tray_available
}

/// The executable path to register for autostart.
///
/// `current_exe()` resolves inside the AppImage's temporary mount point on
/// Linux, which is unmounted once that run exits, so a login entry written
/// with that path would point nowhere on the next boot. `$APPIMAGE` is the
/// path to the `.AppImage` file the user actually launched, which is still
/// there next time. A package or native install has no `$APPIMAGE`, so
/// `current_exe()` is correct there, and everywhere outside the AppImage.
pub fn resolve_app_path(appimage: Option<&OsStr>, current_exe: Option<&Path>) -> Option<PathBuf> {
    if let Some(appimage) = appimage.filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(appimage));
    }
    current_exe.map(Path::to_path_buf)
}

fn current_app_path() -> Result<PathBuf, String> {
    let appimage = if cfg!(target_os = "linux") {
        std::env::var_os("APPIMAGE")
    } else {
        None
    };
    let current_exe = std::env::current_exe().ok();
    resolve_app_path(appimage.as_deref(), current_exe.as_deref())
        .ok_or_else(|| "could not resolve the Rustbox executable path".to_string())
}

/// Quote the executable for the platform's command-line format.
pub fn registered_path(path: &str, os: &str) -> String {
    match os {
        "linux" => {
            let mut escaped = String::from("\"");
            for ch in path.chars() {
                match ch {
                    '%' => escaped.push_str("%%"),
                    '\\' => escaped.push_str("\\\\\\\\"),
                    '"' | '`' | '$' => {
                        escaped.push_str("\\\\");
                        escaped.push(ch);
                    }
                    '\n' => escaped.push_str("\\n"),
                    '\r' => escaped.push_str("\\r"),
                    _ => escaped.push(ch),
                }
            }
            escaped.push('"');
            escaped
        }
        "windows" => format!("\"{path}\""),
        _ => path.to_owned(),
    }
}

fn launcher(hidden: bool) -> Result<auto_launch::AutoLaunch, String> {
    let path = current_app_path()?;
    let path = path
        .to_str()
        .ok_or_else(|| "the executable path is not valid UTF-8".to_string())?;
    let mut builder = AutoLaunchBuilder::new();
    builder.set_app_name(APP_NAME);
    let registered_path = registered_path(path, std::env::consts::OS);
    builder.set_app_path(&registered_path);
    builder.set_windows_enable_mode(auto_launch::WindowsEnableMode::CurrentUser);
    if hidden {
        builder.set_args(&[HIDDEN_ARG]);
    }
    builder.build().map_err(|err| err.to_string())
}

/// Whether the OS currently has a login entry for Rustbox. This is the
/// source of truth for "start at login"; `hidden` does not affect the check
/// on any platform (it only changes the entry's launch arguments).
pub fn is_enabled() -> Result<bool, String> {
    launcher(false)?.is_enabled().map_err(|err| err.to_string())
}

/// Register the login entry, rewriting it if one already exists so a
/// changed `hidden` flag or executable path (an AppImage that moved) takes
/// effect immediately.
pub fn enable(hidden: bool) -> Result<(), String> {
    launcher(hidden)?.enable().map_err(|err| err.to_string())
}

/// Remove the login entry. A no-op when it is already absent.
pub fn disable() -> Result<(), String> {
    launcher(false)?.disable().map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_start_requires_both_flag_and_tray() {
        assert!(should_start_hidden(true, true));
        assert!(!should_start_hidden(true, false));
        assert!(!should_start_hidden(false, true));
        assert!(!should_start_hidden(false, false));
    }

    #[test]
    fn executable_paths_are_quoted_for_command_lines() {
        assert_eq!(
            registered_path("/home/me/My Apps/Rustbox.AppImage", "linux"),
            "\"/home/me/My Apps/Rustbox.AppImage\""
        );
        assert_eq!(
            registered_path("/home/me/100%.AppImage", "linux"),
            "\"/home/me/100%%.AppImage\""
        );
        assert_eq!(
            registered_path("C:/Program Files/Rustbox/rustbox.exe", "windows"),
            "\"C:/Program Files/Rustbox/rustbox.exe\""
        );
        assert_eq!(
            registered_path("/Applications/Rustbox.app/Contents/MacOS/rustbox", "macos"),
            "/Applications/Rustbox.app/Contents/MacOS/rustbox"
        );
    }

    #[test]
    fn appimage_path_wins_over_current_exe() {
        assert_eq!(
            resolve_app_path(
                Some(OsStr::new("/home/user/Apps/rustbox.AppImage")),
                Some(Path::new("/tmp/.mount_rustboxAbCdEf/usr/bin/rustbox")),
            ),
            Some(PathBuf::from("/home/user/Apps/rustbox.AppImage"))
        );
    }

    #[test]
    fn an_empty_appimage_value_is_treated_as_unset() {
        assert_eq!(
            resolve_app_path(Some(OsStr::new("")), Some(Path::new("/usr/bin/rustbox"))),
            Some(PathBuf::from("/usr/bin/rustbox"))
        );
    }

    #[test]
    fn a_package_or_native_install_uses_current_exe() {
        assert_eq!(
            resolve_app_path(None, Some(Path::new("/usr/bin/rustbox"))),
            Some(PathBuf::from("/usr/bin/rustbox"))
        );
    }

    #[test]
    fn no_resolvable_path_is_none() {
        assert_eq!(resolve_app_path(None, None), None);
    }

    #[test]
    fn the_hidden_flag_is_read_back_from_argv() {
        assert!(launched_hidden(["rustbox", "--hidden"]));
        assert!(!launched_hidden(["rustbox"]));
        assert!(!launched_hidden(Vec::<&str>::new()));
        // An argument that only contains the flag as a substring is not a match.
        assert!(!launched_hidden(["--hidden=true"]));
    }
}
