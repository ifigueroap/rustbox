mod config;
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd"
))]
mod linux_stage;
mod policy;
mod presets;
mod runtime;

use tauri::Manager;

/// Desktop entry point. The shell window comes from `tauri.conf.json`; service
/// webviews are added later, one per saved service.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let state = runtime::AppState::initialize(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime::get_state,
            runtime::add_service,
            runtime::update_service,
            runtime::remove_service,
            runtime::reorder_services,
            runtime::focus_service,
            runtime::reload_service,
            runtime::set_content_bounds,
            runtime::set_services_visible,
            runtime::notify_from_service,
            runtime::set_badge,
            runtime::open_external_link,
        ])
        .run(tauri::generate_context!())
        .expect("error while running rustbox");
}
