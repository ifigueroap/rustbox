//! Pure idle-hibernation policy.
//!
//! Given the global settings, which service is active, how long each
//! background service has been loaded without being the active one, and a
//! few per-service flags, decide which services should have their webview
//! torn down right now to free memory and CPU. Waking a hibernated service
//! is just a normal activation (see `services::set_active`); this module
//! only decides the "go to sleep" half, so it stays dependency-light and
//! testable without Tauri.

use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Settings {
    /// Minutes a background service may stay loaded before it is
    /// hibernated. 0 means hibernation is off, matching the settings
    /// dropdown's "Off" option, which is also the default.
    pub after_minutes: u32,
    /// Also hibernate services that are not members of the active
    /// workspace. Off by default: a service tucked away in another
    /// workspace is left alone until the user opts in.
    pub inactive_workspaces: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct Candidate<'a> {
    pub id: &'a str,
    /// Monotonic timestamp in seconds when this service became background.
    /// `None` when no background timer is running (active or unloaded).
    pub background_since: Option<u64>,
    pub never_hibernate: bool,
    /// Whether the service belongs to the currently active workspace, is
    /// pinned to all workspaces, or there is no active workspace at all.
    pub in_active_workspace: bool,
}

/// Ids that should transition from loaded to hibernated right now. The
/// caller tears down each webview and records it as hibernated; this only
/// decides who and when. Idempotent: a service already in `hibernated`
/// never comes back out through this function.
pub fn due_for_hibernation(
    now: u64,
    settings: Settings,
    active_id: Option<&str>,
    hibernated: &HashSet<String>,
    candidates: &[Candidate],
) -> Vec<String> {
    if !matches!(settings.after_minutes, 5 | 15 | 30 | 60) {
        return Vec::new();
    }
    let threshold_seconds = u64::from(settings.after_minutes) * 60;
    candidates
        .iter()
        .filter(|candidate| {
            Some(candidate.id) != active_id
                && !candidate.never_hibernate
                && !hibernated.contains(candidate.id)
                && (candidate.in_active_workspace || settings.inactive_workspaces)
                && candidate
                    .background_since
                    .is_some_and(|since| now.saturating_sub(since) >= threshold_seconds)
        })
        .map(|candidate| candidate.id.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(after_minutes: u32, inactive_workspaces: bool) -> Settings {
        Settings {
            after_minutes,
            inactive_workspaces,
        }
    }

    fn candidate(id: &str, idle_seconds: Option<u64>) -> Candidate<'_> {
        Candidate {
            id,
            background_since: idle_seconds.map(|idle| 100_000u64.saturating_sub(idle)),
            never_hibernate: false,
            in_active_workspace: true,
        }
    }

    #[test]
    fn off_by_default_hibernates_nothing_no_matter_how_idle() {
        let candidates = [candidate("a", Some(100_000))];
        let due = due_for_hibernation(
            100_000,
            settings(0, false),
            None,
            &HashSet::new(),
            &candidates,
        );
        assert!(due.is_empty());
    }

    #[test]
    fn a_service_past_the_threshold_is_due() {
        let candidates = [candidate("a", Some(15 * 60))];
        let due = due_for_hibernation(
            100_000,
            settings(15, false),
            None,
            &HashSet::new(),
            &candidates,
        );
        assert_eq!(due, vec!["a".to_string()]);
    }

    #[test]
    fn a_service_short_of_the_threshold_is_not_due() {
        let candidates = [candidate("a", Some(15 * 60 - 1))];
        let due = due_for_hibernation(
            100_000,
            settings(15, false),
            None,
            &HashSet::new(),
            &candidates,
        );
        assert!(due.is_empty());
    }

    #[test]
    fn the_active_service_is_never_due_even_if_idle_time_is_reported() {
        // Should not happen in practice (the active service has no idle
        // timer running), but the active id always wins regardless.
        let candidates = [candidate("a", Some(999_999))];
        let due = due_for_hibernation(
            100_000,
            settings(5, false),
            Some("a"),
            &HashSet::new(),
            &candidates,
        );
        assert!(due.is_empty());
    }

    #[test]
    fn a_service_with_no_webview_loaded_is_never_due() {
        let candidates = [candidate("a", None)];
        let due = due_for_hibernation(
            100_000,
            settings(5, false),
            None,
            &HashSet::new(),
            &candidates,
        );
        assert!(due.is_empty());
    }

    #[test]
    fn never_hibernate_opts_a_service_out() {
        let mut never = candidate("a", Some(3600));
        never.never_hibernate = true;
        let due = due_for_hibernation(100_000, settings(5, false), None, &HashSet::new(), &[never]);
        assert!(due.is_empty());
    }

    #[test]
    fn an_already_hibernated_service_is_not_reported_again() {
        let candidates = [candidate("a", Some(3600))];
        let mut hibernated = HashSet::new();
        hibernated.insert("a".to_string());
        let due = due_for_hibernation(100_000, settings(5, false), None, &hibernated, &candidates);
        assert!(due.is_empty());
    }

    #[test]
    fn a_service_outside_the_active_workspace_is_spared_by_default() {
        let mut elsewhere = candidate("a", Some(3600));
        elsewhere.in_active_workspace = false;
        let due = due_for_hibernation(
            100_000,
            settings(5, false),
            None,
            &HashSet::new(),
            &[elsewhere],
        );
        assert!(
            due.is_empty(),
            "inactive-workspace services need the opt-in toggle"
        );
    }

    #[test]
    fn the_inactive_workspaces_toggle_extends_hibernation_to_them() {
        let mut elsewhere = candidate("a", Some(3600));
        elsewhere.in_active_workspace = false;
        let due = due_for_hibernation(
            100_000,
            settings(5, true),
            None,
            &HashSet::new(),
            &[elsewhere],
        );
        assert_eq!(due, vec!["a".to_string()]);
    }

    #[test]
    fn a_mixed_batch_only_reports_the_ones_actually_due() {
        let active_but_idle_reported = candidate("active", Some(10_000));
        let fresh = candidate("fresh", Some(10));
        let mut never = candidate("never", Some(10_000));
        never.never_hibernate = true;
        let due_one = candidate("due", Some(600));
        let candidates = [active_but_idle_reported, fresh, never, due_one];
        let due = due_for_hibernation(
            100_000,
            settings(5, false),
            Some("active"),
            &HashSet::new(),
            &candidates,
        );
        assert_eq!(due, vec!["due".to_string()]);
    }
}

