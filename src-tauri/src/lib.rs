mod config;
#[cfg(target_os = "linux")]
mod linux_host;
mod policy;
mod services;
mod shortcuts;
mod tray;

use config::{NewService, ServiceUpdate, Theme};
use services::{RuntimeState, Snapshot};
use tauri::{Manager, WindowEvent};

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
            apply_service_shortcut,
            reload_service,
            open_external,
            forward_notification,
            report_workspace_icon,
            import_local_icon,
            read_local_icon,
        ])
        .run(tauri::generate_context!())
        .expect("error while running rustbox");
}

fn box_err(err: String) -> Box<dyn std::error::Error> {
    Box::new(std::io::Error::other(err))
}
