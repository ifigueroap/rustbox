//! Portable configuration only. This module never accesses sessions or webviews.
use crate::config::{self, Config};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

pub const MAX_DOCUMENT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub format: String,
    pub version: u32,
    pub app_version: String,
    pub config: Config,
    pub icons: BTreeMap<String, Vec<u8>>,
}

pub fn tokens(config: &Config) -> impl Iterator<Item = &str> {
    config
        .services
        .iter()
        .filter_map(|s| s.icon.as_deref())
        .chain(config.workspaces.iter().filter_map(|w| w.icon.as_deref()))
        .filter(|s| s.starts_with("local:"))
}

pub fn build(
    config: Config,
    app_version: String,
    icons: BTreeMap<String, Vec<u8>>,
) -> Result<Document, String> {
    let doc = Document {
        format: "rustbox-config".into(),
        version: 1,
        app_version,
        config,
        icons,
    };
    validate(&doc)?;
    Ok(doc)
}

pub fn parse(bytes: &[u8]) -> Result<Document, String> {
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err("size".into());
    }
    let raw: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| "shape")?;
    if !raw
        .get("config")
        .and_then(|c| c.get("services"))
        .is_some_and(|s| s.is_array())
    {
        return Err("shape".into());
    }
    let doc: Document = serde_json::from_value(raw).map_err(|_| "shape")?;
    validate(&doc)?;
    Ok(doc)
}

fn validate(doc: &Document) -> Result<(), String> {
    if doc.format != "rustbox-config" {
        return Err("shape".into());
    }
    if doc.version != 1
        || doc.config.version != 1
        || doc.config.schema_version > config::CONFIG_SCHEMA_VERSION
    {
        return Err("version".into());
    }
    let c = &doc.config;
    if c.workspaces.len() > config::MAX_WORKSPACES {
        return Err("workspaces".into());
    }
    for ids in [
        c.services.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        c.workspaces.iter().map(|w| w.id.as_str()).collect(),
    ] {
        let mut seen = HashSet::new();
        for id in ids {
            if uuid::Uuid::parse_str(id).is_err() || !seen.insert(id) {
                return Err("id".into());
            }
        }
    }
    for s in &c.services {
        let url = url::Url::parse(&s.url).map_err(|_| "url")?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err("url".into());
        }
        config::normalize_service_url(&s.url).map_err(|_| "url")?;
        config::normalize_icon(s.icon.as_deref()).map_err(|_| "icon")?;
        config::normalize_user_agent(s.user_agent.as_deref()).map_err(|_| "userAgent")?;
        if s.name.trim().is_empty() || s.name.trim().chars().count() > 80 {
            return Err("name".into());
        }
        if s.workspaces
            .iter()
            .any(|id| !c.workspaces.iter().any(|w| &w.id == id))
        {
            return Err("membership".into());
        }
    }
    for w in &c.workspaces {
        config::normalize_icon(w.icon.as_deref()).map_err(|_| "icon")?;
        if w.name.trim().is_empty() || w.name.trim().chars().count() > 80 {
            return Err("name".into());
        }
    }
    for token in tokens(c) {
        if !doc.icons.contains_key(token) {
            return Err("icon".into());
        }
    }
    for (token, bytes) in &doc.icons {
        let filename = config::local_icon_filename(token).ok_or("icon")?;
        config::accept_icon_bytes(bytes, filename.rsplit_once('.').ok_or("icon")?.1)
            .map_err(|_| "icon")?;
    }
    Ok(())
}

