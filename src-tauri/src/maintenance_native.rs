//! Native clears must finish before a replacement webview can use the profile.
//! Tauri's clear_all_browsing_data returns after dispatch, without a completion
//! result (Wry uses empty callbacks). Use engine completion callbacks instead.
use crate::services::{self, RuntimeState};
use tauri::{AppHandle, Manager};

fn wait_closed(app: &AppHandle, id: &str) -> Result<(), String> {
    services::close_for_maintenance(app, id)?;
    // close() queues destruction and removes the manager entry immediately.
    // A subsequent UI task acknowledges that the runtime has dropped the view.
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(());
    })
    .map_err(|_| crate::i18n::maintenance_failed())?;
    rx.recv().map_err(|_| crate::i18n::maintenance_failed())
}

pub fn clear(app: &AppHandle, id: &str, session: bool) -> Result<(), String> {
    let state = app.state::<RuntimeState>();
    let dir = crate::maintenance::session_dir(&state.sessions_dir, id)
        .map_err(|_| crate::i18n::maintenance_failed())?;

    #[cfg(target_os = "linux")]
    {
        use webkit2gtk::{
            WebContextExt, WebViewExt, WebsiteDataManagerExtManual, WebsiteDataTypes,
        };
        let webview = app
            .get_webview(&services::label_for(id))
            .ok_or_else(crate::i18n::maintenance_failed)?;
        let handle = app.clone();
        let service_id = id.to_owned();
        let (tx, rx) = std::sync::mpsc::channel();
        webview
            .with_webview(move |platform| {
                let manager = platform
                    .inner()
                    .context()
                    .and_then(|context| context.website_data_manager());
                // Do not destroy a view while its with_webview callback is borrowed
                // by the runtime. The idle runs after that callback has returned.
                gtk::glib::idle_add_local_once(move || {
                    let Some(manager) = manager else {
                        let _ = tx.send(Err(crate::i18n::maintenance_failed()));
                        return;
                    };
                    if services::close_for_maintenance(&handle, &service_id).is_err() {
                        let _ = tx.send(Err(crate::i18n::maintenance_failed()));
                        return;
                    }
                    // Wry retains the Linux WebContext even without views. Clear
                    // its memory state as well as disk, otherwise old cookies can
                    // be resurrected when we reuse the same data_directory.
                    let types = if session {
                        WebsiteDataTypes::ALL
                    } else {
                        WebsiteDataTypes::MEMORY_CACHE | WebsiteDataTypes::DISK_CACHE
                    };
                    manager.clear(
                        types,
                        gtk::glib::TimeSpan::from_seconds(0),
                        None::<&gtk::gio::Cancellable>,
                        move |result| {
                            let _ = tx.send(result.map_err(|_| crate::i18n::maintenance_failed()));
                        },
                    );
                });
            })
            .map_err(|_| crate::i18n::maintenance_failed())?;
        rx.recv().map_err(|_| crate::i18n::maintenance_failed())??;
        wait_closed(app, id)?;
    }

    #[cfg(target_os = "windows")]
    {
        wait_closed(app, id)?;
        if !session {
            for relative in crate::maintenance::WEBVIEW2_HTTP_CACHES {
                let path = crate::maintenance::cache_path(&dir, relative)
                    .map_err(|_| crate::i18n::maintenance_failed())?;
                crate::maintenance::remove_with_retry(&path)
                    .map_err(|_| crate::i18n::maintenance_failed())?;
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Reject the legacy fallback store id: it can be shared by malformed
        // non-UUID ids. Never clear a shared or default WKWebsiteDataStore.
        if !crate::maintenance::unique_macos_store(
            id,
            services::lock(&state.config)
                .services
                .iter()
                .map(|service| service.id.as_str()),
        ) {
            return Err(crate::i18n::maintenance_failed());
        }
        let uuid = uuid::Uuid::parse_str(id).map_err(|_| crate::i18n::maintenance_failed())?;
        wait_closed(app, id)?;
        let identifier = uuid.to_string();
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            use objc2::{AllocAnyThread, MainThreadMarker};
            use objc2_foundation::{NSDate, NSSet, NSString, NSUUID};
            use objc2_web_kit::{
                WKWebsiteDataStore, WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache,
            };
            let Some(mtm) = MainThreadMarker::new() else {
                let _ = tx.send(Err(crate::i18n::maintenance_failed()));
                return;
            };
            let Some(uuid) =
                NSUUID::initWithUUIDString(NSUUID::alloc(), &NSString::from_str(&identifier))
            else {
                let _ = tx.send(Err(crate::i18n::maintenance_failed()));
                return;
            };
            // SAFETY: macOS 14 is the app minimum. The UUID is nonzero and
            // service-specific; all WebKit calls run on the main thread.
            unsafe {
                if session {
                    let handler =
                        block2::RcBlock::new(move |error: *mut objc2_foundation::NSError| {
                            let _ = tx.send(if error.is_null() {
                                Ok(())
                            } else {
                                Err(crate::i18n::maintenance_failed())
                            });
                        });
                    WKWebsiteDataStore::removeDataStoreForIdentifier_completionHandler(
                        &uuid, &handler, mtm,
                    );
                } else {
                    let store = WKWebsiteDataStore::dataStoreForIdentifier(&uuid, mtm);
                    let types = NSSet::from_slice(&[
                        WKWebsiteDataTypeDiskCache,
                        WKWebsiteDataTypeMemoryCache,
                    ]);
                    // Keep the store alive through the asynchronous removal.
                    let retained = store.clone();
                    let handler = block2::RcBlock::new(move || {
                        let _ = &retained;
                        let _ = tx.send(Ok(()));
                    });
                    store.removeDataOfTypes_modifiedSince_completionHandler(
                        &types,
                        &NSDate::dateWithTimeIntervalSince1970(0.0),
                        &handler,
                    );
                }
            }
        })
        .map_err(|_| crate::i18n::maintenance_failed())?;
        rx.recv().map_err(|_| crate::i18n::maintenance_failed())??;
    }

    if session && !cfg!(target_os = "linux") {
        // Revalidate immediately before removing; the view is already gone.
        let dir = crate::maintenance::session_dir(&state.sessions_dir, id)
            .map_err(|_| crate::i18n::maintenance_failed())?;
        crate::maintenance::remove_with_retry(&dir)
            .map_err(|_| crate::i18n::maintenance_failed())?;
    }
    let _ = dir;
    Ok(())
}
