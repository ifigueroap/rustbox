use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use url::Url;

use crate::policy::effective_user_agent;

fn default_version() -> u32 {
    1
}

fn default_schema_version() -> u32 {
    CONFIG_SCHEMA_VERSION
}

fn default_true() -> bool {
    true
}

fn default_color() -> String {
    "#8d8478".to_string()
}

/// Workspace layout version written next to the legacy `version` field.
///
/// `version` stays at 1 on purpose: an older build rejects any other value,
/// moves the config aside, and starts empty. Every workspaces field is
/// additive, so an older reader ignores it and still shows the services.
pub const CONFIG_SCHEMA_VERSION: u32 = 2;

pub const DEFAULT_WORKSPACE_NAME: &str = "Main";

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Auto,
    Light,
    Dark,
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

/// A named grouping of services. One service can be listed in several
/// workspaces; it keeps a single webview and a single session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default = "default_color")]
    pub color: String,
    /// Silences sound, notifications, and badges for every service that is
    /// only shared with other silenced workspaces. Global Do not disturb wins.
    #[serde(default)]
    pub dnd: bool,
    /// Position in the rail. `Config::normalize` keeps this equal to the
    /// index in `Config::workspaces`.
    #[serde(default)]
    pub order: u32,
}

impl Workspace {
    fn new(name: &str) -> Self {
        Self {
            id: new_id(),
            name: name.to_string(),
            icon: None,
            color: default_color(),
            dnd: false,
            order: 0,
        }
    }
}

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
    /// Page audio for this service. Do not disturb mutes it anyway.
    #[serde(default = "default_true")]
    pub sound_enabled: bool,
    /// Unread badges and desktop notifications. Do not disturb hides them anyway.
    #[serde(default = "default_true")]
    pub notifications_enabled: bool,
    /// Workspace ids this service is listed under.
    #[serde(default)]
    pub workspaces: Vec<String>,
    /// Shown in every workspace, including ones created later.
    #[serde(default)]
    pub all_workspaces: bool,
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
    /// Additive layout marker for workspaces. Older builds ignore it.
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub active_workspace_id: Option<String>,
    #[serde(default)]
    pub services: Vec<Service>,
    /// When true the sidebar is the icon rail. Names stay available as tooltips.
    #[serde(default)]
    pub sidebar_collapsed: bool,
    /// Mutes page audio and hides badges and desktop notifications for every service.
    #[serde(default)]
    pub do_not_disturb: bool,
    /// Closing the window hides it. Quit from the tray, or Ctrl+Q, to exit.
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    /// Hide the workspace rail. The rail also hides while only one workspace exists.
    #[serde(default)]
    pub workspace_rail_hidden: bool,
    #[serde(default)]
    pub theme: Theme,
}

