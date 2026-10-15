//! Linux child-webview placement.
//!
//! Tauri packs every child webview into the window's vertical `GtkBox`, so the
//! position passed to `add_child` is ignored and the box splits its height
//! across the shell and the services. This module moves the shell and each
//! service onto one `GtkFixed`, which is what WebKitGTK needs for absolute
//! positions.

use std::cell::RefCell;
use std::collections::HashMap;

use gtk::prelude::*;
use tauri::{LogicalPosition, LogicalSize, Webview};

struct Host {
    fixed: gtk::Fixed,
    /// Widgets that should fill the window (the shell, and anything Tauri put
    /// beside it, such as a menu bar).
    backdrop: Vec<gtk::Widget>,
    services: HashMap<String, gtk::Widget>,
}

thread_local! {
    static HOST: RefCell<Option<Host>> = const { RefCell::new(None) };
}

pub fn install(window: &tauri::Window) {
    let vbox = match window.default_vbox() {
        Ok(vbox) => vbox,
        Err(err) => {
            eprintln!("rustbox: no gtk box for service webviews: {err}");
            return;
        }
    };
    let Some(parent_widget) = vbox.parent() else {
        eprintln!("rustbox: gtk box has no parent");
        return;
    };
    let Ok(parent) = parent_widget.downcast::<gtk::Container>() else {
        eprintln!("rustbox: gtk box parent is not a container");
        return;
    };

    let scale = window.scale_factor().unwrap_or(1.0);
    let physical = window
        .inner_size()
        .unwrap_or(tauri::PhysicalSize::new(1200, 800));
    let logical: LogicalSize<f64> = physical.to_logical(scale);
    let width = px_size(logical.width);
    let height = px_size(logical.height);

    let fixed = gtk::Fixed::new();
    fixed.set_hexpand(true);
    fixed.set_vexpand(true);

    let backdrop: Vec<gtk::Widget> = vbox.children();
    for child in &backdrop {
        vbox.remove(child);
        fixed.put(child, 0, 0);
        child.set_size_request(width, height);
    }

    parent.remove(&vbox);
    parent.add(&fixed);
    fixed.show();
    for child in &backdrop {
        child.show();
    }

    HOST.with(|slot| {
        *slot.borrow_mut() = Some(Host {
            fixed,
            backdrop,
            services: HashMap::new(),
        });
    });
}

pub fn place(
    webview: &Webview,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
) -> Result<(), String> {
    let label = webview.label().to_string();
    let x = px(position.x);
    let y = px(position.y);
    let width = px_size(size.width);
    let height = px_size(size.height);
    webview
        .with_webview(move |platform| {
            let view = platform.inner();
            HOST.with(|slot| {
                let mut host_slot = slot.borrow_mut();
                let Some(host) = host_slot.as_mut() else {
                    eprintln!("rustbox: linux host is not installed");
                    return;
                };
                attach(&host.fixed, &view, x, y, width, height);
                host.services.insert(label, view.upcast());
            });
        })
        .map_err(|err| err.to_string())
}

pub fn sync(shell: LogicalSize<f64>, position: LogicalPosition<f64>, size: LogicalSize<f64>) {
    let shell_w = px_size(shell.width);
    let shell_h = px_size(shell.height);
    let x = px(position.x);
    let y = px(position.y);
    let width = px_size(size.width);
    let height = px_size(size.height);
    HOST.with(|slot| {
        let host_slot = slot.borrow();
        let Some(host) = host_slot.as_ref() else {
            return;
        };
        for widget in &host.backdrop {
            host.fixed.move_(widget, 0, 0);
            widget.set_size_request(shell_w, shell_h);
        }
        for widget in host.services.values() {
            host.fixed.move_(widget, x, y);
            widget.set_size_request(width, height);
        }
    });
}

fn attach(fixed: &gtk::Fixed, view: &webkit2gtk::WebView, x: i32, y: i32, width: i32, height: i32) {
    let fixed_widget: gtk::Widget = fixed.clone().upcast();
    let already = view.parent().is_some_and(|parent| parent == fixed_widget);
    if !already {
        if let Some(parent) = view.parent() {
            if let Ok(container) = parent.downcast::<gtk::Container>() {
                container.remove(view);
            }
        }
        fixed.put(view, x, y);
    } else {
        fixed.move_(view, x, y);
    }
    view.set_size_request(width, height);
}

fn px(value: f64) -> i32 {
    value.round() as i32
}

fn px_size(value: f64) -> i32 {
    value.round().max(1.0) as i32
}
