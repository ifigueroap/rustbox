//! Decisions shared by the Rust webview callbacks and the injected page script.
//!
//! The host lists below are serialized into `inject.js`. Keep the JavaScript
//! checks aligned with the functions in this file.

use url::Url;

/// Public suffixes where the registrable domain is three labels (`bbc.co.uk`).
pub const MULTI_PART_TLDS: &[&str] = &[
    "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.jp", "ne.jp", "com.br",
    "com.mx", "com.ar", "com.tr", "co.nz", "co.za", "co.in", "com.cn", "com.tw", "com.hk",
    "com.sg",
];

/// Hosts that exist only to sign a user in. Any path on these hosts stays in the app.
pub const AUTH_DEDICATED: &[&str] = &[
    "accounts.google.com",
    "accounts.youtube.com",
    "oauth2.googleapis.com",
    "myaccount.google.com",
    "login.microsoftonline.com",
    "login.microsoft.com",
    "login.live.com",
    "appleid.apple.com",
    "id.slack.com",
    "auth.openai.com",
    "auth.anthropic.com",
];

/// Identity-provider suffixes. A subdomain such as `company.okta.com` counts.
pub const AUTH_PROVIDER_SUFFIXES: &[&str] = &["okta.com", "auth0.com", "onelogin.com"];

/// Broader sites where only sign-in paths should stay inside the app.
pub const AUTH_PATH_HOSTS: &[&str] = &[
    "github.com",
    "gitlab.com",
    "google.com",
    "facebook.com",
    "apple.com",
    "microsoft.com",
    "amazon.com",
];

pub const AUTH_PATH_MARKERS: &[&str] = &[
    "/oauth",
    "/login",
    "/signin",
    "/sign-in",
    "/authorize",
    "/auth",
    "/sso",
    "/saml",
];

/// Chrome stable on desktop as of 2026-10-14. Sites that reject WebKit (WhatsApp
/// Web in particular) look for a Chrome token more than they look at the OS.
pub const DEFAULT_CHROME_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.81 Safari/537.36";

const BRIDGE_PREFIX: char = '\u{2063}';

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NewWindowDecision {
    /// Sign-in or same-site popup. Share the service session when the platform allows it.
    InApp,
    /// Open in the system browser and do not create a webview.
    External,
    /// Drop the request. Used for non-http schemes such as `javascript:` or `file:`.
    Ignore,
}

pub fn host_matches(host: &str, allowed: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let allowed = allowed.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || allowed.is_empty() || allowed.contains('/') {
        return false;
    }
    host == allowed || host.ends_with(&format!(".{allowed}"))
}

pub fn registrable_domain(host: &str) -> String {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.parse::<std::net::IpAddr>().is_ok() {
        return host;
    }
    let parts: Vec<&str> = host.split('.').filter(|part| !part.is_empty()).collect();
    if parts.len() <= 2 {
        return host;
    }
    let last_two = format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1]);
    if MULTI_PART_TLDS.contains(&last_two.as_str()) {
        return format!(
            "{}.{}.{}",
            parts[parts.len() - 3],
            parts[parts.len() - 2],
            parts[parts.len() - 1]
        );
    }
    last_two
}

pub fn is_auth_url(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    if AUTH_DEDICATED
        .iter()
        .any(|allowed| host_matches(host, allowed))
    {
        return true;
    }
    if AUTH_PROVIDER_SUFFIXES
        .iter()
        .any(|allowed| host_matches(host, allowed))
    {
        return true;
    }
    let path = url.path().to_ascii_lowercase();
    let path_match = AUTH_PATH_MARKERS.iter().any(|marker| path.contains(marker));
    path_match
        && AUTH_PATH_HOSTS
            .iter()
            .any(|allowed| host_matches(host, allowed))
}

pub fn is_related(url: &Url, home: &Url, extra_hosts: &[String]) -> bool {
    let (Some(host), Some(home_host)) = (url.host_str(), home.host_str()) else {
        return false;
    };
    if registrable_domain(host) == registrable_domain(home_host) {
        return true;
    }
    extra_hosts
        .iter()
        .any(|allowed| host_matches(host, allowed))
}

pub fn new_window_decision(url: &Url, home: &Url, extra_hosts: &[String]) -> NewWindowDecision {
    match url.scheme() {
        "about" | "blob" | "data" => NewWindowDecision::InApp,
        "http" | "https" => {
            if is_related(url, home, extra_hosts) || is_auth_url(url) {
                NewWindowDecision::InApp
            } else {
                NewWindowDecision::External
            }
        }
        _ => NewWindowDecision::Ignore,
    }
}

/// Main-frame and subframe navigations both reach this callback, and the API
/// does not say which frame moved. Blocking a cross-site load here would also
/// block legitimate iframes, so only dangerous schemes are refused. External
/// *links* are handled from the injected click listener and from `window.open`.
pub fn allow_navigation(url: &Url) -> bool {
    matches!(
        url.scheme(),
        "http" | "https" | "about" | "blob" | "data" | "tauri" | "asset"
    )
}

/// Unread count encoded in a document title.
///
/// `None` means "ignore this title" (empty, or an internal bridge message).
/// `Some(0)` clears the badge. Parenthetical counts above 999 are ignored so a
/// year such as `(2026)` does not become a badge.
pub fn unread_from_title(title: &str) -> Option<u32> {
    let title = title.trim();
    if title.is_empty() || title.starts_with(BRIDGE_PREFIX) {
        return None;
    }
    if let Some(count) = first_wrapped_count(title, '(', ')') {
        return Some(count);
    }
    if let Some(count) = first_wrapped_count(title, '[', ']') {
        return Some(count);
    }
    Some(0)
}

