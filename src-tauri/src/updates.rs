//! Update checks against the GitHub Releases `latest.json`.
//!
//! The only network request a check makes is the updater plugin's GET of that
//! file. Installing is a separate step the user starts, and it replaces the
//! app bundle only. Session directories are not part of that bundle.

use std::cmp::Ordering;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use semver::Version;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::config::UpdateSettings;

pub const STARTUP_DELAY: Duration = Duration::from_secs(10);
pub const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
pub const RELEASE_PAGE_PREFIX: &str = "https://github.com/ifigueroap/rustbox/releases/tag/v";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckKind {
    Automatic,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdatePhase {
    Idle,
    Checking,
    Available,
    UpToDate,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub state: UpdatePhase,
    pub current: String,
    pub latest: Option<String>,
    pub notes: Option<String>,
    pub url: Option<String>,
    pub can_install: bool,
    pub auto_check: bool,
    pub last_checked_at: Option<String>,
}

impl UpdateStatus {
    pub fn idle(current: &str, can_install: bool, auto_check: bool) -> Self {
        Self {
            state: UpdatePhase::Idle,
            current: current.to_string(),
            latest: None,
            notes: None,
            url: None,
            can_install,
            auto_check,
            last_checked_at: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BundleKind {
    Nsis,
    AppImage,
    App,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Probe {
    /// The manifest named a release. It may be older, equal, or newer.
    Remote {
        version: String,
        notes: Option<String>,
    },
    /// The plugin found nothing newer than the running version.
    NotNewer,
    /// The GET failed or the manifest could not be read. Stay quiet.
    Failed,
}

pub struct CheckContext {
    pub current: String,
    pub kind: CheckKind,
    pub skipped_version: Option<String>,
    pub notified_version: Option<String>,
    pub do_not_disturb: bool,
    pub can_install: bool,
    pub auto_check: bool,
    pub last_checked_at: Option<String>,
    pub now: String,
}

pub struct Decision {
    pub status: UpdateStatus,
    pub notify: bool,
    pub persist_notified: bool,
    pub notified_version: Option<String>,
    pub record_checked_at: bool,
}

/// First wait is shortly after startup. Later waits are the steady interval.
pub fn schedule_delay(iteration: u64) -> Duration {
    if iteration == 0 {
        STARTUP_DELAY
    } else {
        CHECK_INTERVAL
    }
}

pub fn supports_self_update(kind: BundleKind) -> bool {
    matches!(
        kind,
        BundleKind::Nsis | BundleKind::AppImage | BundleKind::App
    )
}

/// `bundle_type` is Tauri's patched installer name (`Nsis`, `AppImage`, `App`).
/// A portable executable and the raw tar.gz binary stay `Unknown`: they can
/// be told about a release, and they cannot replace themselves.
pub fn kind_from_markers(bundle_type: &str, appimage: bool, exe_path: &str) -> BundleKind {
    match bundle_type.trim().to_ascii_lowercase().as_str() {
        "nsis" => return BundleKind::Nsis,
        "appimage" => return BundleKind::AppImage,
        "app" => return BundleKind::App,
        _ => {}
    }
    if appimage {
        return BundleKind::AppImage;
    }
    if exe_path.contains(".app/Contents/MacOS/") {
        return BundleKind::App;
    }
    BundleKind::Unknown
}

pub fn detect_bundle_kind() -> BundleKind {
    let patched = tauri::utils::platform::bundle_type()
        .map(|kind| format!("{kind:?}"))
        .unwrap_or_default();
    let appimage = std::env::var_os("APPIMAGE").is_some();
    let exe = std::env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default();
    kind_from_markers(&patched, appimage, &exe)
}

pub fn normalize_version(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_start_matches('v').trim();
    if trimmed.is_empty() {
        return None;
    }
    Version::parse(trimmed)
        .ok()
        .map(|version| version.to_string())
}

/// `Some(Ordering::Greater)` means `latest` is a newer release than `current`.
pub fn compare_versions(current: &str, latest: &str) -> Option<Ordering> {
    let current = Version::parse(normalize_version(current)?.as_str()).ok()?;
    let latest = Version::parse(normalize_version(latest)?.as_str()).ok()?;
    Some(latest.cmp(&current))
}

pub fn release_page_url(version: &str) -> Option<String> {
    let version = normalize_version(version)?;
    Some(format!("{RELEASE_PAGE_PREFIX}{version}"))
}

pub fn tray_menu_label(state: UpdatePhase, latest: Option<&str>) -> String {
    if state == UpdatePhase::Available {
        if let Some(version) = latest.and_then(normalize_version) {
            return format!("Update available: v{version}");
        }
        return "Update available".to_string();
    }
    "Check for updates".to_string()
}

pub fn begin_check(previous: &UpdateStatus) -> UpdateStatus {
    UpdateStatus {
        state: UpdatePhase::Checking,
        ..previous.clone()
    }
}

pub fn decide(context: &CheckContext, probe: Probe) -> Decision {
    let base = UpdateStatus {
        state: UpdatePhase::Idle,
        current: context.current.clone(),
        latest: None,
        notes: None,
        url: None,
        can_install: context.can_install,
        auto_check: context.auto_check,
        last_checked_at: context.last_checked_at.clone(),
    };
    match probe {
        Probe::Failed => Decision {
            status: UpdateStatus {
                state: UpdatePhase::Error,
                ..base
            },
            notify: false,
            persist_notified: false,
            notified_version: context.notified_version.clone(),
            record_checked_at: false,
        },
        Probe::NotNewer => Decision {
            status: UpdateStatus {
                state: UpdatePhase::UpToDate,
                last_checked_at: Some(context.now.clone()),
                ..base
            },
            notify: false,
            persist_notified: false,
            notified_version: context.notified_version.clone(),
            record_checked_at: true,
        },
        Probe::Remote { version, notes } => {
            decide_remote(context, base, &version, notes.as_deref())
        }
    }
}

fn decide_remote(
    context: &CheckContext,
    mut base: UpdateStatus,
    version: &str,
    notes: Option<&str>,
) -> Decision {
    let Some(latest) = normalize_version(version) else {
        return Decision {
            status: UpdateStatus {
                state: UpdatePhase::Error,
                ..base
            },
            notify: false,
            persist_notified: false,
            notified_version: context.notified_version.clone(),
            record_checked_at: false,
        };
    };
    let newer = compare_versions(&context.current, &latest) == Some(Ordering::Greater);
    if !newer {
        base.state = UpdatePhase::UpToDate;
        base.last_checked_at = Some(context.now.clone());
        return Decision {
            status: base,
            notify: false,
            persist_notified: false,
            notified_version: context.notified_version.clone(),
            record_checked_at: true,
        };
    }

    let skipped = context
        .skipped_version
        .as_deref()
        .and_then(normalize_version)
        .is_some_and(|skipped| skipped == latest);
    if skipped && context.kind == CheckKind::Automatic {
        base.state = UpdatePhase::Idle;
        base.last_checked_at = Some(context.now.clone());
        return Decision {
            status: base,
            notify: false,
            persist_notified: false,
            notified_version: context.notified_version.clone(),
            record_checked_at: true,
        };
    }

    let already = context
        .notified_version
        .as_deref()
        .and_then(normalize_version)
        .is_some_and(|seen| seen == latest);
    let notify = context.kind == CheckKind::Automatic && !context.do_not_disturb && !already;
    let persist_notified = !context.do_not_disturb && !already;
    base.state = UpdatePhase::Available;
    base.latest = Some(latest.clone());
    base.notes = notes.map(clip_notes);
    base.url = release_page_url(&latest);
    base.last_checked_at = Some(context.now.clone());
    Decision {
        status: base,
        notify,
        persist_notified,
        notified_version: if persist_notified {
            Some(latest)
        } else {
            context.notified_version.clone()
        },
        record_checked_at: true,
    }
}

fn clip_notes(notes: &str) -> String {
    let trimmed = notes.trim();
    const LIMIT: usize = 8_000;
    if trimmed.chars().count() <= LIMIT {
        return trimmed.to_string();
    }
    let clipped: String = trimmed.chars().take(LIMIT).collect();
    format!("{clipped}…")
}

/// Hide the available state after the user skips that version. The stored
/// skip is what automatic checks honor; this only clears the badge.
pub fn after_skip(status: &UpdateStatus, version: &str) -> Option<UpdateStatus> {
    let version = normalize_version(version)?;
    let mut next = status.clone();
    next.state = UpdatePhase::Idle;
    next.notes = None;
    next.url = None;
    if next.latest.as_deref().is_none() {
        next.latest = Some(version);
    }
    Some(next)
}

pub fn apply_settings(status: &UpdateStatus, settings: &UpdateSettings) -> UpdateStatus {
    UpdateStatus {
        auto_check: settings.auto_check,
        last_checked_at: settings.last_checked_at.clone(),
        ..status.clone()
    }
}

fn status_slot() -> &'static Mutex<UpdateStatus> {
    static SLOT: OnceLock<Mutex<UpdateStatus>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(UpdateStatus::idle("", false, true)))
}

pub fn current_status() -> UpdateStatus {
    status_slot()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .clone()
}

pub fn set_status(status: UpdateStatus) {
    *status_slot().lock().unwrap_or_else(|err| err.into_inner()) = status;
}

static CHECK_BUSY: AtomicBool = AtomicBool::new(false);

pub struct CheckGuard;

impl CheckGuard {
    pub fn try_acquire() -> Option<Self> {
        CHECK_BUSY
            .compare_exchange(false, true, AtomicOrdering::SeqCst, AtomicOrdering::SeqCst)
            .ok()
            .map(|_| Self)
    }
}

impl Drop for CheckGuard {
    fn drop(&mut self) {
        CHECK_BUSY.store(false, AtomicOrdering::SeqCst);
    }
}

/// GET `latest.json` through the updater plugin. Errors stay unstructured so
/// a log line cannot grow into a prompt, and the endpoint is not recorded.
pub async fn probe(app: &AppHandle) -> Probe {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(_) => return Probe::Failed,
    };
    match updater.check().await {
        Ok(Some(update)) => Probe::Remote {
            version: update.version,
            notes: update.body,
        },
        Ok(None) => Probe::NotNewer,
        Err(_) => Probe::Failed,
    }
}

/// Download the announced bundle and hand it to the updater plugin.
///
/// This does not delete config or session directories. Those live under the
/// app data dir, and the plugin only replaces the installed bundle. Portable
/// executables and the tar.gz binary are refused here.
pub async fn download_and_install(app: &AppHandle) -> Result<(), String> {
    if !supports_self_update(detect_bundle_kind()) {
        return Err("this install cannot update itself".into());
    }
    let updater = app
        .updater()
        .map_err(|_| "updater is unavailable".to_string())?;
    let Some(update) = updater
        .check()
        .await
        .map_err(|_| "update check failed".to_string())?
    else {
        return Err("no update is available".into());
    };
    let current = app.package_info().version.to_string();
    if compare_versions(&current, &update.version) != Some(Ordering::Greater) {
        return Err("refusing to install a version that is not newer".into());
    }
    // Windows launches the NSIS installer and leaves the process. Asking it
    // to start Rustbox again is that platform's restart. macOS and Linux
    // return here so the shell can ask first.
    let update = update.restart_after_install(cfg!(target_os = "windows"));
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|_| "update install failed".to_string())
}

pub fn rfc3339_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    unix_to_rfc3339(secs)
}

