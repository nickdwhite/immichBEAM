//! Detects removable media (USB drives, SD cards) and scans for DCIM folders.
//!
//! Platform-specific:
//! - macOS: polls `/Volumes` for new mounts (DiskArbitration requires CFRunLoop
//!   which is cumbersome in async Rust; polling /Volumes every 5 s is simpler
//!   and reliable).
//! - Linux: polls `/media/$USER` and `/run/media/$USER`.
//! - Windows: polls drive letters A-Z for removable drives.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// A removable volume that contains a DCIM folder.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DetectedMedia {
    pub volume_name: String,
    pub dcim_path: String,
}

/// Monitors for removable media and calls `on_detected` when a new volume with
/// a DCIM folder appears. Dropping the handle stops monitoring.
pub struct RemovableMonitor {
    alive: Arc<AtomicBool>,
}

impl Drop for RemovableMonitor {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Relaxed);
    }
}

impl RemovableMonitor {
    pub fn start<F>(on_detected: F) -> Self
    where
        F: Fn(DetectedMedia) + Send + 'static,
    {
        let alive = Arc::new(AtomicBool::new(true));
        let a = alive.clone();
        std::thread::Builder::new()
            .name("removable-monitor".into())
            .spawn(move || monitor_loop(a, on_detected))
            .expect("spawn removable monitor");
        Self { alive }
    }
}

fn monitor_loop<F>(alive: Arc<AtomicBool>, on_detected: F)
where
    F: Fn(DetectedMedia) + Send + 'static,
{
    let mut known: HashSet<PathBuf> = HashSet::new();

    // Seed with currently-mounted volumes so we don't fire on startup.
    for vol in list_volumes() {
        known.insert(vol);
    }

    while alive.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_secs(5));
        if !alive.load(Ordering::Relaxed) {
            break;
        }

        let current = list_volumes();
        for vol in &current {
            if known.contains(vol) {
                continue;
            }
            log::info!("new volume detected: {}", vol.display());
            let dcim = vol.join("DCIM");
            if dcim.is_dir() {
                let name = vol
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| vol.to_string_lossy().to_string());
                on_detected(DetectedMedia {
                    volume_name: name,
                    dcim_path: dcim.to_string_lossy().to_string(),
                });
            }
        }

        // Update known set: add new, remove ejected.
        known = current.into_iter().collect();
    }
}

#[cfg(target_os = "macos")]
fn list_volumes() -> Vec<PathBuf> {
    let volumes = PathBuf::from("/Volumes");
    match std::fs::read_dir(&volumes) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .collect(),
        Err(_) => Vec::new(),
    }
}

#[cfg(target_os = "linux")]
fn list_volumes() -> Vec<PathBuf> {
    let user = std::env::var("USER").unwrap_or_default();
    let mut dirs = Vec::new();
    for base in &[
        format!("/media/{user}"),
        format!("/run/media/{user}"),
    ] {
        if let Ok(entries) = std::fs::read_dir(base) {
            for e in entries.flatten() {
                dirs.push(e.path());
            }
        }
    }
    dirs
}

#[cfg(target_os = "windows")]
fn list_volumes() -> Vec<PathBuf> {
    let mut drives = Vec::new();
    for letter in b'D'..=b'Z' {
        let root = PathBuf::from(format!("{}:\\", letter as char));
        if root.exists() {
            drives.push(root);
        }
    }
    drives
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn list_volumes() -> Vec<PathBuf> {
    Vec::new()
}
