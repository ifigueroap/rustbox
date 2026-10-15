fn main() {
    // Listing the commands here turns off the default "every command is allowed
    // everywhere" policy. Capabilities then grant each command to the shell or
    // to remote service pages explicitly.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_state",
            "add_service",
            "update_service",
            "remove_service",
            "reorder_services",
            "focus_service",
            "reload_service",
            "set_content_bounds",
            "set_services_visible",
            "notify_from_service",
            "set_badge",
            "open_external_link",
        ]),
    ))
    .expect("failed to run tauri-build");
}
