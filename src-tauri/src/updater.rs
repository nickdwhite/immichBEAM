//! In-app auto-update via the Tauri updater plugin.
//!
//! All update operations run Rust-side and are exposed as ordinary commands, so
//! the frontend needs no extra IPC capabilities. The update manifest
//! (`latest.json`) and signed bundles are published with each GitHub Release;
//! see `docs/TODO.md` for the one-time signing-key setup that activates this.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

/// Event pushed to the frontend as the update downloads.
pub const EVT_UPDATE_PROGRESS: &str = "update://progress";

/// Holds the most recently checked update so `install_update` can apply it.
#[derive(Default)]
pub struct PendingUpdate(pub Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub current_version: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
    pub pct: u64,
}

/// Query the configured endpoint for a newer signed release.
#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<UpdateInfo, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    let info = match &update {
        Some(u) => UpdateInfo {
            available: true,
            version: Some(u.version.clone()),
            current_version: Some(u.current_version.clone()),
            notes: u.body.clone(),
        },
        None => UpdateInfo {
            available: false,
            version: None,
            current_version: None,
            notes: None,
        },
    };
    *pending.0.lock().await = update;
    Ok(info)
}

/// Download + install the pending update, then restart the app.
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .await
        .take()
        .ok_or_else(|| "No pending update — run a check first".to_string())?;

    let downloaded = Arc::new(AtomicU64::new(0));
    let last_pct = Arc::new(AtomicU64::new(u64::MAX));
    let app_clone = app.clone();

    update
        .download_and_install(
            move |chunk_len, total| {
                let d = downloaded.fetch_add(chunk_len as u64, Ordering::Relaxed) + chunk_len as u64;
                let pct = total.map(|t| if t > 0 { d * 100 / t } else { 0 }).unwrap_or(0);
                if last_pct.swap(pct, Ordering::Relaxed) != pct {
                    let _ = app_clone.emit(
                        EVT_UPDATE_PROGRESS,
                        UpdateProgress {
                            downloaded: d,
                            total: total.map(|t| t as u64),
                            pct,
                        },
                    );
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    // On Windows the installer exits the app for us; elsewhere we restart.
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}
