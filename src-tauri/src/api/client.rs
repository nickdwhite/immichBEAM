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

/// A classified API error, so the sync engine can decide retry behavior from
/// the real HTTP status rather than matching on message text.
#[derive(Debug)]
pub enum ApiError {
    /// Server returned a non-success HTTP status.
    Status(u16),
    /// Connection / timeout / DNS failure — retryable.
    Transport(String),
    /// Local IO or response-decode failure.
    Other(String),
}

impl ApiError {
    /// 401/403 — the API key is missing, wrong, or lacks permission.
    pub fn is_auth(&self) -> bool {
        matches!(self, ApiError::Status(401) | ApiError::Status(403))
    }

    /// A client error the server will never accept on retry (bad request,
    /// payload too large, unsupported media). Excludes auth, timeout (408),
    /// and rate-limit (429), which are retryable.
    pub fn is_permanent(&self) -> bool {
        match self {
            ApiError::Status(s) => (400..500).contains(s) && !matches!(s, 401 | 403 | 408 | 429),
            _ => false,
        }
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::Status(s) => write!(f, "HTTP {s}"),
            ApiError::Transport(m) => write!(f, "network error: {m}"),
            ApiError::Other(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for ApiError {}

impl From<reqwest::Error> for ApiError {
    fn from(e: reqwest::Error) -> Self {
        if let Some(s) = e.status() {
            ApiError::Status(s.as_u16())
        } else if e.is_connect() || e.is_timeout() {
            ApiError::Transport(e.to_string())
        } else {
            ApiError::Other(e.to_string())
        }
    }
}

/// Turn a non-success response into a typed `ApiError::Status`.
fn status_checked(resp: reqwest::Response) -> std::result::Result<reqwest::Response, ApiError> {
    let s = resp.status();
    if s.is_success() {
        Ok(resp)
    } else {
        Err(ApiError::Status(s.as_u16()))
    }
}

/// How the client authenticates with the Immich server.
#[derive(Clone, Debug)]
pub enum AuthMethod {
    ApiKey(String),
    Bearer(String),
}

/// HTTP client bound to a single Immich server.
#[derive(Clone)]
pub struct ImmichClient {
    base_url: String,
    auth: AuthMethod,
    http: Client,
}

impl ImmichClient {
    /// Build a client. `base_url` may or may not have a trailing slash.
    ///
    /// TLS trust is decided in three modes:
    /// * `pinned_cert: Some(der)` — trust **only** that one certificate (TOFU
    ///   pinning). Built-in roots are disabled and hostname checking is relaxed
    ///   (self-signed homelab certs are usually issued to an IP), so a swapped
    ///   certificate from an in-path attacker is rejected while the pinned one
    ///   is accepted.
    /// * `allow_insecure && pinned_cert == None` — accept any cert, but only so
    ///   the leaf can be captured and pinned on first use (see
    ///   `capture_peer_cert`). This window is closed as soon as a pin is stored.
    /// * neither — normal CA validation.
    pub fn new(
        base_url: &str,
        api_key: &str,
        allow_insecure: bool,
        pinned_cert: Option<Vec<u8>>,
    ) -> Result<Self> {
        Self::with_auth(
            base_url,
            AuthMethod::ApiKey(api_key.to_string()),
            allow_insecure,
            pinned_cert,
        )
    }

    pub fn with_auth(
        base_url: &str,
        auth: AuthMethod,
        allow_insecure: bool,
        pinned_cert: Option<Vec<u8>>,
    ) -> Result<Self> {
        let base_url = base_url.trim_end_matches('/').to_string();
        let mut builder = Client::builder()
            .user_agent(concat!("ImmichBeam/", env!("CARGO_PKG_VERSION")))
            .tls_info(true)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(3600));

        if let Some(der) = pinned_cert {
            let cert = reqwest::Certificate::from_der(&der)
                .context("pinned certificate is not valid DER")?;
            builder = builder.tls_certs_only(vec![cert]);
            if host_is_ip(&base_url) {
                builder = builder.danger_accept_invalid_hostnames(true);
            }
        } else if allow_insecure {
            builder = builder.danger_accept_invalid_certs(true);
        }

        let http = builder.build().context("failed to build HTTP client")?;
        Ok(Self {
            base_url,
            auth,
            http,
        })
    }

    /// Add the appropriate auth header to a request builder.
    fn authed(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.auth {
            AuthMethod::ApiKey(key) => req.header("x-api-key", key),
            AuthMethod::Bearer(token) => req.header("Authorization", format!("Bearer {token}")),
        }
    }

    /// Log in with email + password and return a client using the bearer token.
    pub async fn login(
        base_url: &str,
        email: &str,
        password: &str,
        allow_insecure: bool,
        pinned_cert: Option<Vec<u8>>,
    ) -> Result<(Self, super::types::LoginResponse)> {
        log::info!(
            "auth: attempting password login to {base_url} as {email} \
             (insecure={allow_insecure}, pinned={})",
            pinned_cert.is_some()
        );
        let temp = Self::with_auth(
            base_url,
            AuthMethod::ApiKey(String::new()),
            allow_insecure,
            pinned_cert.clone(),
        )?;
        let endpoint = temp.url("/api/auth/login");
        let resp = match temp
            .http
            .post(&endpoint)
            .json(&serde_json::json!({
                "email": email,
                "password": password,
            }))
            .send()
            .await
            .context("login request failed")
        {
            Ok(r) => {
                log::info!("auth: login endpoint responded {}", r.status());
                r
            }
            // The transport/TLS error chain is the part we most need to see;
            // {:#} makes anyhow print every cause, not just the top message.
            Err(e) => {
                log::warn!("auth: login request to {endpoint} failed: {e:#}");
                return Err(e);
            }
        };
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            log::warn!("auth: login rejected — invalid credentials for {email}");
            return Err(anyhow!("invalid email or password"));
        }
        let resp = match resp.error_for_status().context("login failed") {
            Ok(r) => r,
            Err(e) => {
                log::warn!("auth: login unsuccessful status: {e:#}");
                return Err(e);
            }
        };
        let login: super::types::LoginResponse = match resp.json().await.context("invalid login response") {
            Ok(l) => l,
            Err(e) => {
                log::warn!("auth: login response could not be decoded: {e:#}");
                return Err(e);
            }
        };
        log::info!(
            "auth: login successful — user {} (id {}, admin = {})",
            login.user_email,
            login.user_id,
            login.is_admin
        );
        let client = Self::with_auth(
            base_url,
            AuthMethod::Bearer(login.access_token.clone()),
            allow_insecure,
            pinned_cert,
        )?;
        Ok((client, login))
    }

    /// Fetch the server's leaf certificate (DER) from a fresh handshake, for
    /// trust-on-first-use pinning. Returns `None` if TLS info is unavailable
    /// (e.g. a plain-HTTP server, or the request failed).
    pub async fn capture_peer_cert(&self) -> Option<Vec<u8>> {
        let resp = self.http.get(self.url("/api/server/ping")).send().await.ok()?;
        let info = resp.extensions().get::<reqwest::tls::TlsInfo>()?;
        info.peer_certificate().map(|der| der.to_vec())
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

    /// `GET /api/server/features` (no auth) — discovers optional capabilities
    /// such as OAuth/SSO. Used by the "Detect SSO" check before deciding to
    /// offer the full OAuth login flow.
    pub async fn server_features(&self) -> Result<ServerFeatures> {
        let resp = self
            .http
            .get(self.url("/api/server/features"))
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json().await?)
    }

    /// `GET /api/users/me` — validates the current auth credentials.
    pub async fn me(&self) -> Result<UserResponse> {
        let resp = self
            .authed(self.http.get(self.url("/api/users/me")))
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(anyhow!("invalid credentials"));
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
                    is_admin: false,
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
                is_admin: user.is_admin,
                insecure,
                message: "Connected".into(),
            },
            Err(e) => ConnectionInfo {
                reachable: true,
                authenticated: false,
                version,
                user_email: None,
                is_admin: false,
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
    ) -> std::result::Result<Vec<BulkCheckResultItem>, ApiError> {
        if items.is_empty() {
            return Ok(vec![]);
        }
        let req = BulkCheckRequest { assets: items };
        let resp = self
            .authed(self.http.post(self.url("/api/assets/bulk-upload-check")))
            .json(&req)
            .send()
            .await?;
        let resp = status_checked(resp)?;
        let body: BulkCheckResponse = resp.json().await.map_err(ApiError::from)?;
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
        live_photo_video_id: Option<&str>,
        sidecar: Option<&Path>,
    ) -> std::result::Result<AssetUploadResponse, ApiError> {
        let metadata = tokio::fs::metadata(path)
            .await
            .map_err(|e| ApiError::Other(format!("cannot stat {}: {e}", path.display())))?;
        let total = metadata.len();
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| ApiError::Other("invalid file name".into()))?
            .to_string();

        let mime = mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string();

        let now = std::time::SystemTime::now();
        let modified = chrono::DateTime::<chrono::Utc>::from(
            metadata.modified().unwrap_or(now),
        )
        .to_rfc3339();
        let created = chrono::DateTime::<chrono::Utc>::from(
            metadata.created().or_else(|_| metadata.modified()).unwrap_or(now),
        )
        .to_rfc3339();

        // Stream the file: throttle and report progress per chunk.
        let file = tokio::fs::File::open(path)
            .await
            .map_err(|e| ApiError::Other(format!("open {}: {e}", path.display())))?;
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
            .mime_str(&mime)
            .map_err(ApiError::from)?;

        let device_asset_id = format!("{file_name}-{}", total);

        let mut form = multipart::Form::new()
            .text("deviceAssetId", device_asset_id)
            .text("deviceId", device_id.to_string())
            .text("fileCreatedAt", created)
            .text("fileModifiedAt", modified)
            .text("isFavorite", "false")
            .part("assetData", part);

        // Link the paired video of a Live Photo.
        if let Some(vid) = live_photo_video_id {
            form = form.text("livePhotoVideoId", vid.to_string());
        }

        // Attach an XMP sidecar (metadata) if one was found next to the file.
        if let Some(sc) = sidecar {
            if let Ok(bytes) = tokio::fs::read(sc).await {
                let sc_name = sc
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("sidecar.xmp")
                    .to_string();
                let sc_part = multipart::Part::bytes(bytes)
                    .file_name(sc_name)
                    .mime_str("application/xml")
                    .map_err(ApiError::from)?;
                form = form.part("sidecarData", sc_part);
            }
        }

        let resp = self
            .authed(self.http.post(self.url("/api/assets")))
            .header("x-immich-checksum", sha1_hex)
            .multipart(form)
            .send()
            .await?;
        let resp = status_checked(resp)?;
        resp.json().await.map_err(ApiError::from)
    }

