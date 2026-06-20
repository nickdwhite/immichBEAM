//! The sync engine: watches folders, hashes files, deduplicates against the
//! server, and uploads with bounded concurrency, backoff, and bandwidth limits.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::api::{sha1_to_base64, BulkCheckItem, ImmichClient};
use crate::config::AppConfig;
use crate::db::{status, Db};
use crate::sync::hasher::hash_file;
use crate::sync::queue::{BandwidthLimiter, SyncState, SyncStatus};
use crate::sync::watcher::{scan_folder, FileEvent, FolderWatcher};

/// Max upload attempts before an item is marked dead.
const MAX_RETRIES: i64 = 5;
/// Event name used to push status to the frontend.
pub const EVT_STATUS: &str = "sync://status";
pub const EVT_QUEUE: &str = "sync://queue-updated";
pub const EVT_HISTORY: &str = "sync://history-updated";
pub const EVT_PROGRESS: &str = "sync://progress";
pub const EVT_PROGRESS_DONE: &str = "sync://progress-done";
pub const EVT_FREEABLE: &str = "freeable://updated";

/// Per-file upload progress pushed to the UI.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProgressPayload {
    pub id: String,
    pub path: String,
    pub sent: u64,
    pub total: u64,
    pub pct: u64,
}

struct Inner {
    app: AppHandle,
    config: Mutex<AppConfig>,
    db: Mutex<Db>,
    client: Mutex<Option<ImmichClient>>,
    bandwidth: Arc<BandwidthLimiter>,
    watcher: Mutex<Option<FolderWatcher>>,
    paused: AtomicBool,
    running: AtomicBool,
    state: Mutex<SyncState>,
    last_error: Mutex<Option<String>>,
    uploaded_session: AtomicU64,
    failed_session: AtomicU64,
    debug: AtomicBool,
    /// API key cached in memory so the OS keychain is read only once per launch.
    api_key: Mutex<Option<String>>,
    /// Unix-millis until which the dispatcher should back off after errors.
    cooldown_until: AtomicU64,
    /// Current backoff in seconds (doubles on error, resets on success).
    backoff_secs: AtomicU64,
    /// State of a background free-up-space scan.
    freeable: Mutex<crate::sync::cleanup::FreeableScan>,
}

/// Cheaply-cloneable handle to the running engine.
#[derive(Clone)]
pub struct SyncEngine {
    inner: Arc<Inner>,
}

impl SyncEngine {
    pub fn new(app: AppHandle, config: AppConfig, db: Db) -> Self {
        let bandwidth = BandwidthLimiter::new(config.bandwidth_limit_kbps);
        let paused = config.paused;
        let debug = config.debug_logging;
        // Read the keychain exactly once at startup, then cache in memory.
        let api_key = crate::keychain::get_api_key().ok().flatten();
        let client = build_client(&config, api_key.as_deref());
        let inner = Arc::new(Inner {
            app,
            config: Mutex::new(config),
            db: Mutex::new(db),
            client: Mutex::new(client),
            bandwidth,
            watcher: Mutex::new(None),
            paused: AtomicBool::new(paused),
            running: AtomicBool::new(false),
            state: Mutex::new(SyncState::Idle),
            last_error: Mutex::new(None),
            uploaded_session: AtomicU64::new(0),
            failed_session: AtomicU64::new(0),
            debug: AtomicBool::new(debug),
            api_key: Mutex::new(api_key),
            cooldown_until: AtomicU64::new(0),
            backoff_secs: AtomicU64::new(0),
            freeable: Mutex::new(Default::default()),
        });
        Self { inner }
    }

    /// Start the watcher + worker loop. Safe to call once at startup.
    pub async fn start(&self) {
        if self.inner.running.swap(true, Ordering::SeqCst) {
            return; // already running
        }
        {
            let db = self.inner.db.lock().await;
            let _ = db.requeue_active();
        }

        let (tx, rx) = mpsc::unbounded_channel::<FileEvent>();
        self.start_watcher(tx.clone()).await;
        self.spawn_ingest(rx);
        self.scan_all().await;

        let folders = self.enabled_folders().await.len();
        let has_client = self.inner.client.lock().await.is_some();
        let pending = self.with_db(|db| db.pending_count().unwrap_or(0)).await;
        log::info!(
            "engine started: {folders} folder(s) watched, server {}, {pending} item(s) queued",
            if has_client { "configured" } else { "NOT configured" }
        );

        self.spawn_worker();
        self.push_status().await;
    }