pub fn unix_to_rfc3339(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let tod = secs % 86_400;
    let hour = tod / 3_600;
    let minute = (tod % 3_600) / 60;
    let second = tod % 60;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Howard Hinnant's civil-from-days conversion. `days` is days since 1970-01-01.
fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let year = if month <= 2 { y + 1 } else { y };
    (year as i32, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(kind: CheckKind) -> CheckContext {
        CheckContext {
            current: "0.6.0".into(),
            kind,
            skipped_version: None,
            notified_version: None,
            do_not_disturb: false,
            can_install: true,
            auto_check: true,
            last_checked_at: None,
            now: "2026-10-29T01:00:00Z".into(),
        }
    }

    #[test]
    fn version_order_ignores_a_leading_v_and_is_semver() {
        assert_eq!(compare_versions("0.6.0", "v0.7.0"), Some(Ordering::Greater));
        assert_eq!(compare_versions("v0.6.0", "0.6.0"), Some(Ordering::Equal));
        assert_eq!(compare_versions("0.6.0", "0.5.9"), Some(Ordering::Less));
        assert_eq!(compare_versions("0.9.0", "0.10.0"), Some(Ordering::Greater));
        assert_eq!(compare_versions("0.6.0", "nope"), None);
        assert_eq!(normalize_version(" v1.2.3 "), Some("1.2.3".into()));
    }

    #[test]
    fn a_newer_remote_becomes_available_and_notifies_once() {
        let first = decide(
            &context(CheckKind::Automatic),
            Probe::Remote {
                version: "0.7.0".into(),
                notes: Some("Fixes".into()),
            },
        );
        assert_eq!(first.status.state, UpdatePhase::Available);
        assert_eq!(first.status.latest.as_deref(), Some("0.7.0"));
        assert_eq!(
            first.status.url.as_deref(),
            Some("https://github.com/ifigueroap/rustbox/releases/tag/v0.7.0")
        );
        assert!(first.notify);
        assert!(first.persist_notified);
        assert_eq!(first.notified_version.as_deref(), Some("0.7.0"));
        assert!(first.record_checked_at);
        assert_eq!(
            first.status.last_checked_at.as_deref(),
            Some("2026-10-29T01:00:00Z")
        );

        let mut again = context(CheckKind::Automatic);
        again.notified_version = Some("v0.7.0".into());
        again.last_checked_at = Some("2026-10-29T01:00:00Z".into());
        let second = decide(
            &again,
            Probe::Remote {
                version: "0.7.0".into(),
                notes: Some("Fixes".into()),
            },
        );
        assert_eq!(second.status.state, UpdatePhase::Available);
        assert!(!second.notify);
        assert!(!second.persist_notified);
    }

    #[test]
    fn downgrade_and_same_version_are_up_to_date() {
        for version in ["0.6.0", "v0.5.0", "0.6.0-rc.1"] {
            let decision = decide(
                &context(CheckKind::Automatic),
                Probe::Remote {
                    version: version.into(),
                    notes: None,
                },
            );
            assert_eq!(decision.status.state, UpdatePhase::UpToDate, "{version}");
            assert!(!decision.notify);
            assert!(decision.status.latest.is_none());
        }
        let none = decide(&context(CheckKind::Manual), Probe::NotNewer);
        assert_eq!(none.status.state, UpdatePhase::UpToDate);
        assert!(none.record_checked_at);
    }

    #[test]
    fn network_and_invalid_manifests_stay_quiet() {
        let failed = decide(&context(CheckKind::Automatic), Probe::Failed);
        assert_eq!(failed.status.state, UpdatePhase::Error);
        assert!(!failed.notify);
        assert!(!failed.record_checked_at);
        assert!(failed.status.last_checked_at.is_none());
        assert!(failed.status.url.is_none());

        let invalid = decide(
            &context(CheckKind::Manual),
            Probe::Remote {
                version: "not-a-version".into(),
                notes: Some("ignored".into()),
            },
        );
        assert_eq!(invalid.status.state, UpdatePhase::Error);
        assert!(!invalid.notify);
        assert!(invalid.status.notes.is_none());
    }

    #[test]
    fn skipped_version_hides_automatic_checks_and_not_manual_ones() {
        let mut automatic = context(CheckKind::Automatic);
        automatic.skipped_version = Some("v0.7.0".into());
        let hidden = decide(
            &automatic,
            Probe::Remote {
                version: "0.7.0".into(),
                notes: Some("notes".into()),
            },
        );
        assert_eq!(hidden.status.state, UpdatePhase::Idle);
        assert!(!hidden.notify);
        assert!(hidden.status.notes.is_none());
        assert!(hidden.record_checked_at);

        let mut manual = context(CheckKind::Manual);
        manual.skipped_version = Some("0.7.0".into());
        let shown = decide(
            &manual,
            Probe::Remote {
                version: "v0.7.0".into(),
                notes: Some("notes".into()),
            },
        );
        assert_eq!(shown.status.state, UpdatePhase::Available);
        assert!(!shown.notify);

        let mut newer = context(CheckKind::Automatic);
        newer.skipped_version = Some("0.7.0".into());
        let next = decide(
            &newer,
            Probe::Remote {
                version: "0.8.0".into(),
                notes: None,
            },
        );
        assert_eq!(next.status.state, UpdatePhase::Available);
        assert_eq!(next.status.latest.as_deref(), Some("0.8.0"));
        assert!(next.notify);
    }

    #[test]
    fn do_not_disturb_suppresses_the_notification_until_it_is_off() {
        let mut quiet = context(CheckKind::Automatic);
        quiet.do_not_disturb = true;
        let decision = decide(
            &quiet,
            Probe::Remote {
                version: "0.7.0".into(),
                notes: None,
            },
        );
        assert_eq!(decision.status.state, UpdatePhase::Available);
        assert!(!decision.notify);
        assert!(!decision.persist_notified);

        let mut manual = context(CheckKind::Manual);
        manual.do_not_disturb = false;
        let seen = decide(
            &manual,
            Probe::Remote {
                version: "0.7.0".into(),
                notes: None,
            },
        );
        assert!(!seen.notify);
        assert!(seen.persist_notified);
    }

    #[test]
    fn checking_comes_from_idle_and_skip_returns_to_idle() {
        let idle = UpdateStatus::idle("0.6.0", true, true);
        let checking = begin_check(&idle);
        assert_eq!(checking.state, UpdatePhase::Checking);
        assert_eq!(checking.current, "0.6.0");
        assert!(checking.can_install);

        let mut available = checking;
        available.state = UpdatePhase::Available;
        available.latest = Some("0.7.0".into());
        available.notes = Some("notes".into());
        available.url = release_page_url("0.7.0");
        let skipped = after_skip(&available, "v0.7.0").unwrap();
        assert_eq!(skipped.state, UpdatePhase::Idle);
        assert!(skipped.notes.is_none());
        assert!(skipped.url.is_none());
        assert!(after_skip(&available, "nope").is_none());
    }

    #[test]
    fn tray_label_names_the_available_version() {
        assert_eq!(
            tray_menu_label(UpdatePhase::Idle, None),
            "Check for updates"
        );
        assert_eq!(
            tray_menu_label(UpdatePhase::UpToDate, None),
            "Check for updates"
        );
        assert_eq!(
            tray_menu_label(UpdatePhase::Error, None),
            "Check for updates"
        );
        assert_eq!(
            tray_menu_label(UpdatePhase::Available, Some("v0.7.0")),
            "Update available: v0.7.0"
        );
    }

    #[test]
    fn schedule_waits_ten_seconds_then_six_hours() {
        assert_eq!(schedule_delay(0), Duration::from_secs(10));
        assert_eq!(schedule_delay(1), Duration::from_secs(6 * 60 * 60));
        assert_eq!(schedule_delay(4), Duration::from_secs(6 * 60 * 60));
    }

    #[test]
    fn only_nsis_appimage_and_app_bundles_install_themselves() {
        assert!(supports_self_update(BundleKind::Nsis));
        assert!(supports_self_update(BundleKind::AppImage));
        assert!(supports_self_update(BundleKind::App));
        assert!(!supports_self_update(BundleKind::Unknown));
        assert_eq!(
            kind_from_markers("Nsis", false, "C:\\portable\\rustbox.exe"),
            BundleKind::Nsis
        );
        assert_eq!(
            kind_from_markers("", true, "/tmp/rustbox"),
            BundleKind::AppImage
        );
        assert_eq!(
            kind_from_markers(
                "",
                false,
                "/Applications/Rustbox.app/Contents/MacOS/rustbox"
            ),
            BundleKind::App
        );
        assert_eq!(
            kind_from_markers("", false, "/usr/local/bin/rustbox"),
            BundleKind::Unknown
        );
        assert_eq!(
            kind_from_markers("deb", false, "/usr/bin/rustbox"),
            BundleKind::Unknown
        );
    }

    #[test]
    fn timestamps_are_utc_rfc3339() {
        assert_eq!(unix_to_rfc3339(0), "1970-01-01T00:00:00Z");
        assert_eq!(unix_to_rfc3339(1_763_251_200), "2025-11-16T00:00:00Z");
    }

    #[test]
    fn settings_overlay_keeps_the_phase() {
        let settings = UpdateSettings {
            auto_check: false,
            last_checked_at: Some("2026-01-01T00:00:00Z".into()),
            ..UpdateSettings::default()
        };
        let status = UpdateStatus {
            state: UpdatePhase::Available,
            current: "0.6.0".into(),
            latest: Some("0.7.0".into()),
            notes: None,
            url: None,
            can_install: true,
            auto_check: true,
            last_checked_at: None,
        };
        let merged = apply_settings(&status, &settings);
        assert_eq!(merged.state, UpdatePhase::Available);
        assert!(!merged.auto_check);
        assert_eq!(
            merged.last_checked_at.as_deref(),
            Some("2026-01-01T00:00:00Z")
        );
    }
}