#[cfg(test)]
mod timestamp_tests {
    use super::*;

    #[test]
    fn all_supported_intervals_use_the_same_boundary() {
        for minutes in [5, 15, 30, 60] {
            let settings = Settings {
                after_minutes: minutes,
                inactive_workspaces: true,
            };
            let candidates = [Candidate {
                id: "shared",
                background_since: Some(100),
                never_hibernate: false,
                in_active_workspace: true,
            }];
            let deadline = 100 + u64::from(minutes) * 60;
            assert!(
                due_for_hibernation(deadline - 1, settings, None, &HashSet::new(), &candidates)
                    .is_empty()
            );
            assert_eq!(
                due_for_hibernation(deadline, settings, None, &HashSet::new(), &candidates),
                ["shared"]
            );
            // Shared/pinned services are represented once, by their stable id.
            assert!(
                due_for_hibernation(
                    deadline,
                    settings,
                    Some("shared"),
                    &HashSet::new(),
                    &candidates
                )
                .is_empty()
            );
        }
    }

    #[test]
    fn reactivation_resets_the_background_deadline() {
        let settings = Settings {
            after_minutes: 5,
            inactive_workspaces: false,
        };
        let candidates = [Candidate {
            id: "a",
            background_since: Some(590),
            never_hibernate: false,
            in_active_workspace: true,
        }];
        assert!(due_for_hibernation(600, settings, None, &HashSet::new(), &candidates).is_empty());
        assert!(due_for_hibernation(580, settings, None, &HashSet::new(), &candidates).is_empty());
    }

    #[test]
    fn unsupported_intervals_are_treated_as_off() {
        let candidates = [Candidate {
            id: "a",
            background_since: Some(0),
            never_hibernate: false,
            in_active_workspace: true,
        }];
        for minutes in [1, 7, u32::MAX] {
            let settings = Settings {
                after_minutes: minutes,
                inactive_workspaces: true,
            };
            assert!(
                due_for_hibernation(u64::MAX, settings, None, &HashSet::new(), &candidates)
                    .is_empty()
            );
        }
    }
}
