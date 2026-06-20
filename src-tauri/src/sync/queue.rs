//! In-memory sync state: status enum, counters, and a bandwidth limiter.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::Mutex;
use tokio::time::Instant;

/// High-level state surfaced to the tray and dashboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)] // `Error` is reserved for future fatal-state handling.
pub enum SyncState {
    Idle,
    Syncing,
    Paused,
    Error,
    Offline,
}

impl SyncState {
    #[allow(dead_code)] // used by tests and reserved for future tray labels
    pub fn as_str(&self) -> &'static str {
        match self {
            SyncState::Idle => "idle",
            SyncState::Syncing => "syncing",
            SyncState::Paused => "paused",
            SyncState::Error => "error",
            SyncState::Offline => "offline",
        }
    }
}

/// Snapshot of sync status sent to the UI.
#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    pub state: SyncState,
    /// Tray icon key: disconnected | insecure | secure | syncing | paused.
    pub icon: String,
    /// Whether the configured server URL uses HTTPS.
    pub secure: bool,
    pub pending: i64,
    pub active: i64,
    pub uploaded_session: u64,
    pub failed_session: u64,
    pub message: String,
}

/// A simple token-bucket bandwidth limiter shared across upload tasks.
/// `limit_kbps == 0` means unlimited.
pub struct BandwidthLimiter {
    limit_bytes_per_sec: AtomicU64,
    inner: Mutex<BucketState>,
}

struct BucketState {
    available: f64,
    last_refill: Instant,
}

impl BandwidthLimiter {
    pub fn new(limit_kbps: u32) -> Arc<Self> {
        Arc::new(Self {
            limit_bytes_per_sec: AtomicU64::new(limit_kbps as u64 * 1024),
            inner: Mutex::new(BucketState {
                available: 0.0,
                last_refill: Instant::now(),
            }),
        })
    }

    pub fn set_limit_kbps(&self, limit_kbps: u32) {
        self.limit_bytes_per_sec
            .store(limit_kbps as u64 * 1024, Ordering::Relaxed);
    }

    /// Block until `bytes` worth of budget is available. No-op when unlimited.
    pub async fn consume(&self, bytes: u64) {
        let rate = self.limit_bytes_per_sec.load(Ordering::Relaxed);
        if rate == 0 {
            return;
        }
        let rate = rate as f64;
        let mut needed = bytes as f64;
        loop {
            let wait = {
                let mut state = self.inner.lock().await;
                let now = Instant::now();
                let elapsed = now.duration_since(state.last_refill).as_secs_f64();
                state.last_refill = now;
                // Refill, capping the burst at one second's worth of budget.
                state.available = (state.available + elapsed * rate).min(rate);
                if state.available >= needed {
                    state.available -= needed;
                    return;
                }
                needed -= state.available;
                state.available = 0.0;
                Duration::from_secs_f64((needed / rate).min(1.0))
            };
            tokio::time::sleep(wait).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_strings_are_stable() {
        assert_eq!(SyncState::Idle.as_str(), "idle");
        assert_eq!(SyncState::Syncing.as_str(), "syncing");
        assert_eq!(SyncState::Offline.as_str(), "offline");
    }

    #[tokio::test]
    async fn unlimited_limiter_does_not_block() {
        let limiter = BandwidthLimiter::new(0);
        // Should return effectively instantly for any size.
        let start = std::time::Instant::now();
        limiter.consume(10 * 1024 * 1024).await;
        assert!(start.elapsed() < std::time::Duration::from_millis(50));
    }

    #[tokio::test(start_paused = true)]
    async fn limited_limiter_throttles() {
        // 100 KB/s; consuming 100 KB after draining the initial bucket should
        // require roughly a second of (virtual) time.
        let limiter = BandwidthLimiter::new(100);
        limiter.consume(100 * 1024).await; // drain initial allowance
        let start = tokio::time::Instant::now();
        limiter.consume(100 * 1024).await;
        assert!(start.elapsed() >= std::time::Duration::from_millis(500));
    }
}
