//! Types for the "free up space" feature.
//!
//! A *freeable* file is one that lives in a watched folder, is older than the
//! configured threshold, and whose byte-identical copy is confirmed present
//! (and not trashed) on the Immich server.

use std::collections::HashSet;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct FreeableItem {
    pub path: String,
    /// Size in bytes.
    pub size: i64,
    /// Last-modified time (unix seconds).
    pub mtime: i64,
    /// The server-side asset id confirming this file is synced.
    pub asset_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct FreeResult {
    pub freed_count: u32,
    pub freed_bytes: i64,
    pub errors: Vec<String>,
}

/// Result of a queue-repair pass.
#[derive(Debug, Clone, Default, Serialize)]
pub struct RepairReport {
    /// Items unstuck from a stale `active` status.
    pub requeued_active: usize,
    /// Items dropped because the file no longer exists on disk.
    pub removed_missing: usize,
    /// Items whose cached size was (re)computed.
    pub resized: usize,
}

/// Summary of a folder's matching media, shown before adding it.
#[derive(Debug, Clone, Default, Serialize)]
pub struct FolderInspect {
    pub file_count: u64,
    pub total_bytes: i64,
}

/// Backend-owned state of a free-up-space scan, so it survives the UI
/// navigating away and back.
#[derive(Debug, Clone, Default, Serialize)]
pub struct FreeableScan {
    pub running: bool,
    /// Whether at least one scan has completed this session.
    pub done: bool,
    /// Candidate files examined so far.
    pub scanned: usize,
    /// Total candidate files (known after the gather phase).
    pub total: usize,
    pub items: Vec<FreeableItem>,
}

/// Partition `requested` paths into (allowed, rejected) based on the scan
/// allowlist. Rejected paths get an error message appended to `errors`.
pub fn enforce_allowlist(
    requested: Vec<String>,
    scan_items: &[FreeableItem],
    errors: &mut Vec<String>,
) -> Vec<String> {
    let allowed: HashSet<&str> = scan_items.iter().map(|i| i.path.as_str()).collect();
    let (ok, rejected): (Vec<String>, Vec<String>) =
        requested.into_iter().partition(|p| allowed.contains(p.as_str()));
    for p in rejected {
        errors.push(format!(
            "{p}: not confirmed by the last scan — re-scan first"
        ));
    }
    ok
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(path: &str) -> FreeableItem {
        FreeableItem {
            path: path.to_string(),
            size: 1000,
            mtime: 0,
            asset_id: Some("asset-1".into()),
        }
    }

    #[test]
    fn allowlist_permits_scanned_paths() {
        let scan = vec![item("/photos/a.jpg"), item("/photos/b.jpg")];
        let mut errors = Vec::new();
        let ok = enforce_allowlist(
            vec!["/photos/a.jpg".into(), "/photos/b.jpg".into()],
            &scan,
            &mut errors,
        );
        assert_eq!(ok, vec!["/photos/a.jpg", "/photos/b.jpg"]);
        assert!(errors.is_empty());
    }

    #[test]
    fn allowlist_rejects_unscanned_paths() {
        let scan = vec![item("/photos/a.jpg")];
        let mut errors = Vec::new();
        let ok = enforce_allowlist(
            vec!["/photos/a.jpg".into(), "/etc/passwd".into(), "/photos/evil.jpg".into()],
            &scan,
            &mut errors,
        );
        assert_eq!(ok, vec!["/photos/a.jpg"]);
        assert_eq!(errors.len(), 2);
        assert!(errors[0].contains("/etc/passwd"));
        assert!(errors[1].contains("/photos/evil.jpg"));
    }

    #[test]
    fn allowlist_rejects_all_when_no_scan() {
        let mut errors = Vec::new();
        let ok = enforce_allowlist(
            vec!["/photos/a.jpg".into()],
            &[],
            &mut errors,
        );
        assert!(ok.is_empty());
        assert_eq!(errors.len(), 1);
    }

    #[test]
    fn allowlist_returns_empty_on_empty_request() {
        let scan = vec![item("/photos/a.jpg")];
        let mut errors = Vec::new();
        let ok = enforce_allowlist(vec![], &scan, &mut errors);
        assert!(ok.is_empty());
        assert!(errors.is_empty());
    }
}
