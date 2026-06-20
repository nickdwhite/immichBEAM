//! Filesystem watching and initial folder scans.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::Result;
use notify::{RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, FileIdMap};
use tokio::sync::mpsc::UnboundedSender;
use walkdir::WalkDir;

/// A change detected on disk that may warrant an upload.
#[derive(Debug, Clone)]
pub struct FileEvent {
    pub path: PathBuf,
}

/// Owns the debounced watcher; dropping it stops watching.
pub struct FolderWatcher {
    // Held to keep the watcher alive; dropping it stops watching.
    #[allow(dead_code)]
    debouncer: Debouncer<notify::RecommendedWatcher, FileIdMap>,
}

impl FolderWatcher {
    /// Start watching `folders`. New/modified files are sent on `tx`.
    pub fn start(folders: &[PathBuf], tx: UnboundedSender<FileEvent>) -> Result<Self> {
        let mut debouncer = new_debouncer(
            Duration::from_secs(2),
            None,
            move |result: notify_debouncer_full::DebounceEventResult| match result {
                Ok(events) => {
                    for ev in events {
                        forward_event(&ev, &tx);
                    }
                }
                Err(errors) => {
                    for e in errors {
                        log::warn!("watch error: {e}");
                    }
                }
            },
        )?;

        for folder in folders {
            if folder.exists() {
                debouncer
                    .watcher()
                    .watch(folder, RecursiveMode::Recursive)?;
                log::info!("watching {}", folder.display());
            } else {
                log::warn!("watch path does not exist: {}", folder.display());
            }
        }

        Ok(Self { debouncer })
    }
}

fn forward_event(ev: &DebouncedEvent, tx: &UnboundedSender<FileEvent>) {
    use notify::EventKind;
    match ev.kind {
        EventKind::Create(_) | EventKind::Modify(_) => {
            for path in &ev.paths {
                if path.is_file() {
                    let _ = tx.send(FileEvent { path: path.clone() });
                }
            }
        }
        _ => {}
    }
}

/// Recursively enumerate existing files in a folder (the initial scan).
pub fn scan_folder(folder: &Path) -> Vec<PathBuf> {
    WalkDir::new(folder)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .collect()
}
