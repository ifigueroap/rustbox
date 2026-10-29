use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::menu::{
    CheckMenuItem, CheckMenuItemBuilder, Menu, MenuItem, MenuItemBuilder, PredefinedMenuItem,
    Submenu, SubmenuBuilder,
};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::services::{self, RuntimeState};

const TRAY_ID: &str = "rustbox";
const TRAY_PNG: &[u8] = include_bytes!("../icons/32x32.png");

static QUITTING: AtomicBool = AtomicBool::new(false);
static LAST_TOGGLE: Mutex<Option<Instant>> = Mutex::new(None);

struct TrayMenu {
    dnd: CheckMenuItem<Wry>,
    close_to_tray: CheckMenuItem<Wry>,
    updates: MenuItem<Wry>,
    show: MenuItem<Wry>,
    hide: MenuItem<Wry>,
    /// One check item per workspace, in rail order. Rebuilt when the
    /// workspace list changes because native menus are not dynamic.
    workspaces: Mutex<Vec<(String, CheckMenuItem<Wry>)>>,
    workspace_menu: Mutex<Option<Submenu<Wry>>>,
}

pub fn hide_instead_of_quit(close_to_tray: bool, tray_ready: bool, quitting: bool) -> bool {
    close_to_tray && tray_ready && !quitting
}

/// What the close button does after the hide attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseResolution {
    /// The window was hidden. Call `prevent_close` and keep the process running.
    Hide,
    /// Let the close finish so the window is destroyed and the app exits.
    Exit,
}

/// Cancel the close only when the app meant to hide and the hide succeeded.
/// A failed hide resolves to [`CloseResolution::Exit`], so the window cannot
/// stay open after `prevent_close` with nothing else happening.
pub fn resolve_close(intent_hide: bool, hide_succeeded: bool) -> CloseResolution {
    if intent_hide && hide_succeeded {
        CloseResolution::Hide
    } else {
        CloseResolution::Exit
    }
}

pub fn tooltip(unread: u32) -> String {
    match unread {
        0 => "Rustbox".to_string(),
        1 => "Rustbox — 1 unread".to_string(),
        count => format!("Rustbox — {count} unread"),
    }
}

pub fn request_quit(app: &AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    app.exit(0);
}

pub fn install(app: &AppHandle) -> Result<(), String> {
    let dnd_on = services::lock(&app.state::<RuntimeState>().config).do_not_disturb;
    let close_on = services::lock(&app.state::<RuntimeState>().config).close_to_tray;
    let show_item = MenuItemBuilder::with_id("tray-show", "Show window")
        .build(app)
        .map_err(|err| err.to_string())?;
    let hide_item = MenuItemBuilder::with_id("tray-hide", "Hide window")
        .build(app)
        .map_err(|err| err.to_string())?;
    let dnd = CheckMenuItemBuilder::with_id("tray-dnd", "Do not disturb")
        .checked(dnd_on)
        .build(app)
        .map_err(|err| err.to_string())?;
    let close_to_tray = CheckMenuItemBuilder::with_id("tray-close", "Close window to tray")
        .checked(close_on)
        .build(app)
        .map_err(|err| err.to_string())?;
    let updates = MenuItemBuilder::with_id("tray-updates", "Check for updates")
        .build(app)
        .map_err(|err| err.to_string())?;
    let quit = MenuItemBuilder::with_id("tray-quit", "Quit")
        .build(app)
        .map_err(|err| err.to_string())?;
    let separator = PredefinedMenuItem::separator(app).map_err(|err| err.to_string())?;
    let separator_after = PredefinedMenuItem::separator(app).map_err(|err| err.to_string())?;

    let workspaces = build_workspace_items(app)?;
    let workspace_menu = SubmenuBuilder::with_id(app, "tray-workspaces", "Workspaces")
        .build()
        .map_err(|err| err.to_string())?;
    for (_, item) in &workspaces {
        workspace_menu.append(item).map_err(|err| err.to_string())?;
    }

    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &hide_item,
            &separator,
            &workspace_menu,
            &dnd,
            &close_to_tray,
            &updates,
            &separator_after,
            &quit,
        ],
    )
    .map_err(|err| err.to_string())?;

    let icon = tray_image(false)?;
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Rustbox")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false);
    // The menu-bar glyph is the color mark, including the copper unread dot.
    // A template image would keep only the alpha channel and drop that color.
    #[cfg(target_os = "macos")]
    let tray = tray.icon_as_template(false);
    tray.on_menu_event(|app, event| {
        let id = event.id().as_ref().to_string();
        if let Some(workspace_id) = id.strip_prefix("tray-workspace-dnd:") {
            let next = !workspace_flag(app, workspace_id);
            let _ = store_workspace_dnd(app, workspace_id, next);
            return;
        }
        match id.as_str() {
            "tray-show" => {
                let _ = reveal(app);
            }
            "tray-hide" => {
                let _ = hide(app);
            }
            "tray-dnd" => {
                let next = !flag(app, |config| config.do_not_disturb);
                let _ = store_do_not_disturb(app, next);
            }
            "tray-close" => {
                let next = !flag(app, |config| config.close_to_tray);
                let _ = store_close_to_tray(app, next);
            }
            "tray-updates" => open_update_from_tray(app),
            "tray-quit" => request_quit(app),
            _ => {}
        }
    })
    .on_tray_icon_event(|tray, event| {
        let left_up = matches!(
            event,
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
        );
        if left_up {
            toggle(tray.app_handle());
        }
    })
    .build(app)
    .map_err(|err| err.to_string())?;

    app.manage(TrayMenu {
        dnd,
        close_to_tray,
        updates,
        show: show_item,
        hide: hide_item,
        workspaces: Mutex::new(workspaces),
        workspace_menu: Mutex::new(Some(workspace_menu)),
    });
    sync(app);
    Ok(())
}

