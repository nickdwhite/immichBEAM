//! SQLite persistence: hash cache, upload history, and the durable queue.
//!
//! Backed by an r2d2 connection pool with WAL, so reads (status polls, history,
//! cache lookups) run concurrently with uploads instead of serializing on a
//! single mutex.

use std::path::Path;

use anyhow::{Context, Result};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::config::AppConfig;

type Pool = r2d2::Pool<SqliteConnectionManager>;
type Conn = r2d2::PooledConnection<SqliteConnectionManager>;

/// Status values used in `queue_items` and `upload_history`.
pub mod status {
    #[allow(dead_code)] // kept for symmetry with the other status constants
    pub const PENDING: &str = "pending";
    pub const ACTIVE: &str = "active";
    pub const SUCCESS: &str = "success";
    pub const DUPLICATE: &str = "duplicate";
    pub const SKIPPED: &str = "skipped";
    pub const UNSUPPORTED: &str = "unsupported";
    pub const FAILED: &str = "failed";
}

pub struct Db {
    pool: Pool,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueueItem {
    pub id: String,
    pub path: String,
    pub priority: i64,
    pub status: String,
    pub retries: i64,
    pub error: Option<String>,
    pub size: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryStats {
    pub total: i64,
    pub success: i64,
    pub duplicate: i64,
    pub skipped: i64,
    pub failed: i64,
    pub last_uploaded_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryItem {
    pub id: String,
    pub filename: String,
    pub asset_id: Option<String>,
    pub status: String,
    pub uploaded_at: i64,
    pub reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UploadedAsset {
    pub path: String,
    pub asset_id: String,
    pub album_id: Option<String>,
}

impl Db {
    /// Open (creating if needed) the database at the default app location.
    pub fn open_default() -> Result<Self> {
        let path = AppConfig::app_dir()?.join("dock.db");
        Self::open(&path)
    }

    pub fn open(path: &Path) -> Result<Self> {
        // Each pooled connection enables WAL (concurrent readers), foreign keys,
        // and a busy timeout so concurrent writers wait rather than error.
        let manager = SqliteConnectionManager::file(path).with_init(|c| {
            c.execute_batch(
                "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
            )
        });
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .with_context(|| format!("opening database pool {}", path.display()))?;
        let db = Self { pool };
        db.migrate()?;
        Ok(db)
    }

    fn conn(&self) -> Result<Conn> {
        self.pool.get().context("getting a database connection")
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn()?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS file_hashes (
                path  TEXT PRIMARY KEY,
                sha1  TEXT NOT NULL,
                size  INTEGER NOT NULL,
                mtime INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS upload_history (
                id          TEXT PRIMARY KEY,
                filename    TEXT NOT NULL,
                asset_id    TEXT,
                status      TEXT NOT NULL,
                uploaded_at INTEGER NOT NULL,
                reason      TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_history_time
                ON upload_history(uploaded_at DESC);

            CREATE TABLE IF NOT EXISTS queue_items (
                id       TEXT PRIMARY KEY,
                path     TEXT NOT NULL UNIQUE,
                priority INTEGER NOT NULL DEFAULT 0,
                status   TEXT NOT NULL DEFAULT 'pending',
                retries  INTEGER NOT NULL DEFAULT 0,
                error    TEXT,
                size     INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_queue_status
                ON queue_items(status, priority DESC);

            CREATE TABLE IF NOT EXISTS freed_space (
                path     TEXT NOT NULL,
                size     INTEGER NOT NULL,
                asset_id TEXT,
                freed_at INTEGER NOT NULL
            );

            -- Uploaded assets waiting to be added to an album, flushed in
            -- batched PUTs. Durable so membership survives a restart.
            CREATE TABLE IF NOT EXISTS pending_album (
                asset_id TEXT NOT NULL,
                album_id TEXT NOT NULL,
                PRIMARY KEY (asset_id, album_id)
            );

            -- Tracks which local files have been uploaded and their current
            -- album membership.  Used for album reconciliation (move on
            -- reassign) and the "Reorganize into album" action.
            CREATE TABLE IF NOT EXISTS uploaded_assets (
                path     TEXT PRIMARY KEY,
                asset_id TEXT NOT NULL,
                album_id TEXT
            );
            "#,
        )?;
        // Add columns to databases created before they existed.
        let _ = conn.execute(
            "ALTER TABLE queue_items ADD COLUMN size INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute("ALTER TABLE upload_history ADD COLUMN reason TEXT", []);
        Ok(())
    }

    /// Record a file moved to the trash by the free-up-space feature.
    pub fn add_freed(&self, path: &str, size: i64, asset_id: Option<&str>) -> Result<()> {
        let conn = self.conn()?;
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO freed_space(path, size, asset_id, freed_at) VALUES (?1, ?2, ?3, ?4)",
            params![path, size, asset_id, now],
        )?;
        // Drop the stale hash-cache entry for the now-removed file.
        let _ = conn.execute("DELETE FROM file_hashes WHERE path = ?1", params![path]);
        Ok(())
    }

    // ---- pending album membership ---------------------------------------

    /// Queue an uploaded asset to be added to `album_id` later (deduplicated).
    pub fn queue_album_add(&self, asset_id: &str, album_id: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT OR IGNORE INTO pending_album(asset_id, album_id) VALUES (?1, ?2)",
            params![asset_id, album_id],
        )?;
        Ok(())
    }

    /// Total number of queued album-add rows (for batch-flush thresholds).
    pub fn pending_album_total(&self) -> Result<i64> {
        let conn = self.conn()?;
        Ok(conn.query_row("SELECT COUNT(*) FROM pending_album", [], |r| r.get(0))?)
    }

    /// Take up to `limit` queued asset ids for one album (chosen arbitrarily).
    /// Returns `None` when nothing is pending. Rows are not removed until the
    /// add is confirmed via `remove_album_adds`.
    pub fn take_album_batch(&self, limit: u32) -> Result<Option<(String, Vec<String>)>> {
        let conn = self.conn()?;
        let album_id: Option<String> = conn
            .query_row("SELECT album_id FROM pending_album LIMIT 1", [], |r| r.get(0))
            .optional()?;
        let Some(album_id) = album_id else {
            return Ok(None);
        };
        let mut stmt =
            conn.prepare("SELECT asset_id FROM pending_album WHERE album_id = ?1 LIMIT ?2")?;
        let ids = stmt
            .query_map(params![album_id, limit], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(Some((album_id, ids)))
    }

    /// Remove queued album-add rows once the server confirmed the membership.
    pub fn remove_album_adds(&self, album_id: &str, asset_ids: &[String]) -> Result<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        for id in asset_ids {
            tx.execute(
                "DELETE FROM pending_album WHERE album_id = ?1 AND asset_id = ?2",
                params![album_id, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // ---- uploaded assets (album reconciliation) ---------------------------

    pub fn record_uploaded(&self, path: &str, asset_id: &str, album_id: Option<&str>) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO uploaded_assets(path, asset_id, album_id) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET asset_id = ?2, album_id = ?3",
            params![path, asset_id, album_id],
        )?;
        Ok(())
    }

    pub fn assets_for_folder(&self, folder_path: &str) -> Result<Vec<UploadedAsset>> {
        let conn = self.conn()?;
        let prefix = if folder_path.ends_with('/') || folder_path.ends_with('\\') {
            folder_path.to_string()
        } else {
            format!("{folder_path}/")
        };
        let prefix_end = format!("{prefix}\u{FFFF}");
        let mut stmt = conn.prepare(
            "SELECT path, asset_id, album_id FROM uploaded_assets
             WHERE path >= ?1 AND path < ?2",
        )?;
        let items = stmt
            .query_map(params![prefix, prefix_end], |row| {
                Ok(UploadedAsset {
                    path: row.get(0)?,
                    asset_id: row.get(1)?,
                    album_id: row.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }

    pub fn update_uploaded_album(&self, path: &str, album_id: Option<&str>) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE uploaded_assets SET album_id = ?2 WHERE path = ?1",
            params![path, album_id],
        )?;
        Ok(())
    }

    // ---- hash cache ------------------------------------------------------

    /// Return the cached SHA1 if `path` is unchanged (same size + mtime).
    pub fn cached_hash(&self, path: &str, size: i64, mtime: i64) -> Result<Option<String>> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare("SELECT sha1 FROM file_hashes WHERE path = ?1 AND size = ?2 AND mtime = ?3")?;
        let mut rows = stmt.query(params![path, size, mtime])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Returns true if this path was ever hashed (i.e. previously uploaded),
    /// regardless of whether the file has since changed.
    pub fn was_previously_synced(&self, path: &str) -> Result<bool> {
        let conn = self.conn()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM file_hashes WHERE path = ?1",
            params![path],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    pub fn put_hash(&self, path: &str, sha1: &str, size: i64, mtime: i64) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO file_hashes(path, sha1, size, mtime) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET sha1=?2, size=?3, mtime=?4",
            params![path, sha1, size, mtime],
        )?;
        Ok(())
    }

    // ---- queue -----------------------------------------------------------

    /// Enqueue a path, or refresh the size of an already-queued path. Returns
    /// true if a row was inserted or updated.
    pub fn enqueue(&self, id: &str, path: &str, priority: i64, size: i64) -> Result<bool> {
        let conn = self.conn()?;
        let changed = conn.execute(
            "INSERT INTO queue_items(id, path, priority, status, retries, size)
             VALUES (?1, ?2, ?3, 'pending', 0, ?4)
             ON CONFLICT(path) DO UPDATE SET size = excluded.size",
            params![id, path, priority, size],
        )?;
        Ok(changed > 0)
    }

    /// Update just the cached size of a queued item.
    pub fn update_size(&self, id: &str, size: i64) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE queue_items SET size = ?2 WHERE id = ?1",
            params![id, size],
        )?;
        Ok(())
    }

    /// Remove all pending/active items (used by "Clear queue"). Returns count.
    pub fn clear_pending(&self) -> Result<usize> {
        let conn = self.conn()?;
        Ok(conn.execute(
            "DELETE FROM queue_items WHERE status IN ('pending','active')",
            [],
        )?)
    }

    /// Claim up to `limit` pending items, marking them active.
    pub fn claim_pending(&self, limit: u32) -> Result<Vec<QueueItem>> {
        let conn = self.conn()?;
        let items: Vec<QueueItem> = {
            let mut stmt = conn.prepare(
                "SELECT id, path, priority, status, retries, error, size
                 FROM queue_items WHERE status = 'pending'
                 ORDER BY priority DESC, rowid ASC LIMIT ?1",
            )?;
            let rows = stmt
                .query_map(params![limit], row_to_queue_item)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        for item in &items {
            conn.execute(
                "UPDATE queue_items SET status = ?2 WHERE id = ?1",
                params![item.id, status::ACTIVE],
            )?;
        }
        Ok(items)
    }

    pub fn set_status(&self, id: &str, status: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE queue_items SET status = ?2 WHERE id = ?1",
            params![id, status],
        )?;
        Ok(())
    }

    pub fn mark_failed(&self, id: &str, error: &str) -> Result<i64> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE queue_items SET status='pending', retries = retries + 1, error = ?2
             WHERE id = ?1",
            params![id, error],
        )?;
        let retries: i64 = conn.query_row(
            "SELECT retries FROM queue_items WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        Ok(retries)
    }

    /// Give up on an item after exhausting retries.
    pub fn mark_dead(&self, id: &str, error: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE queue_items SET status='failed', error=?2 WHERE id=?1",
            params![id, error],
        )?;
        Ok(())
    }

    pub fn remove_queue_item(&self, id: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM queue_items WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Reset any rows stuck in `active` back to `pending` (called on startup).
    /// Returns the number of items unstuck.
    pub fn requeue_active(&self) -> Result<usize> {
        let conn = self.conn()?;
        Ok(conn.execute("UPDATE queue_items SET status='pending' WHERE status='active'", [])?)
    }

    /// Move all failed items back to pending (used by "Retry all").
    pub fn retry_failed(&self) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE queue_items SET status='pending', retries=0, error=NULL WHERE status='failed'",
            [],
        )?;
        Ok(())
    }

    /// Move a single failed item back to pending.
    pub fn retry_item(&self, id: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE queue_items SET status='pending', retries=0, error=NULL WHERE id=?1",
            params![id],
        )?;
        Ok(())
    }

    /// Active + pending items, active first, capped at `limit` rows.
    pub fn list_queue(&self, limit: u32) -> Result<Vec<QueueItem>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, path, priority, status, retries, error, size
             FROM queue_items WHERE status IN ('pending','active')
             ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
                      priority DESC, rowid ASC
             LIMIT ?1",
        )?;
        let items = stmt
            .query_map(params![limit], row_to_queue_item)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }

    pub fn list_failed(&self) -> Result<Vec<QueueItem>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, path, priority, status, retries, error, size
             FROM queue_items WHERE status = 'failed' ORDER BY rowid DESC",
        )?;
        let items = stmt
            .query_map([], row_to_queue_item)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }

    pub fn pending_count(&self) -> Result<i64> {
        let conn = self.conn()?;
        Ok(conn.query_row(
            "SELECT COUNT(*) FROM queue_items WHERE status IN ('pending','active')",
            [],
            |r| r.get(0),
        )?)
    }

    // ---- history ---------------------------------------------------------

    pub fn add_history(
        &self,
        id: &str,
        filename: &str,
        asset_id: Option<&str>,
        status: &str,
        reason: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn()?;
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT OR REPLACE INTO upload_history(id, filename, asset_id, status, uploaded_at, reason)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, filename, asset_id, status, now, reason],
        )?;
        Ok(())
    }

    /// Delete all upload-history rows. Returns the number removed.
    pub fn clear_history(&self) -> Result<usize> {
        let conn = self.conn()?;
        Ok(conn.execute("DELETE FROM upload_history", [])?)
    }

    /// Aggregate counts + last-upload time for the overview dashboard.
    pub fn history_stats(&self) -> Result<HistoryStats> {
        let conn = self.conn()?;
        conn.query_row(
            "SELECT COUNT(*),
                    SUM(CASE WHEN status = 'success'   THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status = 'duplicate' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status = 'skipped'   THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END),
                    MAX(uploaded_at)
             FROM upload_history",
            [],
            |r| {
                Ok(HistoryStats {
                    total: r.get(0)?,
                    success: r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    duplicate: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                    skipped: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                    failed: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                    last_uploaded_at: r.get(5)?,
                })
            },
        )
        .context("querying history stats")
    }

    /// Recent history, newest first. `status` filters to one status when given.
    pub fn list_history(&self, limit: u32, status: Option<&str>) -> Result<Vec<HistoryItem>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, filename, asset_id, status, uploaded_at, reason
             FROM upload_history
             WHERE (?2 IS NULL OR status = ?2)
             ORDER BY uploaded_at DESC LIMIT ?1",
        )?;
        let items = stmt
            .query_map(params![limit, status], |row| {
                Ok(HistoryItem {
                    id: row.get(0)?,
                    filename: row.get(1)?,
                    asset_id: row.get(2)?,
                    status: row.get(3)?,
                    uploaded_at: row.get(4)?,
                    reason: row.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }
}

fn row_to_queue_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<QueueItem> {
    Ok(QueueItem {
        id: row.get(0)?,
        path: row.get(1)?,
        priority: row.get(2)?,
        status: row.get(3)?,
        retries: row.get(4)?,
        error: row.get(5)?,
        size: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // A pool over `:memory:` would give each connection its own DB, so tests
    // use a unique temp file instead.
    fn mem() -> Db {
        let path = std::env::temp_dir()
            .join(format!("immich_test_db_{}.sqlite", uuid::Uuid::new_v4()));
        Db::open(&path).unwrap()
    }

    #[test]
    fn enqueue_upsert_and_clear() {
        let db = mem();
        assert!(db.enqueue("id1", "/a/1.jpg", 0, 100).unwrap());
        assert!(db.enqueue("id2", "/a/2.jpg", 0, 200).unwrap());
        // Re-enqueueing the same path updates size (upsert), no duplicate row.
        db.enqueue("id1b", "/a/1.jpg", 0, 150).unwrap();
        assert_eq!(db.pending_count().unwrap(), 2);

        // Active items sort first and the limit is respected.
        let claimed = db.claim_pending(1).unwrap();
        assert_eq!(claimed.len(), 1);
        let listed = db.list_queue(10).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].status, status::ACTIVE);

        assert_eq!(db.clear_pending().unwrap(), 2);
        assert_eq!(db.pending_count().unwrap(), 0);
    }

    #[test]
    fn retry_moves_failed_back_to_pending() {
        let db = mem();
        db.enqueue("id1", "/a/1.jpg", 0, 100).unwrap();
        let claimed = db.claim_pending(1).unwrap();
        db.mark_dead(&claimed[0].id, "boom").unwrap();
        assert_eq!(db.list_failed().unwrap().len(), 1);
        db.retry_failed().unwrap();
        assert_eq!(db.list_failed().unwrap().len(), 0);
        assert_eq!(db.pending_count().unwrap(), 1);
    }

    #[test]
    fn hash_cache_keys_on_size_and_mtime() {
        let db = mem();
        db.put_hash("/a/1.jpg", "abc123", 100, 42).unwrap();
        assert!(db.cached_hash("/a/1.jpg", 100, 42).unwrap().is_some());
        // Different size or mtime → cache miss (file changed).
        assert!(db.cached_hash("/a/1.jpg", 101, 42).unwrap().is_none());
        assert!(db.cached_hash("/a/1.jpg", 100, 43).unwrap().is_none());
    }

    #[test]
    fn album_batch_dedups_and_drains() {
        let db = mem();
        db.queue_album_add("a1", "alb1").unwrap();
        db.queue_album_add("a2", "alb1").unwrap();
        db.queue_album_add("a1", "alb1").unwrap(); // duplicate ignored (PK)
        db.queue_album_add("b1", "alb2").unwrap();
        assert_eq!(db.pending_album_total().unwrap(), 3);

        // One batch returns ids for a single album; confirming removes them.
        let (album, ids) = db.take_album_batch(250).unwrap().unwrap();
        let expected = if album == "alb1" { 2 } else { 1 };
        assert_eq!(ids.len(), expected);
        db.remove_album_adds(&album, &ids).unwrap();
        assert_eq!(db.pending_album_total().unwrap(), 3 - expected as i64);

        // Drain the rest; then nothing is pending.
        let (album2, ids2) = db.take_album_batch(250).unwrap().unwrap();
        db.remove_album_adds(&album2, &ids2).unwrap();
        assert_eq!(db.pending_album_total().unwrap(), 0);
        assert!(db.take_album_batch(250).unwrap().is_none());
    }

    #[test]
    fn uploaded_assets_record_query_and_update() {
        let db = mem();
        db.record_uploaded("/photos/a.jpg", "asset-1", Some("album-1")).unwrap();
        db.record_uploaded("/photos/sub/b.jpg", "asset-2", Some("album-1")).unwrap();
        db.record_uploaded("/other/c.jpg", "asset-3", None).unwrap();

        let found = db.assets_for_folder("/photos").unwrap();
        assert_eq!(found.len(), 2);
        assert!(found.iter().any(|a| a.asset_id == "asset-1"));
        assert!(found.iter().any(|a| a.asset_id == "asset-2"));

        // /other doesn't match /photos prefix
        let other = db.assets_for_folder("/other").unwrap();
        assert_eq!(other.len(), 1);
        assert_eq!(other[0].asset_id, "asset-3");

        // Update album assignment
        db.update_uploaded_album("/photos/a.jpg", Some("album-2")).unwrap();
        let updated = db.assets_for_folder("/photos").unwrap();
        let a = updated.iter().find(|a| a.path == "/photos/a.jpg").unwrap();
        assert_eq!(a.album_id.as_deref(), Some("album-2"));

        // Upsert overwrites
        db.record_uploaded("/photos/a.jpg", "asset-1-new", Some("album-3")).unwrap();
        let upserted = db.assets_for_folder("/photos").unwrap();
        let a = upserted.iter().find(|a| a.path == "/photos/a.jpg").unwrap();
        assert_eq!(a.asset_id, "asset-1-new");
        assert_eq!(a.album_id.as_deref(), Some("album-3"));
    }

    #[test]
    fn history_stats_counts_by_status() {
        let db = mem();
        db.add_history("h1", "a.jpg", Some("x"), status::SUCCESS, None).unwrap();
        db.add_history("h2", "b.jpg", None, status::DUPLICATE, None).unwrap();
        db.add_history("h3", "c.jpg", None, status::FAILED, Some("boom")).unwrap();
        let s = db.history_stats().unwrap();
        assert_eq!(s.total, 3);
        assert_eq!(s.success, 1);
        assert_eq!(s.duplicate, 1);
        assert_eq!(s.failed, 1);
        assert!(s.last_uploaded_at.is_some());
    }
}
