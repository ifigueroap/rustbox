use url::Url;

/// Chrome stable major as of October 2026. Only the major version is real in
/// the reduced Chrome user-agent; the rest is frozen by Chromium.
const CHROME_VERSION: &str = "155";

/// Matches `--sidebar-width` in the shell stylesheet. The border is inside the
/// box, so the service webview starts at this many logical pixels.
pub const SIDEBAR_COLLAPSED_WIDTH: f64 = 72.0;
pub const SIDEBAR_EXPANDED_WIDTH: f64 = 228.0;

/// Matches `--workspace-rail-width` in the shell stylesheet. Kept slim: the
/// rail is a strip of 40px marks, so anything wider is wasted content width.
pub const WORKSPACE_RAIL_WIDTH: f64 = 48.0;

pub fn sidebar_width(collapsed: bool) -> f64 {
    if collapsed {
        SIDEBAR_COLLAPSED_WIDTH
    } else {
        SIDEBAR_EXPANDED_WIDTH
    }
}

/// The rail only earns its space with a second workspace, and the user can
/// hide it outright in the desk settings.
pub fn workspace_rail_visible(hidden_setting: bool, workspace_count: usize) -> bool {
    !hidden_setting && workspace_count > 1
}

/// Total width to the left of the service webview.
pub fn shell_width(sidebar_collapsed: bool, rail_visible: bool) -> f64 {
    let rail = if rail_visible {
        WORKSPACE_RAIL_WIDTH
    } else {
        0.0
    };
    sidebar_width(sidebar_collapsed) + rail
}

/// Matches `--find-bar-height` in the shell stylesheet. The find bar is a
/// shell-drawn strip, not part of the service page, so the active service's
/// webview is shrunk and pushed down by this many logical pixels while it is
/// open rather than painted over.
pub const FIND_BAR_HEIGHT: f64 = 44.0;

/// Extra vertical offset above the service webview while the find bar is
/// open, so the shell's strip has somewhere to paint instead of being covered
/// by the native child webview.
pub fn find_bar_offset(open: bool) -> f64 {
    if open { FIND_BAR_HEIGHT } else { 0.0 }
}

/// Page audio is muted when the service itself is muted, when Do not disturb
/// is on, or when every workspace that lists it is in Do not disturb.
pub fn sound_muted(do_not_disturb: bool, workspace_dnd: bool, sound_enabled: bool) -> bool {
    do_not_disturb || workspace_dnd || !sound_enabled
}

/// Badges and desktop notifications show only when the service allows them,
/// Do not disturb is off, and at least one workspace that lists it is awake.
pub fn notifications_shown(
    do_not_disturb: bool,
    workspace_dnd: bool,
    notifications_enabled: bool,
) -> bool {
    !do_not_disturb && !workspace_dnd && notifications_enabled
}

/// The Home/desk dashboard's informational unread count for a service.
///
/// Unlike `notifications_shown`, this has no Do not disturb parameter at
/// all: Do not disturb only suppresses attention-grabbing surfaces (sidebar
/// and workspace-rail badges, the tray, the window badge overlay, native
/// notifications), never the desk's unread counts. The only thing that
/// zeroes a Home count is the service's own Badges switch
/// (`notifications_enabled`), matching how disabling Badges already hides
/// desktop notifications for that service.
pub fn informational_unread(raw: u32, notifications_enabled: bool) -> u32 {
    if notifications_enabled { raw } else { 0 }
}

/// Whether a service's "notify even in Do not disturb" switch is actually in
/// effect, i.e. Do not disturb (global or every workspace the service
/// belongs to) is on and the service opted in. Badges are never covered by
/// this: they keep following `notifications_shown` regardless.
pub fn bypasses_do_not_disturb(
    do_not_disturb: bool,
    workspace_dnd: bool,
    notify_in_dnd: bool,
) -> bool {
    notify_in_dnd && (do_not_disturb || workspace_dnd)
}

