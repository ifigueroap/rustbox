//! Clean-exit coordination for the tray Quit action, a trapped SIGTERM or
//! SIGINT, and a session ending without one of those (the window's own close
//! path already runs through Tauri's normal `ExitRequested`/`Exit` events).
//!
//! WebKitGTK and WebView2 only guarantee cookies, localStorage, and
//! IndexedDB are durable once a webview is cleanly destroyed. A hard kill
//! (SIGKILL, or a desktop session ending without giving the process a
//! chance to react) skips that entirely. SIGTERM is the one case this app
//! can intercept: trapping it and routing through the same teardown as the
//! tray Quit action buys that chance instead of taking the OS default
//! terminate-immediately disposition.
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(unix)]
use std::time::Duration;
use tauri::AppHandle;

/// Set by the signal handler, which must stay async-signal-safe (a single
/// atomic store, nothing else), and polled by `spawn_signal_watcher`.
#[cfg(unix)]
static SIGNAL_RECEIVED: AtomicBool = AtomicBool::new(false);

/// Whether the webview teardown has already run. The teardown's own
/// `AppHandle::exit` call delivers a second `ExitRequested`; that second
/// delivery, and a repeated signal, should just let the process exit instead
/// of repeating the close pass.
static CLEANUP_STARTED: AtomicBool = AtomicBool::new(false);

#[cfg(unix)]
extern "C" fn on_terminate_signal(_signum: libc::c_int) {
    SIGNAL_RECEIVED.store(true, Ordering::SeqCst);
}

/// Traps SIGTERM and SIGINT. Call once, before the event loop starts.
#[cfg(unix)]
pub fn install_signal_handlers() {
    unsafe {
        libc::signal(libc::SIGTERM, on_terminate_signal as libc::sighandler_t);
        libc::signal(libc::SIGINT, on_terminate_signal as libc::sighandler_t);
    }
}

#[cfg(not(unix))]
pub fn install_signal_handlers() {}

/// Polls the flag the signal handler set (handlers may only touch that one
/// atomic) and asks the app to exit the normal way once it is, which
/// triggers the same `RunEvent::ExitRequested` teardown as the tray Quit
/// action.
#[cfg(unix)]
pub fn spawn_signal_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            if SIGNAL_RECEIVED.load(Ordering::SeqCst) {
                app.exit(0);
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    });
}

#[cfg(not(unix))]
pub fn spawn_signal_watcher(_app: AppHandle) {}

/// First caller gets `true` and should run the webview teardown before
/// letting the exit proceed. Every later caller (the teardown thread's own
/// `app.exit`, or a second signal) gets `false`.
pub fn begin_cleanup_once() -> bool {
    !CLEANUP_STARTED.swap(true, Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_runs_exactly_once() {
        CLEANUP_STARTED.store(false, Ordering::SeqCst);
        assert!(begin_cleanup_once());
        assert!(!begin_cleanup_once());
        assert!(!begin_cleanup_once());
        CLEANUP_STARTED.store(false, Ordering::SeqCst);
    }
}
