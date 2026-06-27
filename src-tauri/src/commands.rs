//! Tauri IPC commands exposed to the React frontend.

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::api::{Album, ConnectionInfo, ImmichClient};
use crate::config::{AppConfig, WatchedFolder};
use crate::db::{HistoryItem, QueueItem};
use crate::keychain;
use crate::sync::{SyncEngine, SyncStatus};

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Config sent to the UI. The API key itself is never returned — only whether
/// one is stored.
#[derive(Serialize)]
pub struct ConfigDto {
    #[serde(flatten)]
    pub config: AppConfig,
    pub has_api_key: bool,
}

#[tauri::command]
pub async fn get_config(engine: State<'_, SyncEngine>) -> CmdResult<ConfigDto> {
    let config = engine.current_config().await;
    let has_api_key = engine.has_api_key().await;
    Ok(ConfigDto {
        config,
        has_api_key,
    })
}

/// Validate a server URL + API key without persisting anything.
/// If `api_key` is omitted, the stored key is used.
#[tauri::command]
pub async fn test_connection(
    url: String,
    api_key: Option<String>,
    allow_insecure: bool,
) -> CmdResult<ConnectionInfo> {
    let key = match api_key {
        Some(k) if !k.is_empty() => k,
        _ => keychain::get_api_key()
            .map_err(map_err)?
            .unwrap_or_default(),
    };
    // No pin here: this is a pre-save connectivity/auth check, so accept the
    // cert (when insecure) rather than failing on a stale pin. The real pin is
    // (re)captured by the engine after the settings are saved and applied.
    let client = ImmichClient::new(&url, &key, allow_insecure, None).map_err(map_err)?;
    Ok(client.validate().await)
}

/// Persist server settings: store the API key in the keychain (if provided) and
/// update + apply the config.
#[tauri::command]
pub async fn save_server(
    engine: State<'_, SyncEngine>,
    url: String,
    api_key: Option<String>,
    allow_insecure: bool,
) -> CmdResult<()> {
    if let Some(key) = api_key {
        if !key.is_empty() {
            keychain::set_api_key(&key).map_err(map_err)?;
            engine.set_api_key(Some(key)).await;
        }
    }
    let mut config = engine.current_config().await;
    let new_url = url.trim().trim_end_matches('/').to_string();
    // A different server has a different certificate — drop any stale pin so a
    // fresh one is captured on the next connect.
    if new_url != config.server_url {
        config.pinned_cert = None;
    }
    config.server_url = new_url;
    config.allow_insecure = allow_insecure;
    engine.apply_config(config).await;
    Ok(())
}

/// Replace the full configuration (folders, sync settings, etc.) and apply it.
#[tauri::command]
pub async fn save_config(engine: State<'_, SyncEngine>, config: AppConfig) -> CmdResult<()> {
    engine.apply_config(config).await;
    Ok(())
}

#[tauri::command]
pub async fn add_folder(
    engine: State<'_, SyncEngine>,
    path: String,
    album_id: Option<String>,
) -> CmdResult<AppConfig> {
    let mut config = engine.current_config().await;
    if !config.folders.iter().any(|f| f.path == path) {
        config.folders.push(WatchedFolder {
            path,
            enabled: true,
            album_id,
            recursive: true,
        });
    }
    engine.apply_config(config.clone()).await;
    Ok(config)
}

#[tauri::command]
pub async fn remove_folder(engine: State<'_, SyncEngine>, path: String) -> CmdResult<AppConfig> {
    let mut config = engine.current_config().await;
    config.folders.retain(|f| f.path != path);
    engine.apply_config(config.clone()).await;
    Ok(config)
}

#[tauri::command]
pub async fn clear_api_key(engine: State<'_, SyncEngine>) -> CmdResult<()> {
    keychain::delete_api_key().map_err(map_err)?;
    engine.set_api_key(None).await;
    // Rebuild client (will become None without a key).
    let config = engine.current_config().await;
    engine.apply_config(config).await;
    Ok(())
}

#[tauri::command]
pub async fn get_status(engine: State<'_, SyncEngine>) -> CmdResult<SyncStatus> {
    Ok(engine.status().await)
}

/// Live connection status (server version, auth) using the cached client, so it
/// never reads the keychain. Returns "Not configured" when no client exists.
#[tauri::command]
pub async fn get_connection_info(engine: State<'_, SyncEngine>) -> CmdResult<ConnectionInfo> {
    match engine.client().await {
        Some(client) => Ok(client.validate().await),
        None => Ok(ConnectionInfo {
            reachable: false,
            authenticated: false,
            version: None,
            user_email: None,
            insecure: false,
            message: "Not configured".into(),
        }),
    }
}

/// SHA-256 fingerprint of the pinned server certificate (TOFU), or `None` if
/// no certificate is currently pinned.
#[tauri::command]
pub async fn get_cert_fingerprint(engine: State<'_, SyncEngine>) -> CmdResult<Option<String>> {
    Ok(engine.cert_fingerprint().await)
}

/// Forget the pinned certificate so the next connection trusts and pins a new
/// one (used when the server's certificate legitimately changes).
#[tauri::command]
pub async fn forget_cert_pin(engine: State<'_, SyncEngine>) -> CmdResult<()> {
    engine.forget_cert_pin().await;
    Ok(())
}

/// The full Immich-supported extension list, for the "reset filter" action.
#[tauri::command]
pub fn default_extensions() -> Vec<String> {
    AppConfig::default().include_extensions
}

fn log_file_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_log_dir()
        .map(|d| d.join("immich-beam.log"))
        .map_err(map_err)
}

/// Absolute path to the rolling log file.
#[tauri::command]
pub fn get_log_path(app: AppHandle) -> CmdResult<String> {
    Ok(log_file_path(&app)?.to_string_lossy().to_string())
}

