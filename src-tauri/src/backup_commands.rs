use crate::{
    backup, i18n,
    services::{self, RuntimeState, Snapshot},
    tray,
};
use std::{collections::BTreeMap, sync::Mutex};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct Pending(pub Mutex<Option<backup::Document>>);

#[tauri::command]
pub async fn export_config(app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = services::lock(&app.state::<RuntimeState>().config).clone();
        let mut icons = BTreeMap::new();
        for token in backup::tokens(&config) {
            let filename = crate::config::local_icon_filename(token).ok_or("icon")?;
            icons.insert(
                token.to_string(),
                std::fs::read(services::icons_dir(&app).map_err(|_| "io")?.join(filename))
                    .map_err(|_| "io")?,
            );
        }
        let doc = backup::build(config, app.package_info().version.to_string(), icons)?;
        let bytes = serde_json::to_vec_pretty(&doc).map_err(|_| "shape")?;
        if bytes.len() > backup::MAX_DOCUMENT_BYTES {
            return Err("size".into());
        }
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("JSON", &["json"])
            .set_file_name("rustbox-config.json")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|_| "io")?;
        std::fs::write(path, bytes).map_err(|_| "io")?;
        Ok(true)
    })
    .await
    .map_err(|_| "dialog".to_string())?
}

#[tauri::command]
pub async fn prepare_config_import(app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        *services::lock(&app.state::<Pending>().0) = None;
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("JSON", &["json"])
            .blocking_pick_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|_| "io")?;
        if std::fs::metadata(&path).map_err(|_| "io")?.len() > backup::MAX_DOCUMENT_BYTES as u64 {
            return Err("size".into());
        }
        use std::io::Read;
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .map_err(|_| "io")?
            .take(backup::MAX_DOCUMENT_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "io")?;
        let doc = backup::parse(&bytes)?;
        *services::lock(&app.state::<Pending>().0) = Some(doc);
        Ok(true)
    })
    .await
    .map_err(|_| "dialog".to_string())?
}

#[tauri::command]
pub async fn apply_config_import(app: tauri::AppHandle, mode: String) -> Result<Snapshot, String> {
    if !matches!(mode.as_str(), "merge" | "replace" | "cancel") {
        return Err("mode".into());
    }
    let pending = services::lock(&app.state::<Pending>().0).take();
    if mode == "cancel" {
        return Ok(services::snapshot(&app));
    }
    let mut doc = pending.ok_or("pending")?;
    let state = app.state::<RuntimeState>();
    let old = services::lock(&state.config).clone();
    // Check limits before writing icons. Fresh tokens prevent collisions with
    // current icons, including icons still referenced by config.json.bak.
    backup::compute(&old, &doc.config, mode == "replace")?;
    for (token, bytes) in &doc.icons {
        let filename = crate::config::local_icon_filename(token).ok_or("icon")?;
        let extension = filename.rsplit_once('.').ok_or("icon")?.1;
        let fresh = services::import_local_icon(&app, bytes, extension).map_err(|_| "io")?;
        for icon in doc
            .config
            .services
            .iter_mut()
            .map(|s| &mut s.icon)
            .chain(doc.config.workspaces.iter_mut().map(|w| &mut w.icon))
        {
            if icon.as_deref() == Some(token) {
                *icon = Some(fresh.clone());
            }
        }
    }
    services::mutate(&app, |current| {
        let next = backup::compute(current, &doc.config, mode == "replace")?;
        if mode == "replace" {
            // Back up the actual on-disk file before the atomic config save.
            std::fs::copy(
                &state.config_path,
                state.config_path.with_extension("json.bak"),
            )
            .map_err(|_| "io")?;
        }
        *current = next;
        Ok(())
    })
    .map_err(|_| "io")?;
    // Close outdated webviews but deliberately retain every session directory.
    if mode == "replace" {
        for service in &old.services {
            services::close_service_webview(&app, &service.id)?;
            services::clear_runtime_service(&app, &service.id);
        }
    }
    services::close_if_outside_active_workspace(&app)?;
    services::apply_sound_policy(&app);
    let language = services::lock(&state.config).language;
    i18n::set_ui_locale(i18n::resolve_preference(language));
    tray::sync(&app);
    services::sync_bounds(&app)?;
    Ok(services::snapshot(&app))
}