/// One "Do not disturb" check item per workspace. The ids carry the workspace
/// id so a click can be routed back without re-reading a snapshot index.
fn build_workspace_items(app: &AppHandle) -> Result<Vec<(String, CheckMenuItem<Wry>)>, String> {
    let workspaces: Vec<(String, String, bool)> = {
        let state = app.state::<RuntimeState>();
        let config = services::lock(&state.config);
        config
            .workspaces
            .iter()
            .map(|workspace| (workspace.id.clone(), workspace.name.clone(), workspace.dnd))
            .collect()
    };
    let mut items = Vec::with_capacity(workspaces.len());
    for (id, name, dnd) in workspaces {
        let item = CheckMenuItemBuilder::with_id(
            format!("tray-workspace-dnd:{id}"),
            format!("{name} — Do not disturb"),
        )
        .checked(dnd)
        .build(app)
        .map_err(|err| err.to_string())?;
        items.push((id, item));
    }
    Ok(items)
}

/// The workspace list changed shape. Native menus cannot edit the id or label
/// of an existing item, so new check items are appended and the old ones
/// removed from the same submenu.
fn rebuild_workspace_items(app: &AppHandle, menu: &TrayMenu) -> Result<(), String> {
    let items = build_workspace_items(app)?;
    let slot = services::lock(&menu.workspace_menu);
    let Some(submenu) = slot.as_ref() else {
        return Ok(());
    };
    let mut previous = services::lock(&menu.workspaces);
    for (_, item) in &items {
        submenu.append(item).map_err(|err| err.to_string())?;
    }
    for (_, item) in previous.iter() {
        let _ = submenu.remove(item);
    }
    *previous = items;
    Ok(())
}

pub fn sync(app: &AppHandle) {
    let Some(menu) = app.try_state::<TrayMenu>() else {
        return;
    };
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let unread = services::visible_unread_total(app);
    let _ = menu
        .dnd
        .set_checked(flag(app, |config| config.do_not_disturb));
    let _ = menu
        .close_to_tray
        .set_checked(flag(app, |config| config.close_to_tray));
    let update = crate::updates::current_status();
    let _ = menu.updates.set_text(crate::updates::tray_menu_label(
        update.state,
        update.latest.as_deref(),
    ));
    let open = window_is_open(app);
    let _ = menu.show.set_enabled(!open);
    let _ = menu.hide.set_enabled(open);
    sync_workspace_items(app, &menu);
    let _ = tray.set_tooltip(Some(tooltip(unread)));
    if let Ok(icon) = tray_image(unread > 0) {
        let _ = tray.set_icon(Some(icon));
    }
}

