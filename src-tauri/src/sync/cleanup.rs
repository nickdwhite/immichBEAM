//! Types for the "free up space" feature.
//!
//! A *freeable* file is one that lives in a watched folder, is older than the
//! configured threshold, and whose byte-identical copy is confirmed present
//! (and not trashed) on the Immich server.

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