fn first_wrapped_count(title: &str, open: char, close: char) -> Option<u32> {
    let mut rest = title;
    while let Some(start) = rest.find(open) {
        let after = &rest[start + open.len_utf8()..];
        if let Some(end) = after.find(close) {
            let inside = after[..end].trim().trim_end_matches('+').trim();
            if (1..=3).contains(&inside.len()) && inside.chars().all(|ch| ch.is_ascii_digit()) {
                if let Ok(value) = inside.parse::<u32>() {
                    return Some(value);
                }
            }
        }
        rest = after;
    }
    None
}

pub fn inject_script(home: &Url, extra_hosts: &[String]) -> String {
    let home_host =
        serde_json::to_string(home.host_str().unwrap_or("")).unwrap_or_else(|_| "\"\"".into());
    let extras = serde_json::to_string(extra_hosts).unwrap_or_else(|_| "[]".into());
    let dedicated = serde_json::to_string(AUTH_DEDICATED).unwrap_or_else(|_| "[]".into());
    let suffixes = serde_json::to_string(AUTH_PROVIDER_SUFFIXES).unwrap_or_else(|_| "[]".into());
    let path_hosts = serde_json::to_string(AUTH_PATH_HOSTS).unwrap_or_else(|_| "[]".into());
    let markers = serde_json::to_string(AUTH_PATH_MARKERS).unwrap_or_else(|_| "[]".into());
    let tlds = serde_json::to_string(MULTI_PART_TLDS).unwrap_or_else(|_| "[]".into());
    include_str!("inject.js")
        .replace("__RBX_HOME_HOST__", &home_host)
        .replace("__RBX_EXTRA_HOSTS__", &extras)
        .replace("__RBX_AUTH_DEDICATED__", &dedicated)
        .replace("__RBX_AUTH_SUFFIXES__", &suffixes)
        .replace("__RBX_AUTH_PATH_HOSTS__", &path_hosts)
        .replace("__RBX_AUTH_PATH_MARKERS__", &markers)
        .replace("__RBX_MULTI_TLDS__", &tlds)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    #[test]
    fn registrable_domains_cover_multipart_suffixes() {
        assert_eq!(registrable_domain("web.whatsapp.com"), "whatsapp.com");
        assert_eq!(registrable_domain("news.bbc.co.uk"), "bbc.co.uk");
        assert_eq!(registrable_domain("localhost"), "localhost");
        assert_eq!(registrable_domain("127.0.0.1"), "127.0.0.1");
    }

    #[test]
    fn host_match_does_not_accept_lookalikes() {
        assert!(host_matches("id.slack.com", "slack.com"));
        assert!(!host_matches("evilslack.com", "slack.com"));
        assert!(!host_matches("slack.com.evil.test", "slack.com"));
        assert!(!host_matches("example.com", ""));
    }

    #[test]
    fn new_windows_stay_in_app_for_the_service_and_sign_in() {
        let home = url("https://web.whatsapp.com/");
        let extra = vec!["whatsapp.net".to_string()];
        assert_eq!(
            new_window_decision(&url("https://faq.whatsapp.com/help"), &home, &extra),
            NewWindowDecision::InApp
        );
        assert_eq!(
            new_window_decision(&url("https://static.whatsapp.net/img"), &home, &extra),
            NewWindowDecision::InApp
        );
        assert_eq!(
            new_window_decision(
                &url("https://accounts.google.com/o/oauth2/v2/auth"),
                &home,
                &extra
            ),
            NewWindowDecision::InApp
        );
        assert_eq!(
            new_window_decision(
                &url("https://github.com/login/oauth/authorize"),
                &home,
                &extra
            ),
            NewWindowDecision::InApp
        );
        assert_eq!(
            new_window_decision(&url("about:blank"), &home, &extra),
            NewWindowDecision::InApp
        );
    }

    #[test]
    fn ordinary_links_and_scripts_leave_the_app() {
        let home = url("https://discord.com/app");
        let extra = vec!["discordapp.com".to_string()];
        assert_eq!(
            new_window_decision(&url("https://example.com/article"), &home, &extra),
            NewWindowDecision::External
        );
        assert_eq!(
            new_window_decision(&url("https://github.com/tauri-apps/tauri"), &home, &extra),
            NewWindowDecision::External
        );
        assert_eq!(
            new_window_decision(&url("javascript:alert(1)"), &home, &extra),
            NewWindowDecision::Ignore
        );
        assert_eq!(
            new_window_decision(&url("file:///etc/passwd"), &home, &extra),
            NewWindowDecision::Ignore
        );
        assert!(!allow_navigation(&url("file:///tmp/x")));
        assert!(allow_navigation(&url("https://cdn.example.com/frame")));
    }

    #[test]
    fn unread_counts_come_from_wrapped_numbers() {
        assert_eq!(unread_from_title("(3) WhatsApp"), Some(3));
        assert_eq!(unread_from_title("Telegram (99+)"), Some(99));
        assert_eq!(unread_from_title("[4] Slack"), Some(4));
        assert_eq!(unread_from_title("Inbox (12) - Mail"), Some(12));
        assert_eq!(unread_from_title("WhatsApp"), Some(0));
        assert_eq!(unread_from_title("Notes (2026)"), Some(0));
        assert_eq!(unread_from_title(""), None);
        assert_eq!(unread_from_title("\u{2063}{\"cmd\":\"notify\"}"), None);
    }

    #[test]
    fn inject_script_embeds_json_and_drops_placeholders() {
        let script = inject_script(&url("https://web.whatsapp.com/"), &["a\"b".into()]);
        assert!(script.contains("\"web.whatsapp.com\""));
        assert!(script.contains("\"a\\\"b\""));
        assert!(!script.contains("__RBX_"));
        assert!(script.contains("notify_from_service"));
    }
}
