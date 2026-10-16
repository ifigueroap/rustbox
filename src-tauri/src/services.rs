use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
#[cfg(not(target_os = "linux"))]
use tauri::Rect;
use tauri::webview::{Color, NewWindowResponse, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};
use tauri_plugin_notification::NotificationExt;
use url::Url;

use crate::config::{
    Config, PRESETS, PresetInfo, Service, import_legacy_sessions, legacy_config_candidates,
    legacy_session_roots,
};
use crate::policy::{self, PopupDecision};
use crate::shortcuts::{self, ShortcutDestination};

pub struct RuntimeState {
    pub config_path: PathBuf,
    pub sessions_dir: PathBuf,
    pub config: Mutex<Config>,
    pub active_id: Mutex<Option<String>>,
    pub unread: Mutex<HashMap<String, u32>>,
    pub notify_times: Mutex<HashMap<String, VecDeque<Instant>>>,
    pub ops: Mutex<()>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceDto {
    pub id: String,
    pub name: String,
    pub url: String,
    pub icon: Option<String>,
    pub color: String,
    pub user_agent: Option<String>,
    pub use_chrome_user_agent: bool,
    pub preset: Option<String>,
    pub sound_enabled: bool,
    pub notifications_enabled: bool,
    pub unread: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub services: Vec<ServiceDto>,
    pub active_id: Option<String>,
    pub chrome_user_agent: String,
    pub config_path: String,
    pub sessions_dir: String,
    pub sidebar_collapsed: bool,
    pub do_not_disturb: bool,
    pub app_version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UnreadEvent {
    service_id: String,
    count: u32,
}

impl RuntimeState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let config_dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
        let data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
        std::fs::create_dir_all(&config_dir).map_err(|err| err.to_string())?;
        let sessions_dir = data_dir.join("sessions");
        std::fs::create_dir_all(&sessions_dir).map_err(|err| err.to_string())?;
        let config_path = config_dir.join("config.json");
        let local_data_dir = app
            .path()
            .app_local_data_dir()
            .unwrap_or_else(|_| data_dir.clone());
        let candidates = legacy_config_candidates(&config_dir, &data_dir, &local_data_dir);
        let (config, imported_legacy) = Config::load_adopting_legacy(&config_path, &candidates);
        if imported_legacy {
            for root in legacy_session_roots(&config_dir, &data_dir, &local_data_dir) {
                if let Err(err) = import_legacy_sessions(&root, &sessions_dir) {
                    eprintln!(
                        "rustbox: could not import previous sessions from {}: {err}",
                        root.display()
                    );
                }
            }
        }
        Ok(Self {
            config_path,
            sessions_dir,
            config: Mutex::new(config),
            active_id: Mutex::new(None),
            unread: Mutex::new(HashMap::new()),
            notify_times: Mutex::new(HashMap::new()),
            ops: Mutex::new(()),
        })
    }
}