/// Keep the per-workspace check items and their labels in step with the
/// config. Only rebuilds when the id set changed.
fn sync_workspace_items(app: &AppHandle, menu: &TrayMenu) {
    let current: Vec<(String, String, bool)> = {
        let state = app.state::<RuntimeState>();
        let config = services::lock(&state.config);
        config
            .workspaces
            .iter()
            .map(|workspace| (workspace.id.clone(), workspace.name.clone(), workspace.dnd))
            .collect()
    };
    let ids: Vec<String> = current.iter().map(|(id, _, _)| id.clone()).collect();
    let (known_ids, labels): (Vec<String>, Vec<String>) = {
        let items = services::lock(&menu.workspaces);
        (
            items.iter().map(|(id, _)| id.clone()).collect(),
            items
                .iter()
                .map(|(_, item)| item.text().unwrap_or_default())
                .collect(),
        )
    };
    let expected_labels: Vec<String> = current
        .iter()
        .map(|(_, name, _)| tray_dnd_label(name))
        .collect();
    if ids != known_ids || labels != expected_labels {
        if let Err(err) = rebuild_workspace_items(app, menu) {
            eprintln!("rustbox: could not update the workspace tray items: {err}");
        }
        return;
    }
    let items = services::lock(&menu.workspaces);
    for ((_, _, dnd), (_, item)) in current.iter().zip(items.iter()) {
        let _ = item.set_checked(*dnd);
    }
}

fn tray_dnd_label(name: &str) -> String {
    format!("{name} — Do not disturb")
}

fn workspace_flag(app: &AppHandle, workspace_id: &str) -> bool {
    let state = app.state::<RuntimeState>();
    let config = services::lock(&state.config);
    config
        .workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .is_some_and(|workspace| workspace.dnd)
}

pub fn store_workspace_dnd(
    app: &AppHandle,
    workspace_id: &str,
    enabled: bool,
) -> Result<(), String> {
    services::mutate(app, |config| {
        config.set_workspace_dnd(workspace_id, enabled)
    })?;
    services::apply_sound_policy(app);
    let _ = app.emit("app-snapshot", services::snapshot(app));
    sync(app);
    Ok(())
}

pub fn reveal(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    window.unminimize().map_err(|err| err.to_string())?;
    window.show().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())?;
    services::sync_bounds(app)?;
    sync(app);
    Ok(())
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    window.hide().map_err(|err| err.to_string())?;
    sync(app);
    Ok(())
}

/// Show the window, then either open the update dialog or run a manual check.
/// A check that finds a release opens the same dialog.
fn open_update_from_tray(app: &AppHandle) {
    let _ = reveal(app);
    let available =
        crate::updates::current_status().state == crate::updates::UpdatePhase::Available;
    if available {
        let _ = app.emit("open-update-dialog", ());
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let status = crate::run_update_check(&app, crate::updates::CheckKind::Manual).await;
        if status.state == crate::updates::UpdatePhase::Available {
            let _ = reveal(&app);
            let _ = app.emit("open-update-dialog", ());
        }
    });
}

/// The shell and each service share one native window. `get_webview_window`
/// only resolves a window whose webviews all use that window's label, so it
/// becomes `None` once a child service webview exists. Hide, show, and focus
/// have to go through the window itself.
fn main_window(app: &AppHandle) -> Result<tauri::Window, String> {
    app.get_window("main")
        .ok_or_else(|| "main window is not available".to_string())
}

pub fn should_hide_on_close(app: &AppHandle) -> bool {
    hide_instead_of_quit(
        flag(app, |config| config.close_to_tray),
        app.tray_by_id(TRAY_ID).is_some(),
        QUITTING.load(Ordering::SeqCst),
    )
}

pub fn store_do_not_disturb(app: &AppHandle, enabled: bool) -> Result<(), String> {
    services::mutate(app, |config| {
        config.do_not_disturb = enabled;
        Ok(())
    })?;
    services::apply_sound_policy(app);
    let _ = app.emit("app-snapshot", services::snapshot(app));
    sync(app);
    Ok(())
}

pub fn store_close_to_tray(app: &AppHandle, enabled: bool) -> Result<(), String> {
    services::mutate(app, |config| {
        config.close_to_tray = enabled;
        Ok(())
    })?;
    let _ = app.emit("app-snapshot", services::snapshot(app));
    sync(app);
    Ok(())
}

fn toggle(app: &AppHandle) {
    let mut last = LAST_TOGGLE.lock().unwrap_or_else(|err| err.into_inner());
    if last.is_some_and(|time| time.elapsed() < Duration::from_millis(400)) {
        return;
    }
    *last = Some(Instant::now());
    if window_is_open(app) {
        let _ = hide(app);
    } else {
        let _ = reveal(app);
    }
}

fn window_is_open(app: &AppHandle) -> bool {
    main_window(app).is_ok_and(|window| {
        window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
    })
}

fn flag(app: &AppHandle, read: impl FnOnce(&crate::config::Config) -> bool) -> bool {
    read(&services::lock(&app.state::<RuntimeState>().config))
}

