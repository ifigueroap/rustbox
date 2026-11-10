//! Click-capable service notifications, independent of the Tauri/webview API.
//! Callers retain the existing plugin path as a delivery fallback.

use std::sync::atomic::{AtomicUsize, Ordering};

// Some notification daemons ignore timeouts or never report a close. Never
// grow one waiting thread per notification indefinitely: excess deliveries
// use the plugin without a click listener instead.
const MAX_WORKERS: usize = 32;
static WORKERS: AtomicUsize = AtomicUsize::new(0);

struct Worker<'a>(&'a AtomicUsize);

impl<'a> Worker<'a> {
    fn acquire(counter: &'a AtomicUsize) -> Option<Self> {
        counter
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |count| {
                (count < MAX_WORKERS).then_some(count + 1)
            })
            .ok()
            .map(|_| Self(counter))
    }
}

impl Drop for Worker<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

/// Returns an error if no worker can be started; the caller must then use
/// its fallback. A native delivery error calls `fallback` on the worker.
/// No title, body, or service data is included in error logs.
pub fn show(
    app_id: &str,
    title: &str,
    body: &str,
    on_click: impl Fn() + Send + 'static,
    fallback: impl FnOnce() + Send + 'static,
) -> Result<(), ()> {
    let (app_id, title, body) = (app_id.to_string(), title.to_string(), body.to_string());
    spawn_delivery(move || deliver(&app_id, &title, &body, on_click), fallback)
}

fn spawn_delivery(
    deliver: impl FnOnce() -> Result<(), ()> + Send + 'static,
    fallback: impl FnOnce() + Send + 'static,
) -> Result<(), ()> {
    let worker = Worker::acquire(&WORKERS).ok_or(())?;
    std::thread::Builder::new()
        .name("service-notification".into())
        .spawn(move || {
            let _worker = worker;
            if deliver().is_err() {
                fallback();
            }
        })
        .map(|_| ())
        .map_err(|_| ())
}

#[cfg(target_os = "linux")]
fn deliver(
    _app_id: &str,
    title: &str,
    body: &str,
    on_click: impl Fn() + Send + 'static,
) -> Result<(), ()> {
    let handle = notify_rust::Notification::new()
        .appname("Rustbox")
        .auto_icon()
        .summary(title)
        .body(body)
        // The default action means clicking the notification itself. An empty
        // label avoids adding a redundant, untranslated action button.
        .action("default", "")
        .timeout(30_000)
        .show()
        .map_err(|_| ())?;
    // Consumes the handle, keeping its D-Bus connection alive until activation
    // or NotificationClosed. Runs only on this bounded background worker.
    handle.wait_for_action(move |action| {
        if action == "default" {
            on_click();
        }
    });
    Ok(())
}

#[cfg(target_os = "windows")]
fn deliver(
    app_id: &str,
    title: &str,
    body: &str,
    on_click: impl Fn() + Send + 'static,
) -> Result<(), ()> {
    // Use the bundle identifier registered by the installer as AppUserModelID.
    // WinRT owns the callback; no thread waits for activation. This does not
    // register a COM activator for Action Center clicks or process relaunch.
    tauri_winrt_notification::Toast::new(app_id)
        .title(title)
        .text2(body)
        // Match notify-rust's existing default (no explicit toast sound).
        .sound(None)
        .on_activated(move |_| {
            on_click();
            Ok(())
        })
        .show()
        .map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, time::Duration};

    #[test]
    fn native_delivery_failure_invokes_the_fallback() {
        let (sent, received) = mpsc::channel();
        spawn_delivery(|| Err(()), move || sent.send("fallback").unwrap()).unwrap();
        assert_eq!(
            received.recv_timeout(Duration::from_secs(2)).unwrap(),
            "fallback"
        );
    }

    #[test]
    fn waiting_for_an_action_does_not_block_the_caller_or_duplicate_delivery() {
        let (finish, wait) = mpsc::channel();
        let (fallback, received) = mpsc::channel();
        spawn_delivery(
            move || {
                wait.recv_timeout(Duration::from_secs(2)).unwrap();
                Ok(())
            },
            move || fallback.send(()).unwrap(),
        )
        .unwrap();
        // This send is reached while the listener is still waiting.
        finish.send(()).unwrap();
        assert_eq!(
            received.recv_timeout(Duration::from_secs(2)),
            Err(mpsc::RecvTimeoutError::Disconnected)
        );
    }

    #[test]
    fn workers_are_bounded_even_when_the_daemon_never_reports_close() {
        let counter = AtomicUsize::new(0);
        let workers: Vec<_> = (0..MAX_WORKERS)
            .map(|_| Worker::acquire(&counter).unwrap())
            .collect();
        assert!(Worker::acquire(&counter).is_none());
        assert_eq!(counter.load(Ordering::Relaxed), MAX_WORKERS);
        drop(workers);
        assert_eq!(counter.load(Ordering::Relaxed), 0);
        assert!(Worker::acquire(&counter).is_some());
    }

    #[test]
    fn a_failed_or_finished_worker_releases_its_slot() {
        let counter = AtomicUsize::new(0);
        let worker = Worker::acquire(&counter).unwrap();
        assert_eq!(counter.load(Ordering::Relaxed), 1);
        drop(worker);
        assert_eq!(counter.load(Ordering::Relaxed), 0);
    }
}
