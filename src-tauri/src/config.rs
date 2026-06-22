//! Persistent application configuration.
//!
//! Non-secret settings are stored as JSON under the OS config dir. The API key
//! is *never* written here — it lives in the OS keychain (see `keychain` module).

use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

const APP_DIR: &str = "immich-dock";
const CONFIG_FILE: &str = "config.json";

/// A single folder watched for new media.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchedFolder {
    pub path: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Optional album id that uploads from this folder are added to.
    #[serde(default)]
    pub album_id: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Base URL of the Immich server, e.g. `http://192.168.2.119:2283`.
    #[serde(default)]
    pub server_url: String,

    /// When true, the app trusts a self-signed/invalid server cert. On the first
    /// successful HTTPS connect it captures and pins that exact certificate
    /// (`pinned_cert`); afterwards only that certificate is accepted (TOFU),
    /// so a later in-path attacker presenting a different cert is rejected.
    #[serde(default)]
    pub allow_insecure: bool,

    /// Base64-encoded DER of the pinned server certificate (trust-on-first-use).
    /// Set automatically; cleared to re-trust a new cert. Never a secret.
    #[serde(default)]
    pub pinned_cert: Option<String>,

    #[serde(default)]
    pub folders: Vec<WatchedFolder>,

    /// Glob patterns of file types to include (empty = all media).
    #[serde(default = "default_include")]
    pub include_extensions: Vec<String>,

    /// Max simultaneous uploads.
    #[serde(default = "default_concurrency")]
    pub concurrency: u32,

    /// Bandwidth cap in KB/s, 0 = unlimited.
    #[serde(default)]
    pub bandwidth_limit_kbps: u32,

    /// Launch the app automatically on login.
    #[serde(default)]
    pub autostart: bool,

    /// Stable per-install device id reported to Immich.
    #[serde(default)]
    pub device_id: String,

    /// Whether syncing is currently paused by the user.
    #[serde(default)]
    pub paused: bool,

    /// Verbose per-file debug logging.
    #[serde(default)]
    pub debug_logging: bool,

    /// Show desktop notifications (e.g. on permanent upload failures).
    #[serde(default = "default_true")]
    pub notifications_enabled: bool,
}

/// The full set of asset extensions Immich accepts (images + videos), mirroring
/// the server's `mime-types.ts`. Sidecars (`.xmp`) are intentionally excluded
/// since they are not standalone assets.
fn default_include() -> Vec<String> {
    [
        // RAW formats
        "3fr", "ari", "arw", "cap", "cin", "cr2", "cr3", "crw", "dcr", "dng", "erf", "fff", "iiq",
        "k25", "kdc", "mrw", "nef", "nrw", "orf", "ori", "pef", "psd", "raf", "raw", "rw2", "rwl",
        "sr2", "srf", "srw", "x3f",
        // Other images
        "avif", "bmp", "gif", "jpeg", "jpg", "png", "webp", "heic", "heif", "hif", "insp", "jp2",
        "jpe", "jxl", "mpo", "svg", "tif", "tiff",
        // Videos
        "3gp", "3gpp", "avi", "flv", "insv", "m2t", "m2ts", "m4v", "mkv", "mov", "mp4", "mpe",
        "mpeg", "mpg", "mts", "mxf", "ts", "vob", "webm", "wmv",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

fn default_concurrency() -> u32 {
    3
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            allow_insecure: false,
            pinned_cert: None,
            folders: Vec::new(),
            include_extensions: default_include(),
            concurrency: default_concurrency(),
            bandwidth_limit_kbps: 0,
            autostart: false,
            device_id: generate_device_id(),
            paused: false,
            debug_logging: false,
            notifications_enabled: true,
        }
    }
}

impl AppConfig {
    /// Directory holding config + database, created if missing.
    pub fn app_dir() -> Result<PathBuf> {
        let dir = dirs::config_dir()
            .context("could not resolve OS config directory")?
            .join(APP_DIR);
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("creating {}", dir.display()))?;
        Ok(dir)
    }

    pub fn config_path() -> Result<PathBuf> {
        Ok(Self::app_dir()?.join(CONFIG_FILE))
    }

    /// Load from disk, or return defaults if the file does not exist.
    pub fn load() -> Result<Self> {
        let path = Self::config_path()?;
        if !path.exists() {
            let cfg = Self::default();
            cfg.save()?;
            return Ok(cfg);
        }
        let raw = std::fs::read_to_string(&path)
            .with_context(|| format!("reading {}", path.display()))?;
        let mut cfg: AppConfig =
            serde_json::from_str(&raw).context("parsing config.json")?;
        if cfg.device_id.is_empty() {
            cfg.device_id = generate_device_id();
        }
        Ok(cfg)
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::config_path()?;
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, json).with_context(|| format!("writing {}", path.display()))?;
        Ok(())
    }

    /// Returns true if `path` matches the include-extension filter.
    pub fn matches_filter(&self, path: &std::path::Path) -> bool {
        if self.include_extensions.is_empty() {
            return true;
        }
        match path.extension().and_then(|e| e.to_str()) {
            Some(ext) => {
                let ext = ext.to_lowercase();
                self.include_extensions.iter().any(|e| e.to_lowercase() == ext)
            }
            None => false,
        }
    }
}

fn generate_device_id() -> String {
    let host = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "unknown-host".into());
    format!("dock-{host}-{}", uuid::Uuid::new_v4())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn filter_matches_by_extension_case_insensitively() {
        let mut cfg = AppConfig::default();
        cfg.include_extensions = vec!["jpg".into(), "mp4".into()];
        assert!(cfg.matches_filter(Path::new("/a/b/photo.JPG")));
        assert!(cfg.matches_filter(Path::new("/a/b/clip.mp4")));
        assert!(!cfg.matches_filter(Path::new("/a/b/notes.txt")));
        assert!(!cfg.matches_filter(Path::new("/a/b/no_extension")));
    }

    #[test]
    fn empty_filter_allows_everything() {
        let mut cfg = AppConfig::default();
        cfg.include_extensions.clear();
        assert!(cfg.matches_filter(Path::new("/a/b/anything.xyz")));
    }
}