    /// `POST /api/albums` — create a new (empty) album.
    pub async fn create_album(&self, name: &str) -> Result<Album> {
        let resp = self
            .authed(self.http.post(self.url("/api/albums")))
            .json(&serde_json::json!({ "albumName": name }))
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json().await?)
    }

    /// `GET /api/albums`.
    pub async fn albums(&self) -> Result<Vec<Album>> {
        let resp = self
            .authed(self.http.get(self.url("/api/albums")))
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
        let path = format!("/api/albums/{}/assets", encode_path_segment(album_id));
        self.authed(self.http.put(self.url(&path)))
            .json(&serde_json::json!({ "ids": asset_ids }))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    /// `DELETE /api/albums/{id}/assets` — remove assets from an album.
    pub async fn remove_from_album(&self, album_id: &str, asset_ids: &[String]) -> Result<()> {
        if asset_ids.is_empty() {
            return Ok(());
        }
        let path = format!("/api/albums/{}/assets", encode_path_segment(album_id));
        self.authed(self.http.delete(self.url(&path)))
            .json(&serde_json::json!({ "ids": asset_ids }))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    /// `POST /api/search/metadata` — one page of the asset timeline/grid.
    /// `asset_type` filters to `"IMAGE"` or `"VIDEO"` (None = both). `size` is
    /// clamped to the server max of 250.
    pub async fn search_assets(
        &self,
        page: u32,
        size: u32,
        asset_type: Option<&str>,
    ) -> Result<MetadataSearchResponse> {
        let mut body = serde_json::json!({
            "page": page,
            "size": size.min(250),
            "withExif": false,
            "isArchived": false,
            "isTrashed": false,
        });
        if let Some(t) = asset_type {
            body["type"] = serde_json::Value::String(t.to_string());
        }
        let resp = self
            .authed(self.http.post(self.url("/api/search/metadata")))
            .json(&body)
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json().await?)
    }

    /// `GET /api/assets/{id}/thumbnail?size=` — the upstream response, so the
    /// caller can read the Content-Type Immich actually returned (webp/jpeg, and
    /// occasionally the original for formats Immich doesn't transcode) before
    /// pulling the bytes. `size` is `"thumbnail"`, `"preview"`, or `"full"`.
    pub async fn thumbnail(&self, asset_id: &str, size: &str) -> Result<reqwest::Response> {
        let path = format!(
            "/api/assets/{}/thumbnail?size={}",
            encode_path_segment(asset_id),
            encode_path_segment(size),
        );
        Ok(self
            .authed(self.http.get(self.url(&path)))
            .send()
            .await?
            .error_for_status()?)
    }

    /// `GET /api/albums/{id}` — an album with its assets, for "open album".
    pub async fn album_assets(&self, album_id: &str) -> Result<AlbumAssetsResponse> {
        let path = format!("/api/albums/{}", encode_path_segment(album_id));
        let resp = self
            .authed(self.http.get(self.url(&path)))
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json().await?)
    }

    /// `GET /api/assets/{id}/original` — streaming download response; the
    /// caller streams the body to the destination file.
    pub async fn download_asset(&self, asset_id: &str) -> Result<reqwest::Response> {
        let path = format!("/api/assets/{}/original", encode_path_segment(asset_id));
        Ok(self
            .authed(self.http.get(self.url(&path)))
            .send()
            .await?
            .error_for_status()?)
    }
}

