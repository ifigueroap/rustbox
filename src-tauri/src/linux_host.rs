//! Linux child-webview placement.
//!
//! Tauri packs every child webview into the window's vertical `GtkBox`, so the
//! position passed to `add_child` is ignored and the box splits its height
//! across the shell and the services. This module moves the shell and each
//! service onto one `GtkFixed`, which is what WebKitGTK needs for absolute
//! positions. Each service has a windowed container: GTK moves that window,
//! while WebKit always renders and receives input at its local origin.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ffi::OsStr;

use gtk::glib;
use gtk::prelude::*;
use tauri::{LogicalPosition, Webview};
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

// GtkFixed's default allocation uses each child's preferred size (WebKit can
// report 1×1), before a size-allocate signal handler can correct it. That sends
// two viewport sizes to WebKit on resize/switch. Own the allocation vfunc so children
// receive only the final bounds; retain GtkFixed and the windowed EventBoxes
// for the local coordinate space required by accelerated drawing and input.
mod fixed_host {
    use super::*;
    use gtk::subclass::prelude::*;

    #[derive(Default)]
    pub struct FixedHost;

    #[glib::object_subclass]
    impl ObjectSubclass for FixedHost {
        const NAME: &'static str = "RustboxFixedHost";
        type Type = super::FixedHost;
        type ParentType = gtk::Fixed;
    }

    impl ObjectImpl for FixedHost {}
    impl WidgetImpl for FixedHost {
        fn size_allocate(&self, allocation: &gtk::Allocation) {
            self.obj().set_allocation(allocation);
            HOST.with(|slot| {
                if let Some(host) = slot.borrow().as_ref() {
                    allocate(host, allocation);
                }
            });
        }
    }
    impl ContainerImpl for FixedHost {}
    impl FixedImpl for FixedHost {}
}

glib::wrapper! {
    pub struct FixedHost(ObjectSubclass<fixed_host::FixedHost>)
        @extends gtk::Fixed, gtk::Container, gtk::Widget,
        @implements gtk::Buildable;
}

struct Host {
    fixed: gtk::Fixed,
    /// Widgets that should fill the window (the shell, and anything Tauri put
    /// beside it, such as a menu bar).
    backdrop: Vec<gtk::Widget>,
    services: HashMap<String, ServiceHost>,
}

/// Keep WebKit's allocation at (0, 0), including after reparenting, sidebar
/// changes and find-bar changes. A windowless GtkFixed gives WebKit a nonzero
/// allocation in the same parent window as the full-size shell. A windowed
/// EventBox instead owns the offset and provides a local GdkWindow coordinate
/// space for both WebKit's accelerated drawing and pointer events.
struct ServiceHost {
    container: gtk::EventBox,
    view: webkit2gtk::WebView,
    position: Cell<(i32, i32)>,
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

    let fixed: gtk::Fixed = glib::Object::new::<FixedHost>().upcast();
    fixed.set_hexpand(true);
    fixed.set_vexpand(true);

    let backdrop: Vec<gtk::Widget> = vbox.children();
    for child in &backdrop {
        vbox.remove(child);
        fixed.put(child, 0, 0);
    }

    let overlay = host_container(&fixed);
    parent.remove(&vbox);
    parent.add(&overlay);
    overlay.show();
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

fn host_container(fixed: &gtk::Fixed) -> gtk::Overlay {
    // GtkFixed measures the extents of its children. Their natural sizes
    // must not become the toplevel's minimum size, otherwise a window can
    // grow but never shrink (especially visible at GDK_SCALE=2).
    // Overlay children do not contribute to the preferred size. Explicitly
    // allocate the host to the available area, even below its natural size.
    let overlay = gtk::Overlay::new();
    overlay.add(&gtk::DrawingArea::new());
    overlay.add_overlay(fixed);
    overlay.connect_get_child_position(|overlay, _| {
        Some(gtk::Allocation::new(
            0,
            0,
            overlay.allocated_width(),
            overlay.allocated_height(),
        ))
    });
    overlay
}

pub fn place(webview: &Webview, position: LogicalPosition<f64>, muted: bool) -> Result<(), String> {
    let label = webview.label().to_string();
    let x = px(position.x);
    let y = px(position.y);
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
                let service = host
                    .services
                    .entry(label)
                    .or_insert_with(|| attach(&host.fixed, &view, x, y));
                place_service(&host.fixed, service, x, y);
            });
        })
        .map_err(|err| err.to_string())
}

pub fn sync(position: LogicalPosition<f64>) {
    let x = px(position.x);
    let y = px(position.y);
    HOST.with(|slot| {
        let host_slot = slot.borrow();
        let Some(host) = host_slot.as_ref() else {
            return;
        };
        for widget in &host.backdrop {
            host.fixed.move_(widget, 0, 0);
        }
        for service in host.services.values() {
            place_service(&host.fixed, service, x, y);
        }
    });
}

pub fn set_muted(label: &str, muted: bool) -> bool {
    HOST.with(|slot| {
        let host_slot = slot.borrow();
        let Some(host) = host_slot.as_ref() else {
            return false;
        };
        let Some(service) = host.services.get(label) else {
            return false;
        };
        service.view.set_is_muted(muted);
        true
    })
}

/// Drop our extra reference before Tauri/Wry destroys a child webview. Called
/// via `with_webview`, so GTK and this thread-local host stay on the UI thread.
pub fn forget(label: &str) {
    HOST.with(|slot| {
        if let Some(host) = slot.borrow_mut().as_mut() {
            if let Some(service) = host.services.remove(label) {
                // Wry still owns the view and will destroy it after this call.
                // Do not leave an empty event window over the shell on wake.
                service.container.remove(&service.view);
                host.fixed.remove(&service.container);
            }
        }
    });
}