fn tray_image(unread: bool) -> Result<Image<'static>, String> {
    let (width, height, mut rgba) = decode_png(TRAY_PNG)?;
    if unread {
        stamp_dot(&mut rgba, width, height);
    }
    Ok(Image::new_owned(rgba, width, height))
}

fn decode_png(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder
        .read_info()
        .map_err(|err| format!("tray icon: {err}"))?;
    let size = reader
        .output_buffer_size()
        .ok_or_else(|| "tray icon has no frame".to_string())?;
    let mut buffer = vec![0; size];
    let info = reader
        .next_frame(&mut buffer)
        .map_err(|err| format!("tray icon: {err}"))?;
    buffer.truncate(info.buffer_size());
    let rgba = match info.color_type {
        png::ColorType::Rgba => buffer,
        png::ColorType::Rgb => {
            let mut expanded = Vec::with_capacity(buffer.len() / 3 * 4);
            for pixel in buffer.chunks_exact(3) {
                expanded.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
            }
            expanded
        }
        other => return Err(format!("tray icon color type {other:?} is unsupported")),
    };
    if rgba.len() != (info.width as usize) * (info.height as usize) * 4 {
        return Err("tray icon size does not match its pixels".into());
    }
    Ok((info.width, info.height, rgba))
}

fn stamp_dot(rgba: &mut [u8], width: u32, height: u32) {
    let radius = (width.min(height) as i32 / 6).max(3);
    let cx = width as i32 - radius - 1;
    let cy = height as i32 - radius - 1;
    let outline = radius + 1;
    for y in (cy - outline).max(0)..=(cy + outline).min(height as i32 - 1) {
        for x in (cx - outline).max(0)..=(cx + outline).min(width as i32 - 1) {
            let distance = (x - cx) * (x - cx) + (y - cy) * (y - cy);
            let index = ((y as u32 * width + x as u32) * 4) as usize;
            if distance <= radius * radius {
                rgba[index..index + 4].copy_from_slice(&[0xE0, 0xA3, 0x6A, 255]);
            } else if distance <= outline * outline {
                rgba[index..index + 4].copy_from_slice(&[0x1C, 0x14, 0x0C, 255]);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_hides_only_while_the_tray_is_up_and_quit_is_not_requested() {
        assert!(hide_instead_of_quit(true, true, false));
        assert!(!hide_instead_of_quit(false, true, false));
        assert!(!hide_instead_of_quit(true, false, false));
        assert!(!hide_instead_of_quit(true, true, true));
    }

    #[test]
    fn close_decision_hides_only_when_the_tray_can_take_the_window() {
        assert_eq!(
            resolve_close(hide_instead_of_quit(true, true, false), true),
            CloseResolution::Hide
        );
        assert_eq!(
            resolve_close(hide_instead_of_quit(false, true, false), true),
            CloseResolution::Exit
        );
        assert_eq!(
            resolve_close(hide_instead_of_quit(true, false, false), true),
            CloseResolution::Exit
        );
        assert_eq!(
            resolve_close(hide_instead_of_quit(true, true, true), true),
            CloseResolution::Exit
        );
    }

    #[test]
    fn failed_hide_does_not_swallow_the_close() {
        let intent_hide = hide_instead_of_quit(true, true, false);
        assert!(intent_hide);
        assert_eq!(
            resolve_close(intent_hide, false),
            CloseResolution::Exit,
            "a failed hide must let the window close and the app exit"
        );
        assert_eq!(resolve_close(false, false), CloseResolution::Exit);
    }

    #[test]
    fn tooltip_counts_visible_unread() {
        assert_eq!(tooltip(0), "Rustbox");
        assert_eq!(tooltip(1), "Rustbox — 1 unread");
        assert_eq!(tooltip(4), "Rustbox — 4 unread");
    }

    #[test]
    fn unread_dot_paints_the_brand_copper() {
        let (width, height, mut rgba) = decode_png(TRAY_PNG).unwrap();
        let before = rgba.clone();
        stamp_dot(&mut rgba, width, height);
        assert_ne!(rgba, before);
        let cx = width as i32 - (width.min(height) as i32 / 6).max(3) - 1;
        let cy = height as i32 - (width.min(height) as i32 / 6).max(3) - 1;
        let index = ((cy as u32 * width + cx as u32) * 4) as usize;
        assert_eq!(&rgba[index..index + 4], &[0xE0, 0xA3, 0x6A, 255]);
    }
}