pub fn snapshot(app: &AppHandle) -> Snapshot {
    let state = app.state::<RuntimeState>();
    let config = lock(&state.config);
    let active_id = lock(&state.active_id).clone();
    let unread = lock(&state.unread);
    let services = config
        .services
        .iter()
        .map(|service| {
            let count = unread.get(&service.id).copied().unwrap_or(0);
            let shown =
                policy::notifications_shown(config.do_not_disturb, service.notifications_enabled);
            ServiceDto {
                id: service.id.clone(),
                name: service.name.clone(),
                url: service.url.clone(),
                icon: service.icon.clone(),
                color: service.color.clone(),
                user_agent: service.user_agent.clone(),
                use_chrome_user_agent: service.use_chrome_user_agent,
                preset: service.preset.clone(),
                sound_enabled: service.sound_enabled,
                notifications_enabled: service.notifications_enabled,
                unread: if shown { count } else { 0 },
            }
        })
        .collect();
    Snapshot {
        services,
        active_id,
        chrome_user_agent: policy::chrome_user_agent(),
        config_path: state.config_path.display().to_string(),
        sessions_dir: state.sessions_dir.display().to_string(),
        sidebar_collapsed: config.sidebar_collapsed,
        do_not_disturb: config.do_not_disturb,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

pub fn presets() -> Vec<PresetInfo> {
    PRESETS.iter().map(PresetInfo::from).collect()
}

pub fn mutate<F>(app: &AppHandle, change: F) -> Result<(), String>
where
    F: FnOnce(&mut Config) -> Result<(), String>,
{
    let state = app.state::<RuntimeState>();
    let mut config = lock(&state.config);
    let previous = config.clone();
    change(&mut config)?;
    if let Err(err) = config.save(&state.config_path) {
        *config = previous;
        return Err(err);
    }
    Ok(())
}

pub fn set_active(app: &AppHandle, id: Option<String>) -> Result<(), String> {
    let state = app.state::<RuntimeState>();
    let _ops = lock(&state.ops);
    match id {
        Some(id) => {
            let service = {
                let config = lock(&state.config);
                config
                    .services
                    .iter()
                    .find(|service| service.id == id)
                    .cloned()
                    .ok_or_else(|| "service not found".to_string())?
            };
            hide_others(app, Some(&service.id))?;
            ensure_webview(app, &service)?;
            show_webview(app, &service.id)?;
            *lock(&state.active_id) = Some(service.id);
            set_window_title(app, Some(&service.name));
        }
        None => {
            hide_others(app, None)?;
            *lock(&state.active_id) = None;
            set_window_title(app, None);
        }
    }
    Ok(())
}

/// Apply a shell shortcut using the current sidebar order. Returns whether
/// the open service changed. Emits `app-snapshot` so the desk updates when
/// the key came from a service webview.
pub fn apply_shortcut(
    app: &AppHandle,
    key: &str,
    ctrl_or_meta: bool,
    shift: bool,
    alt: bool,
) -> Result<bool, String> {
    let Some(shortcut) = shortcuts::parse_service_shortcut(key, ctrl_or_meta, shift, alt) else {
        return Ok(false);
    };
    let (ids, active_index) = {
        let state = app.state::<RuntimeState>();
        let config = lock(&state.config);
        let ids: Vec<String> = config
            .services
            .iter()
            .map(|service| service.id.clone())
            .collect();
        let active = lock(&state.active_id).clone();
        let active_index = active
            .as_ref()
            .and_then(|id| ids.iter().position(|item| item == id));
        (ids, active_index)
    };
    let Some(destination) = shortcuts::shortcut_destination(ids.len(), active_index, shortcut)
    else {
        return Ok(false);
    };
    match destination {
        ShortcutDestination::Desk => set_active(app, None)?,
        ShortcutDestination::Service(index) => set_active(app, Some(ids[index].clone()))?,
    }
    let _ = app.emit("app-snapshot", snapshot(app));
    Ok(true)
}

pub fn close_service_webview(app: &AppHandle, id: &str) -> Result<(), String> {
    let state = app.state::<RuntimeState>();
    let _ops = lock(&state.ops);
    close_webview(app, id)
}

pub fn recreate_if_active(app: &AppHandle, id: &str) -> Result<(), String> {
    let state = app.state::<RuntimeState>();
    let _ops = lock(&state.ops);
    let active = lock(&state.active_id).clone();
    if active.as_deref() != Some(id) {
        close_webview(app, id)?;
        return Ok(());
    }
    close_webview(app, id)?;
    let service = {
        let config = lock(&state.config);
        config
            .services
            .iter()
            .find(|service| service.id == id)
            .cloned()
    };
    if let Some(service) = service {
        ensure_webview(app, &service)?;
        show_webview(app, &service.id)?;
        set_window_title(app, Some(&service.name));
    }
    Ok(())
}

pub fn clear_runtime_service(app: &AppHandle, id: &str) {
    let state = app.state::<RuntimeState>();
    lock(&state.unread).remove(id);
    lock(&state.notify_times).remove(id);
    let mut active = lock(&state.active_id);
    if active.as_deref() == Some(id) {
        *active = None;
        set_window_title(app, None);
    }
}

pub fn delete_session_dir(app: &AppHandle, id: &str) {
    let state = app.state::<RuntimeState>();
    let dir = state.sessions_dir.join(id);
    if let Err(err) = std::fs::remove_dir_all(&dir) {
        if err.kind() != std::io::ErrorKind::NotFound {
            eprintln!("rustbox: could not delete {}: {err}", dir.display());
        }
    }
}

pub fn sync_bounds(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<RuntimeState>();
    let Ok(_ops) = state.ops.try_lock() else {
        return Ok(());
    };
    let window = main_window(app)?;
    let (position, size) = content_bounds(app, &window)?;
    #[cfg(target_os = "linux")]
    {
        let scale = window.scale_factor().map_err(|err| err.to_string())?;
        let physical = window.inner_size().map_err(|err| err.to_string())?;
        let logical: LogicalSize<f64> = physical.to_logical(scale);
        crate::linux_host::sync(logical, position, size);
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let ids: Vec<String> = lock(&state.config)
            .services
            .iter()
            .map(|service| service.id.clone())
            .collect();
        for id in ids {
            if let Some(webview) = app.get_webview(&label_for(&id)) {
                let muted = service_sound_muted(app, &id);
                let _ = place_webview(&webview, position, size, muted);
            }
        }
        Ok(())
    }
}

pub fn note_title(app: &AppHandle, service_id: &str, title: &str) {
    let count = policy::parse_unread_count(title);
    let state = app.state::<RuntimeState>();
    let changed = {
        let mut unread = lock(&state.unread);
        if unread.get(service_id).copied() == Some(count) {
            false
        } else {
            unread.insert(service_id.to_string(), count);
            true
        }
    };
    if changed {
        let visible = if notifications_visible(&state, service_id) {
            count
        } else {
            0
        };
        let _ = app.emit(
            "unread-count",
            UnreadEvent {
                service_id: service_id.to_string(),
                count: visible,
            },
        );
    }
}

pub fn forward_notification(
    app: &AppHandle,
    label: &str,
    title: &str,
    body: &str,
) -> Result<(), String> {
    let Some(service_id) = label.strip_prefix("svc-").filter(|id| !id.is_empty()) else {
        return Err("notifications are only accepted from service webviews".into());
    };
    let state = app.state::<RuntimeState>();
    let name = {
        let config = lock(&state.config);
        config
            .services
            .iter()
            .find(|service| service.id == service_id)
            .map(|service| service.name.clone())
            .unwrap_or_else(|| "Rustbox".to_string())
    };
    if !notifications_visible(&state, service_id) {
        return Ok(());
    }
    if !allow_notification(&state, service_id) {
        return Ok(());
    }
    let title = clip(title.trim(), 180);
    let body = clip(body.trim(), 500);
    let heading = if title.is_empty() {
        name
    } else {
        format!("{name}: {title}")
    };
    let mut builder = app.notification().builder().title(heading);
    if !body.is_empty() {
        builder = builder.body(body);
    }
    builder.show().map_err(|err| err.to_string())
}

pub fn refresh_title_if_active(app: &AppHandle, id: &str) {
    let state = app.state::<RuntimeState>();
    let active = lock(&state.active_id).clone();
    if active.as_deref() != Some(id) {
        return;
    }
    let name = lock(&state.config)
        .services
        .iter()
        .find(|service| service.id == id)
        .map(|service| service.name.clone());
    if let Some(name) = name {
        set_window_title(app, Some(&name));
    }
}

fn notifications_visible(state: &RuntimeState, service_id: &str) -> bool {
    let config = lock(&state.config);
    let enabled = config
        .services
        .iter()
        .find(|service| service.id == service_id)
        .map(|service| service.notifications_enabled)
        .unwrap_or(true);
    policy::notifications_shown(config.do_not_disturb, enabled)
}

fn service_sound_muted(app: &AppHandle, id: &str) -> bool {
    let state = app.state::<RuntimeState>();
    let config = lock(&state.config);
    let enabled = config
        .services
        .iter()
        .find(|service| service.id == id)
        .map(|service| service.sound_enabled)
        .unwrap_or(true);
    policy::sound_muted(config.do_not_disturb, enabled)
}

pub fn apply_sound_policy(app: &AppHandle) {
    let ids: Vec<String> = {
        let state = app.state::<RuntimeState>();
        lock(&state.config)
            .services
            .iter()
            .map(|service| service.id.clone())
            .collect()
    };
    for id in ids {
        let muted = service_sound_muted(app, &id);
        if let Some(webview) = app.get_webview(&label_for(&id)) {
            apply_webview_sound(&webview, muted);
        }
        #[cfg(target_os = "linux")]
        {
            crate::linux_host::set_muted(&label_for(&id), muted);
        }
    }
}

fn apply_webview_sound(webview: &tauri::Webview, muted: bool) {
    let enabled = if muted { "false" } else { "true" };
    if let Err(err) = webview.eval(format!("window.__rustboxSetSound?.({enabled});")) {
        eprintln!("rustbox: could not update service sound: {err}");
    }
}

fn initialization_script(muted: bool) -> String {
    let enabled = if muted { "false" } else { "true" };
    format!(
        "{}\nwindow.__rustboxSetSound({enabled});",
        include_str!("inject.js")
    )
}

fn allow_notification(state: &RuntimeState, service_id: &str) -> bool {
    const WINDOW: Duration = Duration::from_secs(20);
    const MAX_NOTIFICATIONS: usize = 6;
    let mut times = lock(&state.notify_times);
    let entries = times.entry(service_id.to_string()).or_default();
    let now = Instant::now();
    entries.retain(|stamp| now.duration_since(*stamp) < WINDOW);
    if entries.len() >= MAX_NOTIFICATIONS {
        return false;
    }
    entries.push_back(now);
    true
}

fn ensure_webview(app: &AppHandle, service: &Service) -> Result<(), String> {
    let label = label_for(&service.id);
    if app.get_webview(&label).is_some() {
        return Ok(());
    }
    let window = main_window(app)?;
    let (position, size) = content_bounds(app, &window)?;
    let url = Url::parse(&service.url).map_err(|err| err.to_string())?;
    let popup_home = url.clone();
    let service_id = service.id.clone();
    let title_app = app.clone();

    let muted = service_sound_muted(app, &service.id);
    let mut builder = WebviewBuilder::new(label, WebviewUrl::External(url))
        .initialization_script(initialization_script(muted))
        .on_navigation(|target| policy::allow_main_navigation(target))
        .on_new_window(move |target, _features| {
            match policy::popup_decision(&popup_home, &target) {
                PopupDecision::Allow => NewWindowResponse::Allow,
                PopupDecision::External => {
                    policy::open_external_detached(target.as_str());
                    NewWindowResponse::Deny
                }
                PopupDecision::Deny => NewWindowResponse::Deny,
            }
        })
        .on_document_title_changed(move |_window, title| {
            note_title(&title_app, &service_id, &title);
        })
        .background_color(Color(20, 18, 16, 255))
        .zoom_hotkeys_enabled(true)
        .devtools(cfg!(debug_assertions));

    builder = isolate_session(builder, app, service)?;
    if let Some(agent) = service.resolved_user_agent() {
        builder = builder.user_agent(&agent);
    }

    window
        .add_child(builder, position, size)
        .map_err(|err| format!("could not open {}: {err}", service.name))?;
    Ok(())
}

fn place_webview(
    webview: &tauri::Webview,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
    muted: bool,
) -> Result<(), String> {
    // Linux child webviews are packed into the window's vertical GtkBox, which
    // ignores coordinates and splits the window. Place them on our GtkFixed.
    // Elsewhere, set_bounds writes both fields. set_position/set_size read the
    // current frame back, and on a brand-new webview that frame is still 0×0.
    #[cfg(target_os = "linux")]
    {
        return crate::linux_host::place(webview, position, size, muted);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = muted;
        webview
            .set_bounds(Rect {
                position: position.into(),
                size: size.into(),
            })
            .map_err(|err| err.to_string())
    }
}

fn isolate_session(
    builder: WebviewBuilder<tauri::Wry>,
    app: &AppHandle,
    service: &Service,
) -> Result<WebviewBuilder<tauri::Wry>, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        Ok(builder.data_store_identifier(store_id(&service.id)))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let state = app.state::<RuntimeState>();
        let dir = state.sessions_dir.join(&service.id);
        std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
        Ok(builder.data_directory(dir))
    }
}