fn attach(fixed: &gtk::Fixed, view: &webkit2gtk::WebView, x: i32, y: i32) -> ServiceHost {
    // Configure the parent before adding it to the realized host. Removing
    // the view from Tauri's GtkBox unrealizes it; its next realization must
    // use the new parent window, rather than retain the shell's origin.
    let container = gtk::EventBox::new();
    container.set_visible_window(true);
    container.set_above_child(false);
    if let Some(parent) = view.parent() {
        if let Ok(parent) = parent.downcast::<gtk::Container>() {
            parent.remove(view);
        }
    }
    if std::env::var_os("RUSTBOX_GEOMETRY_TRACE").is_some() {
        view.connect_size_allocate(|_, a| {
            eprintln!(
                "geometry: view {} {} {} {}",
                a.x(),
                a.y(),
                a.width(),
                a.height()
            )
        });
        container.connect_size_allocate(|_, a| {
            eprintln!(
                "geometry: container {} {} {} {}",
                a.x(),
                a.y(),
                a.width(),
                a.height()
            )
        });
    }
    container.add(view);
    fixed.put(&container, x, y);
    // An empty EventBox still receives input. Mirror Tauri's view visibility
    // so a hidden/background service cannot intercept the active view or
    // shell. Weak references avoid a view/container reference cycle.
    let weak_container = container.downgrade();
    view.connect_show(move |_| {
        if let Some(container) = weak_container.upgrade() {
            container.show();
        }
    });
    let weak_container = container.downgrade();
    view.connect_hide(move |_| {
        if let Some(container) = weak_container.upgrade() {
            container.hide();
        }
    });
    container.set_visible(view.is_visible());
    ServiceHost {
        container,
        view: view.clone(),
        position: Cell::new((x, y)),
    }
}

fn place_service(fixed: &gtk::Fixed, service: &ServiceHost, x: i32, y: i32) {
    service.position.set((x, y));
    fixed.move_(&service.container, x, y);
    fixed.queue_allocate();
}

/// Allocate each child once with the current logical viewport. In particular,
/// never let GtkFixed allocate WebKit's preferred size before these bounds.
fn allocate(host: &Host, allocation: &gtk::Allocation) {
    let width = allocation.width();
    let height = allocation.height();
    for widget in &host.backdrop {
        widget.size_allocate(&gtk::Allocation::new(0, 0, width, height));
    }
    for service in host.services.values() {
        let (x, y) = service.position.get();
        service
            .container
            .size_allocate(&service_allocation(width, height, x, y));
    }
}

fn service_allocation(width: i32, height: i32, x: i32, y: i32) -> gtk::Allocation {
    gtk::Allocation::new(x, y, (width - x).max(1), (height - y).max(1))
}

fn px(value: f64) -> i32 {
    value.round() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires a GTK display; run under xvfb-run with --ignored --test-threads=1"]
    fn gtk_host_allocates_only_the_final_viewport() {
        gtk::init().expect("GTK display");
        let fixed: gtk::Fixed = glib::Object::new::<FixedHost>().upcast();
        let child = gtk::DrawingArea::new();
        let allocations = std::rc::Rc::new(RefCell::new(Vec::new()));
        let recorded = allocations.clone();
        child.connect_size_allocate(move |_, a| {
            recorded.borrow_mut().push((a.width(), a.height()));
        });
        fixed.put(&child, 0, 0);
        child.show();
        fixed.show();
        HOST.with(|slot| {
            *slot.borrow_mut() = Some(Host {
                fixed: fixed.clone(),
                backdrop: vec![child.upcast()],
                services: HashMap::new(),
            });
        });
        for (width, height) in [(1200, 800), (900, 600), (800, 540), (1200, 800)] {
            fixed.size_allocate(&gtk::Allocation::new(0, 0, width, height));
        }
        HOST.with(|slot| {
            slot.borrow_mut().take();
        });
        assert_eq!(
            *allocations.borrow(),
            [(1200, 800), (900, 600), (800, 540), (1200, 800)]
        );
    }

    #[test]
    fn service_geometry_preserves_sidebar_and_find_strip() {
        for (x, y) in [(228, 0), (276, 44), (72, 44), (120, 0)] {
            let a = service_allocation(1200, 800, x, y);
            assert_eq!((a.x(), a.y()), (x, y));
            assert_eq!((a.width(), a.height()), (1200 - x, 800 - y));
        }
        let a = service_allocation(100, 20, 228, 44);
        assert_eq!((a.width(), a.height()), (1, 1));
    }

    #[test]
    fn service_geometry_tracks_the_current_gtk_viewport() {
        // GTK supplies logical dimensions even on a scaled display. Repeated
        // allocations must use the current dimensions, not the old page size.
        for (width, height) in [(1200, 800), (800, 540), (900, 550), (1200, 800)] {
            let a = service_allocation(width, height, 228, 44);
            assert_eq!(a.x() + a.width(), width);
            assert_eq!(a.y() + a.height(), height);
        }
        let a = service_allocation(0, 0, 0, 0);
        assert_eq!((a.width(), a.height()), (1, 1));
    }

    #[test]
    fn gtk_positions_round_to_logical_widget_coordinates() {
        assert_eq!(px(72.4), 72);
        assert_eq!(px(72.6), 73);
    }

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
