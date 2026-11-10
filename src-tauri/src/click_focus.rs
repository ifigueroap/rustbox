//! Pure decision logic for a notification click: which workspace should
//! become active so the service the notification came from is visible.
//! Kept dependency-light so it can be unit tested on its own.

/// Chooses the workspace to activate for a service that was just clicked
/// from a notification.
///
/// `service_workspace_ids` lists, in sidebar/rail order, the ids of the
/// workspaces that currently list the service (a service pinned to all
/// workspaces should already be expanded to every workspace id by the
/// caller). Keeps the active workspace when the service already belongs to
/// it; otherwise switches to the first workspace that lists it. Returns
/// `None` when the service is not listed anywhere, which should not happen
/// for a service that still exists, since the app requires every service to
/// belong to at least one workspace or be pinned to all of them.
pub fn workspace_for_click(
    active_workspace_id: Option<&str>,
    service_workspace_ids: &[String],
) -> Option<String> {
    if let Some(active) = active_workspace_id
        && service_workspace_ids.iter().any(|id| id == active)
    {
        return Some(active.to_string());
    }
    service_workspace_ids.first().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn keeps_the_active_workspace_when_it_already_lists_the_service() {
        let candidates = ids(&["work", "personal"]);
        assert_eq!(
            workspace_for_click(Some("personal"), &candidates),
            Some("personal".to_string())
        );
    }

    #[test]
    fn switches_to_the_first_listing_workspace_when_the_active_one_does_not_have_it() {
        let candidates = ids(&["work", "personal"]);
        assert_eq!(
            workspace_for_click(Some("teaching"), &candidates),
            Some("work".to_string())
        );
    }

    #[test]
    fn switches_when_no_workspace_is_active_yet() {
        let candidates = ids(&["work"]);
        assert_eq!(
            workspace_for_click(None, &candidates),
            Some("work".to_string())
        );
    }

    #[test]
    fn has_nothing_to_switch_to_when_the_service_lists_no_workspace() {
        assert_eq!(workspace_for_click(Some("work"), &[]), None);
        assert_eq!(workspace_for_click(None, &[]), None);
    }

    #[test]
    fn a_service_pinned_to_every_workspace_keeps_whichever_one_is_active() {
        // The caller expands "pinned to all" to every workspace id before
        // calling this function, so the active one is always a candidate.
        let candidates = ids(&["work", "personal", "teaching"]);
        assert_eq!(
            workspace_for_click(Some("teaching"), &candidates),
            Some("teaching".to_string())
        );
    }
}