/// Return the last `lines` lines of the log file (default 500).
#[tauri::command]
pub fn read_log(app: AppHandle, lines: Option<usize>) -> CmdResult<String> {
    let path = log_file_path(&app)?;
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let n = lines.unwrap_or(500);
    let all: Vec<&str> = content.lines().collect();
    let start = all.len().saturating_sub(n);
    Ok(all[start..].join("\n"))
}

#[tauri::command]
pub async fn get_queue(
    engine: State<'_, SyncEngine>,
    limit: Option<u32>,
) -> CmdResult<Vec<QueueItem>> {
    let limit = limit.unwrap_or(500);
    engine
        .with_db(|db| db.list_queue(limit))
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn get_failed(engine: State<'_, SyncEngine>) -> CmdResult<Vec<QueueItem>> {
    engine
        .with_db(|db| db.list_failed())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn get_history(
    engine: State<'_, SyncEngine>,
    limit: Option<u32>,
    status: Option<String>,
) -> CmdResult<Vec<HistoryItem>> {
    engine
        .with_db(|db| db.list_history(limit.unwrap_or(500), status.as_deref()))
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn clear_history(engine: State<'_, SyncEngine>) -> CmdResult<usize> {
    Ok(engine.clear_history().await)
}

#[tauri::command]
pub async fn pause_sync(engine: State<'_, SyncEngine>) -> CmdResult<()> {
    engine.set_paused(true).await;
    Ok(())
}

#[tauri::command]
pub async fn resume_sync(engine: State<'_, SyncEngine>) -> CmdResult<()> {
    engine.set_paused(false).await;
    Ok(())
}

#[tauri::command]
pub async fn retry_failed(engine: State<'_, SyncEngine>) -> CmdResult<()> {
    engine.retry_failed().await;
    Ok(())
}

#[tauri::command]
pub async fn retry_item(engine: State<'_, SyncEngine>, id: String) -> CmdResult<()> {
    engine.retry_item(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn get_stats(engine: State<'_, SyncEngine>) -> CmdResult<crate::db::HistoryStats> {
    engine
        .with_db(|db| db.history_stats())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rescan(engine: State<'_, SyncEngine>) -> CmdResult<()> {
    engine.scan_all().await;
    Ok(())
}

#[tauri::command]
pub async fn repair_queue(
    engine: State<'_, SyncEngine>,
) -> CmdResult<crate::sync::cleanup::RepairReport> {
    Ok(engine.repair_queue().await)
}

#[tauri::command]
pub async fn clear_queue(engine: State<'_, SyncEngine>) -> CmdResult<usize> {
    Ok(engine.clear_queue().await)
}

#[tauri::command]
pub async fn inspect_folder(
    engine: State<'_, SyncEngine>,
    path: String,
) -> CmdResult<crate::sync::cleanup::FolderInspect> {
    Ok(engine.inspect_folder(&path).await)
}

/// Album shape sent to the UI (snake_case, matching the other DTOs).
#[derive(Serialize)]
pub struct AlbumDto {
    pub id: String,
    pub album_name: String,
    pub asset_count: u32,
}

impl From<Album> for AlbumDto {
    fn from(a: Album) -> Self {
        AlbumDto {
            id: a.id,
            album_name: a.album_name,
            asset_count: a.asset_count,
        }
    }
}

#[tauri::command]
pub async fn start_freeable_scan(engine: State<'_, SyncEngine>, days: u64) -> CmdResult<()> {
    engine.start_freeable_scan(days);
    Ok(())
}

#[tauri::command]
pub async fn get_freeable_state(
    engine: State<'_, SyncEngine>,
) -> CmdResult<crate::sync::cleanup::FreeableScan> {
    Ok(engine.freeable_state().await)
}

#[tauri::command]
pub async fn free_space(
    engine: State<'_, SyncEngine>,
    paths: Vec<String>,
) -> CmdResult<crate::sync::cleanup::FreeResult> {
    Ok(engine.free_space(paths).await)
}

#[tauri::command]
pub async fn get_albums(engine: State<'_, SyncEngine>) -> CmdResult<Vec<AlbumDto>> {
    match engine.client().await {
        Some(client) => client
            .albums()
            .await
            .map(|albums| albums.into_iter().map(AlbumDto::from).collect())
            .map_err(map_err),
        None => Ok(vec![]),
    }
}

#[tauri::command]
pub async fn create_album(
    engine: State<'_, SyncEngine>,
    name: String,
) -> CmdResult<AlbumDto> {
    match engine.client().await {
        Some(client) => client
            .create_album(name.trim())
            .await
            .map(AlbumDto::from)
            .map_err(map_err),
        None => Err("Not connected to a server".into()),
    }
}

/// Suggest default media folders (Pictures, Videos, etc.) that exist on this
/// machine and haven't already been added.
#[tauri::command]
pub async fn suggest_folders(engine: State<'_, SyncEngine>) -> CmdResult<Vec<String>> {
    let config = engine.current_config().await;
    let existing: std::collections::HashSet<String> =
        config.folders.iter().map(|f| f.path.clone()).collect();

    let mut suggestions = Vec::new();
    if let Some(home) = dirs::home_dir() {
        let candidates = [
            dirs::picture_dir(),
            dirs::video_dir(),
            Some(home.join("Photos")),
            Some(home.join("DCIM")),
        ];
        for candidate in candidates.into_iter().flatten() {
            if candidate.exists() && !existing.contains(&candidate.to_string_lossy().to_string()) {
                suggestions.push(candidate.to_string_lossy().to_string());
            }
        }
    }
    suggestions.dedup();
    Ok(suggestions)
}
