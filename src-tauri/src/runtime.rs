//! Webview lifecycle. Each service is a child webview of the main window, with
//! its own data directory, so two accounts of the same site do not share cookies.
//!
//! Creating those webviews is behind Tauri's `unstable` multiwebview API. On
//! Windows the creation has to happen off the UI thread (an async command),
//! otherwise WebView2 deadlocks.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, Webview, WebviewUrl,
};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::config::{self, Config, NewService, Service};
use crate::policy::{self, NewWindowDecision, DEFAULT_CHROME_UA};
use crate::presets;

const POPUP_LIMIT: usize = 4;
const NOTIFY_LIMIT: u32 = 20;
const OPEN_LIMIT: u32 = 40;
const RATE_WINDOW: Duration = Duration::from_secs(10);

pub struct AppState {
    config_path: PathBuf,
    data_dir: PathBuf,
    config: Mutex<Config>,
    badges: Mutex<HashMap<String, u32>>,
    bounds: Mutex<Bounds>,
    services_visible: Mutex<bool>,
    rates: Mutex<HashMap<String, RateWindow>>,
    popup_seq: AtomicU64,
}

#[derive(Clone, Copy)]
struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Default for Bounds {
    fn default() -> Self {
        Self {
            x: 232.0,
            y: 0.0,
            width: 968.0,
            height: 800.0,
        }
    }
}

struct RateWindow {
    started: Instant,
    count: u32,
}