    async fn start_watcher(&self, tx: mpsc::UnboundedSender<FileEvent>) {
        let folders = self.enabled_folders().await;
        match FolderWatcher::start(&folders, tx) {
            Ok(w) => {
                *self.inner.watcher.lock().await = Some(w);
            }
            Err(e) => log::error!("failed to start watcher: {e}"),
        }
    }

    async fn enabled_folders(&self) -> Vec<PathBuf> {
        self.inner
            .config
            .lock()
            .await
            .folders
            .iter()
            .filter(|f| f.enabled)
            .map(|f| PathBuf::from(&f.path))
            .collect()
    }

    /// Ingest task: filter incoming filesystem events and enqueue matches.
    fn spawn_ingest(&self, mut rx: mpsc::UnboundedReceiver<FileEvent>) {
        let engine = self.clone();
        tokio::spawn(async move {
            while let Some(ev) = rx.recv().await {
                let matched = {
                    let cfg = engine.inner.config.lock().await;
                    cfg.matches_filter(&ev.path)
                };
                if !matched {
                    continue;
                }
                let path = ev.path.to_string_lossy().to_string();
                let meta = std::fs::metadata(&ev.path).ok();
                let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
                let mtime = file_mtime(meta.as_ref());
                let id = Uuid::new_v4().to_string();
                let inserted = {
                    let db = engine.inner.db.lock().await;
                    if db.cached_hash(&path, size, mtime).ok().flatten().is_some() {
                        false // already synced and unchanged
                    } else {
                        db.enqueue(&id, &path, 0, size).unwrap_or(false)
                    }
                };
                if inserted {
                    engine.emit(EVT_QUEUE, &());
                }
            }
        });
    }

    /// Initial scan of all enabled folders.
    pub async fn scan_all(&self) {
        let folders = self.enabled_folders().await;
        for folder in folders {
            let files = scan_folder(&folder);
            for path in files {
                let matched = {
                    let cfg = self.inner.config.lock().await;
                    cfg.matches_filter(&path)
                };
                if !matched {
                    continue;
                }
                let p = path.to_string_lossy().to_string();
                let meta = std::fs::metadata(&path).ok();
                let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
                let mtime = file_mtime(meta.as_ref());
                let db = self.inner.db.lock().await;
                // Skip files already confirmed synced and unchanged.
                if db.cached_hash(&p, size, mtime).ok().flatten().is_some() {
                    continue;
                }
                let id = Uuid::new_v4().to_string();
                let _ = db.enqueue(&id, &p, 0, size);
            }
        }
        self.emit(EVT_QUEUE, &());
    }

