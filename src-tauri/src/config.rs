use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use url::Url;

use crate::policy::effective_user_agent;

fn default_version() -> u32 {
    1
}

fn default_true() -> bool {
    true
}

fn default_color() -> String {
    "#8d8478".to_string()
}

#[derive(Debug, Clone, Copy)]
pub struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    pub url: Option<&'static str>,
    pub color: &'static str,
    pub requires_server_url: bool,
    pub url_hint: &'static str,
}

pub const PRESETS: &[Preset] = &[
    Preset {
        id: "whatsapp",
        name: "WhatsApp",
        url: Some("https://web.whatsapp.com/"),
        color: "#25D366",
        requires_server_url: false,
        url_hint: "https://web.whatsapp.com/",
    },
    Preset {
        id: "slack",
        name: "Slack",
        url: Some("https://app.slack.com/"),
        color: "#4A154B",
        requires_server_url: false,
        url_hint: "https://app.slack.com/",
    },
    Preset {
        id: "discord",
        name: "Discord",
        url: Some("https://discord.com/app"),
        color: "#5865F2",
        requires_server_url: false,
        url_hint: "https://discord.com/app",
    },
    Preset {
        id: "zulip",
        name: "Zulip",
        url: None,
        color: "#3AA88A",
        requires_server_url: true,
        url_hint: "https://your-org.zulipchat.com",
    },
    Preset {
        id: "telegram",
        name: "Telegram",
        url: Some("https://web.telegram.org/a/"),
        color: "#2AABEE",
        requires_server_url: false,
        url_hint: "https://web.telegram.org/a/",
    },
    Preset {
        id: "grok",
        name: "Grok",
        url: Some("https://grok.com/"),
        color: "#111111",
        requires_server_url: false,
        url_hint: "https://grok.com/",
    },
    Preset {
        id: "chatgpt",
        name: "ChatGPT",
        url: Some("https://chatgpt.com/"),
        color: "#10A37F",
        requires_server_url: false,
        url_hint: "https://chatgpt.com/",
    },
    Preset {
        id: "claude",
        name: "Claude",
        url: Some("https://claude.ai/"),
        color: "#D97757",
        requires_server_url: false,
        url_hint: "https://claude.ai/",
    },
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default = "default_true")]
    pub use_chrome_user_agent: bool,
    #[serde(default)]
    pub preset: Option<String>,
}

impl Service {
    pub fn resolved_user_agent(&self) -> Option<String> {
        effective_user_agent(self.use_chrome_user_agent, self.user_agent.as_deref())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub services: Vec<Service>,
    /// When true the sidebar is the icon rail. Names stay available as tooltips.
    #[serde(default)]
    pub sidebar_collapsed: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            services: Vec::new(),
            sidebar_collapsed: false,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewService {
    pub name: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default = "default_true")]
    pub use_chrome_user_agent: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceUpdate {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default = "default_true")]
    pub use_chrome_user_agent: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetInfo {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
    pub color: String,
    pub requires_server_url: bool,
    pub url_hint: String,
}

impl From<&Preset> for PresetInfo {
    fn from(preset: &Preset) -> Self {
        Self {
            id: preset.id.to_string(),
            name: preset.name.to_string(),
            url: preset.url.map(str::to_string),
            color: preset.color.to_string(),
            requires_server_url: preset.requires_server_url,
            url_hint: preset.url_hint.to_string(),
        }
    }
}

impl Config {
    pub fn load_or_default(path: &Path) -> Self {
        match read_config(path) {
            ConfigRead::Missing => Self::default(),
            ConfigRead::Loaded(config) => config,
            ConfigRead::Unreadable(err) => {
                eprintln!("rustbox: could not read {}: {err}", path.display());
                Self::default()
            }
            ConfigRead::Invalid(err) => {
                eprintln!("rustbox: invalid config at {}: {err}", path.display());
                move_aside(path);
                Self::default()
            }
        }
    }