#[derive(Clone)]
struct GuestContext {
    service_id: String,
    service_name: String,
    home: Url,
    extra_hosts: Vec<String>,
    user_agent: String,
    data_dir: PathBuf,
    script: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresetDto {
    id: &'static str,
    name: &'static str,
    url: Option<&'static str>,
    needs_url: bool,
    url_placeholder: &'static str,
    color: &'static str,
    monogram: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StateDto {
    services: Vec<Service>,
    presets: Vec<PresetDto>,
    active_id: Option<String>,
    badges: HashMap<String, u32>,
    default_user_agent: &'static str,
    config_path: String,
    data_dir: String,
    version: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddResult {
    #[serde(flatten)]
    state: StateDto,
    created_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BadgeDto {
    service_id: String,
    count: u32,
}

#[derive(serde::Deserialize)]
struct BridgeMessage {
    cmd: String,
    args: serde_json::Value,
}

impl AppState {
    pub(crate) fn initialize(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let config_dir = app.path().app_config_dir()?;
        let data_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&config_dir)?;
        fs::create_dir_all(data_dir.join("services"))?;
        let config_path = config_dir.join("config.json");
        let mut config = Config::load(&config_path);
        cleanup_orphan_sessions(&data_dir, &config);
        if config.save(&config_path).is_err() {
            // A read-only directory should not stop the window from opening.
        }
        let _ = &mut config;
        Ok(Self {
            config_path,
            data_dir,
            config: Mutex::new(config),
            badges: Mutex::new(HashMap::new()),
            bounds: Mutex::new(Bounds::default()),
            services_visible: Mutex::new(true),
            rates: Mutex::new(HashMap::new()),
            popup_seq: AtomicU64::new(1),
        })
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|err| err.into_inner())
}

fn snapshot(app: &AppHandle) -> StateDto {
    let state = app.state::<AppState>();
    let config = lock(&state.config).clone();
    let badges = lock(&state.badges).clone();
    StateDto {
        services: config.services,
        presets: presets::all()
            .iter()
            .map(|preset| PresetDto {
                id: preset.id,
                name: preset.name,
                url: preset.url,
                needs_url: preset.url.is_none(),
                url_placeholder: preset.url_placeholder,
                color: preset.color,
                monogram: preset.monogram,
            })
            .collect(),
        active_id: config.active_id,
        badges,
        default_user_agent: DEFAULT_CHROME_UA,
        config_path: state.config_path.display().to_string(),
        data_dir: state.data_dir.display().to_string(),
        version: env!("CARGO_PKG_VERSION"),
    }
}

fn persist(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let config = lock(&state.config);
    config.save(&state.config_path)
}

#[tauri::command]
pub(crate) fn get_state(app: AppHandle) -> StateDto {
    snapshot(&app)
}

#[tauri::command]
pub(crate) fn add_service(
    app: AppHandle,
    name: Option<String>,
    url: Option<String>,
    icon: Option<String>,
    user_agent: Option<String>,
    preset: Option<String>,
) -> Result<AddResult, String> {
    let created = {
        let state = app.state::<AppState>();
        let mut config = lock(&state.config);
        config.add(NewService {
            name,
            url,
            icon,
            user_agent,
            preset,
        })?
    };
    persist(&app)?;
    Ok(AddResult {
        state: snapshot(&app),
        created_id: created.id,
    })
}

#[tauri::command]
pub(crate) async fn update_service(
    app: AppHandle,
    id: String,
    name: String,
    url: String,
    icon: Option<String>,
    user_agent: Option<String>,
) -> Result<StateDto, String> {
    let recreate = {
        let state = app.state::<AppState>();
        let mut config = lock(&state.config);
        config.update(&id, name, url, icon, user_agent)?
    };
    persist(&app)?;
    if recreate {
        close_service_webview(&app, &id);
        let state = app.state::<AppState>();
        let visible = *lock(&state.services_visible);
        let active = lock(&state.config).active_id.clone();
        if visible && active.as_deref() == Some(id.as_str()) {
            ensure_service_webview(&app, &id)?;
        }
    }
    apply_layout(&app)?;
    refresh_title(&app);
    Ok(snapshot(&app))
}

#[tauri::command]
pub(crate) async fn remove_service(app: AppHandle, id: String) -> Result<StateDto, String> {
    let data_dir = {
        let state = app.state::<AppState>();
        config::service_data_dir(&state.data_dir, &id)?
    };
    {
        let state = app.state::<AppState>();
        let mut config = lock(&state.config);
        config.remove(&id)?;
    }
    persist(&app)?;
    close_service_webview(&app, &id);
    lock(&app.state::<AppState>().badges).remove(&id);
    if let Err(err) = fs::remove_dir_all(&data_dir) {
        eprintln!("could not delete session {}: {err}", data_dir.display());
    }
    let next = lock(&app.state::<AppState>().config).active_id.clone();
    if let Some(next) = next {
        if *lock(&app.state::<AppState>().services_visible) {
            ensure_service_webview(&app, &next)?;
        }
    }
    apply_layout(&app)?;
    refresh_title(&app);
    Ok(snapshot(&app))
}

#[tauri::command]
pub(crate) fn reorder_services(app: AppHandle, ids: Vec<String>) -> Result<StateDto, String> {
    {
        let state = app.state::<AppState>();
        let mut config = lock(&state.config);
        config.reorder(&ids)?;
    }
    persist(&app)?;
    Ok(snapshot(&app))
}

#[tauri::command]
pub(crate) async fn focus_service(app: AppHandle, id: String) -> Result<StateDto, String> {
    {
        let state = app.state::<AppState>();
        let mut config = lock(&state.config);
        if !config.services.iter().any(|service| service.id == id) {
            return Err("That service is no longer in the sidebar.".into());
        }
        config.active_id = Some(id.clone());
    }
    persist(&app)?;
    if *lock(&app.state::<AppState>().services_visible) {
        ensure_service_webview(&app, &id)?;
    }
    apply_layout(&app)?;
    refresh_title(&app);
    Ok(snapshot(&app))
}

#[tauri::command]
pub(crate) async fn reload_service(app: AppHandle, id: String) -> Result<(), String> {
    let label = service_label(&id);
    match app.get_webview(&label) {
        Some(webview) => webview.reload().map_err(|err| err.to_string()),
        None => {
            ensure_service_webview(&app, &id)?;
            apply_layout(&app)?;
            Ok(())
        }
    }
}

#[tauri::command]
pub(crate) async fn set_content_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if !x.is_finite() || !y.is_finite() || !width.is_finite() || !height.is_finite() {
        return Err("Bounds must be finite numbers.".into());
    }
    if width < 32.0 || height < 32.0 || x < 0.0 || y < 0.0 {
        return Ok(());
    }
    *lock(&app.state::<AppState>().bounds) = Bounds {
        x,
        y,
        width,
        height,
    };
    apply_layout(&app)
}

#[tauri::command]
pub(crate) async fn set_services_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    *lock(&app.state::<AppState>().services_visible) = visible;
    if visible {
        if let Some(id) = lock(&app.state::<AppState>().config).active_id.clone() {
            ensure_service_webview(&app, &id)?;
        }
    }
    apply_layout(&app)
}

#[tauri::command]
pub(crate) fn notify_from_service(
    app: AppHandle,
    webview: Webview,
    title: String,
    body: Option<String>,
) -> Result<(), String> {
    let Some(service_id) = service_id_from_label(webview.label()) else {
        return Err("This webview is not a service.".into());
    };
    show_notification(&app, service_id, title, body.unwrap_or_default())
}

#[tauri::command]
pub(crate) fn set_badge(app: AppHandle, webview: Webview, count: u32) -> Result<(), String> {
    let Some(service_id) = service_id_from_label(webview.label()) else {
        return Err("This webview is not a service.".into());
    };
    set_service_badge(&app, service_id, count)
}

#[tauri::command]
pub(crate) fn open_external_link(app: AppHandle, url: String) -> Result<(), String> {
    open_http_url(&app, &url)
}

fn service_label(id: &str) -> String {
    format!("svc-{id}")
}

fn service_id_from_label(label: &str) -> Option<&str> {
    if let Some(id) = label.strip_prefix("svc-") {
        return config::valid_id(id).then_some(id);
    }
    let rest = label.strip_prefix("pop-")?;
    let id = rest.get(..36)?;
    if rest.as_bytes().get(36) == Some(&b'-') && config::valid_id(id) {
        Some(id)
    } else {
        None
    }
}

fn show_notification<R: Runtime>(
    app: &AppHandle<R>,
    service_id: &str,
    title: String,
    body: String,
) -> Result<(), String> {
    if !allow_rate(app, &format!("notify:{service_id}"), NOTIFY_LIMIT) {
        return Ok(());
    }
    let title = clean_text(&title, 200);
    let body = clean_text(&body, 500);
    let title = if title.is_empty() {
        "Notification".to_string()
    } else {
        title
    };
    let name = service_name(app, service_id);
    let shown = match name {
        Some(name) if !title.eq_ignore_ascii_case(&name) => format!("{name} — {title}"),
        _ => title,
    };
    let mut builder = app.notification().builder().title(shown);
    if !body.is_empty() {
        builder = builder.body(body);
    }
    if let Err(err) = builder.show() {
        eprintln!("notification failed: {err}");
    }
    Ok(())
}

fn set_service_badge<R: Runtime>(
    app: &AppHandle<R>,
    service_id: &str,
    count: u32,
) -> Result<(), String> {
    let count = count.min(999);
    {
        let state = app.state::<AppState>();
        let mut badges = lock(&state.badges);
        if badges.get(service_id).copied() == Some(count) {
            return Ok(());
        }
        badges.insert(service_id.to_string(), count);
    }
    if let Some(shell) = app.get_webview("main") {
        let _ = shell.emit(
            "badge-updated",
            BadgeDto {
                service_id: service_id.to_string(),
                count,
            },
        );
    }
    Ok(())
}

fn open_http_url<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<(), String> {
    if url.len() > 4096 {
        return Err("URL is too long.".into());
    }
    let parsed = Url::parse(url).map_err(|_| "Could not open that link.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http and https links open in the system browser.".into());
    }
    if !allow_rate(app, "external", OPEN_LIMIT) {
        return Ok(());
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|err| format!("Could not open the system browser: {err}"))
}