/// Native notification visibility for a service, honoring its "notify even
/// in Do not disturb" switch. Unread badges are not covered by this function;
/// they keep using `notifications_shown` so badges stay unaffected by the
/// bypass.
pub fn notification_allowed(
    do_not_disturb: bool,
    workspace_dnd: bool,
    notifications_enabled: bool,
    notify_in_dnd: bool,
) -> bool {
    notifications_enabled
        && (bypasses_do_not_disturb(do_not_disturb, workspace_dnd, notify_in_dnd)
            || notifications_shown(do_not_disturb, workspace_dnd, notifications_enabled))
}

/// Page audio mute for a service, honoring its "notify even in Do not
/// disturb" switch the same way `notification_allowed` does for
/// notifications.
pub fn sound_muted_allowing_bypass(
    do_not_disturb: bool,
    workspace_dnd: bool,
    sound_enabled: bool,
    notify_in_dnd: bool,
) -> bool {
    if bypasses_do_not_disturb(do_not_disturb, workspace_dnd, notify_in_dnd) {
        !sound_enabled
    } else {
        sound_muted(do_not_disturb, workspace_dnd, sound_enabled)
    }
}

/// Resolve the per-service silencing rule for a service listed in several
/// workspaces: it is silenced only when every workspace it belongs to has Do
/// not disturb on. `workspace_dnd` values are the switches of the workspaces
/// that list this service; an empty list means the service has no workspace.
pub fn silenced_by_workspaces(workspace_dnd: &[bool]) -> bool {
    !workspace_dnd.is_empty() && workspace_dnd.iter().all(|flag| *flag)
}

/// Login hosts whose top-level navigations should stay inside the service
/// webview so redirect and popup sign-in can finish.
pub const AUTH_SUFFIXES: &[&str] = &[
    "google.com",
    "googleusercontent.com",
    "gstatic.com",
    "microsoftonline.com",
    "microsoft.com",
    "live.com",
    "office.com",
    "office365.com",
    "windows.net",
    "apple.com",
    "icloud.com",
    "facebook.com",
    "fb.com",
    "facebook.net",
    "okta.com",
    "okta-emea.com",
    "auth0.com",
    "github.com",
    "amazonaws.com",
    "onelogin.com",
    "duosecurity.com",
    "pingidentity.com",
    "atlassian.net",
    "atlassian.com",
];

const MULTI_PART_SUFFIXES: &[&str] = &[
    "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.jp", "com.br", "co.nz", "com.mx", "co.in",
    "com.ar", "co.za", "com.tr", "co.kr",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PopupDecision {
    /// Let the webview open its own window (same site or a login provider).
    Allow,
    /// Open the URL in the system browser and cancel the webview window.
    External,
    /// Cancel the navigation and do not open anything.
    Deny,
}

pub fn chrome_user_agent() -> String {
    #[cfg(target_os = "windows")]
    let platform = "Windows NT 10.0; Win64; x64";
    #[cfg(target_os = "macos")]
    let platform = "Macintosh; Intel Mac OS X 10_15_7";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let platform = "X11; Linux x86_64";

    format!(
        "Mozilla/5.0 ({platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{CHROME_VERSION}.0.0.0 Safari/537.36"
    )
}

pub fn effective_user_agent(use_chrome: bool, custom: Option<&str>) -> Option<String> {
    if !use_chrome {
        return None;
    }
    match custom.map(str::trim).filter(|value| !value.is_empty()) {
        Some(custom) => Some(custom.to_string()),
        None => Some(chrome_user_agent()),
    }
}

pub fn open_external_detached(url: &str) {
    let url = url.to_string();
    std::thread::spawn(move || {
        if let Err(err) = open::that(&url) {
            eprintln!("rustbox: failed to open {url}: {err}");
        }
    });
}

pub fn allow_main_navigation(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" | "about" | "blob" | "data" | "tauri" => true,
        "mailto" | "tel" => {
            open_external_detached(url.as_str());
            false
        }
        _ => false,
    }
}

pub fn popup_decision(service_url: &Url, target: &Url) -> PopupDecision {
    match target.scheme() {
        "about" | "blob" | "data" => PopupDecision::Allow,
        "mailto" | "tel" => PopupDecision::External,
        "http" | "https" => {
            let host = target.host_str().unwrap_or("");
            if same_site(service_url, target) || is_auth_host(host) {
                PopupDecision::Allow
            } else {
                PopupDecision::External
            }
        }
        _ => PopupDecision::Deny,
    }
}

