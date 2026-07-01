//! In-app auto-update via the Tauri updater plugin.
//!
//! All update operations run Rust-side and are exposed as ordinary commands, so
//! the frontend needs no extra IPC capabilities. The update manifest
//! (`latest.json` / `latest-beta.json`) and signed bundles are published with
//! each GitHub Release.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

/// Stable release feed — GitHub resolves `/releases/latest/` to the newest
/// non-prerelease.
const STABLE_ENDPOINT: &str =
    "https://github.com/nickdwhite/immichBEAM/releases/latest/download/latest.json";

/// Beta/prerelease feed — the `beta` tag is force-moved to each prerelease so
/// this URL always points to the latest beta's manifest.
const BETA_ENDPOINT: &str =
    "https://github.com/nickdwhite/immichBEAM/releases/download/beta/latest-beta.json";

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

/// Query the configured endpoint for a newer signed release. The endpoint is
/// selected from the user's `update_channel` config ("stable" or "beta") —
/// both URLs are hardcoded constants; the config value is **not** interpolated
/// into the URL, so a tampered config cannot redirect to an attacker's server.
#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    engine: State<'_, crate::sync::SyncEngine>,
    pending: State<'_, PendingUpdate>,
) -> Result<UpdateInfo, String> {
    let config = engine.current_config().await;
    let endpoint = if config.update_channel == "beta" {
        BETA_ENDPOINT
    } else {
        STABLE_ENDPOINT
    };
    let url: reqwest::Url = endpoint
        .parse()
        .expect("STABLE_ENDPOINT and BETA_ENDPOINT are hardcoded valid URLs");
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
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

/// Set the update channel ("stable" or "beta"). Only "beta" is accepted as
/// non-default — any other value (including injection attempts) defaults to
/// "stable". The channel determines which hardcoded endpoint URL is used;
/// the value is never interpolated into a URL.
#[tauri::command]
pub async fn set_update_channel(
    engine: State<'_, crate::sync::SyncEngine>,
    channel: String,
) -> Result<(), String> {
    let mut config = engine.current_config().await;
    config.update_channel = if channel == "beta" {
        "beta".to_string()
    } else {
        "stable".to_string()
    };
    engine.apply_config(config).await;
    Ok(())
}