    /// The dispatcher loop. Keeps up to `concurrency` uploads in flight
    /// continuously, so a single slow file never blocks the rest. Runs for the
    /// lifetime of the app.
    fn spawn_worker(&self) {
        let engine = self.clone();
        tokio::spawn(async move {
            // A generous cap so the in-flight set can grow/shrink; the live
            // permit count is enforced per-iteration against current config.
            let sem = Arc::new(tokio::sync::Semaphore::new(64));
            loop {
                if engine.inner.paused.load(Ordering::Relaxed) {
                    engine.set_state(SyncState::Paused).await;
                    tokio::time::sleep(Duration::from_millis(400)).await;
                    continue;
                }
                if engine.inner.client.lock().await.is_none() {
                    engine.set_state(SyncState::Offline).await;
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }

                // Back off after errors (server down, auth failure, etc.).
                let cooldown = engine.inner.cooldown_until.load(Ordering::Relaxed);
                let now = now_ms();
                if now < cooldown {
                    engine.set_state(SyncState::Offline).await;
                    let wait = (cooldown - now).min(2000);
                    tokio::time::sleep(Duration::from_millis(wait)).await;
                    continue;
                }

                // Bound in-flight uploads to the configured concurrency.
                let concurrency = engine.inner.config.lock().await.concurrency.max(1) as usize;
                let in_flight = 64 - sem.available_permits();
                if in_flight >= concurrency {
                    tokio::time::sleep(Duration::from_millis(150)).await;
                    continue;
                }

                let permit = match sem.clone().acquire_owned().await {
                    Ok(p) => p,
                    Err(_) => break,
                };

                let item = {
                    let db = engine.inner.db.lock().await;
                    db.claim_pending(1).unwrap_or_default().into_iter().next()
                };
                let Some(item) = item else {
                    drop(permit);
                    if in_flight == 0 {
                        engine.set_state(SyncState::Idle).await;
                    }
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                };

                engine.set_state(SyncState::Syncing).await;
                let e = engine.clone();
                tokio::spawn(async move {
                    let id = item.id.clone();
                    // Safety net so a truly wedged item eventually frees its slot.
                    match tokio::time::timeout(Duration::from_secs(3600), e.process_one(item)).await
                    {
                        Ok(Ok(())) => e.note_success(),
                        Ok(Err(ProcessError::Network)) => e.note_error(),
                        // Permanent per-file errors / pause don't mean the server is down.
                        Ok(Err(_)) => {}
                        Err(_) => {
                            log::error!("processing timed out for item {id}");
                            let _ = e.with_db(|db| db.set_status(&id, status::PENDING)).await;
                            e.note_error();
                        }
                    }
                    e.emit(EVT_QUEUE, &());
                    e.emit(EVT_HISTORY, &());
                    e.push_status().await;
                    drop(permit);
                });
            }
        });
    }

    /// Process a single queue item end-to-end.
    async fn process_one(&self, item: crate::db::QueueItem) -> Result<(), ProcessError> {
        let path = PathBuf::from(&item.path);
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&item.path)
            .to_string();

        // File may have been deleted between enqueue and now.
        if !path.exists() {
            let db = self.inner.db.lock().await;
            let _ = db.add_history(&item.id, &filename, None, status::SKIPPED);
            let _ = db.remove_queue_item(&item.id);
            return Ok(());
        }

        self.log_debug(&format!("processing {filename}"));

        // 1. Hash the file.
        let fh = match hash_file(&path).await {
            Ok(fh) => fh,
            Err(e) => return self.handle_failure(&item, &filename, &e.to_string()).await,
        };
        self.log_debug(&format!(
            "hashed {filename}: sha1={} size={}",
            fh.sha1_hex, fh.size
        ));

        let client = match self.inner.client.lock().await.clone() {
            Some(c) => c,
            None => return Err(ProcessError::Network),
        };
        let device_id = self.inner.config.lock().await.device_id.clone();

        // 2. Bulk duplicate check (bounded, so a stalled server can't hang us).
        let checksum_b64 = sha1_to_base64(&fh.sha1_bytes);
        self.log_debug(&format!("duplicate-check {filename}"));
        let check = match tokio::time::timeout(
            Duration::from_secs(60),
            client.bulk_upload_check(vec![BulkCheckItem {
                id: item.id.clone(),
                checksum: checksum_b64,
            }]),
        )
        .await
        {
            Ok(r) => r,
            Err(_) => {
                log::warn!("duplicate-check timed out for {filename}");
                let db = self.inner.db.lock().await;
                let _ = db.set_status(&item.id, status::PENDING);
                return Err(ProcessError::Network);
            }
        };
        match check {
            Ok(results) => {
                if let Some(r) = results.first() {
                    if r.action == "reject" {
                        let is_duplicate = r.asset_id.is_some()
                            || r.reason.as_deref() == Some("duplicate");
                        let db = self.inner.db.lock().await;
                        if is_duplicate {
                            log::info!("duplicate (already on server): {filename}");
                            let _ = db.add_history(
                                &item.id,
                                &filename,
                                r.asset_id.as_deref(),
                                status::DUPLICATE,
                            );
                        } else {
                            // e.g. "unsupported-format": this server can't ingest it.
                            let reason =
                                r.reason.clone().unwrap_or_else(|| "rejected".into());
                            log::warn!("server rejected {filename}: {reason}");
                            let _ = db.add_history(
                                &item.id,
                                &filename,
                                None,
                                status::UNSUPPORTED,
                            );
                        }
                        // Either outcome is final — cache so scans skip it later.
                        let _ = db.put_hash(&item.path, &fh.sha1_hex, fh.size, fh.mtime);
                        let _ = db.remove_queue_item(&item.id);
                        return Ok(());
                    }
                }
            }
            Err(e) => {
                let msg = e.to_string();
                log::warn!("duplicate-check failed for {filename}: {msg}");
                if is_auth_error(&msg) {
                    *self.inner.last_error.lock().await =
                        Some("Authentication failed — check your API key".into());
                }
                let db = self.inner.db.lock().await;
                let _ = db.set_status(&item.id, status::PENDING);
                return Err(ProcessError::Network);
            }
        }