/// Read an unread count from a document title.
///
/// Recognizes `(3)`, `(99+)`, and `[3]` anywhere in the title, which is how
/// WhatsApp, Slack, Discord, and Telegram Web report badges. A leading bullet
/// with no number counts as one.
pub fn parse_unread_count(title: &str) -> u32 {
    if let Some(count) = first_wrapped_number(title, '(', ')') {
        return count;
    }
    if let Some(count) = first_wrapped_number(title, '[', ']') {
        return count;
    }
    let trimmed = title.trim_start();
    if trimmed.starts_with(['•', '●', '*']) {
        return 1;
    }
    0
}

pub fn registrable_domain(host: &str) -> String {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let parts: Vec<&str> = host.split('.').filter(|part| !part.is_empty()).collect();
    if parts.len() <= 2 {
        return parts.join(".");
    }
    let last_two = format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1]);
    if MULTI_PART_SUFFIXES.contains(&last_two.as_str()) {
        return format!("{}.{}", parts[parts.len() - 3], last_two);
    }
    last_two
}

pub fn same_site(left: &Url, right: &Url) -> bool {
    match (left.host_str(), right.host_str()) {
        (Some(left_host), Some(right_host)) => {
            let left_domain = registrable_domain(left_host);
            let right_domain = registrable_domain(right_host);
            !left_domain.is_empty() && left_domain == right_domain
        }
        _ => false,
    }
}

pub fn is_auth_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    AUTH_SUFFIXES
        .iter()
        .any(|suffix| host_matches_suffix(&host, suffix))
}

