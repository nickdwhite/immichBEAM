//! Content hashing with an SQLite-backed cache.

use std::path::Path;

use anyhow::{Context, Result};
use sha1::{Digest, Sha1};
use tokio::io::AsyncReadExt;

/// Computed hash plus the file stats used to key the cache.
pub struct FileHash {
    /// Hex-encoded SHA1 (used for the `x-immich-checksum` header).
    pub sha1_hex: String,
    /// Raw SHA1 bytes (used to build the Base64 bulk-check checksum).
    pub sha1_bytes: Vec<u8>,
    pub size: i64,
    pub mtime: i64,
}

/// Stream a file through SHA1 without loading it fully into memory.
pub async fn hash_file(path: &Path) -> Result<FileHash> {
    hash_file_with_progress(path, |_, _| {}).await
}

/// Like `hash_file`, but invokes `on_progress(bytes_hashed, total)` as it reads,
/// so callers can show progress while hashing large files.
pub async fn hash_file_with_progress(
    path: &Path,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<FileHash> {
    let meta = tokio::fs::metadata(path)
        .await
        .with_context(|| format!("stat {}", path.display()))?;
    let size = meta.len() as i64;
    let total = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let mut file = tokio::fs::File::open(path)
        .await
        .with_context(|| format!("open {}", path.display()))?;
    let mut hasher = Sha1::new();
    let mut buf = vec![0u8; 1024 * 1024];
    let mut hashed = 0u64;
    loop {
        let n = file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        hashed += n as u64;
        on_progress(hashed, total);
    }
    let digest = hasher.finalize();
    Ok(FileHash {
        sha1_hex: hex_encode(&digest),
        sha1_bytes: digest.to_vec(),
        size,
        mtime,
    })
}

fn hex_encode(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(s, "{b:02x}");
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_encode_pads_and_lowercases() {
        assert_eq!(hex_encode(&[0x00, 0x0f, 0xff, 0xa5]), "000fffa5");
        assert_eq!(hex_encode(&[]), "");
    }

    #[tokio::test]
    async fn hashes_known_content() {
        // SHA1("abc") = a9993e364706816aba3e25717850c26c9cd0d89d
        let dir = std::env::temp_dir();
        let path = dir.join("immich_dock_hash_test.txt");
        tokio::fs::write(&path, b"abc").await.unwrap();
        let fh = hash_file(&path).await.unwrap();
        assert_eq!(fh.sha1_hex, "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(fh.size, 3);
        let _ = tokio::fs::remove_file(&path).await;
    }
}
