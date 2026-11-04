//! Linux child-webview placement.
//!
//! Tauri packs every child webview into the window's vertical `GtkBox`, so the
//! position passed to `add_child` is ignored and the box splits its height
//! across the shell and the services. This module moves the shell and each
//! service onto one `GtkFixed`, which is what WebKitGTK needs for absolute
//! positions.

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::OsStr;

use gtk::prelude::*;
use tauri::{LogicalPosition, LogicalSize, Webview};
use webkit2gtk::WebViewExt;

/// WebKitGTK 2.42 and later draw through DMA-BUF by default, and its renderer
/// aborts inside `WebKitWebProcess` when the compositor, the GL driver, or Mesa
/// disagree with what WebKitGTK was built against. That is the AppImage's
/// problem: it bundles Ubuntu 22.04's WebKitGTK and meets whatever Mesa the
/// host distribution has, and on Arch the mismatch is a crash. A package build
/// links the distribution's own WebKitGTK, which was built against the same
/// Mesa, so it keeps DMA-BUF: forcing the software path there only costs
/// drawing and input latency (typing in WhatsApp Web ran a whole core hot).
/// WebKitGTK reads this switch once, while it creates the first web process, so
/// it has to be in the environment before any webview exists.
pub fn prepare_environment() {
    let configured = std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER");
    let appimage = std::env::var_os("APPIMAGE");
    let Some(value) = dmabuf_fallback(configured.as_deref(), appimage.as_deref()) else {
        return;
    };
    // SAFETY: `run` calls this before Tauri is built, so no GTK, WebKit, or
    // Rust thread exists yet and nothing can be reading the environment.
    unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", value) };
    eprintln!(
        "rustbox: WEBKIT_DISABLE_DMABUF_RENDERER was unset; using 1 for the AppImage's bundled WebKitGTK so it does not abort on DMA-BUF"
    );
}

/// The value to install in `WEBKIT_DISABLE_DMABUF_RENDERER`, or `None` to leave
/// the environment alone.
///
/// Any value the user set, including an empty one, is a deliberate choice and
/// wins over the fallback. The fallback itself is only for the AppImage, whose
/// bundled WebKitGTK is older than the host's Mesa; a package build, where
/// `APPIMAGE` is absent, keeps the DMA-BUF renderer. Presence alone decides,
/// which is how `updates::detect_bundle_kind` reads the same variable.
fn dmabuf_fallback(configured: Option<&OsStr>, appimage: Option<&OsStr>) -> Option<&'static str> {
    if configured.is_some() {
        return None;
    }
    if appimage.is_some() {
        Some("1")
    } else {
        None
    }
}

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
    muted: bool,
) -> Result<(), String> {
    let label = webview.label().to_string();
    let x = px(position.x);
    let y = px(position.y);
    let width = px_size(size.width);
    let height = px_size(size.height);
    webview
        .with_webview(move |platform| {
            let view = platform.inner();
            view.set_is_muted(muted);
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

pub fn set_muted(label: &str, muted: bool) -> bool {
    HOST.with(|slot| {
        let host_slot = slot.borrow();
        let Some(host) = host_slot.as_ref() else {
            return false;
        };
        let Some(widget) = host.services.get(label) else {
            return false;
        };
        let Ok(view) = widget.clone().downcast::<webkit2gtk::WebView>() else {
            return false;
        };
        view.set_is_muted(muted);
        true
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unset_dmabuf_switch_gets_the_software_renderer_in_the_appimage() {
        assert_eq!(
            dmabuf_fallback(None, Some(OsStr::new("/tmp/.mount_rustbox"))),
            Some("1")
        );
        // The variable is a marker: an empty value still means "AppImage".
        assert_eq!(dmabuf_fallback(None, Some(OsStr::new(""))), Some("1"));
    }

    #[test]
    fn a_package_install_keeps_the_dmabuf_renderer() {
        // A native build links the distribution's WebKitGTK, built against the
        // same Mesa, so the software path is only a slowdown. The hardware path
        // is what makes typing in WhatsApp Web responsive.
        assert_eq!(dmabuf_fallback(None, None), None);
    }

    #[test]
    fn a_user_set_dmabuf_switch_is_never_overridden() {
        // `0` is how a user proves WebKit works on their GL stack, and an empty
        // value is still a deliberate set-and-empty. Both stay as they are,
        // in the AppImage and outside it.
        for appimage in [None, Some(OsStr::new("/tmp/.mount_rustbox"))] {
            assert_eq!(dmabuf_fallback(Some(OsStr::new("0")), appimage), None);
            assert_eq!(dmabuf_fallback(Some(OsStr::new("1")), appimage), None);
            assert_eq!(dmabuf_fallback(Some(OsStr::new("")), appimage), None);
            assert_eq!(dmabuf_fallback(Some(OsStr::new(" true ")), appimage), None);
        }
    }
}
