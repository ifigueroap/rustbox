mod backup;
mod backup_commands;
mod autostart;
mod config;
mod dnd_schedule;
mod i18n;
#[cfg(target_os = "linux")]
mod linux_host;
mod page_tools;
mod policy;
mod services;
mod shortcuts;
mod tray;
mod updates;
mod zoom;

use config::{LanguagePreference, NewService, NewWorkspace, ServiceUpdate, Theme, WorkspaceUpdate};
use i18n::Locale;
use services::{RuntimeState, Snapshot};
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use updates::UpdateStatus;

#[tauri::command]
fn set_dnd_schedule(
    app: tauri::AppHandle,
    workspace_id: Option<String>,
    schedule: dnd_schedule::Schedule,
) -> Result<Snapshot, String> {
    let schedule = dnd_schedule::validate(schedule)?;
    services::mutate(&app, |config| {
        if let Some(id) = workspace_id {
            let workspace = config
                .workspaces
                .iter_mut()
                .find(|w| w.id == id)
                .ok_or("workspace not found")?;
            workspace.set_schedule(schedule, dnd_schedule::local_now())?;
        } else {
            config.do_not_disturb = config.effective_do_not_disturb();
            config.dnd_schedule = schedule;
            config.dnd_override = None;
        }
        Ok(())
    })?;
    services::apply_sound_policy(&app);
    tray::sync(&app);
    let snapshot = services::snapshot(&app);
    let _ = app.emit("app-snapshot", snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
fn get_state(app: tauri::AppHandle) -> Snapshot {
    reconcile_start_at_login(&app);
    services::snapshot(&app)
}

#[tauri::command]
fn list_presets() -> Vec<config::PresetInfo> {
    services::presets()
}

#[tauri::command]
fn add_preset(
    app: tauri::AppHandle,
    preset_id: String,
    server_url: Option<String>,
) -> Result<Snapshot, String> {
    services::mutate(&app, |config| {
        config.add_preset(&preset_id, server_url.as_deref())?;
        Ok(())
    })?;
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn add_custom(app: tauri::AppHandle, service: NewService) -> Result<Snapshot, String> {
    services::mutate(&app, |config| {
        config.add_custom(service)?;
        Ok(())
    })?;
    services::discard_unused_local_icons(&app);
    Ok(services::snapshot(&app))
}

#[tauri::command]
async fn update_service(app: tauri::AppHandle, service: ServiceUpdate) -> Result<Snapshot, String> {
    let id = service.id.clone();
    let mut reload = false;
    services::mutate(&app, |config| {
        reload = config.update_service(service)?;
        Ok(())
    })?;
    if reload {
        services::recreate_if_active(&app, &id)?;
    } else {
        services::refresh_title_if_active(&app, &id);
    }
    services::discard_unused_local_icons(&app);
    Ok(services::snapshot(&app))
}

#[tauri::command]
async fn remove_service(app: tauri::AppHandle, id: String) -> Result<Snapshot, String> {
    services::close_service_webview(&app, &id)?;
    services::mutate(&app, |config| {
        config.remove_service(&id)?;
        Ok(())
    })?;
    services::clear_runtime_service(&app, &id);
    services::delete_session_dir(&app, &id);
    services::discard_unused_local_icons(&app);
    tray::sync(&app);
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn reorder_services(app: tauri::AppHandle, ids: Vec<String>) -> Result<Snapshot, String> {
    services::mutate(&app, |config| config.reorder(&ids))?;
    Ok(services::snapshot(&app))
}

#[tauri::command]
async fn set_active_service(app: tauri::AppHandle, id: Option<String>) -> Result<Snapshot, String> {
    services::set_active(&app, id)?;
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn set_sidebar_collapsed(app: tauri::AppHandle, collapsed: bool) -> Result<Snapshot, String> {
    services::mutate(&app, |config| {
        config.sidebar_collapsed = collapsed;
        Ok(())
    })?;
    services::sync_bounds(&app)?;
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn set_service_sound(app: tauri::AppHandle, id: String, enabled: bool) -> Result<Snapshot, String> {
    services::mutate(&app, |config| {
        let service = config
            .services
            .iter_mut()
            .find(|service| service.id == id)
            .ok_or_else(|| "service not found".to_string())?;
        service.sound_enabled = enabled;
        Ok(())
    })?;
    services::apply_sound_policy(&app);
    tray::sync(&app);
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn set_service_notifications(
    app: tauri::AppHandle,
    id: String,
    enabled: bool,
) -> Result<Snapshot, String> {
    services::mutate(&app, |config| {
        let service = config
            .services
            .iter_mut()
            .find(|service| service.id == id)
            .ok_or_else(|| "service not found".to_string())?;
        service.notifications_enabled = enabled;
        Ok(())
    })?;
    tray::sync(&app);
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn set_service_notify_in_dnd(
    app: tauri::AppHandle,
    id: String,
    enabled: bool,
) -> Result<Snapshot, String> {
    services::mutate(&app, |config| {
        let service = config
            .services
            .iter_mut()
            .find(|service| service.id == id)
            .ok_or_else(|| "service not found".to_string())?;
        service.notify_in_dnd = enabled;
        Ok(())
    })?;
    services::apply_sound_policy(&app);
    tray::sync(&app);
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn set_do_not_disturb(app: tauri::AppHandle, enabled: bool) -> Result<Snapshot, String> {
    tray::store_do_not_disturb(&app, enabled)?;
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn set_close_to_tray(app: tauri::AppHandle, enabled: bool) -> Result<Snapshot, String> {
    tray::store_close_to_tray(&app, enabled)?;
    Ok(services::snapshot(&app))
}

fn reconcile_start_at_login(app: &tauri::AppHandle) {
    let result = autostart::is_enabled().and_then(|enabled| {
        if services::lock(&app.state::<RuntimeState>().config).start_at_login != enabled {
            services::mutate(app, |config| {
                config.start_at_login = enabled;
                Ok(())
            })?;
        }
        Ok(())
    });
    autostart::set_error(result.is_err());
}

/// Add or remove the OS login entry. The entry's hidden-launch argument
/// follows the already-saved `start_hidden` preference.
#[tauri::command]
fn set_start_at_login(app: tauri::AppHandle, enabled: bool) -> Result<Snapshot, String> {
    let hidden = services::lock(&app.state::<RuntimeState>().config).start_hidden;
    if enabled {
        autostart::enable(hidden)?;
    } else {
        autostart::disable()?;
    }
    services::mutate(&app, |config| {
        config.start_at_login = enabled;
        Ok(())
    })?;
    reconcile_start_at_login(&app);
    Ok(services::snapshot(&app))
}

/// Change whether a login-triggered launch skips showing the window. Only
/// rewrites the OS login entry when one is already registered; otherwise
/// just the preference is saved, ready for the next `set_start_at_login`.
#[tauri::command]
fn set_start_hidden(app: tauri::AppHandle, enabled: bool) -> Result<Snapshot, String> {
    let start_at_login = autostart::is_enabled()?;
    if enabled && app.tray_by_id("rustbox").is_none() {
        return Err("tray unavailable".into());
    }
    if start_at_login {
        autostart::enable(enabled)?;
    }
    services::mutate(&app, |config| {
        config.start_at_login = start_at_login;
        config.start_hidden = enabled;
        Ok(())
    })?;
    reconcile_start_at_login(&app);
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    tray::request_quit(&app);
}

#[tauri::command]
fn set_theme(app: tauri::AppHandle, theme: Theme) -> Result<Snapshot, String> {
    services::mutate(&app, |config| {
        config.theme = theme;
        Ok(())
    })?;
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn set_language(
    app: tauri::AppHandle,
    language: LanguagePreference,
    locale: Option<Locale>,
) -> Result<Snapshot, String> {
    services::mutate(&app, |config| {
        config.language = language;
        Ok(())
    })?;
    i18n::set_ui_locale(locale.unwrap_or_else(|| i18n::resolve_preference(language)));
    tray::sync(&app);
    Ok(services::snapshot(&app))
}

/// The shell resolved `system` with `navigator.language`. Relabel native UI
/// without writing the config again.
#[tauri::command]
fn set_ui_locale(app: tauri::AppHandle, locale: Locale) {
    i18n::set_ui_locale(locale);
    tray::sync(&app);
}

#[tauri::command]
fn add_workspace(app: tauri::AppHandle, workspace: NewWorkspace) -> Result<Snapshot, String> {
    let mut created_id = String::new();
    services::mutate(&app, |config| {
        let created = config.add_workspace(workspace)?;
        config.active_workspace_id = Some(created.id.clone());
        created_id = created.id;
        Ok(())
    })?;
    services::switch_workspace(&app, &created_id)?;
    let _ = tauri::Emitter::emit(&app, "app-snapshot", services::snapshot(&app));
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn update_workspace(app: tauri::AppHandle, workspace: WorkspaceUpdate) -> Result<Snapshot, String> {
    services::mutate(&app, |config| config.update_workspace(workspace))?;
    Ok(services::snapshot(&app))
}

/// Add services that already exist to one more workspace. Nothing is removed
/// from the workspaces they are already in, and no session moves.
#[tauri::command]
fn include_services(
    app: tauri::AppHandle,
    workspace_id: String,
    service_ids: Vec<String>,
) -> Result<Snapshot, String> {
    services::mutate(&app, |config| {
        config.include_services(&workspace_id, &service_ids)?;
        Ok(())
    })?;
    tray::sync(&app);
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn set_workspace_dnd(app: tauri::AppHandle, id: String, enabled: bool) -> Result<Snapshot, String> {
    services::mutate(&app, |config| config.set_workspace_dnd(&id, enabled))?;
    services::apply_sound_policy(&app);
    tray::sync(&app);
    Ok(services::snapshot(&app))
}

/// Deleting a workspace never deletes a service. A service left with no
/// workspace moves to the first remaining one; sessions stay where they are.
#[tauri::command]
fn remove_workspace(app: tauri::AppHandle, id: String) -> Result<Snapshot, String> {
    services::mutate(&app, |config| {
        config.remove_workspace(&id)?;
        Ok(())
    })?;
    services::close_if_outside_active_workspace(&app)?;
    services::apply_sound_policy(&app);
    tray::sync(&app);
    let _ = tauri::Emitter::emit(&app, "app-snapshot", services::snapshot(&app));
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn set_active_workspace(app: tauri::AppHandle, id: String) -> Result<Snapshot, String> {
    services::switch_workspace(&app, &id)?;
    let _ = tauri::Emitter::emit(&app, "app-snapshot", services::snapshot(&app));
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn move_workspace(app: tauri::AppHandle, id: String, delta: i32) -> Result<Snapshot, String> {
    services::mutate(&app, |config| config.move_workspace(&id, delta))?;
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn reorder_workspaces(app: tauri::AppHandle, ids: Vec<String>) -> Result<Snapshot, String> {
    services::mutate(&app, |config| config.reorder_workspaces(&ids))?;
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn set_workspace_rail_hidden(app: tauri::AppHandle, hidden: bool) -> Result<Snapshot, String> {
    services::mutate(&app, |config| {
        config.workspace_rail_hidden = hidden;
        Ok(())
    })?;
    services::sync_bounds(&app)?;
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn apply_service_shortcut(
    app: tauri::AppHandle,
    key: String,
    ctrl: bool,
    meta: bool,
    shift: bool,
    alt: bool,
) -> Result<Snapshot, String> {
    services::apply_shortcut(&app, &key, ctrl || meta, shift, alt)?;
    Ok(services::snapshot(&app))
}

// Only the shell can search/resize/focus views or persist zoom. Hosted pages
// can report their own result and forward the existing keyboard shortcut.
#[tauri::command]
fn set_find_open(app: tauri::AppHandle, open: bool) -> Result<Snapshot, String> {
    page_tools::set_find_open(&app, open)?;
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn find_in_service(
    app: tauri::AppHandle,
    id: String,
    query: String,
    direction: i32,
    request_id: u32,
) -> Result<(), String> {
    page_tools::find_in_service(&app, &id, &query, direction, request_id)
}

#[tauri::command]
fn report_find_result(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    result: page_tools::FindResult,
) {
    page_tools::report_find_result(&app, webview.label(), result);
}

#[tauri::command]
fn reset_service_zoom(app: tauri::AppHandle, id: String) -> Result<Snapshot, String> {
    page_tools::change_zoom(&app, &id, zoom::ZoomAction::Reset)?;
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn reload_service(app: tauri::AppHandle, id: String) -> Result<Snapshot, String> {
    services::reload_service(&app, &id)?;
    Ok(services::snapshot(&app))
}

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<UpdateStatus, String> {
    Ok(run_update_check(&app, updates::CheckKind::Manual).await)
}

#[tauri::command]
fn set_update_auto_check(app: tauri::AppHandle, enabled: bool) -> Result<Snapshot, String> {
    services::mutate(&app, |config| {
        config.updates.auto_check = enabled;
        Ok(())
    })?;
    let mut status = updates::current_status();
    status.auto_check = enabled;
    updates::set_status(status);
    publish_update(&app);
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn skip_update(app: tauri::AppHandle, version: String) -> Result<Snapshot, String> {
    let version =
        updates::normalize_version(&version).ok_or_else(|| "invalid version".to_string())?;
    services::mutate(&app, |config| {
        config.updates.skipped_version = Some(version.clone());
        Ok(())
    })?;
    let Some(status) = updates::after_skip(&updates::current_status(), &version) else {
        return Err("invalid version".into());
    };
    updates::set_status(status);
    publish_update(&app);
    Ok(services::snapshot(&app))
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    updates::download_and_install(&app).await
}

#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) {
    app.restart();
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let url = services::validate_external_url(&url)?;
    policy::open_external_detached(&url);
    Ok(())
}

#[tauri::command]
fn forward_notification(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    title: String,
    body: String,
) -> Result<(), String> {
    services::forward_notification(&app, webview.label(), &title, &body)
}

#[tauri::command]
fn report_workspace_icon(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    icon_url: String,
) -> Result<(), String> {
    services::report_workspace_icon(&app, webview.label(), &icon_url)
}

#[tauri::command]
fn import_local_icon(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
    extension: String,
) -> Result<String, String> {
    services::import_local_icon(&app, &bytes, &extension)
}

#[tauri::command]
fn read_local_icon(app: tauri::AppHandle, token: String) -> Result<String, String> {
    services::read_local_icon(&app, &token)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK reads its DMA-BUF switch when the first web process starts, so
    // this has to happen before any window or webview exists.
    #[cfg(target_os = "linux")]
    linux_host::prepare_environment();
    // The login entry passes this so a launch at login can skip the window.
    // A launch the user starts themselves never carries it.
    let hidden_launch = autostart::launched_hidden(std::env::args().skip(1));
    let mut context = tauri::generate_context!();
    for window in &mut context.config_mut().app.windows {
        if window.label == "main" {
            window.visible = false;
        }
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let app = app.clone();
            let _ = app.clone().run_on_main_thread(move || {
                let _ = tray::reveal(&app);
            });
        }))
        .manage(backup_commands::Pending::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let state = RuntimeState::load(app.handle()).map_err(box_err)?;
            app.manage(state);
            let handle = app.handle().clone();
            if let Some(window) = app.get_window("main") {
                #[cfg(target_os = "linux")]
                linux_host::install(&window);
                window.on_window_event(move |event| match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        let intent_hide = tray::should_hide_on_close(&handle);
                        let hide_succeeded = if intent_hide {
                            match tray::hide(&handle) {
                                Ok(()) => true,
                                Err(err) => {
                                    eprintln!("rustbox: could not hide the window on close: {err}");
                                    false
                                }
                            }
                        } else {
                            false
                        };
                        if tray::resolve_close(intent_hide, hide_succeeded)
                            == tray::CloseResolution::Hide
                        {
                            api.prevent_close();
                        }
                    }
                    WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                        let _ = services::sync_bounds(&handle);
                    }
                    _ => {}
                });
            } else {
                eprintln!("rustbox: main window is missing; the close button cannot be handled");
            }
            let language = services::lock(&app.state::<RuntimeState>().config).language;
            i18n::set_ui_locale(i18n::resolve_preference(language));
            reconcile_start_at_login(app.handle());
            let tray_ok = match tray::install(app.handle()) {
                Ok(()) => true,
                Err(err) => {
                    eprintln!("rustbox: tray icon was not created: {err}");
                    false
                }
            };
            let background_ok = !hidden_launch
                || services::load_background_services(app.handle()).is_ok();
            if !background_ok {
                eprintln!("rustbox: could not load background services; showing the window");
            }
            // A launch at login with "start hidden" on, and a tray to bring the
            // window back from, stays hidden. Every other launch shows the
            // window, including a hidden launch with no tray: there would be
            // no way to reach it otherwise.
            if !autostart::should_start_hidden(hidden_launch, tray_ok && background_ok) {
                if let Some(window) = app.get_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            let kind = updates::detect_bundle_kind();
            let can_install = updates::supports_self_update(kind);
            let auto_check = services::lock(&app.state::<RuntimeState>().config)
                .updates
                .auto_check;
            let mut idle =
                updates::UpdateStatus::idle(env!("CARGO_PKG_VERSION"), can_install, auto_check);
            idle.package_managed = updates::package_managed(std::env::consts::OS, kind);
            updates::set_status(idle);
            spawn_update_schedule(app.handle().clone());
            let schedule_app = app.handle().clone();
            std::thread::spawn(move || {
                let mut previous = None;
                loop {
                    let snapshot = services::snapshot(&schedule_app);
                    let current = (
                        snapshot.do_not_disturb,
                        snapshot
                            .workspaces
                            .iter()
                            .map(|w| (w.id.clone(), w.dnd))
                            .collect::<Vec<_>>(),
                    );
                    if previous.as_ref() != Some(&current) {
                        let app = schedule_app.clone();
                        let _ = schedule_app.run_on_main_thread(move || {
                            services::apply_sound_policy(&app);
                            tray::sync(&app);
                            let _ = app.emit("app-snapshot", services::snapshot(&app));
                        });
                        previous = Some(current);
                    }
                    std::thread::sleep(std::time::Duration::from_secs(15));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backup_commands::export_config,
            backup_commands::prepare_config_import,
            backup_commands::apply_config_import,
            get_state,
            list_presets,
            add_preset,
            add_custom,
            update_service,
            remove_service,
            reorder_services,
            set_active_service,
            set_sidebar_collapsed,
            set_service_sound,
            set_service_notifications,
            set_service_notify_in_dnd,
            set_do_not_disturb,
            set_dnd_schedule,
            set_close_to_tray,
            set_start_at_login,
            set_start_hidden,
            quit_app,
            set_theme,
            set_language,
            set_ui_locale,
            add_workspace,
            update_workspace,
            include_services,
            set_workspace_dnd,
            remove_workspace,
            set_active_workspace,
            move_workspace,
            reorder_workspaces,
            set_workspace_rail_hidden,
            apply_service_shortcut,
            set_find_open,
            find_in_service,
            report_find_result,
            reset_service_zoom,
            reload_service,
            open_external,
            check_for_updates,
            set_update_auto_check,
            skip_update,
            install_update,
            relaunch_app,
            forward_notification,
            report_workspace_icon,
            import_local_icon,
            read_local_icon,
        ])
        .build(context)
        .expect("error while building rustbox")
        .run(|app_handle, event| {
            // A hidden window leaves the Dock icon. Clicking it asks the app
            // to reopen; show the same window instead of leaving it hidden.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                let _ = tray::reveal(app_handle);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app_handle, event);
        });
}

fn box_err(err: String) -> Box<dyn std::error::Error> {
    Box::new(std::io::Error::other(err))
}

pub(crate) async fn run_update_check(
    app: &tauri::AppHandle,
    kind: updates::CheckKind,
) -> UpdateStatus {
    let Some(_guard) = updates::CheckGuard::try_acquire() else {
        return services::snapshot(app).update;
    };
    let (skipped, notified, do_not_disturb, auto_check, last_checked_at) = {
        let state = app.state::<RuntimeState>();
        let config = services::lock(&state.config);
        (
            config.updates.skipped_version.clone(),
            config.updates.notified_version.clone(),
            config.effective_do_not_disturb(),
            config.updates.auto_check,
            config.updates.last_checked_at.clone(),
        )
    };
    let bundle = updates::detect_bundle_kind();
    let can_install = updates::supports_self_update(bundle);
    let package_managed = updates::package_managed(std::env::consts::OS, bundle);
    let mut checking = updates::begin_check(&updates::current_status());
    checking.current = app.package_info().version.to_string();
    checking.can_install = can_install;
    checking.package_managed = package_managed;
    checking.auto_check = auto_check;
    checking.last_checked_at = last_checked_at.clone();
    updates::set_status(checking);
    publish_update(app);

    let probe = updates::probe(app).await;
    let decision = updates::decide(
        &updates::CheckContext {
            current: app.package_info().version.to_string(),
            kind,
            skipped_version: skipped,
            notified_version: notified,
            do_not_disturb,
            can_install,
            package_managed,
            auto_check,
            last_checked_at,
            now: updates::rfc3339_now(),
        },
        probe,
    );
    if decision.record_checked_at || decision.persist_notified {
        let _ = services::mutate(app, |config| {
            if decision.record_checked_at {
                config.updates.last_checked_at = decision.status.last_checked_at.clone();
            }
            if decision.persist_notified {
                config.updates.notified_version = decision.notified_version.clone();
            }
            Ok(())
        });
    }
    updates::set_status(decision.status.clone());
    publish_update(app);
    if decision.notify {
        notify_update(app, decision.status.latest.as_deref().unwrap_or(""));
    }
    tray::sync(app);
    services::snapshot(app).update
}

fn publish_update(app: &tauri::AppHandle) {
    let snapshot = services::snapshot(app);
    let _ = tauri::Emitter::emit(app, "update-status", &snapshot.update);
    let _ = tauri::Emitter::emit(app, "app-snapshot", &snapshot);
}

fn notify_update(app: &tauri::AppHandle, version: &str) {
    let version = version.trim().trim_start_matches('v');
    if version.is_empty() {
        return;
    }
    let locale = i18n::ui_locale();
    let result = app
        .notification()
        .builder()
        .title(i18n::update_notification_title(locale))
        .body(i18n::update_notification_body(locale, version))
        .show();
    if result.is_err() {
        eprintln!("rustbox: could not show the update notification");
    }
}

fn spawn_update_schedule(app: tauri::AppHandle) {
    if let Err(err) = std::thread::Builder::new()
        .name("rustbox-updates".into())
        .spawn(move || {
            let mut iteration = 0u64;
            loop {
                std::thread::sleep(updates::schedule_delay(iteration));
                iteration = iteration.saturating_add(1);
                let enabled = services::lock(&app.state::<RuntimeState>().config)
                    .updates
                    .auto_check;
                if !enabled {
                    continue;
                }
                tauri::async_runtime::block_on(run_update_check(
                    &app,
                    updates::CheckKind::Automatic,
                ));
            }
        })
    {
        eprintln!("rustbox: update checks were not scheduled: {err}");
    }
}
