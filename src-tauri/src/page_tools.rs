//! Shell-owned find strip and persisted native service zoom.
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::services::{self, RuntimeState, lock};
use crate::zoom::{self, ZoomAction};

#[derive(Default)]
pub struct PageToolsState {
    pub find_service_id: Option<String>,
    request_id: u32,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindResult {
    pub request_id: u32,
    pub current: u32,
    pub total: u32,
    pub failed: bool,
}

/// Clear only our ranges/selection; never modify the service's DOM or session.
pub fn clear_find(app: &AppHandle) {
    let state = app.state::<RuntimeState>();
    let id = lock(&state.page_tools).find_service_id.take();
    if let Some(webview) = id.and_then(|id| app.get_webview(&services::label_for(&id))) {
        let _ = webview.eval("window.__rustboxFindOpen = false; window.__rustboxFind?.('', 0, 0);");
    }
}

pub fn set_find_open(app: &AppHandle, open: bool) -> Result<(), String> {
    let state = app.state::<RuntimeState>();
    // Native maintenance and hibernation dispatch work back to the UI thread.
    // A shortcut/command on that thread must not wait for their operations lock.
    let _ops = state
        .ops
        .try_lock()
        .map_err(|_| crate::i18n::maintenance_busy())?;
    if open {
        let Some(id) = lock(&state.active_id).clone() else {
            return Ok(());
        };
        if let Some(webview) = app.get_webview(&services::label_for(&id)) {
            webview
                .eval("window.__rustboxFindOpen = true;")
                .map_err(|err| err.to_string())?;
        }
        lock(&state.page_tools).find_service_id = Some(id);
    } else {
        clear_find(app);
    }
    let label = if open {
        "main".to_string()
    } else {
        lock(&state.active_id)
            .as_deref()
            .map(services::label_for)
            .unwrap_or_else(|| "main".to_string())
    };
    if let Some(webview) = app.get_webview(&label) {
        webview.set_focus().map_err(|err| err.to_string())?;
    }
    drop(_ops);
    services::sync_bounds(app)?;
    Ok(())
}

pub fn find_in_service(
    app: &AppHandle,
    id: &str,
    query: &str,
    direction: i32,
    request_id: u32,
) -> Result<(), String> {
    let state = app.state::<RuntimeState>();
    // Native maintenance and hibernation dispatch work back to the UI thread.
    // A shortcut/command on that thread must not wait for their operations lock.
    let _ops = state
        .ops
        .try_lock()
        .map_err(|_| crate::i18n::maintenance_busy())?;
    let active = lock(&state.active_id).clone();
    let mut tools = lock(&state.page_tools);
    if tools.find_service_id.as_deref() != Some(id) || active.as_deref() != Some(id) {
        return Err("find service is no longer active".into());
    }
    tools.request_id = request_id;
    drop(tools);
    let webview = app
        .get_webview(&services::label_for(id))
        .ok_or_else(|| "service webview is missing".to_string())?;
    let query = serde_json::to_string(query).map_err(|err| err.to_string())?;
    webview
        .eval(format!(
            "window.__rustboxFind?.({query}, {}, {request_id});",
            direction.signum()
        ))
        .map_err(|err| err.to_string())
}

/// The caller label binds results to its own webview. Service pages gain no
/// shell commands or general event permission from this reporting channel.
pub fn report_find_result(app: &AppHandle, label: &str, result: FindResult) {
    let state = app.state::<RuntimeState>();
    let tools = lock(&state.page_tools);
    if tools
        .find_service_id
        .as_deref()
        .map(services::label_for)
        .as_deref()
        != Some(label)
        || result.request_id != tools.request_id
    {
        return;
    }
    let _ = app.emit_to("main", "find-result", result);
}

pub fn change_zoom(app: &AppHandle, id: &str, action: ZoomAction) -> Result<f64, String> {
    let state = app.state::<RuntimeState>();
    // Native maintenance and hibernation dispatch work back to the UI thread.
    // A shortcut/command on that thread must not wait for their operations lock.
    let _ops = state
        .ops
        .try_lock()
        .map_err(|_| crate::i18n::maintenance_busy())?;
    let previous = lock(&state.config)
        .services
        .iter()
        .find(|service| service.id == id)
        .map(|service| service.zoom)
        .ok_or_else(|| "service not found".to_string())?;
    let next = zoom::apply(action, previous);
    let webview = app.get_webview(&services::label_for(id));
    if let Some(webview) = &webview {
        webview.set_zoom(next).map_err(|err| err.to_string())?;
    }
    if let Err(err) = services::mutate(app, |config| {
        let service = config
            .services
            .iter_mut()
            .find(|service| service.id == id)
            .ok_or_else(|| "service not found".to_string())?;
        service.zoom = next;
        Ok(())
    }) {
        if let Some(webview) = webview {
            let _ = webview.set_zoom(previous);
        }
        return Err(err);
    }
    let _ = app.emit_to(
        "main",
        "service-zoom",
        serde_json::json!({"id": id, "zoom": next}),
    );
    Ok(next)
}

pub fn restore_zoom(app: &AppHandle, webview: &tauri::Webview) {
    let Some(id) = webview.label().strip_prefix("svc-") else {
        return;
    };
    let state = app.state::<RuntimeState>();
    let zoom = lock(&state.config)
        .services
        .iter()
        .find(|service| service.id == id)
        .map(|service| service.zoom);
    if let Some(zoom) = zoom {
        let _ = webview.set_zoom(zoom);
    }
}
