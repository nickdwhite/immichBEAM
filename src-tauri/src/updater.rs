//! In-app auto-update via the Tauri updater plugin.
//!
//! All update operations run Rust-side and are exposed as ordinary commands, so
//! the frontend needs no extra IPC capabilities. The update manifest
//! (`latest.json`) and signed bundles are published with each GitHub Release;
//! see `docs/TODO.md` for the one-time signing-key setup that activates this.

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

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

    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    // On Windows the installer exits the app for us; elsewhere we restart.
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}