impl Default for Config {
    fn default() -> Self {
        let mut workspace = Workspace::new(DEFAULT_WORKSPACE_NAME);
        workspace.order = 0;
        Self {
            version: 1,
            schema_version: CONFIG_SCHEMA_VERSION,
            active_workspace_id: Some(workspace.id.clone()),
            workspaces: vec![workspace],
            services: Vec::new(),
            sidebar_collapsed: false,
            do_not_disturb: false,
            close_to_tray: true,
            workspace_rail_hidden: false,
            theme: Theme::Auto,
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
    #[serde(default)]
    pub workspaces: Option<Vec<String>>,
    #[serde(default)]
    pub all_workspaces: Option<bool>,
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
    #[serde(default)]
    pub workspaces: Option<Vec<String>>,
    #[serde(default)]
    pub all_workspaces: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewWorkspace {
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceUpdate {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
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

    /// Keep a current config that already has services. When it is missing,
    /// unreadable, invalid, or has an empty service list, copy the candidate
    /// that has the most services. The source file is left in place.
    ///
    /// Returns the loaded config and whether a candidate was adopted.
    pub fn load_adopting_legacy(current: &Path, candidates: &[PathBuf]) -> (Self, bool) {
        let current_read = read_config(current);
        if let ConfigRead::Loaded(config) = &current_read {
            if !config.services.is_empty() {
                return (config.clone(), false);
            }
        }

        let mut viable: Vec<(usize, Config, &Path)> = Vec::new();
        for candidate in candidates {
            if paths_equal(candidate, current) {
                continue;
            }
            match read_config(candidate) {
                ConfigRead::Loaded(config) if !config.services.is_empty() => {
                    viable.push((config.services.len(), config, candidate));
                }
                ConfigRead::Loaded(_) => {
                    eprintln!(
                        "rustbox: skipping {} because it has no services",
                        candidate.display()
                    );
                }
                ConfigRead::Missing => {}
                ConfigRead::Unreadable(err) => {
                    eprintln!(
                        "rustbox: skipping {}; could not read it ({err})",
                        candidate.display()
                    );
                }
                ConfigRead::Invalid(err) => {
                    eprintln!(
                        "rustbox: skipping {}; could not parse it ({err})",
                        candidate.display()
                    );
                }
            }
        }

        if let Some((winner_index, _)) = viable
            .iter()
            .enumerate()
            .max_by_key(|(index, (count, _, _))| (*count, std::cmp::Reverse(*index)))
        {
            let (count, config, source) = &viable[winner_index];
            let _ = count;
            for (other_count, _, other) in &viable {
                if paths_equal(other, source) {
                    continue;
                }
                eprintln!(
                    "rustbox: not using {} ({other_count} services)",
                    other.display()
                );
            }

            let mut chosen = config.clone();
            if let ConfigRead::Loaded(existing) = &current_read {
                chosen.sidebar_collapsed = existing.sidebar_collapsed;
                chosen.do_not_disturb = existing.do_not_disturb;
                chosen.close_to_tray = existing.close_to_tray;
            }

            if matches!(current_read, ConfigRead::Invalid(_)) {
                let backup = current.with_extension("json.bak");
                if !paths_equal(source, &backup) {
                    move_aside(current);
                }
            }
            if let Err(err) = chosen.save(current) {
                eprintln!(
                    "rustbox: imported config from {} but could not write {}: {err}",
                    source.display(),
                    current.display()
                );
            } else {
                eprintln!(
                    "rustbox: imported {} service(s) from {}",
                    chosen.services.len(),
                    source.display()
                );
            }
            return (chosen, true);
        }

        match current_read {
            ConfigRead::Loaded(config) => (config, false),
            ConfigRead::Missing => (Self::default(), false),
            ConfigRead::Unreadable(err) => {
                eprintln!("rustbox: could not read {}: {err}", current.display());
                (Self::default(), false)
            }
            ConfigRead::Invalid(err) => {
                eprintln!("rustbox: invalid config at {}: {err}", current.display());
                move_aside(current);
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
        std::fs::write(&temporary, &json).map_err(|err| err.to_string())?;
        if let Err(err) = std::fs::rename(&temporary, path) {
            // Windows cannot replace an existing file with rename. An empty
            // config written by an earlier build is the usual destination.
            if path.is_file() {
                if let Err(remove_err) = std::fs::remove_file(path) {
                    let _ = std::fs::remove_file(&temporary);
                    return Err(format!("{err}; also could not replace it ({remove_err})"));
                }
                if let Err(retry) = std::fs::rename(&temporary, path) {
                    return Err(format!(
                        "{retry}; the updated config is still at {}",
                        temporary.display()
                    ));
                }
            } else {
                let _ = std::fs::remove_file(&temporary);
                return Err(err.to_string());
            }
        }
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
        let workspace = self.active_workspace().map(|item| item.id.clone());
        let service = Service {
            id: new_id(),
            name: unique_name(self, preset.name),
            url,
            icon: None,
            color: preset.color.to_string(),
            user_agent: None,
            use_chrome_user_agent: true,
            preset: Some(preset.id.to_string()),
            sound_enabled: true,
            notifications_enabled: true,
            workspaces: workspace.into_iter().collect(),
            all_workspaces: false,
        };
        self.services.push(service.clone());
        Ok(service)
    }

    pub fn add_custom(&mut self, input: NewService) -> Result<Service, String> {
        let fallback = self.active_workspace().map(|item| item.id.clone());
        let (workspaces, all_workspaces) =
            self.resolve_membership(input.workspaces, input.all_workspaces, fallback)?;
        let service = Service {
            id: new_id(),
            name: normalize_name(&input.name)?,
            url: normalize_service_url(&input.url)?,
            icon: normalize_icon(input.icon.as_deref())?,
            color: normalize_color(input.color.as_deref()),
            user_agent: normalize_user_agent(input.user_agent.as_deref())?,
            use_chrome_user_agent: input.use_chrome_user_agent,
            preset: None,
            sound_enabled: true,
            notifications_enabled: true,
            workspaces,
            all_workspaces,
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
        let fallback = self.active_workspace().map(|item| item.id.clone());
        let (workspaces, all_workspaces) =
            self.resolve_membership(input.workspaces, input.all_workspaces, fallback)?;
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
        service.workspaces = workspaces;
        service.all_workspaces = all_workspaces;
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

    // ---- Workspaces -------------------------------------------------------

    /// The workspace the shell is showing. Falls back to the first one when the
    /// saved id is gone, so deleting a workspace never leaves the shell blank.
    pub fn active_workspace(&self) -> Option<&Workspace> {
        let saved = self.active_workspace_id.as_deref();
        saved
            .and_then(|id| self.workspaces.iter().find(|workspace| workspace.id == id))
            .or_else(|| self.workspaces.first())
    }

    pub fn active_workspace_id(&self) -> Option<String> {
        self.active_workspace().map(|workspace| workspace.id.clone())
    }

    /// Services shown for a workspace, in sidebar order. `None` means every
    /// service on the desk's "all services" view.
    pub fn services_in_workspace(&self, workspace_id: &str) -> Vec<&Service> {
        self.services
            .iter()
            .filter(|service| service_in_workspace(service, workspace_id))
            .collect()
    }

    /// True when this service is silenced by workspace Do not disturb only.
    /// A service shared with any awake workspace keeps its sound and badges.
    pub fn workspace_silenced(&self, service: &Service) -> bool {
        if self.workspaces.is_empty() {
            return false;
        }
        let flags: Vec<bool> = if service.all_workspaces {
            self.workspaces.iter().map(|workspace| workspace.dnd).collect()
        } else {
            self.workspaces
                .iter()
                .filter(|workspace| service.workspaces.iter().any(|id| id == &workspace.id))
                .map(|workspace| workspace.dnd)
                .collect()
        };
        crate::policy::silenced_by_workspaces(&flags)
    }

    pub fn add_workspace(&mut self, input: NewWorkspace) -> Result<Workspace, String> {
        let name = normalize_name(&input.name)?;
        if self.workspaces.len() >= MAX_WORKSPACES {
            return Err(format!("at most {MAX_WORKSPACES} workspaces"));
        }
        let mut workspace = Workspace::new(&unique_workspace_name(self, &name));
        workspace.icon = normalize_icon(input.icon.as_deref())?;
        workspace.color = normalize_color(input.color.as_deref());
        workspace.order = self.workspaces.len() as u32;
        self.workspaces.push(workspace.clone());
        if self.active_workspace_id.is_none() {
            self.active_workspace_id = Some(workspace.id.clone());
        }
        Ok(workspace)
    }

    pub fn update_workspace(&mut self, input: WorkspaceUpdate) -> Result<(), String> {
        let name = normalize_name(&input.name)?;
        let icon = normalize_icon(input.icon.as_deref())?;
        let color = normalize_color(input.color.as_deref());
        let workspace = self
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == input.id)
            .ok_or_else(|| "workspace not found".to_string())?;
        workspace.name = name;
        workspace.icon = icon;
        workspace.color = color;
        Ok(())
    }

    pub fn set_workspace_dnd(&mut self, id: &str, dnd: bool) -> Result<(), String> {
        let workspace = self
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == id)
            .ok_or_else(|| "workspace not found".to_string())?;
        workspace.dnd = dnd;
        Ok(())
    }

    /// Removing a workspace never removes a service. A service that is left
    /// with no workspace at all moves to the first remaining workspace.
    pub fn remove_workspace(&mut self, id: &str) -> Result<Workspace, String> {
        if self.workspaces.len() <= 1 {
            return Err("keep at least one workspace".into());
        }
        let index = self
            .workspaces
            .iter()
            .position(|workspace| workspace.id == id)
            .ok_or_else(|| "workspace not found".to_string())?;
        let removed = self.workspaces.remove(index);
        let fallback = self.workspaces[0].id.clone();
        for service in &mut self.services {
            service.workspaces.retain(|item| item != id);
            if !service.all_workspaces && service.workspaces.is_empty() {
                service.workspaces.push(fallback.clone());
            }
        }
        if self.active_workspace_id.as_deref() == Some(id) {
            self.active_workspace_id = Some(fallback);
        }
        self.resequence_workspaces();
        Ok(removed)
    }

    pub fn reorder_workspaces(&mut self, ids: &[String]) -> Result<(), String> {
        if ids.len() != self.workspaces.len() {
            return Err("reorder must include every workspace exactly once".into());
        }
        let mut next = Vec::with_capacity(ids.len());
        for id in ids {
            if next.iter().any(|workspace: &Workspace| &workspace.id == id) {
                return Err(format!("duplicate workspace {id}"));
            }
            let workspace = self
                .workspaces
                .iter()
                .find(|workspace| &workspace.id == id)
                .cloned()
                .ok_or_else(|| format!("unknown workspace {id}"))?;
            next.push(workspace);
        }
        self.workspaces = next;
        self.resequence_workspaces();
        Ok(())
    }

    /// Move one workspace one slot up the rail, without a full reorder list.
    pub fn move_workspace(&mut self, id: &str, delta: i32) -> Result<(), String> {
        let index = self
            .workspaces
            .iter()
            .position(|workspace| workspace.id == id)
            .ok_or_else(|| "workspace not found".to_string())?;
        let target = index as i32 + delta;
        if target < 0 || target >= self.workspaces.len() as i32 {
            return Ok(());
        }
        self.workspaces.swap(index, target as usize);
        self.resequence_workspaces();
        Ok(())
    }

    fn resequence_workspaces(&mut self) {
        for (index, workspace) in self.workspaces.iter_mut().enumerate() {
            workspace.order = index as u32;
        }
    }

    /// Validate a requested membership. A missing list falls back to the active
    /// workspace; an explicit list that ends up empty is an error so the UI can
    /// tell the user why the service would be invisible everywhere.
    fn resolve_membership(
        &self,
        requested: Option<Vec<String>>,
        all_workspaces: Option<bool>,
        fallback: Option<String>,
    ) -> Result<(Vec<String>, bool), String> {
        if all_workspaces.unwrap_or(false) {
            return Ok((Vec::new(), true));
        }
        let Some(requested) = requested else {
            return match fallback {
                Some(id) => Ok((vec![id], false)),
                None => Err(EMPTY_MEMBERSHIP_MESSAGE.into()),
            };
        };
        let mut ids: Vec<String> = Vec::new();
        for id in requested {
            if !self.workspaces.iter().any(|workspace| workspace.id == id) {
                continue;
            }
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        if ids.is_empty() {
            return Err(EMPTY_MEMBERSHIP_MESSAGE.into());
        }
        Ok((ids, false))
    }

    /// Repair anything an older build, a hand edit, or a deleted workspace
    /// could have left inconsistent. Never drops a service.
    pub fn normalize(&mut self) {
        self.schema_version = CONFIG_SCHEMA_VERSION;
        dedupe_workspaces(&mut self.workspaces);
        if self.workspaces.is_empty() {
            let mut workspace = Workspace::new(DEFAULT_WORKSPACE_NAME);
            workspace.order = 0;
            self.workspaces.push(workspace);
        }
        self.resequence_workspaces();

        let known: HashSet<String> = self
            .workspaces
            .iter()
            .map(|workspace| workspace.id.clone())
            .collect();
        let first = self.workspaces[0].id.clone();
        for service in &mut self.services {
            service.workspaces.retain(|id| known.contains(id));
            service.workspaces.dedup();
            if service.all_workspaces {
                service.workspaces.clear();
            } else if service.workspaces.is_empty() {
                service.workspaces.push(first.clone());
            }
        }

        let active_ok = self
            .active_workspace_id
            .as_deref()
            .is_some_and(|id| self.workspaces.iter().any(|workspace| workspace.id == id));
        if !active_ok {
            self.active_workspace_id = Some(self.workspaces[0].id.clone());
        }
    }
}

pub const MAX_WORKSPACES: usize = 24;

pub const EMPTY_MEMBERSHIP_MESSAGE: &str =
    "Pick at least one workspace, or tick All workspaces, so this service is not hidden.";

/// A service is listed under a workspace when it is pinned to all of them or
/// when the workspace id is on its own list.
pub fn service_in_workspace(service: &Service, workspace_id: &str) -> bool {
    service.all_workspaces || service.workspaces.iter().any(|id| id == workspace_id)
}

fn dedupe_workspaces(workspaces: &mut Vec<Workspace>) {
    let mut seen: HashSet<String> = HashSet::new();
    workspaces.retain(|workspace| seen.insert(workspace.id.clone()));
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

pub const MAX_ICON_BYTES: usize = 1_500_000;

/// `local:<uuid>.<ext>` stored in config. The bytes live under the app data `icons` directory.
pub fn local_icon_filename(token: &str) -> Option<String> {
    let rest = token.strip_prefix("local:")?;
    if rest.contains('/') || rest.contains('\\') || rest.contains("..") {
        return None;
    }
    let (id, ext) = rest.rsplit_once('.')?;
    if uuid::Uuid::parse_str(id).is_err() {
        return None;
    }
    if !matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "ico" | "svg") {
        return None;
    }
    Some(format!("{id}.{ext}"))
}

pub fn accept_icon_bytes(bytes: &[u8], extension: &str) -> Result<&'static str, String> {
    if bytes.is_empty() || bytes.len() > MAX_ICON_BYTES {
        return Err("icon file must be under 1.5 MB".into());
    }
    let ext = extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    let kind = match ext.as_str() {
        "png" => "png",
        "jpg" | "jpeg" => "jpg",
        "webp" => "webp",
        "ico" => "ico",
        "svg" => "svg",
        _ => return Err("icon must be PNG, SVG, ICO, JPG, or WebP".into()),
    };
    let matches_kind = match kind {
        "png" => bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        "jpg" => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        "webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "ico" => bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]),
        "svg" => svg_markup(bytes),
        _ => false,
    };
    if !matches_kind {
        return Err("that file does not match the chosen image type".into());
    }
    Ok(kind)
}

fn svg_markup(bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let trimmed = text.trim_start().trim_start_matches('\u{feff}');
    let head: String = trimmed.chars().take(240).collect();
    let head = head.to_ascii_lowercase();
    let lower = trimmed.to_ascii_lowercase();
    (head.starts_with("<svg") || head.starts_with("<?xml") || head.starts_with("<!doctype"))
        && lower.contains("<svg")
        && !lower.contains("<script")
}

fn normalize_icon(icon: Option<&str>) -> Result<Option<String>, String> {
    let Some(icon) = icon.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if icon.starts_with("local:") {
        if local_icon_filename(icon).is_some() {
            return Ok(Some(icon.to_string()));
        }
        return Err("icon file is not a saved Rustbox icon".into());
    }
    if icon.starts_with("file:")
        || icon.starts_with("\\\\")
        || icon.contains('\\')
        || (icon.len() >= 2 && icon.as_bytes()[1] == b':')
    {
        return Err("choose an image, or paste an http(s) URL or emoji".into());
    }
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
    if icon.chars().count() > 8 || icon.contains('/') {
        return Err("icon must be an http(s) URL, an emoji, or a chosen image".into());
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

fn unique_workspace_name(config: &Config, base: &str) -> String {
    if !config.workspaces.iter().any(|workspace| workspace.name == base) {
        return base.to_string();
    }
    for number in 2..100 {
        let candidate = format!("{base} {number}");
        if !config
            .workspaces
            .iter()
            .any(|workspace| workspace.name == candidate)
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
        Ok(mut config) if config.version == 1 => {
            repair_preset_colors(&mut config);
            migrate_workspaces(&mut config);
            config.normalize();
            ConfigRead::Loaded(config)
        }
        Ok(config) => ConfigRead::Invalid(format!("unsupported config version {}", config.version)),
        Err(err) => ConfigRead::Invalid(err.to_string()),
    }
}

/// First run after the workspaces upgrade: a config without a `workspaces`
/// key gets one default workspace holding every existing service. Sessions
/// stay in `sessions/<service id>` and no service is touched.
fn migrate_workspaces(config: &mut Config) {
    if !config.workspaces.is_empty() {
        return;
    }
    let mut workspace = Workspace::new(DEFAULT_WORKSPACE_NAME);
    workspace.order = 0;
    for service in &mut config.services {
        if service.all_workspaces || service.workspaces.is_empty() {
            service.workspaces = vec![workspace.id.clone()];
            service.all_workspaces = false;
        }
    }
    config.active_workspace_id = Some(workspace.id.clone());
    config.workspaces.push(workspace);
}

/// Preset services saved before `color` existed deserialize as the generic
/// grey. Put the brand color back so marks such as Claude are not a white
/// glyph on that grey plate. An explicit non-default color is left alone.
fn repair_preset_colors(config: &mut Config) {
    for service in &mut config.services {
        if service.color != default_color() {
            continue;
        }
        let Some(preset_id) = service.preset.as_deref() else {
            continue;
        };
        if let Some(preset) = PRESETS.iter().find(|preset| preset.id == preset_id) {
            service.color = preset.color.to_string();
        }
    }
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
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

fn sibling_app_dir(current_app_dir: &Path) -> PathBuf {
    match current_app_dir.parent() {
        Some(parent) => parent.join(LEGACY_BUNDLE_ID),
        None => Path::new(LEGACY_BUNDLE_ID).to_path_buf(),
    }
}

/// Older configs that might still hold the service list. Order is the
/// tie-break when two files have the same number of services: config dir,
/// then data dir, then the OS local data dir, then a backup beside the
/// current file. The portable exe and AppImage use these same directories.
pub fn legacy_config_candidates(
    config_dir: &Path,
    data_dir: &Path,
    local_data_dir: &Path,
) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for dir in [config_dir, data_dir, local_data_dir] {
        let legacy = sibling_app_dir(dir);
        push_unique(&mut paths, legacy.join("config.json"));
        push_unique(&mut paths, legacy.join("config.json.bak"));
    }
    push_unique(&mut paths, config_dir.join("config.json.bak"));
    paths
}

/// Directories whose `services/<id>` folders belong to the previous build.
/// On Linux those folders live under the data dir. On Windows the config and
/// data dirs are the same Roaming folder. LocalAppData is included because a
/// portable build can still be pointed there by the OS.
pub fn legacy_session_roots(
    config_dir: &Path,
    data_dir: &Path,
    local_data_dir: &Path,
) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for dir in [data_dir, local_data_dir, config_dir] {
        push_unique(&mut paths, sibling_app_dir(dir));
    }
    paths
}

fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if paths.iter().any(|existing| existing == &path) {
        return;
    }
    paths.push(path);
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
                    workspaces: None,
                    all_workspaces: None,
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
                workspaces: None,
                all_workspaces: None,
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

    // ---- Workspaces -------------------------------------------------------

    fn config_with_workspaces(names: &[&str]) -> Config {
        let mut config = Config::default();
        config.workspaces.clear();
        config.active_workspace_id = None;
        let ids: Vec<String> = names
            .iter()
            .map(|name| {
                let mut workspace = Workspace::new(name);
                workspace.order = config.workspaces.len() as u32;
                config.workspaces.push(workspace.clone());
                workspace.id
            })
            .collect();
        config.active_workspace_id = ids.first().cloned();
        config
    }

    fn add_service(config: &mut Config, name: &str, workspaces: &[&str]) -> Service {
        let membership = if workspaces.is_empty() {
            None
        } else {
            Some(workspaces.iter().map(|id| (*id).to_string()).collect())
        };
        config
            .add_custom(NewService {
                name: name.into(),
                url: format!("https://{}.example.com/", name.to_lowercase()),
                icon: None,
                color: None,
                user_agent: None,
                use_chrome_user_agent: true,
                workspaces: membership,
                all_workspaces: None,
            })
            .unwrap()
    }

    #[test]
    fn the_default_config_has_one_workspace() {
        let config = Config::default();
        assert_eq!(config.workspaces.len(), 1);
        assert_eq!(config.workspaces[0].name, DEFAULT_WORKSPACE_NAME);
        assert_eq!(config.workspaces[0].order, 0);
        assert_eq!(
            config.active_workspace_id.as_deref(),
            Some(config.workspaces[0].id.as_str())
        );
    }

    #[test]
    fn an_old_config_migrates_into_one_workspace_holding_every_service() {
        let dir = std::env::temp_dir().join(format!("rustbox-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        std::fs::write(
            &path,
            r##"{"version":1,"sidebarCollapsed":true,"doNotDisturb":true,"theme":"dark",
                "services":[
                    {"id":"a","name":"Slack","url":"https://app.slack.com/","preset":"slack"},
                    {"id":"b","name":"Claude","url":"https://claude.ai/","preset":"claude","color":"#D97757"}
                ]}"##,
        )
        .unwrap();

        let loaded = Config::load_or_default(&path);
        assert_eq!(loaded.services.len(), 2, "migration must not drop services");
        assert_eq!(loaded.services[0].id, "a");
        assert_eq!(loaded.services[1].id, "b");
        assert_eq!(loaded.workspaces.len(), 1);
        let main = &loaded.workspaces[0];
        assert_eq!(main.name, DEFAULT_WORKSPACE_NAME);
        assert!(!main.dnd);
        for service in &loaded.services {
            assert_eq!(service.workspaces, vec![main.id.clone()]);
            assert!(!service.all_workspaces);
        }
        assert_eq!(loaded.active_workspace_id.as_deref(), Some(main.id.as_str()));
        assert!(loaded.sidebar_collapsed);
        assert!(loaded.do_not_disturb);
        assert_eq!(loaded.theme, Theme::Dark);
        assert_eq!(loaded.schema_version, CONFIG_SCHEMA_VERSION);
        assert_eq!(loaded.version, 1, "older readers still accept version 1");

        loaded.save(&path).unwrap();
        let written = std::fs::read_to_string(&path).unwrap();
        assert!(written.contains("\"schemaVersion\""));
        assert!(written.contains("\"workspaces\""));
        assert!(written.contains("\"version\": 1"));
        let reloaded = Config::load_or_default(&path);
        assert_eq!(reloaded, loaded);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_empty_config_still_gets_one_workspace() {
        let config: Config = serde_json::from_str(r#"{"version":1,"services":[]}"#).unwrap();
        let mut config = config;
        migrate_workspaces(&mut config);
        config.normalize();
        assert_eq!(config.workspaces.len(), 1);
        assert_eq!(config.active_workspace_id(), Some(config.workspaces[0].id.clone()));
    }

    #[test]
    fn a_service_can_belong_to_several_workspaces() {
        let mut config = config_with_workspaces(&["Work", "Teaching"]);
        let work = config.workspaces[0].id.clone();
        let teaching = config.workspaces[1].id.clone();
        add_service(&mut config, "Slack", &[&work, &teaching]);
        let service = &config.services[0];
        assert_eq!(service.workspaces, vec![work.clone(), teaching.clone()]);
        assert!(service_in_workspace(service, &work));
        assert!(service_in_workspace(service, &teaching));
        assert_eq!(config.services_in_workspace(&work).len(), 1);
        assert_eq!(config.services_in_workspace(&teaching).len(), 1);
    }

    #[test]
    fn all_workspaces_includes_workspaces_created_later() {
        let mut config = config_with_workspaces(&["Work"]);
        config
            .add_custom(NewService {
                name: "Mail".into(),
                url: "https://mail.example.com/".into(),
                icon: None,
                color: None,
                user_agent: None,
                use_chrome_user_agent: true,
                workspaces: None,
                all_workspaces: Some(true),
            })
            .unwrap();
        let created = config
            .add_workspace(NewWorkspace {
                name: "Personal".into(),
                icon: None,
                color: None,
            })
            .unwrap();
        let service = &config.services[0];
        assert!(service.all_workspaces);
        assert!(service.workspaces.is_empty());
        assert!(service_in_workspace(service, &config.workspaces[0].id));
        assert!(service_in_workspace(service, &created.id));
    }

    #[test]
    fn membership_must_not_be_empty() {
        let mut config = config_with_workspaces(&["Work"]);
        let error = config
            .add_custom(NewService {
                name: "Orphan".into(),
                url: "https://orphan.example.com/".into(),
                icon: None,
                color: None,
                user_agent: None,
                use_chrome_user_agent: true,
                workspaces: Some(vec!["missing".into()]),
                all_workspaces: Some(false),
            })
            .unwrap_err();
        assert_eq!(error, EMPTY_MEMBERSHIP_MESSAGE);
        assert!(config.services.is_empty());

        // No workspace list at all falls back to the active workspace.
        let service = add_service(&mut config, "Slack", &[]);
        assert_eq!(service.workspaces, vec![config.workspaces[0].id.clone()]);
    }

    #[test]
    fn editing_a_service_keeps_multi_workspace_membership() {
        let mut config = config_with_workspaces(&["Work", "Teaching"]);
        let work = config.workspaces[0].id.clone();
        let teaching = config.workspaces[1].id.clone();
        let service = add_service(&mut config, "Slack", &[&work, &teaching]);
        config
            .update_service(ServiceUpdate {
                id: service.id.clone(),
                name: "Slack".into(),
                url: "https://app.slack.com/".into(),
                icon: None,
                color: None,
                user_agent: None,
                use_chrome_user_agent: true,
                workspaces: Some(vec![teaching.clone()]),
                all_workspaces: Some(false),
            })
            .unwrap();
        assert_eq!(config.services[0].workspaces, vec![teaching]);
    }

    #[test]
    fn deleting_a_workspace_keeps_services_and_moves_orphans_to_the_first_one() {
        let mut config = config_with_workspaces(&["Work", "Teaching", "Personal"]);
        let work = config.workspaces[0].id.clone();
        let teaching = config.workspaces[1].id.clone();
        let personal = config.workspaces[2].id.clone();
        add_service(&mut config, "Slack", &[&teaching]);
        add_service(&mut config, "Claude", &[&work, &teaching]);

        config.remove_workspace(&teaching).unwrap();
        assert_eq!(config.services.len(), 2, "no service is deleted");
        assert_eq!(config.services[0].workspaces, vec![work.clone()]);
        assert_eq!(config.services[1].workspaces, vec![work.clone()]);
        assert_eq!(config.workspaces.len(), 2);
        assert_eq!(config.workspaces[0].order, 0);
        assert_eq!(config.workspaces[1].order, 1);
        assert!(config.workspaces.iter().all(|item| item.id != teaching));

        // The active workspace falls back instead of dangling.
        config.active_workspace_id = Some(teaching);
        config.normalize();
        assert_eq!(
            config.active_workspace_id(),
            Some(config.workspaces[0].id.clone())
        );

        // A last workspace cannot be deleted.
        config.remove_workspace(&personal).unwrap();
        assert!(config.remove_workspace(&work).is_err());
    }

    #[test]
    fn deleting_a_workspace_keeps_an_all_pinned_service_pinned() {
        let mut config = config_with_workspaces(&["Work", "Teaching"]);
        config
            .add_custom(NewService {
                name: "Mail".into(),
                url: "https://mail.example.com/".into(),
                icon: None,
                color: None,
                user_agent: None,
                use_chrome_user_agent: true,
                workspaces: None,
                all_workspaces: Some(true),
            })
            .unwrap();
        let work = config.workspaces[0].id.clone();
        let teaching = config.workspaces[1].id.clone();
        config.remove_workspace(&work).unwrap();
        let service = &config.services[0];
        assert!(service.all_workspaces);
        assert!(service.workspaces.is_empty());
        assert!(service_in_workspace(service, &teaching));
    }

    #[test]
    fn workspace_dnd_silences_only_services_with_no_awake_workspace() {
        let mut config = config_with_workspaces(&["Work", "Teaching"]);
        let work = config.workspaces[0].id.clone();
        let teaching = config.workspaces[1].id.clone();
        let shared = add_service(&mut config, "Slack", &[&work, &teaching]);
        let _work_only = add_service(&mut config, "Claude", &[&work]);

        let find = |config: &Config, id: &str| {
            config
                .services
                .iter()
                .find(|service| service.id == id)
                .cloned()
                .unwrap()
        };

        config.set_workspace_dnd(&work, true).unwrap();
        assert!(
            !config.workspace_silenced(&find(&config, &shared.id)),
            "the shared service still has an awake workspace"
        );

        config.set_workspace_dnd(&teaching, true).unwrap();
        assert!(
            config.workspace_silenced(&find(&config, &shared.id)),
            "every workspace is now in Do not disturb"
        );

        // Global Do not disturb is separate and always wins.
        config.set_workspace_dnd(&teaching, false).unwrap();
        assert!(!config.workspace_silenced(&find(&config, &shared.id)));
        assert!(crate::policy::sound_muted(
            true,
            config.workspace_silenced(&find(&config, &shared.id)),
            true
        ));
    }

    #[test]
    fn all_pinned_services_are_silenced_only_when_every_workspace_is() {
        let mut config = config_with_workspaces(&["Work", "Teaching"]);
        config
            .add_custom(NewService {
                name: "Mail".into(),
                url: "https://mail.example.com/".into(),
                icon: None,
                color: None,
                user_agent: None,
                use_chrome_user_agent: true,
                workspaces: None,
                all_workspaces: Some(true),
            })
            .unwrap();
        let work = config.workspaces[0].id.clone();
        let teaching = config.workspaces[1].id.clone();
        config.set_workspace_dnd(&work, true).unwrap();
        assert!(!config.workspace_silenced(&config.services[0]));
        config.set_workspace_dnd(&teaching, true).unwrap();
        assert!(config.workspace_silenced(&config.services[0]));
    }

    #[test]
    fn normalize_repairs_dangling_membership_without_losing_services() {
        let json = r#"{
            "version": 1,
            "schemaVersion": 2,
            "activeWorkspaceId": "gone",
            "workspaces": [
                {"id":"w1","name":"Work","order":9},
                {"id":"w1","name":"Duplicate","order":4}
            ],
            "services": [
                {"id":"s1","name":"Slack","url":"https://app.slack.com/","workspaces":["nope"]},
                {"id":"s2","name":"Mail","url":"https://mail.example.com/","allWorkspaces":true,"workspaces":["w1"]}
            ]
        }"#;
        let mut config: Config = serde_json::from_str(json).unwrap();
        config.normalize();
        assert_eq!(config.workspaces.len(), 1);
        assert_eq!(config.workspaces[0].order, 0);
        assert_eq!(config.services.len(), 2);
        assert_eq!(config.services[0].workspaces, vec!["w1".to_string()]);
        assert!(config.services[1].all_workspaces);
        assert!(config.services[1].workspaces.is_empty());
        assert_eq!(config.active_workspace_id.as_deref(), Some("w1"));
    }

    #[test]
    fn an_older_reader_ignores_the_workspaces_fields() {
        let mut config = config_with_workspaces(&["Work", "Teaching"]);
        let work = config.workspaces[0].id.clone();
        add_service(&mut config, "Slack", &[&work]);
        let json = serde_json::to_string(&config).unwrap();
        let partial: LegacyConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(partial.version, 1);
        assert_eq!(partial.services.len(), 1);
        assert_eq!(partial.services[0].name, "Slack");
    }

    /// The fields an older Rustbox build reads from `config.json`.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LegacyConfig {
        version: u32,
        services: Vec<LegacyService>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LegacyService {
        name: String,
    }

    #[test]
    fn workspaces_reorder_and_move() {
        let mut config = config_with_workspaces(&["Work", "Teaching", "Personal"]);
        let ids: Vec<String> = config
            .workspaces
            .iter()
            .map(|workspace| workspace.id.clone())
            .collect();
        config
            .reorder_workspaces(&[ids[2].clone(), ids[0].clone(), ids[1].clone()])
            .unwrap();
        assert_eq!(config.workspaces[0].name, "Personal");
        assert_eq!(config.workspaces[0].order, 0);
        assert!(config.reorder_workspaces(&[ids[0].clone()]).is_err());

        config.move_workspace(&ids[0], -1).unwrap();
        assert_eq!(config.workspaces[0].name, "Work");
        config.move_workspace(&ids[0], 1).unwrap();
        assert_eq!(config.workspaces[1].name, "Work");
        assert!(config.move_workspace(&ids[0], -5).is_ok());
    }

    #[test]
    fn workspace_names_stay_inside_the_length_limit() {
        let mut config = Config::default();
        assert!(
            config
                .add_workspace(NewWorkspace {
                    name: "  ".into(),
                    icon: None,
                    color: None,
                })
                .is_err()
        );
        let long = "x".repeat(81);
        assert!(
            config
                .add_workspace(NewWorkspace {
                    name: long,
                    icon: None,
                    color: None,
                })
                .is_err()
        );
        config
            .add_workspace(NewWorkspace {
                name: DEFAULT_WORKSPACE_NAME.into(),
                icon: None,
                color: None,
            })
            .unwrap();
        assert_eq!(config.workspaces[1].name, "Main 2");
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
        let (loaded, imported) = Config::load_adopting_legacy(&current, &[legacy_config.clone()]);
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

        std::fs::write(
            &current,
            r#"{"version":1,"sidebarCollapsed":true,"services":[]}"#,
        )
        .unwrap();
        let (again, imported_again) =
            Config::load_adopting_legacy(&current, &[legacy_config.clone()]);
        assert!(imported_again);
        assert_eq!(again.services.len(), 1);
        assert_eq!(again.services[0].name, "Slack");
        assert!(again.sidebar_collapsed);
        assert!(!again.do_not_disturb);
        assert_eq!(std::fs::read_to_string(&legacy_config).unwrap(), original);

        let broken = legacy_dir.join("broken.json");
        std::fs::write(&broken, "{not json").unwrap();
        let absent = current_dir.join("missing.json");
        let (fresh, imported_broken) = Config::load_adopting_legacy(&absent, &[broken.clone()]);
        assert!(!imported_broken);
        assert!(fresh.services.is_empty());
        assert!(broken.is_file());
        assert!(!absent.is_file());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn nonempty_current_config_is_not_replaced() {
        let root = std::env::temp_dir().join(format!("rustbox-test-{}", uuid::Uuid::new_v4()));
        let current_dir = root.join("app.rustbox.desktop");
        let legacy_dir = root.join(LEGACY_BUNDLE_ID);
        std::fs::create_dir_all(&current_dir).unwrap();
        std::fs::create_dir_all(&legacy_dir).unwrap();
        let current = current_dir.join("config.json");
        let legacy = legacy_dir.join("config.json");
        std::fs::write(
            &current,
            r#"{"version":1,"services":[{"id":"new","name":"Grok","url":"https://grok.com/","preset":"grok"}]}"#,
        )
        .unwrap();
        std::fs::write(
            &legacy,
            r#"{"version":1,"services":[
                {"id":"old-1","name":"Slack","url":"https://app.slack.com/","preset":"slack"},
                {"id":"old-2","name":"Claude","url":"https://claude.ai/","preset":"claude"}
            ]}"#,
        )
        .unwrap();
        let (loaded, imported) = Config::load_adopting_legacy(&current, &[legacy.clone()]);
        assert!(!imported);
        assert_eq!(loaded.services.len(), 1);
        assert_eq!(loaded.services[0].name, "Grok");
        assert!(legacy.is_file());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn empty_current_config_adopts_the_richest_older_file() {
        let root = std::env::temp_dir().join(format!("rustbox-test-{}", uuid::Uuid::new_v4()));
        let current_dir = root.join("config").join("app.rustbox.desktop");
        let data_dir = root.join("data").join("app.rustbox.desktop");
        let local_dir = root.join("local").join("app.rustbox.desktop");
        std::fs::create_dir_all(&current_dir).unwrap();
        let legacy_data = root.join("data").join(LEGACY_BUNDLE_ID);
        std::fs::create_dir_all(legacy_data.join("services").join("svc-bak")).unwrap();
        std::fs::write(
            legacy_data.join("services").join("svc-bak").join("cookie"),
            "session",
        )
        .unwrap();
        std::fs::write(
            &legacy_data.join("config.json"),
            r#"{"version":1,"services":[{"id":"one","name":"Only","url":"https://example.com/"}]}"#,
        )
        .unwrap();
        std::fs::write(
            &legacy_data.join("config.json.bak"),
            r#"{"version":1,"services":[
                {"id":"svc-bak","name":"WhatsApp","url":"https://web.whatsapp.com/","preset":"whatsapp"},
                {"id":"svc-2","name":"Claude","url":"https://claude.ai/","preset":"claude"}
            ]}"#,
        )
        .unwrap();
        std::fs::write(
            current_dir.join("config.json"),
            r#"{"version":1,"services":[]}"#,
        )
        .unwrap();

        let candidates = legacy_config_candidates(&current_dir, &data_dir, &local_dir);
        assert!(
            candidates
                .iter()
                .any(|path| path.ends_with("com.ifigueroa.rustbox/config.json"))
        );
        assert!(
            candidates
                .iter()
                .any(|path| path.ends_with("com.ifigueroa.rustbox/config.json.bak"))
        );
        assert!(
            candidates
                .iter()
                .any(|path| path.ends_with("app.rustbox.desktop/config.json.bak"))
        );

        let current = current_dir.join("config.json");
        let (loaded, imported) = Config::load_adopting_legacy(&current, &candidates);
        assert!(imported);
        assert_eq!(loaded.services.len(), 2);
        assert_eq!(loaded.services[0].id, "svc-bak");
        assert_eq!(loaded.services[1].color, "#D97757");
        assert!(loaded.services[0].sound_enabled);
        assert!(loaded.services[0].notifications_enabled);

        let sessions = data_dir.join("sessions");
        for root in legacy_session_roots(&current_dir, &data_dir, &local_dir) {
            import_legacy_sessions(&root, &sessions).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(sessions.join("svc-bak").join("cookie")).unwrap(),
            "session"
        );
        let saved = std::fs::read_to_string(legacy_data.join("config.json.bak")).unwrap();
        assert!(saved.contains("svc-bak"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn same_id_backup_is_adopted_when_the_current_file_is_empty() {
        let root = std::env::temp_dir().join(format!("rustbox-test-{}", uuid::Uuid::new_v4()));
        let current_dir = root.join("app.rustbox.desktop");
        std::fs::create_dir_all(&current_dir).unwrap();
        let current = current_dir.join("config.json");
        let backup = current_dir.join("config.json.bak");
        std::fs::write(&current, r#"{"version":1,"services":[]}"#).unwrap();
        std::fs::write(
            &backup,
            r#"{"version":1,"services":[{"id":"svc","name":"Telegram","url":"https://web.telegram.org/a/","preset":"telegram"}]}"#,
        )
        .unwrap();
        let candidates = legacy_config_candidates(&current_dir, &current_dir, &current_dir);
        let (loaded, imported) = Config::load_adopting_legacy(&current, &candidates);
        assert!(imported);
        assert_eq!(loaded.services[0].name, "Telegram");
        assert!(backup.is_file());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn save_replaces_an_existing_config_file() {
        let dir = std::env::temp_dir().join(format!("rustbox-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        std::fs::write(&path, r#"{"version":1,"services":[]}"#).unwrap();
        let config = sample_config();
        config.save(&path).unwrap();
        let loaded = Config::load_or_default(&path);
        assert_eq!(loaded.services.len(), 2);
        assert!(!dir.join("config.json.tmp").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn omitted_preset_color_and_alert_flags_use_defaults() {
        let dir = std::env::temp_dir().join(format!("rustbox-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        std::fs::write(
            &path,
            r##"{"version":1,"services":[
                {"id":"c","name":"Claude","url":"https://claude.ai/","preset":"claude"},
                {"id":"n","name":"Notes","url":"https://example.com/","color":"#112233"},
                {"id":"g","name":"Grey","url":"https://example.com/","preset":"grok","color":"#abcdef"}
            ]}"##,
        )
        .unwrap();
        let loaded = Config::load_or_default(&path);
        assert_eq!(loaded.services[0].color, "#D97757");
        assert!(loaded.services[0].sound_enabled);
        assert!(loaded.services[0].notifications_enabled);
        assert!(!loaded.do_not_disturb);
        assert!(loaded.close_to_tray);
        assert!(!loaded.sidebar_collapsed);
        assert_eq!(loaded.services[1].color, "#112233");
        assert!(loaded.services[1].preset.is_none());
        assert_eq!(loaded.services[2].color, "#abcdef");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn icons_accept_urls_emoji_and_saved_files_only() {
        assert_eq!(
            normalize_icon(Some(" https://cdn.example.com/a.png "))
                .unwrap()
                .as_deref(),
            Some("https://cdn.example.com/a.png")
        );
        assert_eq!(normalize_icon(Some("📝")).unwrap().as_deref(), Some("📝"));
        let token = "local:550e8400-e29b-41d4-a716-446655440000.png";
        assert_eq!(normalize_icon(Some(token)).unwrap().as_deref(), Some(token));
        assert!(normalize_icon(Some("file:///tmp/icon.png")).is_err());
        assert!(normalize_icon(Some(r"C:\Users\me\icon.png")).is_err());
        assert!(normalize_icon(Some("local:not-a-uuid.png")).is_err());
        assert!(normalize_icon(Some("local:../secrets.png")).is_err());
        assert!(normalize_icon(None).unwrap().is_none());
    }

    #[test]
    fn icon_bytes_must_match_the_extension() {
        assert_eq!(
            accept_icon_bytes(
                &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0],
                "PNG"
            )
            .unwrap(),
            "png"
        );
        assert_eq!(
            accept_icon_bytes(&[0xFF, 0xD8, 0xFF, 0xD9], "jpeg").unwrap(),
            "jpg"
        );
        assert_eq!(accept_icon_bytes(b"RIFF0123WEBP", "webp").unwrap(), "webp");
        assert_eq!(
            accept_icon_bytes(&[0x00, 0x00, 0x01, 0x00, 1], "ico").unwrap(),
            "ico"
        );
        assert_eq!(
            accept_icon_bytes(
                br#"<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>"#,
                ".svg"
            )
            .unwrap(),
            "svg"
        );
        assert!(accept_icon_bytes(&[0xFF, 0xD8, 0xFF], "png").is_err());
        assert!(accept_icon_bytes(br#"<svg><script>alert(1)</script></svg>"#, "svg").is_err());
        assert!(accept_icon_bytes(b"hello", "gif").is_err());
        assert!(accept_icon_bytes(&[], "png").is_err());
    }
}