#[cfg(target_os = "macos")]
fn store_id(service_id: &str) -> [u8; 16] {
    uuid::Uuid::parse_str(service_id)
        .map(|id| *id.as_bytes())
        .unwrap_or([1; 16])
}

fn show_webview(app: &AppHandle, id: &str) -> Result<(), String> {
    let window = main_window(app)?;
    let (position, size) = content_bounds(app, &window)?;
    let webview = app
        .get_webview(&label_for(id))
        .ok_or_else(|| "service webview is missing".to_string())?;
    let muted = service_sound_muted(app, id);
    place_webview(&webview, position, size, muted)?;
    apply_webview_sound(&webview, muted);
    webview.show().map_err(|err| err.to_string())?;
    let _ = webview.set_focus();
    Ok(())
}

fn hide_others(app: &AppHandle, except: Option<&str>) -> Result<(), String> {
    let state = app.state::<RuntimeState>();
    let ids: Vec<String> = lock(&state.config)
        .services
        .iter()
        .map(|service| service.id.clone())
        .collect();
    for id in ids {
        if except == Some(id.as_str()) {
            continue;
        }
        if let Some(webview) = app.get_webview(&label_for(&id)) {
            webview.hide().map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn close_webview(app: &AppHandle, id: &str) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label_for(id)) {
        webview.close().map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn content_bounds(
    app: &AppHandle,
    window: &tauri::Window,
) -> Result<(LogicalPosition<f64>, LogicalSize<f64>), String> {
    let state = app.state::<RuntimeState>();
    let sidebar = policy::sidebar_width(lock(&state.config).sidebar_collapsed);
    let scale = window.scale_factor().map_err(|err| err.to_string())?;
    let physical = window.inner_size().map_err(|err| err.to_string())?;
    let logical: LogicalSize<f64> = physical.to_logical(scale);
    Ok((
        LogicalPosition::new(sidebar, 0.0),
        LogicalSize::new((logical.width - sidebar).max(0.0), logical.height.max(0.0)),
    ))
}

fn main_window(app: &AppHandle) -> Result<tauri::Window, String> {
    app.get_window("main")
        .ok_or_else(|| "main window is not available".to_string())
}

fn set_window_title(app: &AppHandle, service_name: Option<&str>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let title = match service_name {
        Some(name) if !name.is_empty() => format!("{name} - Rustbox"),
        _ => "Rustbox".to_string(),
    };
    let _ = window.set_title(&title);
}

pub fn label_for(id: &str) -> String {
    format!("svc-{id}")
}

fn clip(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

pub fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|err| err.into_inner())
}

pub fn validate_external_url(raw: &str) -> Result<String, String> {
    let url = Url::parse(raw.trim()).map_err(|err| format!("URL: {err}"))?;
    match url.scheme() {
        "http" | "https" | "mailto" | "tel" => Ok(url.to_string()),
        _ => Err("only http, https, mailto, and tel links can be opened".into()),
    }
}
