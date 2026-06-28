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

/// Selected fields from `GET /api/server/features` (unauthenticated). Used to
/// discover whether the server advertises optional auth methods like OAuth/SSO.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ServerFeatures {
    #[serde(rename = "oauth", default)]
    pub oauth: bool,
    #[serde(rename = "passwordLogin", default)]
    pub password_login: bool,
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

/// Response of `POST /api/auth/login`.
#[derive(Debug, Clone, Deserialize)]
pub struct LoginResponse {
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "userEmail")]
    pub user_email: String,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "isAdmin", default)]
    pub is_admin: bool,
}

/// Result of validating a server connection, surfaced to the UI.
#[derive(Debug, Clone, Serialize)]
pub struct ConnectionInfo {
    pub reachable: bool,
    pub authenticated: bool,
    pub version: Option<String>,
    pub user_email: Option<String>,
    /// True when the signed-in account is an Immich administrator.
    pub is_admin: bool,
    /// True when the server URL uses plain HTTP.
    pub insecure: bool,
    pub message: String,
}

// ---- Remote browser (download direction) -------------------------------

/// A minimal asset representation for the remote browser, returned by
/// `POST /api/search/metadata` and `GET /api/albums/{id}`. Optional fields use
/// `#[serde(default)]` so forward-compatible server additions don't break
/// decoding; we render only what's modeled here.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BrowseAsset {
    pub id: String,
    /// "IMAGE" | "VIDEO" (Immich uses the `type` field, renamed here).
    #[serde(rename = "type", default)]
    pub asset_type: String,
    #[serde(rename = "originalFileName", default)]
    pub original_file_name: Option<String>,
    #[serde(rename = "originalMimeType", default)]
    pub original_mime_type: Option<String>,
    #[serde(rename = "fileCreatedAt", default)]
    pub file_created_at: Option<String>,
    /// Base64-encoded placeholder rendered behind a tile while its thumbnail loads.
    #[serde(default)]
    pub thumbhash: Option<String>,
    /// Video duration string, e.g. "0:00:12.34500" (absent for images).
    #[serde(default)]
    pub duration: Option<String>,
    #[serde(rename = "isFavorite", default)]
    pub is_favorite: bool,
    #[serde(rename = "livePhotoVideoId", default)]
    pub live_photo_video_id: Option<String>,
}

/// One page of search results (the `assets` block of the search response).
#[derive(Debug, Clone, Deserialize, Default)]
pub struct SearchAssetPage {
    #[serde(default)]
    pub items: Vec<BrowseAsset>,
    /// Cursor token for the next page (None when exhausted). The browser drives
    /// numeric `page` primarily; this is an additional end-of-results signal.
    #[serde(rename = "nextPage", default)]
    pub next_page: Option<String>,
    #[serde(default)]
    pub total: Option<u64>,
}

/// `POST /api/search/metadata` response. Only the `assets` block is consumed.
#[derive(Debug, Clone, Deserialize)]
pub struct MetadataSearchResponse {
    #[serde(default)]
    pub assets: SearchAssetPage,
}

/// `GET /api/albums/{id}` response, trimmed to what the browser needs.
#[derive(Debug, Clone, Deserialize)]
pub struct AlbumAssetsResponse {
    #[serde(default)]
    pub assets: SearchAssetPage,
    #[serde(rename = "albumName", default)]
    pub album_name: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_search_response_decodes() {
        let json = r#"{
            "albums": {"total": 0, "count": 0, "items": [], "nextPage": null},
            "assets": {
                "total": 2,
                "count": 2,
                "items": [
                    {"id": "a1", "type": "IMAGE", "originalFileName": "cat.jpg",
                     "fileCreatedAt": "2024-01-02T03:04:05.000Z", "isFavorite": true},
                    {"id": "v1", "type": "VIDEO", "originalFileName": "clip.mov",
                     "duration": "0:00:05.00000", "thumbhash": "AA=="}
                ],
                "nextPage": "CURSOR"
            }
        }"#;
        let resp: MetadataSearchResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.assets.items.len(), 2);
        assert_eq!(resp.assets.items[0].asset_type, "IMAGE");
        assert!(resp.assets.items[0].is_favorite);
        assert_eq!(resp.assets.items[1].asset_type, "VIDEO");
        assert_eq!(
            resp.assets.items[1].duration.as_deref(),
            Some("0:00:05.00000")
        );
        assert_eq!(resp.assets.next_page.as_deref(), Some("CURSOR"));
    }

    #[test]
    fn browse_asset_tolerates_missing_fields() {
        let json = r#"{"id": "x"}"#;
        let a: BrowseAsset = serde_json::from_str(json).unwrap();
        assert_eq!(a.id, "x");
        assert_eq!(a.asset_type, "");
        assert!(!a.is_favorite);
        assert!(a.duration.is_none());
    }
}