fn allow_rate<R: Runtime>(app: &AppHandle<R>, key: &str, limit: u32) -> bool {
    let state = app.state::<AppState>();
    let mut rates = lock(&state.rates);
    let now = Instant::now();
    let entry = rates.entry(key.to_string()).or_insert(RateWindow {
        started: now,
        count: 0,
    });
    if now.duration_since(entry.started) > RATE_WINDOW {
        entry.started = now;
        entry.count = 0;
    }
    if entry.count >= limit {
        return false;
    }
    entry.count += 1;
    true
}

fn clean_text(value: &str, max_chars: usize) -> String {
    value
        .chars()
        .filter(|ch| *ch == '\n' || *ch == '\t' || !ch.is_control())
        .take(max_chars)
        .collect::<String>()
        .trim()
        .to_string()
}

fn service_name<R: Runtime>(app: &AppHandle<R>, id: &str) -> Option<String> {
    lock(&app.state::<AppState>().config)
        .services
        .iter()
        .find(|service| service.id == id)
        .map(|service| service.name.clone())
}

fn service_by_id(app: &AppHandle, id: &str) -> Result<Service, String> {
    lock(&app.state::<AppState>().config)
        .services
        .iter()
        .find(|service| service.id == id)
        .cloned()
        .ok_or_else(|| "That service is no longer in the sidebar.".to_string())
}

