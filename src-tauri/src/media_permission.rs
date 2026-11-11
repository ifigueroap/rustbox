//! In-app microphone/camera prompting for a service's webview.
//!
//! Without this module nothing ever answers the page's `getUserMedia`
//! request:
//!
//! - **Linux (WebKitGTK)**: `webkit_web_view_new` does not enable the media
//!   stream/WebRTC settings by default, and nothing connects to the
//!   `permission-request` signal. WebKit's documented default action for an
//!   unhandled `WebKitUserMediaPermissionRequest` is to deny it, so a Slack
//!   huddle never even shows a prompt; it just never gets a microphone.
//! - **Windows (WebView2)**: with no `PermissionRequested` handler attached,
//!   WebView2 falls back to its own native permission bar, which is the
//!   "native dialog" this module replaces with an in-app one.
//! - **macOS (WKWebView)**: wry's `WKUIDelegate` grants capture requests
//!   automatically when no permission handler is installed (see
//!   `requestMediaCapturePermissionForOrigin:` in wry's
//!   `wry_web_view_ui_delegate.rs`), so the OS usage prompt still requires the
//!   `NSMicrophoneUsageDescription`/`NSCameraUsageDescription` Info.plist
//!   entries before capture can proceed. Implementing a Rustbox-styled async prompt on macOS
//!   would mean replacing wry's `WKUIDelegate`, which wry owns; that is not
//!   done here, so this module installs nothing on macOS.
//!
//! The remembered answer lives on `Service::media_permission` (`Ask`,
//! `Allow`, or `Deny`). `Ask` is answered by emitting `media-permission-request`
//! to the shell and holding the native request/deferral until
//! `answer_media_permission` (see `lib.rs`) resolves it, or until the
//! service's webview closes first, which denies it.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::config::MediaPermission;
use crate::services::{RuntimeState, lock};

/// What the shell needs to show a prompt and later resolve it. The native
/// request/deferral itself is never stored here: it is not `Send`, so it
/// stays on the platform UI thread (see the `linux`/`windows` submodules
/// below), keyed by the same request id.
pub struct PendingMediaRequest {
    pub service_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaPermissionRequestEvent {
    request_id: String,
    service_id: String,
    service_name: String,
    audio: bool,
    video: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaPermissionResolvedEvent {
    request_id: String,
}

fn decide(app: &AppHandle, service_id: &str) -> MediaPermission {
    let state = app.state::<RuntimeState>();
    let config = lock(&state.config);
    config
        .services
        .iter()
        .find(|service| service.id == service_id)
        .map(|service| service.media_permission)
        .unwrap_or_default()
}

/// Registers a pending `Ask` request and tells the shell about it. Returns
/// the request id the caller should hold its native request/deferral under,
/// or `None` if the service disappeared (removed) between the request
/// firing and this call, in which case the caller should deny immediately.
fn announce(app: &AppHandle, service_id: &str, audio: bool, video: bool) -> Option<String> {
    let state = app.state::<RuntimeState>();
    let service_name = lock(&state.config)
        .services
        .iter()
        .find(|service| service.id == service_id)
        .map(|service| service.name.clone())?;
    let request_id = uuid::Uuid::new_v4().to_string();
    lock(&state.media_requests).insert(
        request_id.clone(),
        PendingMediaRequest {
            service_id: service_id.to_string(),
        },
    );
    let emitted = app.emit_to(
        "main",
        "media-permission-request",
        MediaPermissionRequestEvent {
            request_id: request_id.clone(),
            service_id: service_id.to_string(),
            service_name,
            audio,
            video,
        },
    );
    if emitted.is_err() {
        lock(&state.media_requests).remove(&request_id);
        return None;
    }
    Some(request_id)
}

/// `answer_media_permission` command target: resolves a pending request the
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
    let Some(pending) = lock(&state.media_requests).remove(request_id) else {
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
                service.media_permission = if allow {
                    MediaPermission::Allow
                } else {
                    MediaPermission::Deny
                };
            }
            Ok(())
        })
    } else {
        Ok(())
    };
    resolve_native(app, request_id, allow);
    let _ = app.emit_to(
        "main",
        "media-permission-resolved",
        MediaPermissionResolvedEvent {
            request_id: request_id.to_string(),
        },
    );
    saved
}