pub fn compute(current: &Config, imported: &Config, replace: bool) -> Result<Config, String> {
    let mut result = if replace {
        imported.clone()
    } else {
        current.clone()
    };
    if !replace {
        for w in &imported.workspaces {
            if !result.workspaces.iter().any(|x| x.id == w.id) {
                result.workspaces.push(w.clone());
            }
        }
        for s in &imported.services {
            if !result.services.iter().any(|x| x.id == s.id) {
                result.services.push(s.clone());
            }
        }
    }
    if result.workspaces.len() > config::MAX_WORKSPACES {
        return Err("workspaces".into());
    }
    result.normalize();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn populated() -> Config {
        let mut c = Config::default();
        c.add_preset("telegram", None).unwrap();
        c
    }
    fn document(c: Config) -> Document {
        build(c, "test".into(), BTreeMap::new()).unwrap()
    }
    #[test]
    fn merge_by_id_keeps_current_objects_and_globals() {
        let current = populated();
        let mut imported = current.clone();
        imported.services[0].name = "Changed".into();
        imported.workspaces[0].name = "Changed".into();
        imported.do_not_disturb = true;
        let merged = compute(&current, &imported, false).unwrap();
        assert_eq!(merged, current);
    }
    #[test]
    fn merge_keeps_new_workspace_references() {
        let current = populated();
        let imported = populated();
        let merged = compute(&current, &imported, false).unwrap();
        assert_eq!(merged.services.len(), 2);
        assert_eq!(merged.workspaces.len(), 2);
        assert_eq!(
            merged.services[1].workspaces,
            imported.services[0].workspaces
        );
    }
    #[test]
    fn replace_restores_configuration() {
        let current = populated();
        let mut imported = populated();
        imported.do_not_disturb = true;
        assert_eq!(compute(&current, &imported, true).unwrap(), imported);
    }
    #[test]
    fn backups_keep_combined_service_and_global_preferences() {
        let current = populated();
        let mut imported = populated();
        imported.services[0].zoom = 1.25;
        imported.services[0].media_permission = crate::config::MediaPermission::Deny;
        imported.services[0].spellcheck_enabled = Some(false);
        imported.services[0].never_hibernate = true;
        imported.start_at_login = true;
        imported.start_hidden = true;
        imported.hibernate_after_minutes = 15;
        imported.hibernate_inactive_workspaces = true;
        imported.dnd_schedule = serde_json::from_value(serde_json::json!({
            "enabled": true,
            "rules": [{ "days": ["fri"], "startMinute": 1140, "endMinute": 480 }]
        }))
        .unwrap();
        imported.workspaces[0].dnd_schedule = imported.dnd_schedule.clone();

        let exported = document(imported.clone());
        let restored = parse(&serde_json::to_vec(&exported).unwrap()).unwrap();
        assert_eq!(restored.config, imported);
        assert_eq!(compute(&current, &restored.config, true).unwrap(), imported);

        let merged = compute(&current, &restored.config, false).unwrap();
        assert_eq!(merged.services[0], current.services[0]);
        assert_eq!(merged.services[1], imported.services[0]);
        assert_eq!(merged.workspaces[1].id, imported.workspaces[0].id);
        assert_eq!(merged.workspaces[1].dnd_schedule, imported.workspaces[0].dnd_schedule);
        assert_eq!(merged.start_at_login, current.start_at_login);
        assert_eq!(merged.start_hidden, current.start_hidden);
        assert_eq!(merged.hibernate_after_minutes, current.hibernate_after_minutes);
        assert_eq!(merged.hibernate_inactive_workspaces, current.hibernate_inactive_workspaces);
        assert_eq!(merged.dnd_schedule, current.dnd_schedule);
    }

    #[test]
    fn invalid_files_and_old_versions_are_rejected() {
        assert_eq!(parse(b"{}").err().as_deref(), Some("shape"));
        assert_eq!(parse(b"not json").err().as_deref(), Some("shape"));
        for version in [0, 2] {
            let mut doc = document(populated());
            doc.version = version;
            assert_eq!(parse(&serde_json::to_vec(&doc).unwrap()).err().as_deref(), Some("version"));
        }
        let mut doc = document(populated());
        doc.format = "other".into();
        assert_eq!(parse(&serde_json::to_vec(&doc).unwrap()).err().as_deref(), Some("shape"));
    }
    #[test]
    fn validates_urls_ids_and_memberships() {
        for url in [
            "file:///tmp/a",
            "javascript:bad",
            "ftp://example.org",
            "invalid",
        ] {
            let mut doc = document(populated());
            doc.config.services[0].url = url.into();
            assert!(parse(&serde_json::to_vec(&doc).unwrap()).is_err());
        }
        let mut doc = document(populated());
        doc.config.services.push(doc.config.services[0].clone());
        assert!(parse(&serde_json::to_vec(&doc).unwrap()).is_err());
        doc.config.services.pop();
        doc.config.services[0].workspaces = vec!["missing".into()];
        assert!(parse(&serde_json::to_vec(&doc).unwrap()).is_err());
    }
    #[test]
    fn icon_roundtrip_and_missing_or_unsafe_icon_rejection() {
        let mut c = populated();
        let token = format!("local:{}.png", uuid::Uuid::new_v4());
        c.services[0].icon = Some(token.clone());
        c.workspaces[0].icon = Some(token.clone());
        let bytes = vec![137, 80, 78, 71, 13, 10, 26, 10];
        let mut icons = BTreeMap::new();
        icons.insert(token.clone(), bytes.clone());
        let doc = build(c, "test".into(), icons).unwrap();
        let mut restored = parse(&serde_json::to_vec(&doc).unwrap()).unwrap();
        assert_eq!(restored.icons[&token], bytes);
        assert_eq!(restored.config, doc.config);
        restored.icons.clear();
        assert_eq!(validate(&restored).err().as_deref(), Some("icon"));
        restored.icons.insert("local:../private.png".into(), bytes);
        assert_eq!(validate(&restored).err().as_deref(), Some("icon"));
    }
    #[test]
    fn export_has_no_session_fields() {
        let value = serde_json::to_value(document(populated())).unwrap();
        assert!(value.get("sessions").is_none());
        let json = value.to_string();
        for key in [
            "cookies",
            "localStorage",
            "cache",
            "sessionsDir",
            "configPath",
        ] {
            assert!(!json.contains(key));
        }
    }
    #[test]
    fn old_config_loads_unchanged() {
        let c: Config = serde_json::from_str(r#"{"version":1,"services":[]}"#).unwrap();
        assert!(c.services.is_empty());
        assert!(c.updates.auto_check);
        assert!(!c.do_not_disturb);
        let mut doc = document(c);
        doc.config.normalize();
        assert_eq!(doc.config.workspaces.len(), 1);
    }
    #[test]
    fn merge_workspace_limit_is_checked() {
        let c = Config::default();
        let mut imported = Config::default();
        imported.workspaces = (0..config::MAX_WORKSPACES)
            .map(|_| Config::default().workspaces.remove(0))
            .collect();
        assert!(compute(&c, &imported, false).is_err());
    }
}
