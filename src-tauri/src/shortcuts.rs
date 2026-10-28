/// A keyboard chord that changes which service is showing.
///
/// The shell and each service webview report the same key, and this module
/// decides what it means. Nothing here is stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceShortcut {
    /// Zero-based position in the current sidebar order. `0` is Ctrl/Cmd+1.
    OpenIndex(usize),
    Next,
    Previous,
    Desk,
}

/// A chord that changes which workspace is showing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceShortcut {
    /// Zero-based position in the rail. `0` is Ctrl/Cmd+Alt+1.
    OpenIndex(usize),
}

/// Where that chord should land, given how many services exist and which
/// one is open. `None` means the chord does not change anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShortcutDestination {
    Service(usize),
    Desk,
}

/// `key` is a DOM `KeyboardEvent.key` value, such as `"1"`, `"Tab"`, or `"d"`.
pub fn parse_service_shortcut(
    key: &str,
    ctrl_or_meta: bool,
    shift: bool,
    alt: bool,
) -> Option<ServiceShortcut> {
    if !ctrl_or_meta || alt {
        return None;
    }
    let key = key.trim();
    if key.eq_ignore_ascii_case("tab") {
        return Some(if shift {
            ServiceShortcut::Previous
        } else {
            ServiceShortcut::Next
        });
    }
    if shift && key.eq_ignore_ascii_case("d") {
        return Some(ServiceShortcut::Desk);
    }
    if shift || key.chars().count() != 1 {
        return None;
    }
    let digit = key.chars().next()?;
    if !('1'..='9').contains(&digit) {
        return None;
    }
    Some(ServiceShortcut::OpenIndex((digit as u8 - b'1') as usize))
}

/// Ctrl/Cmd+Alt+1 … 9 selects a workspace by rail position.
pub fn parse_workspace_shortcut(
    key: &str,
    ctrl_or_meta: bool,
    shift: bool,
    alt: bool,
) -> Option<WorkspaceShortcut> {
    if !ctrl_or_meta || !alt || shift {
        return None;
    }
    let key = key.trim();
    if key.chars().count() != 1 {
        return None;
    }
    let digit = key.chars().next()?;
    if !('1'..='9').contains(&digit) {
        return None;
    }
    Some(WorkspaceShortcut::OpenIndex((digit as u8 - b'1') as usize))
}

pub fn shortcut_destination(
    service_count: usize,
    active_index: Option<usize>,
    shortcut: ServiceShortcut,
) -> Option<ShortcutDestination> {
    let active_index = active_index.filter(|index| *index < service_count);
    match shortcut {
        ServiceShortcut::Desk => Some(ShortcutDestination::Desk),
        ServiceShortcut::OpenIndex(index) if index < service_count => {
            Some(ShortcutDestination::Service(index))
        }
        ServiceShortcut::OpenIndex(_) => None,
        ServiceShortcut::Next | ServiceShortcut::Previous if service_count == 0 => None,
        ServiceShortcut::Next => {
            let index = match active_index {
                Some(index) => (index + 1) % service_count,
                None => 0,
            };
            Some(ShortcutDestination::Service(index))
        }
        ServiceShortcut::Previous => {
            let index = match active_index {
                Some(index) => (index + service_count - 1) % service_count,
                None => service_count - 1,
            };
            Some(ShortcutDestination::Service(index))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_keys_follow_sidebar_order() {
        assert_eq!(
            parse_service_shortcut("1", true, false, false),
            Some(ServiceShortcut::OpenIndex(0))
        );
        assert_eq!(
            parse_service_shortcut("9", true, false, false),
            Some(ServiceShortcut::OpenIndex(8))
        );
        assert_eq!(parse_service_shortcut("0", true, false, false), None);
        assert_eq!(parse_service_shortcut("1", true, true, false), None);
        assert_eq!(parse_service_shortcut("1", false, false, false), None);
        assert_eq!(parse_service_shortcut("1", true, false, true), None);
        assert_eq!(
            shortcut_destination(3, Some(2), ServiceShortcut::OpenIndex(0)),
            Some(ShortcutDestination::Service(0))
        );
        assert_eq!(
            shortcut_destination(3, None, ServiceShortcut::OpenIndex(8)),
            None
        );
    }

    #[test]
    fn tab_cycles_and_wraps_using_the_current_order() {
        assert_eq!(
            parse_service_shortcut("Tab", true, false, false),
            Some(ServiceShortcut::Next)
        );
        assert_eq!(
            parse_service_shortcut("Tab", true, true, false),
            Some(ServiceShortcut::Previous)
        );
        assert_eq!(
            shortcut_destination(3, Some(1), ServiceShortcut::Next),
            Some(ShortcutDestination::Service(2))
        );
        assert_eq!(
            shortcut_destination(3, Some(2), ServiceShortcut::Next),
            Some(ShortcutDestination::Service(0))
        );
        assert_eq!(
            shortcut_destination(3, Some(0), ServiceShortcut::Previous),
            Some(ShortcutDestination::Service(2))
        );
        assert_eq!(
            shortcut_destination(3, None, ServiceShortcut::Next),
            Some(ShortcutDestination::Service(0))
        );
        assert_eq!(
            shortcut_destination(3, None, ServiceShortcut::Previous),
            Some(ShortcutDestination::Service(2))
        );
        assert_eq!(shortcut_destination(0, None, ServiceShortcut::Next), None);
    }

    #[test]
    fn shift_d_opens_the_desk() {
        assert_eq!(
            parse_service_shortcut("d", true, true, false),
            Some(ServiceShortcut::Desk)
        );
        assert_eq!(
            parse_service_shortcut("D", true, true, false),
            Some(ServiceShortcut::Desk)
        );
        assert_eq!(parse_service_shortcut("d", true, false, false), None);
        assert_eq!(
            shortcut_destination(4, Some(1), ServiceShortcut::Desk),
            Some(ShortcutDestination::Desk)
        );
        assert_eq!(
            shortcut_destination(0, None, ServiceShortcut::Desk),
            Some(ShortcutDestination::Desk)
        );
    }

    #[test]
    fn alt_numbers_switch_workspaces_and_plain_numbers_do_not() {
        assert_eq!(
            parse_workspace_shortcut("1", true, false, true),
            Some(WorkspaceShortcut::OpenIndex(0))
        );
        assert_eq!(
            parse_workspace_shortcut("9", true, false, true),
            Some(WorkspaceShortcut::OpenIndex(8))
        );
        assert_eq!(parse_workspace_shortcut("1", true, false, false), None);
        assert_eq!(parse_workspace_shortcut("1", true, true, true), None);
        assert_eq!(parse_workspace_shortcut("0", true, false, true), None);
        assert_eq!(parse_workspace_shortcut("Tab", true, false, true), None);
        assert_eq!(
            parse_service_shortcut("1", true, false, true),
            None,
            "a workspace chord must not also open a service"
        );
    }
}