    /// Use `current` when that file exists, even if it lists no services.
    /// Otherwise copy a readable config from the previous bundle id into
    /// `current` and return it. The legacy file is not renamed or deleted.
    pub fn load_adopting_legacy(current: &Path, legacy: &Path) -> (Self, bool) {
        if current.is_file() {
            return (Self::load_or_default(current), false);
        }
        match read_config(legacy) {
            ConfigRead::Loaded(config) => {
                if let Err(err) = config.save(current) {
                    eprintln!(
                        "rustbox: imported config from {} but could not write {}: {err}",
                        legacy.display(),
                        current.display()
                    );
                } else {
                    eprintln!(
                        "rustbox: imported {} service(s) from {}",
                        config.services.len(),
                        legacy.display()
                    );
                }
                (config, true)
            }
            ConfigRead::Missing => (Self::default(), false),
            ConfigRead::Unreadable(err) => {
                eprintln!(
                    "rustbox: leaving {} in place; could not read it ({err})",
                    legacy.display()
                );
                (Self::default(), false)
            }
            ConfigRead::Invalid(err) => {
                eprintln!(
                    "rustbox: leaving {} in place; could not parse it ({err})",
                    legacy.display()
                );
                (Self::default(), false)
            }
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|err| err.to_string())?;
        let temporary = path.with_extension("json.tmp");
        std::fs::write(&temporary, json).map_err(|err| err.to_string())?;
        std::fs::rename(&temporary, path).map_err(|err| err.to_string())?;
        Ok(())
    }

    pub fn add_preset(
        &mut self,
        preset_id: &str,
        server_url: Option<&str>,
    ) -> Result<Service, String> {
        let preset = PRESETS
            .iter()
            .find(|preset| preset.id == preset_id)
            .ok_or_else(|| format!("unknown preset {preset_id}"))?;
        let url = if preset.requires_server_url {
            let raw = server_url.unwrap_or("").trim();
            if raw.is_empty() {
                return Err(format!("{} needs your server URL", preset.name));
            }
            normalize_service_url(raw)?
        } else {
            preset
                .url
                .ok_or_else(|| format!("{} has no URL", preset.name))?
                .to_string()
        };
        let service = Service {
            id: new_id(),
            name: unique_name(self, preset.name),
            url,
            icon: None,
            color: preset.color.to_string(),
            user_agent: None,
            use_chrome_user_agent: true,
            preset: Some(preset.id.to_string()),
        };
        self.services.push(service.clone());
        Ok(service)
    }

    pub fn add_custom(&mut self, input: NewService) -> Result<Service, String> {
        let service = Service {
            id: new_id(),
            name: normalize_name(&input.name)?,
            url: normalize_service_url(&input.url)?,
            icon: normalize_icon(input.icon.as_deref())?,
            color: normalize_color(input.color.as_deref()),
            user_agent: normalize_user_agent(input.user_agent.as_deref())?,
            use_chrome_user_agent: input.use_chrome_user_agent,
            preset: None,
        };
        self.services.push(service.clone());
        Ok(service)
    }

    pub fn update_service(&mut self, input: ServiceUpdate) -> Result<bool, String> {
        let name = normalize_name(&input.name)?;
        let url = normalize_service_url(&input.url)?;
        let icon = normalize_icon(input.icon.as_deref())?;
        let color = normalize_color(input.color.as_deref());
        let user_agent = normalize_user_agent(input.user_agent.as_deref())?;
        let service = self
            .services
            .iter_mut()
            .find(|service| service.id == input.id)
            .ok_or_else(|| "service not found".to_string())?;
        let reload = service.url != url
            || service.user_agent != user_agent
            || service.use_chrome_user_agent != input.use_chrome_user_agent;
        service.name = name;
        service.url = url;
        service.icon = icon;
        service.color = color;
        service.user_agent = user_agent;
        service.use_chrome_user_agent = input.use_chrome_user_agent;
        Ok(reload)
    }

    pub fn remove_service(&mut self, id: &str) -> Result<Service, String> {
        let index = self
            .services
            .iter()
            .position(|service| service.id == id)
            .ok_or_else(|| "service not found".to_string())?;
        Ok(self.services.remove(index))
    }

    pub fn reorder(&mut self, ids: &[String]) -> Result<(), String> {
        if ids.len() != self.services.len() {
            return Err("reorder must include every service exactly once".into());
        }
        let mut next = Vec::with_capacity(ids.len());
        for id in ids {
            if next.iter().any(|service: &Service| &service.id == id) {
                return Err(format!("duplicate service {id}"));
            }
            let service = self
                .services
                .iter()
                .find(|service| &service.id == id)
                .cloned()
                .ok_or_else(|| format!("unknown service {id}"))?;
            next.push(service);
        }
        self.services = next;
        Ok(())
    }
}

