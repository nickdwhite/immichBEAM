//! The sync engine: watches folders, hashes files, deduplicates against the
//! server, and uploads with bounded concurrency, backoff, and bandwidth limits.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::api::{sha1_to_base64, BulkCheckItem, ImmichClient};
use crate::config::{AppConfig, ConflictPolicy};
use crate::db::{status, Db};
use crate::sync::hasher::{hash_file, hash_file_with_progress};
use crate::sync::queue::{BandwidthLimiter, SyncState, SyncStatus};
use crate::sync::watcher::{scan_folder, FileEvent, FolderWatcher};

/// Max upload attempts before an item is marked dead.
const MAX_RETRIES: i64 = 5;
/// Max asset ids sent in one album-add request.
const ALBUM_BATCH: u32 = 250;
/// Flush queued album-adds once this many have accumulated (the rest flush when
/// the queue goes idle).
const ALBUM_FLUSH_THRESHOLD: i64 = 50;
/// Event name used to push status to the frontend.
pub const EVT_STATUS: &str = "sync://status";
pub const EVT_QUEUE: &str = "sync://queue-updated";
pub const EVT_HISTORY: &str = "sync://history-updated";
pub const EVT_PROGRESS: &str = "sync://progress";
pub const EVT_PROGRESS_DONE: &str = "sync://progress-done";
pub const EVT_FREEABLE: &str = "freeable://updated";
pub const EVT_REMOVABLE: &str = "sync://removable-detected";

/// Per-file progress pushed to the UI. `phase` is "hashing" or "uploading".
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProgressPayload {
    pub id: String,
    pub path: String,
    pub phase: String,
    pub sent: u64,
    pub total: u64,
    pub pct: u64,
}

struct Inner {
    app: AppHandle,
    config: Mutex<AppConfig>,
    // The r2d2 pool (WAL + busy_timeout) handles concurrent access, so no mutex.
    db: Db,
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
    /// Whether desktop notifications are enabled.
    notifications: AtomicBool,
    /// API key cached in memory so the OS keychain is read only once per launch.
    api_key: Mutex<Option<String>>,
    /// Unix-millis until which the dispatcher should back off after errors.
    cooldown_until: AtomicU64,
    /// Current backoff in seconds (doubles on error, resets on success).
    backoff_secs: AtomicU64,
    /// State of a background free-up-space scan.
    freeable: Mutex<crate::sync::cleanup::FreeableScan>,
    /// Serializes album-add flushes so only one runs at a time.
    album_flush: Mutex<()>,
    /// Monitors for USB/SD card insertions.
    #[allow(dead_code)]
    removable: Mutex<Option<crate::sync::removable::RemovableMonitor>>,
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
        let notifications = config.notifications_enabled;
        let api_key = crate::keychain::get_api_key().ok().flatten();
        let client = build_client(&config, api_key.as_deref());

        let app_handle = app.clone();
        let monitor = crate::sync::removable::RemovableMonitor::start(move |media| {
            log::info!(
                "removable media with DCIM detected: {} at {}",
                media.volume_name,
                media.dcim_path
            );
            let _ = app_handle.emit(EVT_REMOVABLE, &media);
        });

