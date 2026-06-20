//! Thin async wrapper around the Immich REST API.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use base64::Engine as _;
use futures::StreamExt;
use reqwest::multipart;
use reqwest::Client;
use tokio_util::io::ReaderStream;

use super::types::*;
use crate::sync::queue::BandwidthLimiter;

/// Callback invoked with `(bytes_sent, total_bytes)` as an upload streams.
pub type ProgressFn = Arc<dyn Fn(u64, u64) + Send + Sync>;

/// Returns true to abort an in-flight upload (e.g. the user paused).
pub type CancelFn = Arc<dyn Fn() -> bool + Send + Sync>;

/// HTTP client bound to a single Immich server + API key.
#[derive(Clone)]
pub struct ImmichClient {
    base_url: String,
    api_key: String,
    http: Client,
}

impl ImmichClient {
    /// Build a client. `base_url` may or may not have a trailing slash.
    /// `allow_insecure` accepts self-signed certificates (trust-on-first-use).
    pub fn new(base_url: &str, api_key: &str, allow_insecure: bool) -> Result<Self> {
        let base_url = base_url.trim_end_matches('/').to_string();
        let http = Client::builder()
            .user_agent(concat!("ImmichSyncDesk/", env!("CARGO_PKG_VERSION")))
            .danger_accept_invalid_certs(allow_insecure)
            .connect_timeout(Duration::from_secs(10))
            // No overall request timeout: large uploads can legitimately take a
            // long time. Stalls are bounded by the worker's per-item timeout and
            // pause-cancellation; connect failures still fail fast.
            .timeout(Duration::from_secs(3600))
            .build()
            .context("failed to build HTTP client")?;
        Ok(Self {
            base_url,
            api_key: api_key.to_string(),
            http,
        })
    }

    pub fn is_insecure(&self) -> bool {
        self.base_url.starts_with("http://")
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// `GET /api/server/ping` — connectivity check (no auth required).
    pub async fn ping(&self) -> Result<bool> {
        let resp = self
            .http
            .get(self.url("/api/server/ping"))
            .send()
            .await
            .context("ping request failed")?;
        if !resp.status().is_success() {
            return Ok(false);
        }
        let body: PingResponse = resp.json().await.context("invalid ping response")?;
        Ok(body.res == "pong")
    }

    /// `GET /api/server/version`.
    pub async fn version(&self) -> Result<ServerVersion> {
        let resp = self
            .http
            .get(self.url("/api/server/version"))
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json().await?)
    }

