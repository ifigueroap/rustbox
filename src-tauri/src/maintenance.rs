//! Session maintenance policy and guarded filesystem operations. No webview dependencies.
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

/// A service id must be a single, portable directory name, including legacy ids.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id != "."
        && id != ".."
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// WKWebView maps UUID spellings to the same store and uses a shared fallback
/// for legacy non-UUID ids. Refuse maintenance on any ambiguous identity.
pub fn unique_macos_store<'a>(id: &str, ids: impl Iterator<Item = &'a str>) -> bool {
    let Ok(uuid) = uuid::Uuid::parse_str(id) else {
        return false;
    };
    if uuid.is_nil() {
        return false;
    }
    let key = *uuid.as_bytes();
    ids.filter(|other| {
        uuid::Uuid::parse_str(other)
            .map(|value| *value.as_bytes())
            .unwrap_or([1; 16])
            == key
    })
    .count()
        == 1
}

fn redirected(path: &Path) -> io::Result<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => Ok(metadata.file_type().is_symlink() || path.canonicalize()? != path),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(err),
    }
}

pub fn session_dir(root: &Path, id: &str) -> io::Result<PathBuf> {
    if !valid_id(id) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid service id",
        ));
    }
    let root = root.canonicalize()?;
    let dir = root.join(id);
    // Refuse redirected profiles; never follow a symlink/junction outside the root.
    if redirected(&dir)? {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "redirected session directory",
        ));
    }
    Ok(dir)
}

/// WebView2's default profile, rooted at the per-service user data folder.
/// Do not remove Network, Local Storage, IndexedDB, Service Worker or CacheStorage.
/// Linux and macOS use native APIs instead of relying on WebKit's disk layout.
pub const WEBVIEW2_HTTP_CACHES: &[&str] = &[
    "EBWebView/Default/Cache",
    "EBWebView/Default/Code Cache",
    "EBWebView/Default/GPUCache",
];

pub fn cache_path(session: &Path, relative: &str) -> io::Result<PathBuf> {
    if redirected(session)? {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "redirected session directory",
        ));
    }
    let relative = Path::new(relative);
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
        || relative.as_os_str().is_empty()
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid cache path",
        ));
    }
    let mut path = session.to_path_buf();
    for part in relative.components() {
        path.push(part);
        if redirected(&path)? {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "redirected cache directory",
            ));
        }
    }
    Ok(path)
}

/// Run only after destruction has been acknowledged by the UI thread.
/// WebView2's browser process can take a little longer to release its files.
pub fn remove_with_retry(path: &Path) -> io::Result<()> {
    for attempt in 0..20 {
        match std::fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(err) if attempt == 19 => return Err(err),
            Err(_) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rustbox-maintenance-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }
    #[test]
    fn rejects_unsafe_ids() {
        for id in [
            "",
            ".",
            "..",
            "../other",
            "x/y",
            "x\\y",
            "/tmp",
            "C:profile",
            " white",
            "a\0b",
        ] {
            assert!(!valid_id(id), "{id:?}");
        }
        assert!(valid_id("legacy-account_2"));
        assert!(valid_id("12345678-1234-1234-1234-123456789abc"));
    }
    #[test]
    fn macos_refuses_shared_and_fallback_stores() {
        let id = "aabbccdd-1234-1234-1234-123456789abc";
        assert!(unique_macos_store(id, [id, "legacy"].into_iter()));
        assert!(!unique_macos_store(
            id,
            [id, "AABBCCDD-1234-1234-1234-123456789ABC"].into_iter()
        ));
        assert!(!unique_macos_store("legacy", ["legacy"].into_iter()));
        assert!(!unique_macos_store(
            "00000000-0000-0000-0000-000000000000",
            ["00000000-0000-0000-0000-000000000000"].into_iter()
        ));
        let fallback = "01010101-0101-0101-0101-010101010101";
        assert!(!unique_macos_store(
            fallback,
            [fallback, "legacy"].into_iter()
        ));
    }

    #[test]
    fn only_removes_target_session() {
        let root = root();
        for id in ["one", "two"] {
            std::fs::create_dir(root.join(id)).unwrap();
        }
        remove_with_retry(&session_dir(&root, "one").unwrap()).unwrap();
        assert!(root.join("two").is_dir());
        remove_with_retry(&session_dir(&root, "one").unwrap()).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cache_clear_keeps_authentication_and_storage() {
        let root = root();
        let session = session_dir(&root, "one").unwrap();
        for path in WEBVIEW2_HTTP_CACHES.iter().copied().chain([
            "EBWebView/Default/Network",
            "EBWebView/Default/Local Storage",
            "EBWebView/Default/IndexedDB",
            "EBWebView/Default/Service Worker/CacheStorage",
        ]) {
            std::fs::create_dir_all(session.join(path)).unwrap();
            std::fs::write(session.join(path).join("data"), b"test").unwrap();
        }
        for path in WEBVIEW2_HTTP_CACHES {
            remove_with_retry(&cache_path(&session, path).unwrap()).unwrap();
        }
        for path in [
            "EBWebView/Default/Network",
            "EBWebView/Default/Local Storage",
            "EBWebView/Default/IndexedDB",
            "EBWebView/Default/Service Worker/CacheStorage",
        ] {
            assert!(session.join(path).join("data").exists());
        }
        for path in ["../two", "/tmp", "EBWebView/Default/../Network", ""] {
            assert!(cache_path(&session, path).is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlinked_profiles_and_cache_ancestors() {
        use std::os::unix::fs::symlink;
        let root = root();
        std::fs::create_dir(root.join("two")).unwrap();
        symlink(root.join("two"), root.join("one")).unwrap();
        assert!(session_dir(&root, "one").is_err());
        assert!(cache_path(&root.join("one"), "EBWebView/Default/Cache").is_err());
        symlink(root.join("missing"), root.join("dangling")).unwrap();
        assert!(session_dir(&root, "dangling").is_err());
        let session = session_dir(&root, "three").unwrap();
        std::fs::create_dir(&session).unwrap();
        symlink(root.join("two"), session.join("EBWebView")).unwrap();
        assert!(cache_path(&session, "EBWebView/Default/Cache").is_err());
        assert!(root.join("two").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