fn user_agent_for(service: &Service) -> String {
    service
        .user_agent
        .clone()
        .filter(|agent| !agent.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_CHROME_UA.to_string())
}

fn guest_context(app: &AppHandle, service: &Service) -> Result<GuestContext, String> {
    let home = Url::parse(&service.url).map_err(|err| format!("Service URL is invalid: {err}"))?;
    let state = app.state::<AppState>();
    let data_dir = config::service_data_dir(&state.data_dir, &service.id)?;
    fs::create_dir_all(&data_dir)
        .map_err(|err| format!("Could not create the session folder: {err}"))?;
    let extra_hosts = presets::extra_hosts(service.preset.as_deref());
    let script = policy::inject_script(&home, &extra_hosts);
    Ok(GuestContext {
        service_id: service.id.clone(),
        service_name: service.name.clone(),
        home,
        extra_hosts,
        user_agent: user_agent_for(service),
        data_dir,
        script,
    })
}

fn ensure_service_webview(app: &AppHandle, id: &str) -> Result<(), String> {
    let label = service_label(id);
    if app.get_webview(&label).is_some() {
        return Ok(());
    }
    let service = service_by_id(app, id)?;
    let ctx = guest_context(app, &service)?;
    let window = app
        .get_window("main")
        .ok_or_else(|| "The main window is not open.".to_string())?;
    let bounds = *lock(&app.state::<AppState>().bounds);
    let size = LogicalSize::new(bounds.width.max(100.0), bounds.height.max(100.0));
    let position = LogicalPosition::new(bounds.x, bounds.y);
    let app_for_window = app.clone();
    let ctx_for_window = ctx.clone();
    let app_for_title = app.clone();
    let service_id = ctx.service_id.clone();
    let builder =
        tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(ctx.home.clone()))
            .user_agent(&ctx.user_agent)
            .data_directory(ctx.data_dir.clone())
            .initialization_script_for_all_frames(&ctx.script)
            .zoom_hotkeys_enabled(true)
            .accept_first_mouse(true)
            .devtools(cfg!(debug_assertions))
            .on_navigation(policy::allow_navigation)
            .on_new_window(move |url, features| {
                handle_new_window(&app_for_window, &ctx_for_window, url, features)
            })
            .on_document_title_changed(move |_webview, title| {
                handle_title(&app_for_title, &service_id, &title);
            })
            .on_permission_request(|_webview, kind| {
                use tauri::webview::{PermissionKind, PermissionResponse};
                if matches!(kind, PermissionKind::Notifications) {
                    PermissionResponse::Allow
                } else {
                    PermissionResponse::Default
                }
            });
    window
        .add_child(builder, position, size)
        .map_err(|err| format!("Could not open the service: {err}"))?;
    Ok(())
}

fn close_service_webview(app: &AppHandle, id: &str) {
    if let Some(webview) = app.get_webview(&service_label(id)) {
        let _ = webview.close();
    }
}

fn apply_layout(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let bounds = *lock(&state.bounds);
    let visible = *lock(&state.services_visible);
    let active = lock(&state.config).active_id.clone();
    let services = lock(&state.config).services.clone();
    for service in services {
        let Some(webview) = app.get_webview(&service_label(&service.id)) else {
            continue;
        };
        let show = visible
            && active.as_deref() == Some(service.id.as_str())
            && bounds.width >= 32.0
            && bounds.height >= 32.0;
        if show {
            webview
                .set_position(LogicalPosition::new(bounds.x, bounds.y))
                .map_err(|err| err.to_string())?;
            webview
                .set_size(LogicalSize::new(bounds.width, bounds.height))
                .map_err(|err| err.to_string())?;
            webview.show().map_err(|err| err.to_string())?;
        } else {
            webview.hide().map_err(|err| err.to_string())?;
        }
        // WebKitGTK packs child webviews into the window's vertical box, which
        // splits the shell in half. Pin them to a fixed overlay instead.
        #[cfg(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "openbsd",
            target_os = "netbsd"
        ))]
        if show {
            crate::linux_stage::place_child(
                &webview,
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
            )?;
        }
    }
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd"
    ))]
    crate::linux_stage::place_shell(app)?;
    Ok(())
}