/// Encode raw SHA1 bytes as Base64 (for bulk-upload-check).
pub fn sha1_to_base64(sha1_bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(sha1_bytes)
}

/// True if the host in `base_url` is an IP literal (v4 or v6). Used to decide
/// whether to relax TLS hostname checking when pinning (IP certs can't carry a
/// matching hostname). Unparseable URLs fall back to `true` (lenient), matching
/// the prior behavior.
fn host_is_ip(base_url: &str) -> bool {
    match reqwest::Url::parse(base_url) {
        Ok(u) => match u.host_str() {
            // Strip IPv6 brackets, then try to parse as an IP address.
            Some(h) => h
                .trim_start_matches('[')
                .trim_end_matches(']')
                .parse::<std::net::IpAddr>()
                .is_ok(),
            None => true,
        },
        Err(_) => true,
    }
}

/// Percent-encode a single URL path segment, keeping only RFC 3986 unreserved
/// characters. Defense-in-depth for server-supplied ids placed into a path
/// (a normal UUID passes through unchanged).
fn encode_path_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_is_ip_detects_literals() {
        assert!(host_is_ip("https://192.168.1.5:2283"));
        assert!(host_is_ip("http://127.0.0.1"));
        assert!(host_is_ip("https://[::1]:2283"));
        assert!(!host_is_ip("https://immich.example.com"));
        assert!(!host_is_ip("https://nas.local:2283"));
    }

    #[test]
    fn encode_path_segment_passes_uuids_and_escapes_separators() {
        let uuid = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        assert_eq!(encode_path_segment(uuid), uuid);
        // Path-breaking characters are escaped.
        assert_eq!(encode_path_segment("a/b"), "a%2Fb");
        assert_eq!(encode_path_segment("../x"), "..%2Fx");
        assert_eq!(encode_path_segment("a b?c#d"), "a%20b%3Fc%23d");
    }
}

/// Colon-separated, uppercase SHA-256 fingerprint of a DER certificate — the
/// same format browsers/`openssl` show, for displaying a pinned cert to the user.
pub fn cert_fingerprint(der: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(der);
    digest
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}