/// Denies every request still pending for a service, without touching its
/// `media_permission` setting. Called right before that service's webview is
/// destroyed (removed, hibernated, logged out, or recreated), since nothing
/// will ever answer a request whose webview is gone.
pub fn deny_pending_for_service(app: &AppHandle, service_id: &str) {
    let state = app.state::<RuntimeState>();
    let ids: Vec<String> = lock(&state.media_requests)
        .iter()
        .filter(|(_, pending)| pending.service_id == service_id)
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        lock(&state.media_requests).remove(&id);
        resolve_native(app, &id, false);
        let _ = app.emit_to(
            "main",
            "media-permission-resolved",
            MediaPermissionResolvedEvent { request_id: id },
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

    use tauri::AppHandle;
    use webkit2gtk::{
        DeviceInfoPermissionRequest, PermissionRequest, PermissionRequestExt, SettingsExt,
        UserMediaPermissionRequest, UserMediaPermissionRequestExt, WebViewExt,
    };

    // Held only on the GTK/WebKit main thread, which is also the only thread
    // `run_on_main_thread` ever runs these closures on; see `linux_host.rs`'s
    // `HOST` thread-local for the same pattern with the host widget tree.
    // `DeviceInfoPermissionRequest` is never stored here: it is always
    // resolved immediately, never held for an `Ask` prompt.
    thread_local! {
        static GRANTED: RefCell<std::collections::HashSet<String>> = RefCell::new(Default::default());
        static PENDING: RefCell<HashMap<String, (String, UserMediaPermissionRequest)>> =
            RefCell::new(HashMap::new());
    }

    pub fn clear_grant(service_id: &str) {
        GRANTED.with(|cell| cell.borrow_mut().remove(service_id));
    }

    pub fn resolve(request_id: &str, allow: bool) {
        if let Some((service_id, request)) =
            PENDING.with(|cell| cell.borrow_mut().remove(request_id))
        {
            if allow {
                GRANTED.with(|cell| cell.borrow_mut().insert(service_id));
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
        if let Some(media) = request.downcast_ref::<UserMediaPermissionRequest>() {
            let audio = media.is_for_audio_device();
            let video = media.is_for_video_device();
            if !audio && !video {
                return false;
            }
            match super::decide(app, service_id) {
                super::MediaPermission::Allow => media.allow(),
                super::MediaPermission::Deny => media.deny(),
                super::MediaPermission::Ask => {
                    match super::announce(app, service_id, audio, video) {
                        Some(request_id) => {
                            PENDING.with(|cell| {
                                cell.borrow_mut()
                                    .insert(request_id, (service_id.to_string(), media.clone()));
                            });
                        }
                        None => media.deny(),
                    }
                }
            }
            return true;
        }
        if let Some(device) = request.downcast_ref::<DeviceInfoPermissionRequest>() {
            // `enumerateDevices()` labels are only useful once a media
            // permission is already granted; asking again here would be a
            // second, redundant prompt for the same access.
            match super::decide(app, service_id) {
                super::MediaPermission::Allow => device.allow(),
                super::MediaPermission::Ask
                    if GRANTED.with(|cell| cell.borrow().contains(service_id)) =>
                {
                    device.allow()
                }
                _ => device.deny(),
            }
            return true;
        }
        false
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use tauri::AppHandle;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY,
        ICoreWebView2Deferral, ICoreWebView2PermissionRequestedEventArgs,
        ICoreWebView2PermissionRequestedEventArgs3,
    };
    use webview2_com::PermissionRequestedEventHandler;

    /// Held only on the WebView2 UI thread; see the Linux module's `PENDING`
    /// for the same pattern. `args` carries `SetState`, `deferral` is what
    /// releases WebView2 to act on it.
    struct Held {
        args: ICoreWebView2PermissionRequestedEventArgs,
        deferral: ICoreWebView2Deferral,
    }

    thread_local! {
        static PENDING: RefCell<HashMap<String, Held>> = RefCell::new(HashMap::new());
    }

    pub fn resolve(request_id: &str, allow: bool) {
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

    fn handle(app: &AppHandle, service_id: &str, args: ICoreWebView2PermissionRequestedEventArgs) {
        let mut kind = Default::default();
        if unsafe { args.PermissionKind(&mut kind) }.is_err() {
            return;
        }
        let (audio, video) = match kind {
            k if k == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE => (true, false),
            k if k == COREWEBVIEW2_PERMISSION_KIND_CAMERA => (false, true),
            _ => return,
        };
        // Rustbox owns persistence; WebView2 must not cache an ephemeral
        // answer and bypass Ask or a later settings change.
        use windows_core::Interface;
        if let Ok(args3) = args.cast::<ICoreWebView2PermissionRequestedEventArgs3>() {
            let _ = unsafe { args3.SetSavesInProfile(false) };
        }
        match super::decide(app, service_id) {
            super::MediaPermission::Allow => {
                let _ = unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW) };
            }
            super::MediaPermission::Deny => {
                let _ = unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY) };
            }
            super::MediaPermission::Ask => {
                let Ok(deferral) = (unsafe { args.GetDeferral() }) else {
                    let _ = unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY) };
                    return;
                };
                match super::announce(app, service_id, audio, video) {
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
