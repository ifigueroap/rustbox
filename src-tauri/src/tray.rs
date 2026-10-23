use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::menu::{
    CheckMenuItem, CheckMenuItemBuilder, Menu, MenuItem, MenuItemBuilder, PredefinedMenuItem,
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
    show: MenuItem<Wry>,
    hide: MenuItem<Wry>,
}

pub fn hide_instead_of_quit(close_to_tray: bool, tray_ready: bool, quitting: bool) -> bool {
    close_to_tray && tray_ready && !quitting
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
    let quit = MenuItemBuilder::with_id("tray-quit", "Quit")
        .build(app)
        .map_err(|err| err.to_string())?;
    let separator = PredefinedMenuItem::separator(app).map_err(|err| err.to_string())?;
    let separator_after = PredefinedMenuItem::separator(app).map_err(|err| err.to_string())?;
    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &hide_item,
            &separator,
            &dnd,
            &close_to_tray,
            &separator_after,
            &quit,
        ],
    )
    .map_err(|err| err.to_string())?;

    let icon = tray_image(false)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Rustbox")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
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
            "tray-quit" => request_quit(app),
            _ => {}
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
        show: show_item,
        hide: hide_item,
    });
    sync(app);
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
    let open = window_is_open(app);
    let _ = menu.show.set_enabled(!open);
    let _ = menu.hide.set_enabled(open);
    let _ = tray.set_tooltip(Some(tooltip(unread)));
    if let Ok(icon) = tray_image(unread > 0) {
        let _ = tray.set_icon(Some(icon));
    }
}

pub fn reveal(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    window.unminimize().map_err(|err| err.to_string())?;
    window.show().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())?;
    services::sync_bounds(app)?;
    sync(app);
    Ok(())
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    window.hide().map_err(|err| err.to_string())?;
    sync(app);
    Ok(())
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
    app.get_webview_window("main").is_some_and(|window| {
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
