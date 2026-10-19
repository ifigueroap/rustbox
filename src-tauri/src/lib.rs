mod config;
#[cfg(target_os = "linux")]
mod linux_host;
mod policy;
mod services;
mod shortcuts;

use config::{NewService, ServiceUpdate, Theme};
use services::{RuntimeState, Snapshot};
use tauri::menu::{Menu, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
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
    Ok(services::snapshot(&app))
}

#[tauri::command]
fn set_do_not_disturb(app: tauri::AppHandle, enabled: bool) -> Result<Snapshot, String> {
    services::mutate(&app, |config| {
        config.do_not_disturb = enabled;
        Ok(())
    })?;
    services::apply_sound_policy(&app);
    Ok(services::snapshot(&app))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
                window.on_window_event(move |event| {
                    if matches!(
                        event,
                        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }
                    ) {
                        let _ = services::sync_bounds(&handle);
                    }
                });
            }
            if let Err(err) = install_tray(app.handle()) {
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
            set_theme,
            apply_service_shortcut,
            reload_service,
            open_external,
            forward_notification,
            report_workspace_icon,
        ])
        .run(tauri::generate_context!())
        .expect("error while running rustbox");
}

fn box_err(err: String) -> Box<dyn std::error::Error> {
    Box::new(std::io::Error::other(err))
}

fn install_tray(app: &tauri::AppHandle) -> Result<(), String> {
    let show = MenuItemBuilder::with_id("tray-show", "Show window")
        .build(app)
        .map_err(|err| err.to_string())?;
    let hide = MenuItemBuilder::with_id("tray-hide", "Hide window")
        .build(app)
        .map_err(|err| err.to_string())?;
    let quit = MenuItemBuilder::with_id("tray-quit", "Quit")
        .build(app)
        .map_err(|err| err.to_string())?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit]).map_err(|err| err.to_string())?;
    let mut builder = TrayIconBuilder::with_id("rustbox")
        .tooltip("Rustbox")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show" => {
                let _ = reveal_main(app);
            }
            "tray-hide" => {
                let _ = hide_main(app);
            }
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let show = matches!(
                event,
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } | TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            );
            if show {
                let _ = reveal_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let tray = builder.build(app).map_err(|err| err.to_string())?;
    app.manage(tray);
    Ok(())
}

fn reveal_main(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    window.unminimize().map_err(|err| err.to_string())?;
    window.show().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())?;
    services::sync_bounds(app)?;
    Ok(())
}

fn hide_main(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    window.hide().map_err(|err| err.to_string())
}
