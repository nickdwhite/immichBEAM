//! SQLite persistence: hash cache, upload history, and the durable queue.

use std::path::Path;

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::config::AppConfig;

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
    conn: Connection,
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
}

impl Db {
    /// Open (creating if needed) the database at the default app location.
    pub fn open_default() -> Result<Self> {
        let path = AppConfig::app_dir()?.join("syncdesk.db");
        Self::open(&path)
    }

    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)
            .with_context(|| format!("opening database {}", path.display()))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
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
                uploaded_at INTEGER NOT NULL
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
            "#,
        )?;
        // Add the size column to databases created before it existed.
        let _ = self.conn.execute(
            "ALTER TABLE queue_items ADD COLUMN size INTEGER NOT NULL DEFAULT 0",
            [],
        );
        Ok(())
    }

    /// Record a file moved to the trash by the free-up-space feature.
    pub fn add_freed(&self, path: &str, size: i64, asset_id: Option<&str>) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.conn.execute(
            "INSERT INTO freed_space(path, size, asset_id, freed_at) VALUES (?1, ?2, ?3, ?4)",
            params![path, size, asset_id, now],
        )?;
        // Drop the stale hash-cache entry for the now-removed file.
        let _ = self
            .conn
            .execute("DELETE FROM file_hashes WHERE path = ?1", params![path]);
        Ok(())
    }

    // ---- hash cache ------------------------------------------------------

    /// Return the cached SHA1 if `path` is unchanged (same size + mtime).
    pub fn cached_hash(&self, path: &str, size: i64, mtime: i64) -> Result<Option<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT sha1 FROM file_hashes WHERE path = ?1 AND size = ?2 AND mtime = ?3")?;
        let mut rows = stmt.query(params![path, size, mtime])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn put_hash(&self, path: &str, sha1: &str, size: i64, mtime: i64) -> Result<()> {
        self.conn.execute(
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
        let changed = self.conn.execute(
            "INSERT INTO queue_items(id, path, priority, status, retries, size)
             VALUES (?1, ?2, ?3, 'pending', 0, ?4)
             ON CONFLICT(path) DO UPDATE SET size = excluded.size",
            params![id, path, priority, size],
        )?;
        Ok(changed > 0)
    }

    /// Update just the cached size of a queued item.
    pub fn update_size(&self, id: &str, size: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE queue_items SET size = ?2 WHERE id = ?1",
            params![id, size],
        )?;
        Ok(())
    }

    /// Remove all pending/active items (used by "Clear queue"). Returns count.
    pub fn clear_pending(&self) -> Result<usize> {
        Ok(self.conn.execute(
            "DELETE FROM queue_items WHERE status IN ('pending','active')",
            [],
        )?)
    }

    /// Claim up to `limit` pending items, marking them active.
    pub fn claim_pending(&self, limit: u32) -> Result<Vec<QueueItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, priority, status, retries, error, size
             FROM queue_items WHERE status = 'pending'
             ORDER BY priority DESC, rowid ASC LIMIT ?1",
        )?;
        let items = stmt
            .query_map(params![limit], row_to_queue_item)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for item in &items {
            self.set_status(&item.id, status::ACTIVE)?;
        }
        Ok(items)
    }

    pub fn set_status(&self, id: &str, status: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE queue_items SET status = ?2 WHERE id = ?1",
            params![id, status],
        )?;
        Ok(())
    }

    pub fn mark_failed(&self, id: &str, error: &str) -> Result<i64> {
        self.conn.execute(
            "UPDATE queue_items SET status='pending', retries = retries + 1, error = ?2
             WHERE id = ?1",
            params![id, error],
        )?;
        let retries: i64 = self.conn.query_row(
            "SELECT retries FROM queue_items WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        Ok(retries)
    }

    /// Give up on an item after exhausting retries.
    pub fn mark_dead(&self, id: &str, error: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE queue_items SET status='failed', error=?2 WHERE id=?1",
            params![id, error],
        )?;
        Ok(())
    }

    pub fn remove_queue_item(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM queue_items WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Reset any rows stuck in `active` back to `pending` (called on startup).
    /// Returns the number of items unstuck.
    pub fn requeue_active(&self) -> Result<usize> {
        Ok(self
            .conn
            .execute("UPDATE queue_items SET status='pending' WHERE status='active'", [])?)
    }

    /// Move all failed items back to pending (used by "Retry all").
    pub fn retry_failed(&self) -> Result<()> {
        self.conn.execute(
            "UPDATE queue_items SET status='pending', retries=0, error=NULL WHERE status='failed'",
            [],
        )?;
        Ok(())
    }

    /// Move a single failed item back to pending.
    pub fn retry_item(&self, id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE queue_items SET status='pending', retries=0, error=NULL WHERE id=?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn list_queue(&self) -> Result<Vec<QueueItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, priority, status, retries, error, size
             FROM queue_items WHERE status IN ('pending','active')
             ORDER BY status DESC, priority DESC, rowid ASC",
        )?;
        let items = stmt
            .query_map([], row_to_queue_item)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }

    pub fn list_failed(&self) -> Result<Vec<QueueItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, priority, status, retries, error, size
             FROM queue_items WHERE status = 'failed' ORDER BY rowid DESC",
        )?;
        let items = stmt
            .query_map([], row_to_queue_item)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }

    pub fn pending_count(&self) -> Result<i64> {
        Ok(self.conn.query_row(
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
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.conn.execute(
            "INSERT OR REPLACE INTO upload_history(id, filename, asset_id, status, uploaded_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, filename, asset_id, status, now],
        )?;
        Ok(())
    }

    /// Aggregate counts + last-upload time for the overview dashboard.
    pub fn history_stats(&self) -> Result<HistoryStats> {
        let count = |status: &str| -> Result<i64> {
            Ok(self.conn.query_row(
                "SELECT COUNT(*) FROM upload_history WHERE status = ?1",
                params![status],
                |r| r.get(0),
            )?)
        };
        let total: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM upload_history", [], |r| r.get(0))?;
        let last_uploaded_at: Option<i64> = self.conn.query_row(
            "SELECT MAX(uploaded_at) FROM upload_history",
            [],
            |r| r.get(0),
        )?;
        Ok(HistoryStats {
            total,
            success: count(status::SUCCESS)?,
            duplicate: count(status::DUPLICATE)?,
            skipped: count(status::SKIPPED)?,
            failed: count(status::FAILED)?,
            last_uploaded_at,
        })
    }

    pub fn list_history(&self, limit: u32) -> Result<Vec<HistoryItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, filename, asset_id, status, uploaded_at
             FROM upload_history ORDER BY uploaded_at DESC LIMIT ?1",
        )?;
        let items = stmt
            .query_map(params![limit], |row| {
                Ok(HistoryItem {
                    id: row.get(0)?,
                    filename: row.get(1)?,
                    asset_id: row.get(2)?,
                    status: row.get(3)?,
                    uploaded_at: row.get(4)?,
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