    /// `GET /api/users/me` — validates the API key.
    pub async fn me(&self) -> Result<UserResponse> {
        let resp = self
            .http
            .get(self.url("/api/users/me"))
            .header("x-api-key", &self.api_key)
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(anyhow!("invalid API key"));
        }
        let resp = resp.error_for_status()?;
        Ok(resp.json().await?)
    }

    /// Run the full connection-validation sequence used by "Test Connection".
    pub async fn validate(&self) -> ConnectionInfo {
        let insecure = self.is_insecure();
        match self.ping().await {
            Ok(true) => {}
            Ok(false) | Err(_) => {
                return ConnectionInfo {
                    reachable: false,
                    authenticated: false,
                    version: None,
                    user_email: None,
                    insecure,
                    message: "Server is not reachable".into(),
                };
            }
        }

        let version = self.version().await.ok().map(|v| v.to_string());

        match self.me().await {
            Ok(user) => ConnectionInfo {
                reachable: true,
                authenticated: true,
                version,
                user_email: Some(user.email),
                insecure,
                message: "Connected".into(),
            },
            Err(e) => ConnectionInfo {
                reachable: true,
                authenticated: false,
                version,
                user_email: None,
                insecure,
                message: format!("Authentication failed: {e}"),
            },
        }
    }

    /// `POST /api/assets/bulk-upload-check` — batch duplicate detection.
    /// `items` maps a client id to a Base64-encoded SHA1 checksum.
    pub async fn bulk_upload_check(
        &self,
        items: Vec<BulkCheckItem>,
    ) -> Result<Vec<BulkCheckResultItem>> {
        if items.is_empty() {
            return Ok(vec![]);
        }
        let req = BulkCheckRequest { assets: items };
        let resp = self
            .http
            .post(self.url("/api/assets/bulk-upload-check"))
            .header("x-api-key", &self.api_key)
            .json(&req)
            .send()
            .await?
            .error_for_status()?;
        let body: BulkCheckResponse = resp.json().await?;
        Ok(body.results)
    }

    /// `POST /api/assets` — streaming multipart upload of a single file.
    ///
    /// The file body is streamed (not buffered), with `bandwidth` applied per
    /// chunk and `on_progress(sent, total)` invoked as bytes are sent.
    /// `sha1_hex` is the hex-encoded SHA1 checksum sent via `x-immich-checksum`.
    pub async fn upload_asset(
        &self,
        path: &Path,
        sha1_hex: &str,
        device_id: &str,
        bandwidth: Arc<BandwidthLimiter>,
        on_progress: ProgressFn,
        cancel: CancelFn,
    ) -> Result<AssetUploadResponse> {
        let metadata = tokio::fs::metadata(path)
            .await
            .with_context(|| format!("cannot stat {}", path.display()))?;
        let total = metadata.len();
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| anyhow!("invalid file name"))?
            .to_string();

        let mime = mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string();

        let created = chrono::DateTime::<chrono::Utc>::from(
            metadata.modified().unwrap_or(std::time::SystemTime::now()),
        )
        .to_rfc3339();

        // Stream the file: throttle and report progress per chunk.
        let file = tokio::fs::File::open(path).await?;
        let sent = Arc::new(AtomicU64::new(0));
        let stream = ReaderStream::new(file).then(move |chunk| {
            let bandwidth = bandwidth.clone();
            let sent = sent.clone();
            let on_progress = on_progress.clone();
            let cancel = cancel.clone();
            async move {
                if cancel() {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        "upload cancelled (paused)",
                    ));
                }
                if let Ok(ref bytes) = chunk {
                    let n = bytes.len() as u64;
                    bandwidth.consume(n).await;
                    let total_sent = sent.fetch_add(n, Ordering::Relaxed) + n;
                    on_progress(total_sent, total);
                }
                chunk
            }
        });

        let body = reqwest::Body::wrap_stream(stream);
        let part = multipart::Part::stream_with_length(body, total)
            .file_name(file_name.clone())
            .mime_str(&mime)?;

        let device_asset_id = format!("{file_name}-{}", total);

        let form = multipart::Form::new()
            .text("deviceAssetId", device_asset_id)
            .text("deviceId", device_id.to_string())
            .text("fileCreatedAt", created.clone())
            .text("fileModifiedAt", created)
            .text("isFavorite", "false")
            .part("assetData", part);

        let resp = self
            .http
            .post(self.url("/api/assets"))
            .header("x-api-key", &self.api_key)
            .header("x-immich-checksum", sha1_hex)
            .multipart(form)
            .send()
            .await?
            .error_for_status()?;

        Ok(resp.json().await?)
    }

    /// `POST /api/albums` — create a new (empty) album.
    pub async fn create_album(&self, name: &str) -> Result<Album> {
        let resp = self
            .http
            .post(self.url("/api/albums"))
            .header("x-api-key", &self.api_key)
            .json(&serde_json::json!({ "albumName": name }))
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json().await?)
    }

    /// `GET /api/albums`.
    pub async fn albums(&self) -> Result<Vec<Album>> {
        let resp = self
            .http
            .get(self.url("/api/albums"))
            .header("x-api-key", &self.api_key)
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json().await?)
    }

    /// `PUT /api/albums/{id}/assets` — add uploaded assets to an album.
    pub async fn add_to_album(&self, album_id: &str, asset_ids: &[String]) -> Result<()> {
        if asset_ids.is_empty() {
            return Ok(());
        }
        self.http
            .put(self.url(&format!("/api/albums/{album_id}/assets")))
            .header("x-api-key", &self.api_key)
            .json(&serde_json::json!({ "ids": asset_ids }))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }
}

/// Encode raw SHA1 bytes as Base64 (for bulk-upload-check).
pub fn sha1_to_base64(sha1_bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(sha1_bytes)
}