pub fn normalize_service_url(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("enter an http(s) URL".into());
    }
    let with_scheme = if raw.starts_with("http://") || raw.starts_with("https://") {
        raw.to_string()
    } else if raw.contains(' ') {
        return Err("enter an http(s) URL".into());
    } else {
        format!("https://{raw}")
    };
    let url = Url::parse(&with_scheme).map_err(|err| format!("URL: {err}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("only http and https services are supported".into());
    }
    if url.host_str().is_none() {
        return Err("URL needs a host".into());
    }
    Ok(url.to_string())
}

fn normalize_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    let len = name.chars().count();
    if len == 0 || len > 80 {
        return Err("name must be 1–80 characters".into());
    }
    Ok(name.to_string())
}

fn normalize_icon(icon: Option<&str>) -> Result<Option<String>, String> {
    let Some(icon) = icon.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if icon.starts_with("https://") || icon.starts_with("http://") {
        let url = Url::parse(icon).map_err(|err| format!("icon URL: {err}"))?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err("icon URL must be http(s)".into());
        }
        if icon.len() > 500 {
            return Err("icon URL is too long".into());
        }
        return Ok(Some(icon.to_string()));
    }
    if icon.chars().count() > 8 {
        return Err("icon must be an http(s) URL or at most 8 characters".into());
    }
    Ok(Some(icon.to_string()))
}

fn normalize_color(color: Option<&str>) -> String {
    let Some(color) = color.map(str::trim).filter(|value| !value.is_empty()) else {
        return default_color();
    };
    let hex = color.strip_prefix('#').unwrap_or(color);
    if (hex.len() == 6 || hex.len() == 3) && hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        format!("#{hex}")
    } else {
        default_color()
    }
}

fn normalize_user_agent(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if raw.len() > 400 || raw.chars().any(|ch| ch == '\n' || ch == '\r') {
        return Err("user agent must be a single line under 400 characters".into());
    }
    Ok(Some(raw.to_string()))
}

fn unique_name(config: &Config, base: &str) -> String {
    if !config.services.iter().any(|service| service.name == base) {
        return base.to_string();
    }
    for number in 2..100 {
        let candidate = format!("{base} {number}");
        if !config
            .services
            .iter()
            .any(|service| service.name == candidate)
        {
            return candidate;
        }
    }
    format!("{base} {}", new_id())
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

enum ConfigRead {
    Missing,
    Loaded(Config),
    Unreadable(std::io::Error),
    Invalid(String),
}

fn read_config(path: &Path) -> ConfigRead {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return ConfigRead::Missing,
        Err(err) => return ConfigRead::Unreadable(err),
    };
    match serde_json::from_str::<Config>(&text) {
        Ok(config) if config.version == 1 => ConfigRead::Loaded(config),
        Ok(config) => ConfigRead::Invalid(format!("unsupported config version {}", config.version)),
        Err(err) => ConfigRead::Invalid(err.to_string()),
    }
}

fn move_aside(path: &Path) {
    let backup = path.with_extension("json.bak");
    if std::fs::rename(path, &backup).is_ok() {
        eprintln!(
            "rustbox: moved the unreadable config to {}",
            backup.display()
        );
    }
}

/// Bundle id of the first published Rustbox build. Tauri puts config and
/// session data in a directory named after the identifier, so a later build
/// that only looks up `app.rustbox.desktop` never sees those files.
pub const LEGACY_BUNDLE_ID: &str = "com.ifigueroa.rustbox";

pub fn legacy_config_path(current_config_dir: &Path) -> PathBuf {
    sibling_app_dir(current_config_dir).join("config.json")
}

pub fn legacy_data_dir(current_data_dir: &Path) -> PathBuf {
    sibling_app_dir(current_data_dir)
}

fn sibling_app_dir(current_app_dir: &Path) -> PathBuf {
    match current_app_dir.parent() {
        Some(parent) => parent.join(LEGACY_BUNDLE_ID),
        None => Path::new(LEGACY_BUNDLE_ID).to_path_buf(),
    }
}

