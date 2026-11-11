//! Per-service native permissions. Requests stay on the platform UI thread;
//! closing a service denies its pending requests. macOS keeps wry/system handling.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::config::{PermissionDecision, PermissionKind};
use crate::services::{RuntimeState, lock};

/// What the shell needs to show a prompt and later resolve it. The native
/// request/deferral itself is never stored here: it is not `Send`, so it
/// stays on the platform UI thread (see the `linux`/`windows` submodules
/// below), keyed by the same request id.
pub struct PendingPermissionRequest {
    pub service_id: String,
    pub kind: PermissionKind,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionRequestEvent {
    request_id: String,
    service_id: String,
    service_name: String,
    kind: PermissionKind,
    audio: bool,
    video: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionResolvedEvent {
    request_id: String,
}

fn decide(app: &AppHandle, service_id: &str, kind: PermissionKind) -> PermissionDecision {
    let state = app.state::<RuntimeState>();
    let config = lock(&state.config);
    config
        .services
        .iter()
        .find(|service| service.id == service_id)
        .map(|service| service.permission(kind))
        .unwrap_or_default()
}

/// Registers a pending `Ask` request and tells the shell about it. Returns
/// the request id the caller should hold its native request/deferral under,
/// or `None` if the service disappeared (removed) between the request
/// firing and this call, in which case the caller should deny immediately.
fn announce(
    app: &AppHandle,
    service_id: &str,
    kind: PermissionKind,
    audio: bool,
    video: bool,
) -> Option<String> {
    let state = app.state::<RuntimeState>();
    let service_name = lock(&state.config)
        .services
        .iter()
        .find(|service| service.id == service_id)
        .map(|service| service.name.clone())?;
    let request_id = uuid::Uuid::new_v4().to_string();
    lock(&state.permission_requests).insert(
        request_id.clone(),
        PendingPermissionRequest {
            service_id: service_id.to_string(),
            kind,
        },
    );
    let emitted = app.emit_to(
        "main",
        "permission-request",
        PermissionRequestEvent {
            request_id: request_id.clone(),
            service_id: service_id.to_string(),
            service_name,
            kind,
            audio,
            video,
        },
    );
    if emitted.is_err() {
        lock(&state.permission_requests).remove(&request_id);
        return None;
    }
    Some(request_id)
}

/// `answer_permission` command target: resolves a pending request the
/// shell's dialog just answered. A missing id (already resolved, or the
/// service was removed first) is a no-op, not an error.
pub fn answer(
    app: &AppHandle,
    request_id: &str,
    allow: bool,
    remember: bool,
) -> Result<(), String> {
    let state = app.state::<RuntimeState>();
    // Atomically claim the answer before saving. A simultaneous close can
    // deny only requests that have not already been answered. Never wait on
    // `ops` here: maintenance can hold it while awaiting the native UI thread.
    let Some(pending) = lock(&state.permission_requests).remove(request_id) else {
        return Ok(());
    };
    let service_id = pending.service_id;
    let saved = if remember {
        crate::services::mutate(app, |config| {
            if let Some(service) = config
                .services
                .iter_mut()
                .find(|service| service.id == service_id)
            {
                service.permissions.insert(
                    pending.kind,
                    if allow {
                        PermissionDecision::Allow
                    } else {
                        PermissionDecision::Deny
                    },
                );
            }
            Ok(())
        })
    } else {
        Ok(())
    };
    resolve_native(app, request_id, allow);
    let _ = app.emit_to(
        "main",
        "permission-resolved",
        PermissionResolvedEvent {
            request_id: request_id.to_string(),
        },
    );
    saved
}

/// Denies every request still pending for a service, without touching its
/// `permissions` settings. Called right before that service's webview is
/// destroyed (removed, hibernated, logged out, or recreated), since nothing
/// will ever answer a request whose webview is gone.
pub fn deny_pending_for_service(app: &AppHandle, service_id: &str) {
    let state = app.state::<RuntimeState>();
    let ids: Vec<String> = lock(&state.permission_requests)
        .iter()
        .filter(|(_, pending)| pending.service_id == service_id)
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        lock(&state.permission_requests).remove(&id);
        resolve_native(app, &id, false);
        let _ = app.emit_to(
            "main",
            "permission-resolved",
            PermissionResolvedEvent { request_id: id },
        );
    }
    #[cfg(target_os = "linux")]
    {
        let service_id = service_id.to_string();
        let _ = app.run_on_main_thread(move || linux::clear_grant(&service_id));
    }
}

fn resolve_native(app: &AppHandle, request_id: &str, allow: bool) {
    #[cfg(target_os = "linux")]
    {
        let request_id = request_id.to_string();
        let _ = app.run_on_main_thread(move || linux::resolve(&request_id, allow));
    }
    #[cfg(target_os = "windows")]
    {
        let request_id = request_id.to_string();
        let _ = app.run_on_main_thread(move || windows::resolve(&request_id, allow));
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = (app, request_id, allow);
    }
}

/// Wires one service webview's native permission hook. A no-op on platforms
/// without one (see the module doc comment for why macOS has none).
pub fn install(app: &AppHandle, service_id: &str, webview: &tauri::Webview) {
    #[cfg(target_os = "linux")]
    linux::install(app, service_id, webview);
    #[cfg(target_os = "windows")]
    windows::install(app, service_id, webview);
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = (app, service_id, webview);
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use crate::config::PermissionKind;
    use tauri::AppHandle;
    use webkit2gtk::{
        DeviceInfoPermissionRequest, GeolocationPermissionRequest, PermissionRequest,
        PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
        UserMediaPermissionRequestExt, WebViewExt,
    };

    // Held only on the GTK/WebKit main thread, which is also the only thread
    // `run_on_main_thread` ever runs these closures on; see `linux_host.rs`'s
    // `HOST` thread-local for the same pattern with the host widget tree.
    // `DeviceInfoPermissionRequest` is never stored here: it is always
    // resolved immediately, never held for an `Ask` prompt.
    thread_local! {
        static GRANTED: RefCell<std::collections::HashSet<String>> = RefCell::new(Default::default());
        static PENDING: RefCell<HashMap<String, (String, PermissionKind, PermissionRequest)>> =
            RefCell::new(HashMap::new());
    }

    pub fn clear_grant(service_id: &str) {
        GRANTED.with(|cell| cell.borrow_mut().remove(service_id));
    }

    pub fn resolve(request_id: &str, allow: bool) {
        if let Some((service_id, kind, request)) =
            PENDING.with(|cell| cell.borrow_mut().remove(request_id))
        {
            if allow {
                if kind == PermissionKind::Media {
                    GRANTED.with(|cell| cell.borrow_mut().insert(service_id));
                }
                request.allow()
            } else {
                request.deny()
            }
        }
    }

    pub fn install(app: &AppHandle, service_id: &str, webview: &tauri::Webview) {
        let app = app.clone();
        let service_id = service_id.to_string();
        let _ = webview.with_webview(move |platform| {
            let view = platform.inner();
            if let Some(settings) = view.settings() {
                settings.set_enable_media_stream(true);
                settings.set_enable_webrtc(true);
                settings.set_enable_mediasource(true);
                settings.set_enable_media_capabilities(true);
            }
            view.connect_permission_request(move |_view, request| {
                handle(&app, &service_id, request)
            });
        });
    }

    fn handle(app: &AppHandle, service_id: &str, request: &PermissionRequest) -> bool {
        use webkit2gtk::glib::Cast;
        let media = request.downcast_ref::<UserMediaPermissionRequest>();
        let kind = if let Some(media) = media {
            // The safe wrapper omits this method, but the pinned v2_34+
            // sys API exposes it (enabled by our v2_38 feature).
            use webkit2gtk::glib::translate::ToGlibPtr;
            let display = unsafe {
                webkit2gtk::ffi::webkit_user_media_permission_is_for_display_device(
                    media.to_glib_none().0,
                ) != 0
            };
            Some(if display {
                PermissionKind::Screen
            } else {
                PermissionKind::Media
            })
        } else if request
            .downcast_ref::<GeolocationPermissionRequest>()
            .is_some()
        {
            Some(PermissionKind::Location)
        } else {
            None
        };
        if let Some(kind) = kind {
            let audio = media.map(|m| m.is_for_audio_device()).unwrap_or(false);
            let video = media.map(|m| m.is_for_video_device()).unwrap_or(false);
            match super::decide(app, service_id, kind) {
                super::PermissionDecision::Allow => request.allow(),
                super::PermissionDecision::Deny => request.deny(),
                super::PermissionDecision::Ask => {
                    match super::announce(app, service_id, kind, audio, video) {
                        Some(request_id) => {
                            PENDING.with(|cell| {
                                cell.borrow_mut().insert(
                                    request_id,
                                    (service_id.to_string(), kind, request.clone()),
                                );
                            });
                        }
                        None => request.deny(),
                    }
                }
            }
            return true;
        }
        if let Some(device) = request.downcast_ref::<DeviceInfoPermissionRequest>() {
            // `enumerateDevices()` labels are only useful once a media
            // permission is already granted; asking again here would be a
            // second, redundant prompt for the same access.
            match super::decide(app, service_id, PermissionKind::Media) {
                super::PermissionDecision::Allow => device.allow(),
                super::PermissionDecision::Ask
                    if GRANTED.with(|cell| cell.borrow().contains(service_id)) =>
                {
                    device.allow()
                }
                _ => device.deny(),
            }
            return true;
        }
        request.deny();
        true
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use crate::config::PermissionKind;
    use tauri::AppHandle;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ,
        COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY, ICoreWebView2_27,
        ICoreWebView2Deferral, ICoreWebView2PermissionRequestedEventArgs,
        ICoreWebView2PermissionRequestedEventArgs3, ICoreWebView2ScreenCaptureStartingEventArgs,
    };
    use webview2_com::{PermissionRequestedEventHandler, ScreenCaptureStartingEventHandler};

    /// Held only on the WebView2 UI thread; see the Linux module's `PENDING`
    /// for the same pattern. `args` carries `SetState`, `deferral` is what
    /// releases WebView2 to act on it.
    struct Held {
        args: ICoreWebView2PermissionRequestedEventArgs,
        deferral: ICoreWebView2Deferral,
    }

    thread_local! {
        static PENDING: RefCell<HashMap<String, Held>> = RefCell::new(HashMap::new());
        static SCREENS: RefCell<HashMap<String, (ICoreWebView2ScreenCaptureStartingEventArgs, ICoreWebView2Deferral)>> = RefCell::new(HashMap::new());
    }

    pub fn resolve(request_id: &str, allow: bool) {
        if let Some((args, deferral)) = SCREENS.with(|cell| cell.borrow_mut().remove(request_id)) {
            unsafe {
                let _ = args.SetCancel(!allow);
                let _ = deferral.Complete();
            }
        }

        if let Some(held) = PENDING.with(|cell| cell.borrow_mut().remove(request_id)) {
            let state = if allow {
                COREWEBVIEW2_PERMISSION_STATE_ALLOW
            } else {
                COREWEBVIEW2_PERMISSION_STATE_DENY
            };
            unsafe {
                let _ = held.args.SetState(state);
                let _ = held.deferral.Complete();
            }
        }
    }

    pub fn install(app: &AppHandle, service_id: &str, webview: &tauri::Webview) {
        let app = app.clone();
        let service_id = service_id.to_string();
        let _ = webview.with_webview(move |platform| {
            let controller = platform.controller();
            let Ok(view) = (unsafe { controller.CoreWebView2() }) else {
                return;
            };
            use windows_core::Interface;
            if let Ok(screen_view) = view.cast::<ICoreWebView2_27>() {
                let screen_app = app.clone();
                let screen_service = service_id.clone();
                let mut token = 0;
                let _ = unsafe {
                    screen_view.add_ScreenCaptureStarting(
                        &ScreenCaptureStartingEventHandler::create(Box::new(move |_, args| {
                            if let Some(args) = args {
                                handle_screen(&screen_app, &screen_service, args);
                            }
                            Ok(())
                        })),
                        &mut token,
                    )
                };
            }
            let mut token = Default::default();
            let _ = unsafe {
                view.add_PermissionRequested(
                    &PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                        let Some(args) = args else { return Ok(()) };
                        handle(&app, &service_id, args);
                        Ok(())
                    })),
                    &mut token,
                )
            };
        });
    }

    fn handle_screen(
        app: &AppHandle,
        service_id: &str,
        args: ICoreWebView2ScreenCaptureStartingEventArgs,
    ) {
        // Handled prevents duplicate frame handlers; the system source picker
        // still chooses what is captured after Rustbox allows the request.
        let _ = unsafe { args.SetHandled(true) };
        match super::decide(app, service_id, PermissionKind::Screen) {
            super::PermissionDecision::Allow => {
                let _ = unsafe { args.SetCancel(false) };
            }
            super::PermissionDecision::Deny => {
                let _ = unsafe { args.SetCancel(true) };
            }
            super::PermissionDecision::Ask => {
                let Ok(deferral) = (unsafe { args.GetDeferral() }) else {
                    let _ = unsafe { args.SetCancel(true) };
                    return;
                };
                if let Some(id) =
                    super::announce(app, service_id, PermissionKind::Screen, false, false)
                {
                    SCREENS.with(|cell| cell.borrow_mut().insert(id, (args, deferral)));
                } else {
                    let _ = unsafe { args.SetCancel(true) };
                    let _ = unsafe { deferral.Complete() };
                }
            }
        }
    }

    fn handle(app: &AppHandle, service_id: &str, args: ICoreWebView2PermissionRequestedEventArgs) {
        let mut kind = Default::default();
        if unsafe { args.PermissionKind(&mut kind) }.is_err() {
            let _ = unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY) };
            return;
        }
        let (kind, audio, video) = match kind {
            k if k == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE => {
                (PermissionKind::Media, true, false)
            }
            k if k == COREWEBVIEW2_PERMISSION_KIND_CAMERA => (PermissionKind::Media, false, true),
            k if k == COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION => {
                (PermissionKind::Location, false, false)
            }
            k if k == COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ => {
                (PermissionKind::Clipboard, false, false)
            }
            _ => {
                let _ = unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY) };
                return;
            }
        };
        // Rustbox owns persistence; WebView2 must not cache an ephemeral
        // answer and bypass Ask or a later settings change.
        use windows_core::Interface;
        if let Ok(args3) = args.cast::<ICoreWebView2PermissionRequestedEventArgs3>() {
            let _ = unsafe { args3.SetSavesInProfile(false) };
        }
        match super::decide(app, service_id, kind) {
            super::PermissionDecision::Allow => {
                let _ = unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW) };
            }
            super::PermissionDecision::Deny => {
                let _ = unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY) };
            }
            super::PermissionDecision::Ask => {
                let Ok(deferral) = (unsafe { args.GetDeferral() }) else {
                    let _ = unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY) };
                    return;
                };
                match super::announce(app, service_id, kind, audio, video) {
                    Some(request_id) => {
                        PENDING.with(|cell| {
                            cell.borrow_mut()
                                .insert(request_id, Held { args, deferral });
                        });
                    }
                    None => {
                        let _ = unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY) };
                        let _ = unsafe { deferral.Complete() };
                    }
                }
            }
        }
    }
}
