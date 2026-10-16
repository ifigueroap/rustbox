fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_state",
            "list_presets",
            "add_preset",
            "add_custom",
            "update_service",
            "remove_service",
            "reorder_services",
            "set_active_service",
            "set_sidebar_collapsed",
            "set_service_sound",
            "set_service_notifications",
            "set_do_not_disturb",
            "apply_service_shortcut",
            "reload_service",
            "open_external",
            "forward_notification",
        ]),
    ))
    .expect("failed to run tauri build script");
}
