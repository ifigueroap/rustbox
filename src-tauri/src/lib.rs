mod config;
#[cfg(target_os = "linux")]
mod linux_host;
mod policy;
mod services;
mod shortcuts;
mod tray;
mod updates;

use config::{NewService, NewWorkspace, ServiceUpdate, Theme, WorkspaceUpdate};
use services::{RuntimeState, Snapshot};
use tauri::{Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use updates::UpdateStatus;

#[tauri::command]
fn get_state(app: tauri::AppHandle) -> Snapshot {
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
fn set_do_not_disturb(app: tauri::AppHandle, enabled: bool) -> Result<Snapshot, String> {
    tray::store_do_not_disturb(&app, enabled)?;
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn set_close_to_tray(app: tauri::AppHandle, enabled: bool) -> Result<Snapshot, String> {
    tray::store_close_to_tray(&app, enabled)?;
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
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let app = app.clone();
            let _ = app.clone().run_on_main_thread(move || {
                let _ = tray::reveal(&app);
            });
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let state = RuntimeState::load(app.handle()).map_err(box_err)?;
            app.manage(state);
            let handle = app.handle().clone();
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_window("main") {
                linux_host::install(&window);
            }
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        if tray::should_hide_on_close(&handle) {
                            api.prevent_close();
                            let _ = tray::hide(&handle);
                        }
                    }
                    WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                        let _ = services::sync_bounds(&handle);
                    }
                    _ => {}
                });
            }
            if let Err(err) = tray::install(app.handle()) {
                eprintln!("rustbox: tray icon was not created: {err}");
            }
            let can_install = updates::supports_self_update(updates::detect_bundle_kind());
            let auto_check = services::lock(&app.state::<RuntimeState>().config)
                .updates
                .auto_check;
            updates::set_status(updates::UpdateStatus::idle(
                env!("CARGO_PKG_VERSION"),
                can_install,
                auto_check,
            ));
            spawn_update_schedule(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            set_do_not_disturb,
            set_close_to_tray,
            quit_app,
            set_theme,
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
        .build(tauri::generate_context!())
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
            config.do_not_disturb,
            config.updates.auto_check,
            config.updates.last_checked_at.clone(),
        )
    };
    let can_install = updates::supports_self_update(updates::detect_bundle_kind());
    let mut checking = updates::begin_check(&updates::current_status());
    checking.current = app.package_info().version.to_string();
    checking.can_install = can_install;
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
    let result = app
        .notification()
        .builder()
        .title("Rustbox update")
        .body(format!("Version {version} is available."))
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