        // 3. Streaming, bandwidth-limited upload with progress events.
        log::info!("uploading {filename} ({} bytes)", fh.size);
        let progress = self.progress_callback(&item.id, &item.path);
        let bandwidth = self.inner.bandwidth.clone();
        let cancel: crate::api::CancelFn = {
            let engine = self.clone();
            Arc::new(move || engine.inner.paused.load(Ordering::Relaxed))
        };
        let result = client
            .upload_asset(&path, &fh.sha1_hex, &device_id, bandwidth, progress, cancel)
            .await;
        match result {
            Ok(resp) => {
                let st = if resp.status == "duplicate" {
                    status::DUPLICATE
                } else {
                    status::SUCCESS
                };
                log::info!("uploaded {filename} -> {st} (asset {})", resp.id);
                self.inner.uploaded_session.fetch_add(1, Ordering::Relaxed);
                // Add to the watched folder's album, if one is configured.
                if let Some(album_id) = self.album_for_path(&item.path).await {
                    self.log_debug(&format!("adding {filename} to album {album_id}"));
                    let _ = client.add_to_album(&album_id, &[resp.id.clone()]).await;
                }
                let db = self.inner.db.lock().await;
                let _ = db.add_history(&item.id, &filename, Some(&resp.id), st);
                // Mark synced so future scans skip this file entirely.
                let _ = db.put_hash(&item.path, &fh.sha1_hex, fh.size, fh.mtime);
                let _ = db.remove_queue_item(&item.id);
                self.emit(EVT_PROGRESS_DONE, &item.id);
                Ok(())
            }
            Err(e) => {
                self.emit(EVT_PROGRESS_DONE, &item.id);
                // If the user paused mid-upload, just requeue for resume — this
                // is not a real failure and must not consume a retry.
                if self.inner.paused.load(Ordering::Relaxed) {
                    log::info!("upload paused, requeued: {filename}");
                    let db = self.inner.db.lock().await;
                    let _ = db.set_status(&item.id, status::PENDING);
                    return Err(ProcessError::Paused);
                }

                let msg = e.to_string();

                // Permanent, file-specific errors: count toward retries and
                // eventually give up (the server will never accept this file).
                if is_permanent_error(&msg) {
                    return self.handle_failure(&item, &filename, &msg).await;
                }

                // Retryable (network / 5xx / auth): requeue WITHOUT consuming a
                // retry, so transient outages auto-resume. The dispatcher backs
                // off via note_error().
                let friendly = if is_auth_error(&msg) {
                    "Authentication failed — check your API key".to_string()
                } else {
                    format!("{filename}: {msg}")
                };
                log::warn!("upload retryable error for {filename}: {msg}");
                *self.inner.last_error.lock().await = Some(friendly);
                let db = self.inner.db.lock().await;
                let _ = db.set_status(&item.id, status::PENDING);
                Err(ProcessError::Network)
            }
        }
    }

    /// Repair the queue: unstick `active` items, drop entries whose file is
    /// gone, and backfill missing sizes.
    pub async fn repair_queue(&self) -> crate::sync::cleanup::RepairReport {
        use crate::sync::cleanup::RepairReport;
        let mut report = RepairReport::default();

        report.requeued_active = self
            .with_db(|db| db.requeue_active().unwrap_or(0))
            .await;

        let items = self.with_db(|db| db.list_queue()).await.unwrap_or_default();
        for item in items {
            let path = PathBuf::from(&item.path);
            if !path.exists() {
                let filename = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&item.path)
                    .to_string();
                self.with_db(|db| {
                    let _ = db.add_history(&item.id, &filename, None, status::SKIPPED);
                    let _ = db.remove_queue_item(&item.id);
                })
                .await;
                report.removed_missing += 1;
            } else if item.size == 0 {
                if let Ok(meta) = std::fs::metadata(&path) {
                    let size = meta.len() as i64;
                    self.with_db(|db| {
                        let _ = db.update_size(&item.id, size);
                    })
                    .await;
                    report.resized += 1;
                }
            }
        }

        self.emit(EVT_QUEUE, &());
        self.emit(EVT_HISTORY, &());
        self.push_status().await;
        log::info!(
            "queue repair: {} unstuck, {} missing removed, {} resized",
            report.requeued_active,
            report.removed_missing,
            report.resized
        );
        report
    }

    /// Remove all pending/active items from the queue. Returns the count.
    pub async fn clear_queue(&self) -> usize {
        let n = self
            .with_db(|db| db.clear_pending().unwrap_or(0))
            .await;
        self.emit(EVT_QUEUE, &());
        self.push_status().await;
        log::info!("queue cleared: {n} item(s) removed");
        n
    }

    /// Count and total size of matching media in a folder (for the add warning).
    pub async fn inspect_folder(&self, path: &str) -> crate::sync::cleanup::FolderInspect {
        use crate::sync::cleanup::FolderInspect;
        let folder = PathBuf::from(path);
        let cfg = self.inner.config.lock().await.clone();
        let mut info = FolderInspect::default();
        for file in scan_folder(&folder) {
            if !cfg.matches_filter(&file) {
                continue;
            }
            if let Ok(meta) = std::fs::metadata(&file) {
                info.file_count += 1;
                info.total_bytes += meta.len() as i64;
            }
        }
        info
    }

    /// Reset error backoff after a clean upload.
    fn note_success(&self) {
        self.inner.backoff_secs.store(0, Ordering::Relaxed);
        self.inner.cooldown_until.store(0, Ordering::Relaxed);
    }

    /// Grow the error backoff and set a cooldown the dispatcher will honor.
    fn note_error(&self) {
        let next = (self.inner.backoff_secs.load(Ordering::Relaxed) * 2)
            .clamp(1, 60);
        self.inner.backoff_secs.store(next, Ordering::Relaxed);
        self.inner
            .cooldown_until
            .store(now_ms() + next * 1000, Ordering::Relaxed);
    }

    /// True when verbose debug logging is enabled.
    fn debug_enabled(&self) -> bool {
        self.inner.debug.load(Ordering::Relaxed)
    }

    /// Emit a verbose log line (at info level so it lands in the log file) only
    /// when debug logging is enabled.
    fn log_debug(&self, msg: &str) {
        if self.debug_enabled() {
            log::info!("[debug] {msg}");
        }
    }

    async fn handle_failure(
        &self,
        item: &crate::db::QueueItem,
        filename: &str,
        msg: &str,
    ) -> Result<(), ProcessError> {
        log::warn!("upload failed for {filename}: {msg}");
        *self.inner.last_error.lock().await = Some(format!("{filename}: {msg}"));
        let db = self.inner.db.lock().await;
        let retries = db.mark_failed(&item.id, msg).unwrap_or(MAX_RETRIES);
        if retries >= MAX_RETRIES {
            let _ = db.mark_dead(&item.id, msg);
            let _ = db.add_history(&item.id, filename, None, status::FAILED);
            self.inner.failed_session.fetch_add(1, Ordering::Relaxed);
            drop(db);
            self.notify_failure(filename);
        }
        Err(ProcessError::Upload)
    }

    /// Show a desktop notification for a permanently-failed upload.
    fn notify_failure(&self, filename: &str) {
        use tauri_plugin_notification::NotificationExt;
        let _ = self
            .inner
            .app
            .notification()
            .builder()
            .title("Immich SyncDesk — upload failed")
            .body(format!("Gave up on \"{filename}\" after repeated retries."))
            .show();
    }

    /// Build a throttled progress callback bound to this queue item.
    fn progress_callback(&self, id: &str, path: &str) -> crate::api::ProgressFn {
        let app = self.inner.app.clone();
        let id = id.to_string();
        let path = path.to_string();
        let last_pct = Arc::new(AtomicU64::new(u64::MAX));
        Arc::new(move |sent: u64, total: u64| {
            let pct = if total > 0 { sent * 100 / total } else { 100 };
            // Emit only when the whole-percent value changes, to avoid flooding.
            if last_pct.swap(pct, Ordering::Relaxed) != pct {
                let _ = app.emit(
                    EVT_PROGRESS,
                    ProgressPayload {
                        id: id.clone(),
                        path: path.clone(),
                        sent,
                        total,
                        pct,
                    },
                );
            }
        })
    }

    /// Find the album id configured for the watched folder containing `path`.
    async fn album_for_path(&self, path: &str) -> Option<String> {
        let file = PathBuf::from(path);
        let cfg = self.inner.config.lock().await;
        cfg.folders
            .iter()
            .filter(|f| f.enabled && f.album_id.is_some())
            .find(|f| file.starts_with(&f.path))
            .and_then(|f| f.album_id.clone())
    }

    // ---- control surface (called from IPC commands) ----------------------

    pub async fn set_paused(&self, paused: bool) {
        self.inner.paused.store(paused, Ordering::Relaxed);
        let mut cfg = self.inner.config.lock().await;
        cfg.paused = paused;
        let _ = cfg.save();
        drop(cfg);
        self.push_status().await;
    }

    /// Apply a new configuration: rebuild the client, restart the watcher,
    /// update bandwidth, and rescan.
    pub async fn apply_config(&self, new_config: AppConfig) {
        self.inner
            .bandwidth
            .set_limit_kbps(new_config.bandwidth_limit_kbps);
        self.inner
            .debug
            .store(new_config.debug_logging, Ordering::Relaxed);
        // Use the cached key — never re-read the keychain here.
        let key = self.inner.api_key.lock().await.clone();
        let client = build_client(&new_config, key.as_deref());
        *self.inner.client.lock().await = client;
        {
            let mut cfg = self.inner.config.lock().await;
            *cfg = new_config;
            let _ = cfg.save();
        }
        // Restart watcher against the new folder set.
        let (tx, rx) = mpsc::unbounded_channel::<FileEvent>();
        self.start_watcher(tx).await;
        self.spawn_ingest(rx);
        self.scan_all().await;
        self.push_status().await;
    }

    /// Update the in-memory cached API key (mirrors a keychain write/delete).
    pub async fn set_api_key(&self, key: Option<String>) {
        *self.inner.api_key.lock().await = key;
    }

    pub async fn current_config(&self) -> AppConfig {
        self.inner.config.lock().await.clone()
    }

    pub async fn client(&self) -> Option<ImmichClient> {
        self.inner.client.lock().await.clone()
    }

    pub async fn retry_failed(&self) {
        {
            let db = self.inner.db.lock().await;
            let _ = db.retry_failed();
        }
        self.emit(EVT_QUEUE, &());
    }

    pub async fn retry_item(&self, id: &str) {
        {
            let db = self.inner.db.lock().await;
            let _ = db.retry_item(id);
        }
        self.emit(EVT_QUEUE, &());
    }

    /// Snapshot of the current/last free-up-space scan.
    pub async fn freeable_state(&self) -> crate::sync::cleanup::FreeableScan {
        self.inner.freeable.lock().await.clone()
    }

    /// Kick off a free-up-space scan in the background (no-op if one is already
    /// running). Returns immediately; progress is reported via state + events.
    pub fn start_freeable_scan(&self, older_than_days: u64) {
        let engine = self.clone();
        tokio::spawn(async move {
            {
                let mut st = engine.inner.freeable.lock().await;
                if st.running {
                    return;
                }
                *st = crate::sync::cleanup::FreeableScan {
                    running: true,
                    ..Default::default()
                };
            }
            engine.emit(EVT_FREEABLE, &());
            engine.run_freeable_scan(older_than_days).await;
        });
    }

    async fn run_freeable_scan(&self, older_than_days: u64) {
        use crate::sync::cleanup::FreeableItem;

        let client = match self.client().await {
            Some(c) => c,
            None => {
                let mut st = self.inner.freeable.lock().await;
                st.running = false;
                st.done = true;
                self.emit(EVT_FREEABLE, &());
                return;
            }
        };
        let cutoff = chrono::Utc::now().timestamp() - (older_than_days as i64 * 86_400);
        let folders = self.enabled_folders().await;

        // Gather candidates, reusing the cached hash when the file is unchanged
        // so we don't re-read already-synced files from disk.
        // (path, size, mtime, base64 checksum)
        let mut candidates: Vec<(String, i64, i64, String)> = Vec::new();
        let mut scanned = 0usize;
        for folder in folders {
            for path in scan_folder(&folder) {
                let matched = self.inner.config.lock().await.matches_filter(&path);
                if !matched {
                    continue;
                }
                let meta = match std::fs::metadata(&path) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let mtime = file_mtime(Some(&meta));
                let size = meta.len() as i64;
                if mtime > cutoff {
                    continue; // too recent to free
                }
                let p = path.to_string_lossy().to_string();

                // Prefer the cached SHA1 (hex) → base64; else hash from disk.
                let checksum_b64 = match self
                    .with_db(|db| db.cached_hash(&p, size, mtime))
                    .await
                    .ok()
                    .flatten()
                {
                    Some(hex) => sha1_to_base64(&hex_to_bytes(&hex)),
                    None => match hash_file(&path).await {
                        Ok(fh) => sha1_to_base64(&fh.sha1_bytes),
                        Err(_) => continue,
                    },
                };
                candidates.push((p, size, mtime, checksum_b64));

                scanned += 1;
                if scanned % 50 == 0 {
                    let mut st = self.inner.freeable.lock().await;
                    st.scanned = scanned;
                    drop(st);
                    self.emit(EVT_FREEABLE, &());
                }
            }
        }

        {
            let mut st = self.inner.freeable.lock().await;
            st.scanned = scanned;
            st.total = candidates.len();
        }
        self.emit(EVT_FREEABLE, &());

        // Verify against the server in batches.
        let mut freeable = Vec::new();
        for chunk in candidates.chunks(100) {
            let items: Vec<BulkCheckItem> = chunk
                .iter()
                .enumerate()
                .map(|(i, c)| BulkCheckItem {
                    id: i.to_string(),
                    checksum: c.3.clone(),
                })
                .collect();
            let results = match client.bulk_upload_check(items).await {
                Ok(r) => r,
                Err(_) => continue,
            };
            for r in results {
                // Safe only if the server holds it (assetId present) and the
                // server copy is not in the trash.
                if r.action == "reject" && r.asset_id.is_some() && !r.is_trashed {
                    if let Ok(idx) = r.id.parse::<usize>() {
                        if let Some(c) = chunk.get(idx) {
                            freeable.push(FreeableItem {
                                path: c.0.clone(),
                                size: c.1,
                                mtime: c.2,
                                asset_id: r.asset_id.clone(),
                            });
                        }
                    }
                }
            }
        }

        let count = freeable.len();
        {
            let mut st = self.inner.freeable.lock().await;
            st.running = false;
            st.done = true;
            st.items = freeable;
        }
        log::info!("free-up-space scan complete: {count} freeable file(s)");
        self.emit(EVT_FREEABLE, &());
    }

    /// Move the given files to the OS trash (recoverable), recording each in
    /// the audit table. On macOS this uses NSFileManager (silent + fast) and a
    /// single batched move, instead of scripting Finder once per file.
    pub async fn free_space(&self, paths: Vec<String>) -> crate::sync::cleanup::FreeResult {
        use crate::sync::cleanup::FreeResult;
        let mut result = FreeResult::default();

        // Capture sizes before the files move.
        let sized: Vec<(String, i64)> = paths
            .iter()
            .map(|p| (p.clone(), std::fs::metadata(p).map(|m| m.len() as i64).unwrap_or(0)))
            .collect();

        let ctx = trash_context();

        // One batched move first — a single Trash operation, no repeated sound.
        match ctx.delete_all(&paths) {
            Ok(()) => {
                let db = self.inner.db.lock().await;
                for (p, size) in &sized {
                    result.freed_count += 1;
                    result.freed_bytes += size;
                    let _ = db.add_freed(p, *size, None);
                }
            }
            Err(e) => {
                // Fall back to per-file so we get partial success + granular errors.
                log::warn!("batch trash failed ({e}); retrying per-file");
                for (p, size) in &sized {
                    match ctx.delete(p) {
                        Ok(()) => {
                            result.freed_count += 1;
                            result.freed_bytes += size;
                            let db = self.inner.db.lock().await;
                            let _ = db.add_freed(p, *size, None);
                        }
                        Err(e) => result.errors.push(format!("{p}: {e}")),
                    }
                }
            }
        }

        log::info!(
            "freed {} file(s), {} bytes ({} errors)",
            result.freed_count,
            result.freed_bytes,
            result.errors.len()
        );
        result
    }

    pub async fn with_db<T>(&self, f: impl FnOnce(&Db) -> T) -> T {
        let db = self.inner.db.lock().await;
        f(&db)
    }

    pub async fn status(&self) -> SyncStatus {
        let state = *self.inner.state.lock().await;
        let (pending, active) = self
            .with_db(|db| {
                let pending = db.pending_count().unwrap_or(0);
                (pending, 0)
            })
            .await;
        let message = self
            .inner
            .last_error
            .lock()
            .await
            .clone()
            .unwrap_or_default();
        let secure = self
            .inner
            .config
            .lock()
            .await
            .server_url
            .starts_with("https://");
        let icon = match state {
            SyncState::Offline => "disconnected",
            SyncState::Paused => "paused",
            SyncState::Syncing => "syncing",
            // Idle / Error while connected: reflect transport security.
            _ => {
                if secure {
                    "secure"
                } else {
                    "insecure"
                }
            }
        }
        .to_string();
        SyncStatus {
            state,
            icon,
            secure,
            pending,
            active,
            uploaded_session: self.inner.uploaded_session.load(Ordering::Relaxed),
            failed_session: self.inner.failed_session.load(Ordering::Relaxed),
            message,
        }
    }

    async fn set_state(&self, state: SyncState) {
        let changed = {
            let mut s = self.inner.state.lock().await;
            if *s != state {
                *s = state;
                true
            } else {
                false
            }
        };
        if changed {
            self.push_status().await;
        }
    }

    pub async fn push_status(&self) {
        let status = self.status().await;
        self.emit(EVT_STATUS, &status);
    }

    fn emit<S: serde::Serialize + Clone>(&self, event: &str, payload: &S) {
        let _ = self.inner.app.emit(event, payload.clone());
    }
}