        let inner = Arc::new(Inner {
            app,
            config: Mutex::new(config),
            db,
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
            notifications: AtomicBool::new(notifications),
            api_key: Mutex::new(api_key),
            cooldown_until: AtomicU64::new(0),
            backoff_secs: AtomicU64::new(0),
            freeable: Mutex::new(Default::default()),
            album_flush: Mutex::new(()),
            removable: Mutex::new(Some(monitor)),
        });
        Self { inner }
    }

    /// Start the watcher + worker loop. Safe to call once at startup.
    pub async fn start(&self) {
        if self.inner.running.swap(true, Ordering::SeqCst) {
            return; // already running
        }
        {
            let db = &self.inner.db;
            let _ = db.requeue_active();
        }

        let (tx, rx) = mpsc::unbounded_channel::<FileEvent>();
        self.start_watcher(tx.clone()).await;
        self.spawn_ingest(rx);
        // Pin the server cert (TOFU) before the worker starts uploading.
        self.ensure_cert_pinned().await;
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

    async fn enabled_folders(&self) -> Vec<(PathBuf, bool)> {
        self.inner
            .config
            .lock()
            .await
            .folders
            .iter()
            .filter(|f| f.enabled)
            .map(|f| (PathBuf::from(&f.path), f.recursive))
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
                if !extension_content_ok(&ev.path) {
                    engine.record_content_skip(&ev.path).await;
                    continue;
                }
                let path = ev.path.to_string_lossy().to_string();
                let meta = std::fs::metadata(&ev.path).ok();
                let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
                let mtime = file_mtime(meta.as_ref());
                let id = Uuid::new_v4().to_string();
                let inserted = {
                    let db = &engine.inner.db;
                    if db.cached_hash(&path, size, mtime).ok().flatten().is_some() {
                        false // already synced and unchanged
                    } else {
                        let conflict_policy = engine.inner.config.lock().await.conflict_policy;
                        if conflict_policy == ConflictPolicy::Skip
                            && db.was_previously_synced(&path).unwrap_or(false)
                        {
                            false
                        } else {
                            db.enqueue(&id, &path, 0, size).unwrap_or(false)
                        }
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
        let ext_set = self.inner.config.lock().await.extension_set();
        let (mut queued, mut already, mut filtered, mut content_skipped) = (0, 0, 0, 0);
        for (folder, recursive) in folders {
            let files = tokio::task::spawn_blocking(move || scan_folder(&folder, recursive))
                .await
                .unwrap_or_default();
            for path in files {
                let matched = {
                    let cfg = self.inner.config.lock().await;
                    cfg.matches_filter_with(&path, &ext_set)
                };
                if !matched {
                    filtered += 1;
                    continue;
                }
                if !extension_content_ok(&path) {
                    content_skipped += 1;
                    self.record_content_skip(&path).await;
                    continue;
                }
                let p = path.to_string_lossy().to_string();
                let meta = std::fs::metadata(&path).ok();
                let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
                let mtime = file_mtime(meta.as_ref());
                let db = &self.inner.db;
                if db.cached_hash(&p, size, mtime).ok().flatten().is_some() {
                    already += 1;
                    continue;
                }
                let conflict_policy = self.inner.config.lock().await.conflict_policy;
                if conflict_policy == ConflictPolicy::Skip
                    && db.was_previously_synced(&p).unwrap_or(false)
                {
                    already += 1;
                    continue;
                }
                let id = Uuid::new_v4().to_string();
                let _ = db.enqueue(&id, &p, 0, size);
                queued += 1;
            }
        }
        log::info!(
            "scan complete: {queued} queued, {already} already synced, \
             {filtered} non-matching, {content_skipped} skipped by content check"
        );
        self.emit(EVT_QUEUE, &());
        if content_skipped > 0 {
            self.emit(EVT_HISTORY, &());
        }
    }

    /// Record a content-check skip in the history (keyed by path so repeated
    /// scans don't create duplicate rows), with a human-readable reason.
    async fn record_content_skip(&self, path: &Path) {
        let p = path.to_string_lossy().to_string();
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&p)
            .to_string();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let reason = format!(
            "Skipped: .{ext} extension is a media type, but the file's contents \
             aren't (looks like text/source, e.g. TypeScript)"
        );
        let db = &self.inner.db;
        let _ = db.add_history(&p, &filename, None, status::SKIPPED, Some(reason.as_str()));
        self.log_debug(&format!("content check skipped: {p}"));
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
                    let db = &engine.inner.db;
                    db.claim_pending(1).unwrap_or_default().into_iter().next()
                };
                let Some(item) = item else {
                    drop(permit);
                    if in_flight == 0 {
                        engine.set_state(SyncState::Idle).await;
                        // Nothing left to upload: flush any queued album-adds
                        // (also drains leftovers from a previous run).
                        let e = engine.clone();
                        tokio::spawn(async move { e.flush_albums().await });
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
                    // Clear any lingering progress entry (hashing or upload) for
                    // this item, whatever the outcome.
                    e.emit(EVT_PROGRESS_DONE, &id);
                    e.emit(EVT_QUEUE, &());
                    e.emit(EVT_HISTORY, &());
                    e.push_status().await;
                    drop(permit);
                });
            }
        });
    }

    /// Upload a companion file (e.g. a Live Photo's video) standalone and
    /// return its server asset id. Caches it as synced and records history.
    async fn upload_companion(
        &self,
        client: &ImmichClient,
        path: &Path,
        device_id: &str,
    ) -> Option<String> {
        let fh = hash_file(path).await.ok()?;
        let bandwidth = self.inner.bandwidth.clone();
        let noop: crate::api::ProgressFn = Arc::new(|_, _| {});
        let engine = self.clone();
        let cancel: crate::api::CancelFn =
            Arc::new(move || engine.inner.paused.load(Ordering::Relaxed));
        match client
            .upload_asset(path, &fh.sha1_hex, device_id, bandwidth, noop, cancel, None, None)
            .await
        {
            Ok(resp) => {
                let p = path.to_string_lossy().to_string();
                let fname = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&p)
                    .to_string();
                let db = &self.inner.db;
                let _ = db.put_hash(&p, &fh.sha1_hex, fh.size, fh.mtime);
                let _ = db.add_history(
                    &p,
                    &fname,
                    Some(&resp.id),
                    status::SUCCESS,
                    Some("Live Photo video"),
                );
                Some(resp.id)
            }
            Err(e) => {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("video");
                log::warn!("Live Photo video upload failed for {name}: {e}");
                None
            }
        }
    }

    /// True if `path` is already confirmed synced (in the hash cache, unchanged).
    async fn is_synced(&self, path: &Path) -> bool {
        let p = path.to_string_lossy().to_string();
        let meta = std::fs::metadata(path).ok();
        let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
        let mtime = file_mtime(meta.as_ref());
        self.with_db(|db| db.cached_hash(&p, size, mtime).ok().flatten().is_some())
            .await
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
            let db = &self.inner.db;
            let _ = db.add_history(
                &item.id,
                &filename,
                None,
                status::SKIPPED,
                Some("File no longer exists on disk"),
            );
            let _ = db.remove_queue_item(&item.id);
            return Ok(());
        }

        // Live Photo: if this is the video half and its still is still pending
        // upload, the still will upload + link this video — defer it here. If
        // the still is already synced, fall through (the video uploads normally
        // and will dedupe if it was already sent as the still's companion).
        if let Some(still) = paired_live_still(&path) {
            if !self.is_synced(&still).await {
                log::info!("Live Photo: deferring {filename} to its still");
                let db = &self.inner.db;
                let _ = db.add_history(
                    &item.path,
                    &filename,
                    None,
                    status::SKIPPED,
                    Some("Part of a Live Photo — uploaded with its still"),
                );
                let _ = db.remove_queue_item(&item.id);
                return Ok(());
            }
        }

        self.log_debug(&format!("processing {filename}"));

        // 1. Hash the file, reporting progress (large files take a while).
        let hash_progress = self.progress_callback(&item.id, &item.path, "hashing");
        let fh = match hash_file_with_progress(&path, |done, total| hash_progress(done, total))
            .await
        {
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
                let db = &self.inner.db;
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
                        let db = &self.inner.db;
                        if is_duplicate {
                            log::info!("duplicate (already on server): {filename}");
                            let _ = db.add_history(
                                &item.id,
                                &filename,
                                r.asset_id.as_deref(),
                                status::DUPLICATE,
                                Some("Already on the server"),
                            );
                        } else {
                            // e.g. "unsupported-format": this server can't ingest it.
                            let reason =
                                r.reason.clone().unwrap_or_else(|| "rejected".into());
                            log::warn!("server rejected {filename}: {reason}");
                            let unsupported_reason = format!("Server rejected: {reason}");
                            let _ = db.add_history(
                                &item.id,
                                &filename,
                                None,
                                status::UNSUPPORTED,
                                Some(unsupported_reason.as_str()),
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
                log::warn!("duplicate-check failed for {filename}: {e}");
                if e.is_auth() {
                    *self.inner.last_error.lock().await =
                        Some("Authentication failed — check your API key".into());
                }
                let db = &self.inner.db;
                let _ = db.set_status(&item.id, status::PENDING);
                return Err(ProcessError::Network);
            }
        }

        // 3. Live Photo: upload the paired video first so we can link it.
        let live_video_id: Option<String> = match paired_live_video(&path) {
            Some(video) => {
                self.log_debug(&format!("Live Photo: uploading paired video for {filename}"));
                self.upload_companion(&client, &video, &device_id).await
            }
            None => None,
        };
        // XMP sidecar to attach, if present next to the file.
        let sidecar = find_sidecar(&path);

        // 4. Streaming, bandwidth-limited upload with progress events.
        log::info!("uploading {filename} ({} bytes)", fh.size);
        let progress = self.progress_callback(&item.id, &item.path, "uploading");
        let bandwidth = self.inner.bandwidth.clone();
        let cancel: crate::api::CancelFn = {
            let engine = self.clone();
            Arc::new(move || engine.inner.paused.load(Ordering::Relaxed))
        };
        let result = client
            .upload_asset(
                &path,
                &fh.sha1_hex,
                &device_id,
                bandwidth,
                progress,
                cancel,
                live_video_id.as_deref(),
                sidecar.as_deref(),
            )
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
                // Queue the album membership; it's flushed in batched PUTs once
                // enough accumulate or the queue goes idle (fewer round-trips).
                if let Some(album_id) = self.album_for_path(&item.path).await {
                    let _ = self.with_db(|db| db.queue_album_add(&resp.id, &album_id)).await;
                    let total = self
                        .with_db(|db| db.pending_album_total().unwrap_or(0))
                        .await;
                    if total >= ALBUM_FLUSH_THRESHOLD {
                        let e = self.clone();
                        tokio::spawn(async move { e.flush_albums().await });
                    }
                }
                let db = &self.inner.db;
                let _ = db.add_history(&item.id, &filename, Some(&resp.id), st, None);
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
                    let db = &self.inner.db;
                    let _ = db.set_status(&item.id, status::PENDING);
                    return Err(ProcessError::Paused);
                }

                // Permanent, file-specific errors: count toward retries and
                // eventually give up (the server will never accept this file).
                if e.is_permanent() {
                    return self.handle_failure(&item, &filename, &e.to_string()).await;
                }

                // Retryable (network / 5xx / auth): requeue WITHOUT consuming a
                // retry, so transient outages auto-resume. The dispatcher backs
                // off via note_error().
                let friendly = if e.is_auth() {
                    "Authentication failed — check your API key".to_string()
                } else {
                    format!("{filename}: {e}")
                };
                log::warn!("upload retryable error for {filename}: {e}");
                *self.inner.last_error.lock().await = Some(friendly);
                let db = &self.inner.db;
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

        // Repair must consider every queued item, not just a UI page.
        let items = self
            .with_db(|db| db.list_queue(u32::MAX))
            .await
            .unwrap_or_default();
        for item in items {
            let path = PathBuf::from(&item.path);
            if !path.exists() {
                let filename = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&item.path)
                    .to_string();
                self.with_db(|db| {
                    let _ = db.add_history(
                        &item.id,
                        &filename,
                        None,
                        status::SKIPPED,
                        Some("File no longer exists on disk"),
                    );
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
        let ext_set = cfg.extension_set();
        let mut info = FolderInspect::default();
        let files = tokio::task::spawn_blocking(move || scan_folder(&folder, true))
            .await
            .unwrap_or_default();
        for file in files {
            if !cfg.matches_filter_with(&file, &ext_set) {
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
        let db = &self.inner.db;
        let retries = db.mark_failed(&item.id, msg).unwrap_or(MAX_RETRIES);
        if retries >= MAX_RETRIES {
            let _ = db.mark_dead(&item.id, msg);
            let _ = db.add_history(&item.id, filename, None, status::FAILED, Some(msg));
            self.inner.failed_session.fetch_add(1, Ordering::Relaxed);
            self.notify_failure(filename);
        }
        Err(ProcessError::Upload)
    }

    /// Show a desktop notification for a permanently-failed upload.
    fn notify_failure(&self, filename: &str) {
        if !self.inner.notifications.load(Ordering::Relaxed) {
            return;
        }
        use tauri_plugin_notification::NotificationExt;
        let _ = self
            .inner
            .app
            .notification()
            .builder()
            .title("Immich Beam — upload failed")
            .body(format!("Gave up on \"{filename}\" after repeated retries."))
            .show();
    }

    /// Build a throttled progress callback bound to this queue item.
    fn progress_callback(
        &self,
        id: &str,
        path: &str,
        phase: &'static str,
    ) -> crate::api::ProgressFn {
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
                        phase: phase.to_string(),
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

    /// Flush queued album memberships in batched PUTs. Rows are only removed
    /// once the server confirms the add, so a failure or crash just retries
    /// later (the add is idempotent server-side). Only one flush runs at a time.
    async fn flush_albums(&self) {
        // If a flush is already running, let it drain the queue.
        let _guard = match self.inner.album_flush.try_lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let client = match self.client().await {
            Some(c) => c,
            None => return,
        };
        loop {
            let batch = self
                .with_db(|db| db.take_album_batch(ALBUM_BATCH))
                .await
                .unwrap_or(None);
            let Some((album_id, asset_ids)) = batch else {
                break;
            };
            if asset_ids.is_empty() {
                break;
            }
            match client.add_to_album(&album_id, &asset_ids).await {
                Ok(()) => {
                    let _ = self
                        .with_db(|db| db.remove_album_adds(&album_id, &asset_ids))
                        .await;
                    log::info!(
                        "added {} asset(s) to album {album_id}",
                        asset_ids.len()
                    );
                }
                Err(e) => {
                    // Leave the rows for a later retry (idle flush / next run).
                    log::warn!("album batch add failed for {album_id}: {e}");
                    break;
                }
            }
        }
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

    /// Apply a new configuration: rebuild the client, restart the watcher
    /// (only if folder/filter/server settings changed), update bandwidth, etc.
    pub async fn apply_config(&self, new_config: AppConfig) {
        let needs_rescan = {
            let old = self.inner.config.lock().await;
            old.server_url != new_config.server_url
                || old.allow_insecure != new_config.allow_insecure
                || old.folders != new_config.folders
                || old.include_extensions != new_config.include_extensions
        };

        self.inner
            .bandwidth
            .set_limit_kbps(new_config.bandwidth_limit_kbps);
        self.inner
            .debug
            .store(new_config.debug_logging, Ordering::Relaxed);
        self.inner
            .notifications
            .store(new_config.notifications_enabled, Ordering::Relaxed);
        // Use the cached key — never re-read the keychain here.
        let key = self.inner.api_key.lock().await.clone();
        let client = build_client(&new_config, key.as_deref());
        *self.inner.client.lock().await = client;
        {
            let mut cfg = self.inner.config.lock().await;
            *cfg = new_config;
            let _ = cfg.save();
        }

        if needs_rescan {
            // A new server/insecure setting may need a fresh pin captured.
            self.ensure_cert_pinned().await;
            // Restart watcher against the new folder set.
            let (tx, rx) = mpsc::unbounded_channel::<FileEvent>();
            self.start_watcher(tx).await;
            self.spawn_ingest(rx);
            self.scan_all().await;
        }
        self.push_status().await;
    }

    /// On the first successful HTTPS connection to a server we are trusting
    /// insecurely, capture and pin its certificate (trust-on-first-use), then
    /// rebuild the client so it enforces that exact certificate from now on.
    /// No-op once pinned, over plain HTTP, or when not in insecure mode.
    async fn ensure_cert_pinned(&self) {
        let (insecure_https, already_pinned) = {
            let cfg = self.inner.config.lock().await;
            (
                cfg.allow_insecure && cfg.server_url.starts_with("https://"),
                cfg.pinned_cert.is_some(),
            )
        };
        if !insecure_https || already_pinned {
            return;
        }
        let client = match self.client().await {
            Some(c) => c,
            None => return,
        };
        let Some(der) = client.capture_peer_cert().await else {
            return;
        };
        use base64::Engine as _;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&der);
        let fp = crate::api::client::cert_fingerprint(&der);
        let new_cfg = {
            let mut cfg = self.inner.config.lock().await;
            cfg.pinned_cert = Some(b64);
            let _ = cfg.save();
            cfg.clone()
        };
        let key = self.inner.api_key.lock().await.clone();
        *self.inner.client.lock().await = build_client(&new_cfg, key.as_deref());
        log::info!("pinned server TLS certificate (SHA-256 {fp})");
    }

    /// Forget the pinned certificate so the next connection re-captures it
    /// (used when the server's certificate legitimately changes).
    pub async fn forget_cert_pin(&self) {
        {
            let mut cfg = self.inner.config.lock().await;
            if cfg.pinned_cert.is_none() {
                return;
            }
            cfg.pinned_cert = None;
            let _ = cfg.save();
        }
        // Rebuild now (back to capture mode), then re-pin on the next connect.
        let new_cfg = self.inner.config.lock().await.clone();
        let key = self.inner.api_key.lock().await.clone();
        *self.inner.client.lock().await = build_client(&new_cfg, key.as_deref());
        self.ensure_cert_pinned().await;
        self.push_status().await;
    }

    /// The SHA-256 fingerprint of the currently pinned certificate, if any.
    pub async fn cert_fingerprint(&self) -> Option<String> {
        let cfg = self.inner.config.lock().await;
        let der = decode_pinned_cert(cfg.pinned_cert.as_deref())?;
        Some(crate::api::client::cert_fingerprint(&der))
    }

    /// Update the in-memory cached API key (mirrors a keychain write/delete).
    pub async fn set_api_key(&self, key: Option<String>) {
        *self.inner.api_key.lock().await = key;
    }

    /// Whether an API key is cached (without touching the OS keychain).
    pub async fn has_api_key(&self) -> bool {
        self.inner
            .api_key
            .lock()
            .await
            .as_ref()
            .is_some_and(|k| !k.is_empty())
    }

    pub async fn current_config(&self) -> AppConfig {
        self.inner.config.lock().await.clone()
    }

    pub async fn client(&self) -> Option<ImmichClient> {
        self.inner.client.lock().await.clone()
    }

    pub async fn retry_failed(&self) {
        {
            let db = &self.inner.db;
            let _ = db.retry_failed();
        }
        self.emit(EVT_QUEUE, &());
    }

    pub async fn retry_item(&self, id: &str) {
        {
            let db = &self.inner.db;
            let _ = db.retry_item(id);
        }
        self.emit(EVT_QUEUE, &());
    }

    pub async fn clear_history(&self) -> usize {
        let n = self.with_db(|db| db.clear_history().unwrap_or(0)).await;
        self.emit(EVT_HISTORY, &());
        n
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
        let ext_set = self.inner.config.lock().await.extension_set();

        // Gather candidates, reusing the cached hash when the file is unchanged
        // so we don't re-read already-synced files from disk.
        // (path, size, mtime, base64 checksum)
        let mut candidates: Vec<(String, i64, i64, String)> = Vec::new();
        let mut scanned = 0usize;
        for (folder, recursive) in folders {
            let files = tokio::task::spawn_blocking(move || scan_folder(&folder, recursive))
                .await
                .unwrap_or_default();
            for path in files {
                let matched = self.inner.config.lock().await.matches_filter_with(&path, &ext_set);
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
        use crate::sync::cleanup::{enforce_allowlist, FreeResult};
        let mut result = FreeResult::default();

        // Safety: only files the last scan confirmed freeable (synced + not
        // trashed on the server) may be trashed, so a path arriving from the UI
        // can never be used to delete arbitrary files.
        let paths = {
            let st = self.inner.freeable.lock().await;
            enforce_allowlist(paths, &st.items, &mut result.errors)
        };
        if paths.is_empty() {
            return result;
        }

        // Capture sizes before the files move.
        let sized: Vec<(String, i64)> = paths
            .iter()
            .map(|p| (p.clone(), std::fs::metadata(p).map(|m| m.len() as i64).unwrap_or(0)))
            .collect();

        let ctx = trash_context();

        // One batched move first — a single Trash operation, no repeated sound.
        match ctx.delete_all(&paths) {
            Ok(()) => {
                let db = &self.inner.db;
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
                            let db = &self.inner.db;
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
        f(&self.inner.db)
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
    // A pin only applies in insecure mode; with normal CA validation it's
    // ignored (and a stale pin must not break a switch to a real cert).
    let pinned = if cfg.allow_insecure {
        decode_pinned_cert(cfg.pinned_cert.as_deref())
    } else {
        None
    };
    ImmichClient::new(&cfg.server_url, api_key, cfg.allow_insecure, pinned).ok()
}

/// Decode a base64-DER pinned certificate from config, if present and valid.
fn decode_pinned_cert(b64: Option<&str>) -> Option<Vec<u8>> {
    use base64::Engine as _;
    let b64 = b64?;
    base64::engine::general_purpose::STANDARD.decode(b64).ok()
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

/// Some extensions are ambiguous (notably `.ts` = MPEG transport stream *or*
/// TypeScript source). For those we sniff the file's magic bytes so we don't
/// queue source/text files as if they were video. Unambiguous extensions are
/// trusted without reading the file.
fn extension_content_ok(path: &Path) -> bool {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("ts") => is_mpeg_ts(path),
        _ => true,
    }
}

/// True if the file looks like an MPEG transport stream by its 0x47 sync bytes.
/// Handles both standard 188-byte packets (DVB/ATSC) and 192-byte packets with
/// a 4-byte timecode prefix (M2TS / Blu-ray style).
fn is_mpeg_ts(path: &Path) -> bool {
    use std::io::Read;
    let mut f = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut buf = [0u8; 384];
    let mut filled = 0;
    while filled < buf.len() {
        match f.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(_) => return false,
        }
    }
    // 188-byte packets: sync at offsets 0 and 188.
    let ts188 = filled > 188 && buf[0] == 0x47 && buf[188] == 0x47;
    // 192-byte packets: sync at offsets 4 and 196.
    let ts192 = filled > 196 && buf[4] == 0x47 && buf[196] == 0x47;
    ts188 || ts192
}

fn ext_lower(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

fn is_image_file(path: &Path) -> bool {
    matches!(
        ext_lower(path).as_deref(),
        Some("heic" | "heif" | "jpg" | "jpeg" | "png" | "dng")
    )
}

fn is_video_file(path: &Path) -> bool {
    matches!(ext_lower(path).as_deref(), Some("mov" | "mp4" | "m4v"))
}

/// For a still image, find a same-named sibling video (the Live Photo motion).
fn paired_live_video(still: &Path) -> Option<PathBuf> {
    if !is_image_file(still) {
        return None;
    }
    let stem = still.file_stem()?;
    let dir = still.parent()?;
    for ext in ["mov", "MOV", "mp4", "MP4", "m4v", "M4V"] {
        let cand = dir.join(stem).with_extension(ext);
        if cand != *still && cand.exists() {
            return Some(cand);
        }
    }
    None
}

/// For a video, find a same-named sibling still image (its Live Photo).
fn paired_live_still(video: &Path) -> Option<PathBuf> {
    if !is_video_file(video) {
        return None;
    }
    let stem = video.file_stem()?;
    let dir = video.parent()?;
    for ext in ["heic", "HEIC", "heif", "HEIF", "jpg", "JPG", "jpeg", "JPEG"] {
        let cand = dir.join(stem).with_extension(ext);
        if cand.exists() {
            return Some(cand);
        }
    }
    None
}

/// Find an XMP sidecar next to `path`: either `name.ext.xmp` or `name.xmp`.
fn find_sidecar(path: &Path) -> Option<PathBuf> {
    let appended = PathBuf::from(format!("{}.xmp", path.to_string_lossy()));
    if appended.exists() {
        return Some(appended);
    }
    let replaced = path.with_extension("xmp");
    if replaced != *path && replaced.exists() {
        return Some(replaced);
    }
    None
}

/// Unix-seconds mtime from optional metadata, 0 if unavailable.
fn file_mtime(meta: Option<&std::fs::Metadata>) -> i64 {
    meta.and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::api::client::ApiError;

    #[test]
    fn classifies_permanent_vs_retryable_errors() {
        // Permanent client errors the server will never accept on retry.
        assert!(ApiError::Status(400).is_permanent());
        assert!(ApiError::Status(413).is_permanent());
        assert!(ApiError::Status(415).is_permanent());
        assert!(ApiError::Status(422).is_permanent());
        // Retryable: auth, rate-limit, timeout, server, transport.
        assert!(!ApiError::Status(401).is_permanent());
        assert!(!ApiError::Status(429).is_permanent());
        assert!(!ApiError::Status(408).is_permanent());
        assert!(!ApiError::Status(500).is_permanent());
        assert!(!ApiError::Transport("connection refused".into()).is_permanent());
    }

    #[test]
    fn detects_auth_errors() {
        assert!(ApiError::Status(401).is_auth());
        assert!(ApiError::Status(403).is_auth());
        assert!(!ApiError::Status(500).is_auth());
        assert!(!ApiError::Transport("x".into()).is_auth());
    }

    #[test]
    fn ts_content_check_distinguishes_video_from_typescript() {
        use std::io::Write;
        let dir = std::env::temp_dir();

        // Fake MPEG-TS: 0x47 sync byte at offsets 0 and 188.
        let video = dir.join("immich_test_stream.ts");
        let mut buf = vec![0u8; 200];
        buf[0] = 0x47;
        buf[188] = 0x47;
        std::fs::File::create(&video).unwrap().write_all(&buf).unwrap();
        assert!(extension_content_ok(&video));

        // TypeScript source — should be rejected.
        let code = dir.join("immich_test_module.ts");
        std::fs::write(&code, b"export const greeting = 'hello world';\n").unwrap();
        assert!(!extension_content_ok(&code));

        // Non-ambiguous extensions are trusted without reading.
        assert!(extension_content_ok(std::path::Path::new("/x/photo.jpg")));

        let _ = std::fs::remove_file(&video);
        let _ = std::fs::remove_file(&code);
    }

    #[test]
    fn hex_roundtrips_to_bytes() {
        assert_eq!(hex_to_bytes("00ff10a5"), vec![0x00, 0xff, 0x10, 0xa5]);
        assert_eq!(hex_to_bytes(""), Vec::<u8>::new());
        // SHA1("abc") hex → 20 bytes
        assert_eq!(
            hex_to_bytes("a9993e364706816aba3e25717850c26c9cd0d89d").len(),
            20
        );
    }

    #[test]
    fn paired_live_video_finds_sibling_mov() {
        let dir = std::env::temp_dir().join("immich_live_test");
        let _ = std::fs::create_dir_all(&dir);
        let still = dir.join("IMG_1234.heic");
        let video = dir.join("IMG_1234.mov");
        std::fs::write(&still, b"fake").unwrap();
        std::fs::write(&video, b"fake").unwrap();

        assert_eq!(paired_live_video(&still), Some(video.clone()));
        // Video files don't pair with other videos.
        assert_eq!(paired_live_video(&video), None);
        // Non-image file returns None.
        assert_eq!(paired_live_video(&dir.join("notes.txt")), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn paired_live_still_finds_sibling_heic() {
        let dir = std::env::temp_dir().join("immich_live_test2");
        let _ = std::fs::create_dir_all(&dir);
        let still = dir.join("IMG_5678.heic");
        let video = dir.join("IMG_5678.mov");
        std::fs::write(&still, b"fake").unwrap();
        std::fs::write(&video, b"fake").unwrap();

        assert_eq!(paired_live_still(&video), Some(still.clone()));
        // Image files don't pair with other images.
        assert_eq!(paired_live_still(&still), None);
        // Non-video file returns None.
        assert_eq!(paired_live_still(&dir.join("doc.pdf")), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn paired_live_video_returns_none_when_no_sibling() {
        let dir = std::env::temp_dir().join("immich_live_test3");
        let _ = std::fs::create_dir_all(&dir);
        let still = dir.join("solo.jpg");
        std::fs::write(&still, b"fake").unwrap();
        // No .mov/.mp4 sibling exists.
        assert_eq!(paired_live_video(&still), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_sidecar_prefers_appended_extension() {
        let dir = std::env::temp_dir().join("immich_sidecar_test");
        let _ = std::fs::create_dir_all(&dir);
        let photo = dir.join("photo.dng");
        let appended = dir.join("photo.dng.xmp");
        let replaced = dir.join("photo.xmp");
        std::fs::write(&photo, b"raw").unwrap();
        std::fs::write(&appended, b"xmp1").unwrap();
        std::fs::write(&replaced, b"xmp2").unwrap();

        // Appended form (photo.dng.xmp) takes priority.
        assert_eq!(find_sidecar(&photo), Some(appended));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_sidecar_falls_back_to_replaced() {
        let dir = std::env::temp_dir().join("immich_sidecar_test2");
        let _ = std::fs::create_dir_all(&dir);
        let photo = dir.join("photo.dng");
        let replaced = dir.join("photo.xmp");
        std::fs::write(&photo, b"raw").unwrap();
        std::fs::write(&replaced, b"xmp").unwrap();
        // No appended form → falls back to photo.xmp.
        assert_eq!(find_sidecar(&photo), Some(replaced));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_sidecar_returns_none_when_absent() {
        let dir = std::env::temp_dir().join("immich_sidecar_test3");
        let _ = std::fs::create_dir_all(&dir);
        let photo = dir.join("photo.jpg");
        std::fs::write(&photo, b"img").unwrap();
        assert_eq!(find_sidecar(&photo), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