fn refresh_title(app: &AppHandle) {
    let state = app.state::<AppState>();
    let config = lock(&state.config);
    let active_name = config.active_id.as_ref().and_then(|id| {
        config
            .services
            .iter()
            .find(|service| &service.id == id)
            .map(|service| service.name.clone())
    });
    drop(config);
    let title = match active_name {
        Some(name) => format!("{name} — Rustbox"),
        None => "Rustbox".to_string(),
    };
    if let Some(window) = app.get_window("main") {
        let _ = window.set_title(&title);
    }
}

fn handle_title<R: Runtime>(app: &AppHandle<R>, service_id: &str, title: &str) {
    if let Some(rest) = title.strip_prefix('\u{2063}') {
        if let Ok(message) = serde_json::from_str::<BridgeMessage>(rest) {
            dispatch_bridge(app, service_id, message);
        }
        return;
    }
    if let Some(count) = policy::unread_from_title(title) {
        let _ = set_service_badge(app, service_id, count);
    }
}

fn dispatch_bridge<R: Runtime>(app: &AppHandle<R>, service_id: &str, message: BridgeMessage) {
    let args = message.args;
    let result = match message.cmd.as_str() {
        "notify_from_service" => {
            let title = args
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or("Notification");
            let body = args
                .get("body")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            show_notification(app, service_id, title.to_string(), body.to_string())
        }
        "set_badge" => {
            let count = args
                .get("count")
                .and_then(|value| value.as_u64())
                .unwrap_or(0) as u32;
            set_service_badge(app, service_id, count)
        }
        "open_external_link" => {
            let url = args
                .get("url")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            open_http_url(app, url)
        }
        _ => Ok(()),
    };
    if let Err(err) = result {
        eprintln!("service bridge failed: {err}");
    }
}

fn handle_new_window<R: Runtime>(
    app: &AppHandle<R>,
    ctx: &GuestContext,
    url: Url,
    features: tauri::webview::NewWindowFeatures,
) -> NewWindowResponse<R> {
    match policy::new_window_decision(&url, &ctx.home, &ctx.extra_hosts) {
        NewWindowDecision::External => {
            let _ = open_http_url(app, url.as_str());
            NewWindowResponse::Deny
        }
        NewWindowDecision::Ignore => NewWindowResponse::Deny,
        NewWindowDecision::InApp => match create_popup(app, ctx, url.clone(), features) {
            Ok(window) => NewWindowResponse::Create { window },
            Err(err) => {
                eprintln!("sign-in window failed ({err}); opening externally");
                let _ = open_http_url(app, url.as_str());
                NewWindowResponse::Deny
            }
        },
    }
}

fn create_popup<R: Runtime>(
    app: &AppHandle<R>,
    ctx: &GuestContext,
    url: Url,
    features: tauri::webview::NewWindowFeatures,
) -> Result<tauri::WebviewWindow<R>, String> {
    let prefix = format!("pop-{}-", ctx.service_id);
    let open = app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with(&prefix))
        .count();
    if open >= POPUP_LIMIT {
        return Err(format!("already {POPUP_LIMIT} sign-in windows open"));
    }
    let seq = app
        .state::<AppState>()
        .popup_seq
        .fetch_add(1, Ordering::Relaxed);
    let label = format!("pop-{}-{seq}", ctx.service_id);
    let app_for_window = app.clone();
    let ctx_for_window = ctx.clone();
    let app_for_title = app.clone();
    let service_id = ctx.service_id.clone();
    let builder = tauri::WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .title(format!("{} — sign in", ctx.service_name))
        .inner_size(520.0, 720.0)
        .min_inner_size(360.0, 480.0)
        .center()
        .user_agent(&ctx.user_agent)
        .data_directory(ctx.data_dir.clone())
        .initialization_script_for_all_frames(&ctx.script)
        .zoom_hotkeys_enabled(true)
        .window_features(features)
        .on_navigation(policy::allow_navigation)
        .on_new_window(move |next, next_features| {
            handle_new_window(&app_for_window, &ctx_for_window, next, next_features)
        })
        .on_document_title_changed(move |_window, title| {
            handle_title(&app_for_title, &service_id, &title);
        });
    builder.build().map_err(|err| err.to_string())
}

fn cleanup_orphan_sessions(data_dir: &Path, config: &Config) {
    let root = data_dir.join("services");
    let Ok(entries) = fs::read_dir(&root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !config::valid_id(name) {
            continue;
        }
        if config.services.iter().any(|service| service.id == name) {
            continue;
        }
        if let Err(err) = fs::remove_dir_all(entry.path()) {
            eprintln!("could not remove leftover session {name}: {err}");
        }
    }
}