#[derive(Debug)]
enum ProcessError {
    Network,
    Upload,
    /// Upload aborted because the user paused; item left pending for resume.
    Paused,
}

fn build_client(cfg: &AppConfig, api_key: Option<&str>) -> Option<ImmichClient> {
    if cfg.server_url.is_empty() {
        return None;
    }
    let api_key = api_key?;
    if api_key.is_empty() {
        return None;
    }
    ImmichClient::new(&cfg.server_url, api_key, cfg.allow_insecure).ok()
}

/// A trash context that, on macOS, uses NSFileManager — silent and fast —
/// instead of the default (which scripts Finder and plays the trash sound
/// once per file). Other platforms use the default recycle-bin behavior.
fn trash_context() -> trash::TrashContext {
    #[allow(unused_mut)]
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx
}

/// Decode a hex string into bytes (for cached SHA1 → base64 conversion).
fn hex_to_bytes(s: &str) -> Vec<u8> {
    (0..s.len().saturating_sub(1))
        .step_by(2)
        .filter_map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A permanent, file-specific error the server will never accept on retry
/// (bad request, payload too large, unsupported media). Network/5xx/auth
/// errors are treated as retryable instead.
fn is_permanent_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("400")
        || m.contains("413")
        || m.contains("415")
        || m.contains("422")
}

fn is_auth_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("401") || m.contains("403") || m.contains("unauthorized")
}

/// Unix-seconds mtime from optional metadata, 0 if unavailable.
fn file_mtime(meta: Option<&std::fs::Metadata>) -> i64 {
    meta.and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