/// Copy session folders from the previous build's `services/<id>` layout into
/// `sessions/<id>`. Existing destination folders are left alone.
pub fn import_legacy_sessions(legacy_data_dir: &Path, sessions_dir: &Path) -> Result<(), String> {
    let source = legacy_data_dir.join("services");
    if !source.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(sessions_dir).map_err(|err| err.to_string())?;
    for entry in std::fs::read_dir(&source).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let file_type = entry.file_type().map_err(|err| err.to_string())?;
        if !file_type.is_dir() {
            continue;
        }
        let dest = sessions_dir.join(entry.file_name());
        if dest.exists() {
            continue;
        }
        copy_dir(&entry.path(), &dest)?;
    }
    Ok(())
}

fn copy_dir(source: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|err| err.to_string())?;
    for entry in std::fs::read_dir(source).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let file_type = entry.file_type().map_err(|err| err.to_string())?;
        let target = dest.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &target).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_config() -> Config {
        let mut config = Config::default();
        config.add_preset("whatsapp", None).unwrap();
        config.add_preset("whatsapp", None).unwrap();
        config
    }

    #[test]
    fn presets_cover_the_mvp_services() {
        let ids: Vec<_> = PRESETS.iter().map(|preset| preset.id).collect();
        assert_eq!(
            ids,
            [
                "whatsapp", "slack", "discord", "zulip", "telegram", "grok", "chatgpt", "claude"
            ]
        );
        assert!(
            PRESETS
                .iter()
                .any(|preset| preset.id == "zulip" && preset.requires_server_url)
        );
    }

    #[test]
    fn two_presets_get_isolated_ids_and_distinct_names() {
        let config = sample_config();
        assert_eq!(config.services.len(), 2);
        assert_ne!(config.services[0].id, config.services[1].id);
        assert_eq!(config.services[0].name, "WhatsApp");
        assert_eq!(config.services[1].name, "WhatsApp 2");
        assert!(config.services[0].use_chrome_user_agent);
        assert!(
            config.services[0]
                .resolved_user_agent()
                .unwrap()
                .contains("Chrome/155")
        );
    }

    #[test]
    fn zulip_requires_a_server_url() {
        let mut config = Config::default();
        assert!(config.add_preset("zulip", None).is_err());
        let service = config
            .add_preset("zulip", Some("chat.example.com"))
            .unwrap();
        assert_eq!(service.url, "https://chat.example.com/");
    }

    #[test]
    fn custom_services_reject_bad_urls_and_keep_optional_fields() {
        let mut config = Config::default();
        assert!(
            config
                .add_custom(NewService {
                    name: "Notes".into(),
                    url: "not a url".into(),
                    icon: None,
                    color: None,
                    user_agent: None,
                    use_chrome_user_agent: true,
                })
                .is_err()
        );
        let service = config
            .add_custom(NewService {
                name: " Notes ".into(),
                url: "notes.example.com".into(),
                icon: Some("📝".into()),
                color: Some("#abc".into()),
                user_agent: Some("CustomAgent".into()),
                use_chrome_user_agent: true,
            })
            .unwrap();
        assert_eq!(service.name, "Notes");
        assert_eq!(service.url, "https://notes.example.com/");
        assert_eq!(service.icon.as_deref(), Some("📝"));
        assert_eq!(service.color, "#abc");
        assert_eq!(
            service.resolved_user_agent().as_deref(),
            Some("CustomAgent")
        );
    }

    #[test]
    fn reorder_requires_a_permutation() {
        let mut config = sample_config();
        let ids = vec![config.services[1].id.clone(), config.services[0].id.clone()];
        config.reorder(&ids).unwrap();
        assert_eq!(config.services[0].name, "WhatsApp 2");
        assert!(config.reorder(&[ids[0].clone()]).is_err());
    }

    #[test]
    fn config_round_trips_through_disk() {
        let dir = std::env::temp_dir().join(format!("rustbox-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let config = sample_config();
        config.save(&path).unwrap();
        let loaded = Config::load_or_default(&path);
        assert_eq!(loaded, config);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_sidebar_flag_stays_expanded() {
        let config: Config = serde_json::from_str(r#"{"version":1,"services":[]}"#).unwrap();
        assert!(!config.sidebar_collapsed);
    }

    #[test]
    fn invalid_config_is_moved_aside() {
        let dir = std::env::temp_dir().join(format!("rustbox-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        std::fs::write(&path, "{not json").unwrap();
        let loaded = Config::load_or_default(&path);
        assert!(loaded.services.is_empty());
        assert!(dir.join("config.json.bak").is_file());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn previous_bundle_config_keeps_its_services() {
        let json = r#"{
            "version": 1,
            "activeId": "svc-1",
            "services": [{
                "id": "svc-1",
                "name": "WhatsApp",
                "url": "https://web.whatsapp.com/",
                "preset": "whatsapp"
            }]
        }"#;
        let config: Config = serde_json::from_str(json).unwrap();
        assert_eq!(config.services.len(), 1);
        assert_eq!(config.services[0].id, "svc-1");
        assert_eq!(config.services[0].name, "WhatsApp");
        assert_eq!(config.services[0].preset.as_deref(), Some("whatsapp"));
        assert!(config.services[0].use_chrome_user_agent);
        assert!(!config.sidebar_collapsed);
    }

    #[test]
    fn missing_current_config_adopts_the_previous_bundle() {
        let root = std::env::temp_dir().join(format!("rustbox-test-{}", uuid::Uuid::new_v4()));
        let current_dir = root.join("app.rustbox.desktop");
        let legacy_dir = root.join(LEGACY_BUNDLE_ID);
        let legacy_data = root.join("data").join(LEGACY_BUNDLE_ID);
        std::fs::create_dir_all(&current_dir).unwrap();
        std::fs::create_dir_all(legacy_data.join("services").join("svc-1")).unwrap();
        std::fs::create_dir_all(&legacy_dir).unwrap();
        let legacy_config = legacy_dir.join("config.json");
        let original = r#"{
            "version": 1,
            "activeId": "svc-1",
            "services": [{
                "id": "svc-1",
                "name": "Slack",
                "url": "https://app.slack.com/",
                "preset": "slack"
            }]
        }"#;
        std::fs::write(&legacy_config, original).unwrap();
        std::fs::write(
            legacy_data.join("services").join("svc-1").join("cookie"),
            "kept",
        )
        .unwrap();

        let current = current_dir.join("config.json");
        let (loaded, imported) = Config::load_adopting_legacy(&current, &legacy_config);
        assert!(imported);
        assert_eq!(loaded.services.len(), 1);
        assert_eq!(loaded.services[0].name, "Slack");
        assert_eq!(std::fs::read_to_string(&legacy_config).unwrap(), original);
        assert!(current.is_file());
        let saved = Config::load_or_default(&current);
        assert_eq!(saved.services[0].id, "svc-1");

        let sessions = root
            .join("data")
            .join("app.rustbox.desktop")
            .join("sessions");
        import_legacy_sessions(&legacy_data, &sessions).unwrap();
        assert_eq!(
            std::fs::read_to_string(sessions.join("svc-1").join("cookie")).unwrap(),
            "kept"
        );
        std::fs::write(sessions.join("svc-1").join("cookie"), "local").unwrap();
        import_legacy_sessions(&legacy_data, &sessions).unwrap();
        assert_eq!(
            std::fs::read_to_string(sessions.join("svc-1").join("cookie")).unwrap(),
            "local"
        );

        std::fs::write(&current, r#"{"version":1,"services":[]}"#).unwrap();
        let (again, imported_again) = Config::load_adopting_legacy(&current, &legacy_config);
        assert!(!imported_again);
        assert!(again.services.is_empty());
        assert_eq!(std::fs::read_to_string(&legacy_config).unwrap(), original);

        let broken = legacy_dir.join("broken.json");
        std::fs::write(&broken, "{not json").unwrap();
        let absent = current_dir.join("missing.json");
        let (fresh, imported_broken) = Config::load_adopting_legacy(&absent, &broken);
        assert!(!imported_broken);
        assert!(fresh.services.is_empty());
        assert!(broken.is_file());
        assert!(!absent.is_file());

        std::fs::remove_dir_all(&root).ok();
    }
}
