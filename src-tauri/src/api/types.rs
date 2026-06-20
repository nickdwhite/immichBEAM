//! Request/response types for the Immich API (v2.7.5).
//! Only the subset needed for the sync upload flow is modeled here.

use serde::{Deserialize, Serialize};

/// Response of `GET /api/server/ping`.
#[derive(Debug, Clone, Deserialize)]
pub struct PingResponse {
    pub res: String,
}

/// Response of `GET /api/server/version`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ServerVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl std::fmt::Display for ServerVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// Response of `GET /api/users/me`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UserResponse {
    pub id: String,
    pub email: String,
    pub name: String,
    #[serde(rename = "isAdmin", default)]
    pub is_admin: bool,
}

/// One entry in the `POST /api/assets/bulk-upload-check` request.
#[derive(Debug, Clone, Serialize)]
pub struct BulkCheckItem {
    /// Arbitrary client-side id used to correlate the response.
    pub id: String,
    /// Base64-encoded SHA1 checksum of the asset.
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BulkCheckRequest {
    pub assets: Vec<BulkCheckItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)] // `id` and `reason` are part of the API response shape.
pub struct BulkCheckResultItem {
    pub id: String,
    /// Either "accept" or "reject".
    pub action: String,
    /// Present when `action == "reject"`, e.g. "duplicate".
    #[serde(default)]
    pub reason: Option<String>,
    /// Existing asset id when the file is a duplicate.
    #[serde(rename = "assetId", default)]
    pub asset_id: Option<String>,
    /// True when the server's copy is currently in the trash.
    #[serde(rename = "isTrashed", default)]
    pub is_trashed: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BulkCheckResponse {
    pub results: Vec<BulkCheckResultItem>,
}

/// Response of `POST /api/assets` (multipart upload).
#[derive(Debug, Clone, Deserialize)]
pub struct AssetUploadResponse {
    pub id: String,
    /// "created" | "duplicate" | "replaced"
    pub status: String,
}

/// A minimal album representation from `GET /api/albums`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Album {
    pub id: String,
    #[serde(rename = "albumName")]
    pub album_name: String,
    #[serde(rename = "assetCount", default)]
    pub asset_count: u32,
}

/// Result of validating a server connection, surfaced to the UI.
#[derive(Debug, Clone, Serialize)]
pub struct ConnectionInfo {
    pub reachable: bool,
    pub authenticated: bool,
    pub version: Option<String>,
    pub user_email: Option<String>,
    /// True when the server URL uses plain HTTP.
    pub insecure: bool,
    pub message: String,
}
