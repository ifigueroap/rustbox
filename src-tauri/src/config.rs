//! Service list persisted as pretty JSON in the app config directory.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use url::Url;
use uuid::Uuid;

use crate::presets;

pub const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub preset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub active_id: Option<String>,
    #[serde(default)]
    pub services: Vec<Service>,
}

fn default_version() -> u32 {
    CONFIG_VERSION
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            active_id: None,
            services: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewService {
    pub name: Option<String>,
    pub url: Option<String>,
    pub icon: Option<String>,
    pub user_agent: Option<String>,
    pub preset: Option<String>,
}

impl Config {
    pub fn load(path: &Path) -> Self {
        let text = match fs::read_to_string(path) {
            Ok(text) => text,
            Err(_) => return Self::default(),
        };
        match serde_json::from_str::<Config>(&text) {
            Ok(mut config) => {
                config.sanitize();
                config
            }
            Err(err) => {
                let backup = path.with_extension("json.bak");
                let _ = fs::copy(path, &backup);
                eprintln!(
                    "rustbox config at {} is invalid ({err}); backed it up to {} and starting fresh",
                    path.display(),
                    backup.display()
                );
                Self::default()
            }
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Could not create {}: {err}", parent.display()))?;
        }
        let mut stored = self.clone();
        stored.version = CONFIG_VERSION;
        let bytes = serde_json::to_vec_pretty(&stored).map_err(|err| err.to_string())?;
        atomic_write(path, &bytes)
    }

    pub fn sanitize(&mut self) {
        let mut seen = Vec::new();
        self.services.retain(|service| {
            if !valid_id(&service.id) || Url::parse(&service.url).is_err() {
                return false;
            }
            if seen.iter().any(|id: &String| id == &service.id) {
                return false;
            }
            seen.push(service.id.clone());
            true
        });
        if self
            .active_id
            .as_ref()
            .is_some_and(|id| !self.services.iter().any(|service| &service.id == id))
        {
            self.active_id = None;
        }
    }

    pub fn add(&mut self, draft: NewService) -> Result<Service, String> {
        let preset = match draft
            .preset
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
        {
            Some(id) => Some(
                presets::find(id)
                    .ok_or_else(|| format!("Unknown preset \"{id}\"."))?
                    .id
                    .to_string(),
            ),
            None => None,
        };
        let preset_def = preset.as_deref().and_then(presets::find);
        let name = match draft.name {
            Some(name) if !name.trim().is_empty() => normalize_name(&name)?,
            _ => preset_def
                .map(|preset| preset.name.to_string())
                .ok_or_else(|| "Give the service a name.".to_string())?,
        };
        let url = match draft
            .url
            .map(|url| url.trim().to_string())
            .filter(|url| !url.is_empty())
        {
            Some(url) => normalize_url(&url)?,
            None => preset_def
                .and_then(|preset| preset.url)
                .map(|url| url.to_string())
                .ok_or_else(|| match preset.as_deref() {
                    Some("zulip") => "Zulip needs your server URL.".to_string(),
                    _ => "Enter a service URL.".to_string(),
                })?,
        };
        let service = Service {
            id: Uuid::new_v4().to_string(),
            name,
            url,
            icon: normalize_icon(draft.icon)?,
            user_agent: normalize_user_agent(draft.user_agent)?,
            preset,
        };
        self.services.push(service.clone());
        Ok(service)
    }

    pub fn update(
        &mut self,
        id: &str,
        name: String,
        url: String,
        icon: Option<String>,
        user_agent: Option<String>,
    ) -> Result<bool, String> {
        let service = self
            .services
            .iter_mut()
            .find(|service| service.id == id)
            .ok_or_else(|| "That service is no longer in the sidebar.".to_string())?;
        let name = normalize_name(&name)?;
        let url = normalize_url(&url)?;
        let icon = normalize_icon(icon)?;
        let user_agent = normalize_user_agent(user_agent)?;
        let recreate = service.url != url || service.user_agent != user_agent;
        service.name = name;
        service.url = url;
        service.icon = icon;
        service.user_agent = user_agent;
        Ok(recreate)
    }

    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        let index = self
            .services
            .iter()
            .position(|service| service.id == id)
            .ok_or_else(|| "That service is no longer in the sidebar.".to_string())?;
        self.services.remove(index);
        if self.active_id.as_deref() == Some(id) {
            self.active_id = self
                .services
                .get(index)
                .or_else(|| self.services.last())
                .map(|service| service.id.clone());
        }
        Ok(())
    }

    pub fn reorder(&mut self, ids: &[String]) -> Result<(), String> {
        if ids.len() != self.services.len() {
            return Err("Reorder must include every service exactly once.".into());
        }
        let mut next = Vec::with_capacity(ids.len());
        for id in ids {
            if next.iter().any(|service: &Service| &service.id == id) {
                return Err("Reorder listed a service twice.".into());
            }
            let service = self
                .services
                .iter()
                .find(|service| &service.id == id)
                .cloned()
                .ok_or_else(|| "Reorder listed an unknown service.".to_string())?;
            next.push(service);
        }
        self.services = next;
        Ok(())
    }
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

pub fn service_data_dir(data_dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Invalid service id.".into());
    }
    Ok(data_dir.join("services").join(id))
}