fn host_matches_suffix(host: &str, suffix: &str) -> bool {
    host == suffix
        || host
            .strip_suffix(suffix)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

fn first_wrapped_number(title: &str, open: char, close: char) -> Option<u32> {
    let mut rest = title;
    while let Some(start) = rest.find(open) {
        let after = &rest[start + open.len_utf8()..];
        if let Some(end) = after.find(close) {
            if let Some(count) = parse_badge_number(&after[..end]) {
                return Some(count);
            }
            rest = &after[end + close.len_utf8()..];
        } else {
            break;
        }
    }
    None
}

fn parse_badge_number(inner: &str) -> Option<u32> {
    let inner = inner.trim().trim_end_matches('+').trim();
    if inner.is_empty() || !inner.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    // Reject leading-zero noise such as "(00)" by still accepting it as a number.
    inner.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    #[test]
    fn sidebar_widths_match_the_shell_stylesheet() {
        assert_eq!(sidebar_width(true), 72.0);
        assert_eq!(sidebar_width(false), 228.0);
        assert_eq!(shell_width(false, false), 228.0);
        assert_eq!(shell_width(false, true), 276.0);
        assert_eq!(shell_width(true, true), 120.0);
    }

    #[test]
    fn the_workspace_rail_hides_with_one_workspace_or_when_told_to() {
        assert!(workspace_rail_visible(false, 2));
        assert!(!workspace_rail_visible(false, 1));
        assert!(!workspace_rail_visible(false, 0));
        assert!(!workspace_rail_visible(true, 4));
    }

    #[test]
    fn the_find_bar_offset_only_applies_while_open() {
        assert_eq!(find_bar_offset(false), 0.0);
        assert_eq!(find_bar_offset(true), 44.0);
        assert_eq!(find_bar_offset(true), FIND_BAR_HEIGHT);
    }

    #[test]
    fn chrome_user_agent_matches_reduced_chrome_155() {
        let agent = chrome_user_agent();
        assert!(agent.contains("Chrome/155.0.0.0"));
        assert!(agent.contains("AppleWebKit/537.36"));
        assert!(agent.contains("Safari/537.36"));
        #[cfg(target_os = "linux")]
        assert!(agent.contains("X11; Linux x86_64"));
        #[cfg(target_os = "macos")]
        assert!(agent.contains("Macintosh; Intel Mac OS X 10_15_7"));
        #[cfg(target_os = "windows")]
        assert!(agent.contains("Windows NT 10.0; Win64; x64"));
    }

    #[test]
    fn user_agent_override_replaces_the_builtin_chrome_string() {
        assert!(effective_user_agent(false, None).is_none());
        assert!(effective_user_agent(false, Some("Custom")).is_none());
        let builtin = effective_user_agent(true, None).unwrap();
        assert!(builtin.contains("Chrome/155"));
        assert_eq!(
            effective_user_agent(true, Some("  CustomAgent  ")).as_deref(),
            Some("CustomAgent")
        );
    }

    #[test]
    fn do_not_disturb_overrides_per_service_sound_and_badges() {
        assert!(!sound_muted(false, false, true));
        assert!(sound_muted(false, false, false));
        assert!(sound_muted(true, false, true));
        assert!(sound_muted(true, false, false));
        assert!(sound_muted(false, true, true));
        assert!(notifications_shown(false, false, true));
        assert!(!notifications_shown(false, false, false));
        assert!(!notifications_shown(true, false, true));
        assert!(!notifications_shown(true, false, false));
        assert!(!notifications_shown(false, true, true));
    }

    #[test]
    fn informational_unread_respects_badges_but_ignores_do_not_disturb() {
        // No `do_not_disturb` parameter exists to pass here at all: Home
        // counts simply do not know about Do not disturb.
        assert_eq!(informational_unread(5, true), 5);
        assert_eq!(informational_unread(0, true), 0);
        assert_eq!(informational_unread(5, false), 0, "Badges off still hides Home's count");

        // Confirm it diverges from the attention-badge rule while Do not
        // disturb is active and Badges are on: the badge is hidden, but the
        // informational count is not.
        assert!(!notifications_shown(true, false, true));
        assert_eq!(informational_unread(5, true), 5);
    }

    #[test]
    fn notify_in_dnd_bypasses_only_while_do_not_disturb_is_active() {
        assert!(
            !bypasses_do_not_disturb(false, false, true),
            "nothing to bypass while awake"
        );
        assert!(bypasses_do_not_disturb(true, false, true));
        assert!(bypasses_do_not_disturb(false, true, true));
        assert!(
            !bypasses_do_not_disturb(true, true, false),
            "the service did not opt in"
        );
    }

    #[test]
    fn notify_in_dnd_lets_native_notifications_through_do_not_disturb() {
        // Awake: behaves exactly like notifications_shown either way.
        assert!(notification_allowed(false, false, true, false));
        assert!(notification_allowed(false, false, true, true));
        assert!(
            !notification_allowed(false, false, false, true),
            "the service's own switch still gates it"
        );

        // Global Do not disturb: only the opted-in service gets through.
        assert!(!notification_allowed(true, false, true, false));
        assert!(notification_allowed(true, false, true, true));
        assert!(
            !notification_allowed(true, false, false, true),
            "disabled notifications are not resurrected by the bypass"
        );

        // Workspace Do not disturb behaves the same as global.
        assert!(!notification_allowed(false, true, true, false));
        assert!(notification_allowed(false, true, true, true));
    }

    #[test]
    fn sound_policy_restores_after_dnd_cycles() {
        for workspace in [false, true] {
            for enabled in [false, true] {
                for bypass in [false, true] {
                    let before = sound_muted_allowing_bypass(false, false, enabled, bypass);
                    assert_eq!(
                        sound_muted_allowing_bypass(!workspace, workspace, enabled, bypass),
                        !enabled || !bypass
                    );
                    assert_eq!(
                        sound_muted_allowing_bypass(false, false, enabled, bypass),
                        before
                    );
                }
            }
        }
    }

    #[test]
    fn notify_in_dnd_lets_sound_through_do_not_disturb() {
        // Awake: behaves exactly like sound_muted either way.
        assert!(!sound_muted_allowing_bypass(false, false, true, false));
        assert!(!sound_muted_allowing_bypass(false, false, true, true));
        assert!(
            sound_muted_allowing_bypass(false, false, false, true),
            "sound_enabled still gates it"
        );

        // Global and workspace Do not disturb: only the opted-in service stays audible.
        assert!(sound_muted_allowing_bypass(true, false, true, false));
        assert!(!sound_muted_allowing_bypass(true, false, true, true));
        assert!(sound_muted_allowing_bypass(false, true, true, false));
        assert!(!sound_muted_allowing_bypass(false, true, true, true));
        assert!(
            sound_muted_allowing_bypass(true, false, false, true),
            "disabled sound is not resurrected by the bypass"
        );
    }

    #[test]
    fn workspace_dnd_silences_only_when_every_workspace_is_asleep() {
        assert!(!silenced_by_workspaces(&[]));
        assert!(!silenced_by_workspaces(&[true, false]));
        assert!(!silenced_by_workspaces(&[false, false]));
        assert!(silenced_by_workspaces(&[true]));
        assert!(silenced_by_workspaces(&[true, true]));
    }

    #[test]
    fn unread_counts_follow_common_title_badges() {
        assert_eq!(parse_unread_count("(3) WhatsApp"), 3);
        assert_eq!(parse_unread_count("WhatsApp"), 0);
        assert_eq!(parse_unread_count("Slack | home (12)"), 12);
        assert_eq!(parse_unread_count("(99+) Discord"), 99);
        assert_eq!(parse_unread_count("Meeting (notes)"), 0);
        assert_eq!(parse_unread_count("[4] Telegram"), 4);
        assert_eq!(parse_unread_count("• Claude"), 1);
        assert_eq!(parse_unread_count(""), 0);
        assert_eq!(parse_unread_count("(0) WhatsApp"), 0);
        assert_eq!(parse_unread_count("Chat (2) and (5)"), 2);
    }

    #[test]
    fn same_site_uses_the_registrable_domain() {
        assert!(same_site(
            &url("https://web.whatsapp.com/"),
            &url("https://www.whatsapp.com/download")
        ));
        assert!(same_site(
            &url("https://chat.example.co.uk/"),
            &url("https://files.example.co.uk/a")
        ));
        assert!(!same_site(
            &url("https://web.whatsapp.com/"),
            &url("https://example.com/")
        ));
    }

    #[test]
    fn popups_to_other_sites_leave_the_webview() {
        let service = url("https://web.whatsapp.com/");
        assert_eq!(
            popup_decision(&service, &url("https://example.com/article")),
            PopupDecision::External
        );
        assert_eq!(
            popup_decision(&service, &url("https://faq.whatsapp.com/help")),
            PopupDecision::Allow
        );
        assert_eq!(
            popup_decision(&service, &url("https://accounts.google.com/o/oauth2")),
            PopupDecision::Allow
        );
        assert_eq!(
            popup_decision(&service, &url("mailto:a@example.com")),
            PopupDecision::External
        );
        assert_eq!(
            popup_decision(&service, &url("about:blank")),
            PopupDecision::Allow
        );
        assert_eq!(
            popup_decision(&service, &url("file:///etc/passwd")),
            PopupDecision::Deny
        );
    }

    #[test]
    fn main_frame_http_stays_so_login_redirects_work() {
        assert!(allow_main_navigation(&url("https://accounts.google.com/")));
        assert!(allow_main_navigation(&url("http://localhost:8080/")));
        assert!(!allow_main_navigation(&url("file:///tmp/a")));
        assert!(!allow_main_navigation(&url("javascript:alert(1)")));
    }

    #[test]
    fn injected_script_lists_every_auth_and_multipart_suffix() {
        let script = include_str!("inject.js");
        for suffix in AUTH_SUFFIXES {
            assert!(
                script.contains(&format!("\"{suffix}\"")),
                "inject.js is missing auth suffix {suffix}"
            );
        }
        for suffix in MULTI_PART_SUFFIXES {
            assert!(
                script.contains(&format!("\"{suffix}\"")),
                "inject.js is missing public suffix {suffix}"
            );
        }
        assert!(
            script.contains("window.__rustboxSetSound"),
            "inject.js must expose the sound switch"
        );
        assert!(
            script.contains("apply_service_shortcut"),
            "inject.js must forward service shortcuts"
        );
        assert!(
            script.contains("isSettingsShortcut"),
            "inject.js must forward the settings shortcut"
        );
    }
}
