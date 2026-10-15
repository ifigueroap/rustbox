//! Linux child-webview placement.
//!
//! Tauri packs every WebKitGTK webview into the window's `gtk::Box`. A second
//! webview therefore steals half the window instead of floating over the stage.
//! The shell and the service pages are moved onto one `gtk::Fixed` so a service
//! can sit on the stage rectangle while the sidebar stays in the shell.

use std::cell::Cell;
use std::sync::mpsc;
use std::time::Duration;

use gtk::prelude::*;
use tauri::{Manager, Webview};

const STAGE_NAME: &str = "rustbox-stage";
const SHELL_NAME: &str = "rustbox-shell";

thread_local! {
    static IN_ALLOCATE: Cell<bool> = const { Cell::new(false) };
}

pub(crate) fn place_shell(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "The main window is not open.".to_string())?;
    let scale = window.scale_factor().map_err(|err| err.to_string())?;
    let inner = window.inner_size().map_err(|err| err.to_string())?;
    let width = inner.width as f64 / scale;
    let height = inner.height as f64 / scale;
    let Some(shell) = app.get_webview("main") else {
        return Ok(());
    };
    place(&shell, 0.0, 0.0, width, height, true)
}

pub(crate) fn place_child(
    webview: &Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    place(webview, x, y, width, height, false)
}

fn place(
    webview: &Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    shell: bool,
) -> Result<(), String> {
    let x = x.round() as i32;
    let y = y.round() as i32;
    let width = width.round().max(1.0) as i32;
    let height = height.round().max(1.0) as i32;
    let (tx, rx) = mpsc::channel();
    webview
        .with_webview(move |platform| {
            let widget = platform.inner();
            let result = move_onto_stage(&widget, x, y, width, height, shell);
            let _ = tx.send(result);
        })
        .map_err(|err| err.to_string())?;
    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Timed out while placing a webview.".to_string())?
}

fn move_onto_stage(
    widget: &webkit2gtk::WebView,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    shell: bool,
) -> Result<(), String> {
    if shell {
        widget.set_widget_name(SHELL_NAME);
    }
    let stage = ensure_stage(widget)?;
    reparent(&stage, widget.upcast_ref::<gtk::Widget>(), x, y);
    widget.set_size_request(width, height);
    widget.size_allocate(&gtk::Allocation::new(x, y, width, height));
    if !shell {
        let allocation = stage.allocation();
        resize_shell(&stage, allocation.width(), allocation.height());
    }
    Ok(())
}

fn ensure_stage(widget: &webkit2gtk::WebView) -> Result<gtk::Fixed, String> {
    let parent = widget
        .parent()
        .ok_or_else(|| "The webview has no parent widget.".to_string())?;
    if parent.widget_name() == STAGE_NAME {
        return parent
            .dynamic_cast::<gtk::Fixed>()
            .map_err(|_| "The stage widget is not a fixed container.".to_string());
    }
    let vbox = parent
        .clone()
        .dynamic_cast::<gtk::Box>()
        .map_err(|_| "The webview is not in the window box.".to_string())?;
    if let Some(stage) = find_stage(&vbox) {
        return Ok(stage);
    }

    let stage = gtk::Fixed::new();
    stage.set_widget_name(STAGE_NAME);
    stage.set_hexpand(true);
    stage.set_vexpand(true);
    for child in container_children(&vbox) {
        vbox.remove(&child);
        stage.put(&child, 0, 0);
    }
    vbox.pack_start(&stage, true, true, 0);
    stage.connect_size_allocate(|stage, allocation| {
        resize_shell(stage, allocation.width(), allocation.height());
    });
    stage.show();
    Ok(stage)
}

fn find_stage(vbox: &gtk::Box) -> Option<gtk::Fixed> {
    container_children(vbox).into_iter().find_map(|child| {
        if child.widget_name() == STAGE_NAME {
            child.dynamic_cast::<gtk::Fixed>().ok()
        } else {
            None
        }
    })
}

fn reparent(stage: &gtk::Fixed, widget: &gtk::Widget, x: i32, y: i32) {
    if widget
        .parent()
        .is_some_and(|parent| parent.widget_name() == STAGE_NAME)
    {
        stage.move_(widget, x, y);
        return;
    }
    if let Some(parent) = widget.parent() {
        if let Ok(container) = parent.dynamic_cast::<gtk::Container>() {
            container.remove(widget);
        }
    }
    stage.put(widget, x, y);
    widget.show();
}

fn resize_shell(stage: &gtk::Fixed, width: i32, height: i32) {
    if width < 32 || height < 32 {
        return;
    }
    if IN_ALLOCATE.with(Cell::get) {
        return;
    }
    IN_ALLOCATE.with(|flag| flag.set(true));
    for child in container_children(stage) {
        if child.widget_name() != SHELL_NAME {
            continue;
        }
        let current = child.allocation();
        if current.width() == width && current.height() == height && current.x() == 0 {
            continue;
        }
        child.set_size_request(width, height);
        child.size_allocate(&gtk::Allocation::new(0, 0, width, height));
    }
    IN_ALLOCATE.with(|flag| flag.set(false));
}

fn container_children(container: &impl gtk::prelude::ContainerExt) -> Vec<gtk::Widget> {
    let mut children = Vec::new();
    container.foreach(|child| children.push(child.clone()));
    children
}