fn normalize_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    let count = name.chars().count();
    if count == 0 || count > 60 {
        return Err("Name should be 1–60 characters.".into());
    }
    Ok(name.to_string())
}

fn normalize_url(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.len() > 2048 {
        return Err("URL is too long.".into());
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&with_scheme).map_err(|_| "Enter a valid http(s) URL.".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Only http and https services are supported.".into());
    }
    if url.host_str().is_none() {
        return Err("URL needs a host.".into());
    }
    Ok(url.to_string())
}

fn normalize_icon(icon: Option<String>) -> Result<Option<String>, String> {
    let Some(icon) = icon else {
        return Ok(None);
    };
    let icon = icon.trim();
    if icon.is_empty() {
        return Ok(None);
    }
    if icon.contains("://") {
        let url = Url::parse(icon).map_err(|_| "Icon URL is invalid.".to_string())?;
        if url.scheme() != "http" && url.scheme() != "https" {
            return Err("Icon URL must be http or https.".into());
        }
        return Ok(Some(url.to_string()));
    }
    if icon.chars().count() > 8 {
        return Err("Icon should be an emoji, a short monogram, or an image URL.".into());
    }
    Ok(Some(icon.to_string()))
}

fn normalize_user_agent(user_agent: Option<String>) -> Result<Option<String>, String> {
    let Some(user_agent) = user_agent else {
        return Ok(None);
    };
    let user_agent = user_agent.trim();
    if user_agent.is_empty() {
        return Ok(None);
    }
    if user_agent.len() > 400 {
        return Err("User agent is too long.".into());
    }
    if user_agent.chars().any(|ch| ch.is_control()) {
        return Err("User agent cannot contain control characters.".into());
    }
    Ok(Some(user_agent.to_string()))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, bytes).map_err(|err| format!("Could not write {}: {err}", tmp.display()))?;
    if fs::rename(&tmp, path).is_err() {
        // Windows refuses to rename over a file that already exists.
        if path.exists() {
            fs::remove_file(path)
                .map_err(|err| format!("Could not replace {}: {err}", path.display()))?;
        }
        fs::rename(&tmp, path)
            .map_err(|err| format!("Could not save {}: {err}", path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(name: &str, url: &str) -> NewService {
        NewService {
            name: Some(name.into()),
            url: Some(url.into()),
            icon: None,
            user_agent: None,
            preset: None,
        }
    }

    #[test]
    fn preset_and_custom_services_round_trip() {
        let dir = std::env::temp_dir().join(format!("rustbox-config-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let mut config = Config::default();
        let whatsapp = config
            .add(NewService {
                name: None,
                url: None,
                icon: None,
                user_agent: Some("  ".into()),
                preset: Some("whatsapp".into()),
            })
            .unwrap();
        assert_eq!(whatsapp.name, "WhatsApp");
        assert!(whatsapp.url.contains("web.whatsapp.com"));
        assert_eq!(whatsapp.preset.as_deref(), Some("whatsapp"));
        assert!(whatsapp.user_agent.is_none());

        let zulip_err = config
            .add(NewService {
                name: None,
                url: None,
                icon: None,
                user_agent: None,
                preset: Some("zulip".into()),
            })
            .unwrap_err();
        assert!(zulip_err.contains("server URL"));

        let custom = config.add(sample("Notes", "notes.example.com")).unwrap();
        assert_eq!(custom.url, "https://notes.example.com/");
        config.active_id = Some(custom.id.clone());
        config.save(&path).unwrap();

        let loaded = Config::load(&path);
        assert_eq!(loaded.services.len(), 2);
        assert_eq!(loaded.active_id.as_deref(), Some(custom.id.as_str()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reorder_remove_and_rejects_bad_urls() {
        let mut config = Config::default();
        let first = config.add(sample("One", "https://one.example")).unwrap();
        let second = config.add(sample("Two", "https://two.example")).unwrap();
        config
            .reorder(&[second.id.clone(), first.id.clone()])
            .unwrap();
        assert_eq!(config.services[0].id, second.id);
        assert!(config.reorder(std::slice::from_ref(&first.id)).is_err());

        config.active_id = Some(second.id.clone());
        config.remove(&second.id).unwrap();
        assert_eq!(config.active_id.as_deref(), Some(first.id.as_str()));
        assert!(config.add(sample("Bad", "javascript:alert(1)")).is_err());
        assert!(config
            .add(NewService {
                name: Some("X".into()),
                url: Some("https://example.com".into()),
                icon: Some("javascript:alert(1)".into()),
                user_agent: None,
                preset: None,
            })
            .is_err());
    }

    #[test]
    fn corrupt_config_is_replaced_with_empty() {
        let dir = std::env::temp_dir().join(format!("rustbox-config-bad-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        fs::write(&path, "{not json").unwrap();
        let loaded = Config::load(&path);
        assert!(loaded.services.is_empty());
        assert!(dir.join("config.json.bak").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
