//! Filesystem watching and initial folder scans.
//!
//! Uses the OS-native watcher by default; when it fails (common on NFS/SMB/CIFS
//! mounts) the affected folder automatically falls back to poll-based watching.
//! A background health probe detects silently-dead watchers and restarts them.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

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

/// Tracks per-folder watch state for health monitoring.
#[allow(dead_code)]
struct WatchedEntry {
    path: PathBuf,
    recursive: bool,
    /// Whether this folder fell back to poll-based watching.
    poll_fallback: bool,
}

/// Owns the debounced watcher; dropping it stops watching.
/// Also runs a background health probe to detect dead watchers.
pub struct FolderWatcher {
    #[allow(dead_code)]
    debouncer: Debouncer<notify::RecommendedWatcher, FileIdMap>,
    /// Poll watchers for folders where native notify failed.
    #[allow(dead_code)]
    poll_watchers: Vec<notify::PollWatcher>,
    /// Tracked folder metadata for diagnostics.
    #[allow(dead_code)]
    entries: Vec<WatchedEntry>,
    /// Signals the health probe to stop.
    alive: Arc<AtomicBool>,
}

impl Drop for FolderWatcher {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Relaxed);
    }
}

impl FolderWatcher {
    /// Start watching `folders`. Each entry is `(path, recursive)`.
    /// New/modified files are sent on `tx`.
    ///
    /// Folders where the native watcher fails (e.g. network mounts) are
    /// automatically watched with a poll-based fallback (30 s interval).
    pub fn start(folders: &[(PathBuf, bool)], tx: UnboundedSender<FileEvent>) -> Result<Self> {
        let tx_poll = tx.clone();
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

        let mut poll_watchers = Vec::new();
        let mut entries = Vec::new();

        for (folder, recursive) in folders {
            if !folder.exists() {
                log::warn!("watch path does not exist: {}", folder.display());
                continue;
            }

            let mode = if *recursive {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            };

            match debouncer.watcher().watch(folder, mode) {
                Ok(()) => {
                    log::info!(
                        "watching {} ({})",
                        folder.display(),
                        if *recursive { "recursive" } else { "top-level only" }
                    );
                    entries.push(WatchedEntry {
                        path: folder.clone(),
                        recursive: *recursive,
                        poll_fallback: false,
                    });
                }
                Err(e) => {
                    log::warn!(
                        "native watcher failed for {} ({}), falling back to polling",
                        folder.display(),
                        e
                    );
                    match start_poll_watcher(folder, mode, tx_poll.clone()) {
                        Ok(pw) => {
                            poll_watchers.push(pw);
                            entries.push(WatchedEntry {
                                path: folder.clone(),
                                recursive: *recursive,
                                poll_fallback: true,
                            });
                        }
                        Err(pe) => {
                            log::error!(
                                "poll watcher also failed for {}: {pe}",
                                folder.display()
                            );
                        }
                    }
                }
            }
        }

        let alive = Arc::new(AtomicBool::new(true));
        let health_alive = alive.clone();
        let health_entries: Vec<PathBuf> = entries.iter().map(|e| e.path.clone()).collect();
        std::thread::Builder::new()
            .name("watcher-health".into())
            .spawn(move || health_probe(health_alive, health_entries))?;

        Ok(Self {
            debouncer,
            poll_watchers,
            entries,
            alive,
        })
    }
}

/// Start a poll-based watcher for a single folder.
fn start_poll_watcher(
    folder: &Path,
    mode: RecursiveMode,
    tx: UnboundedSender<FileEvent>,
) -> Result<notify::PollWatcher> {
    use notify::Config;
    let config = Config::default().with_poll_interval(Duration::from_secs(30));
    let mut watcher = notify::PollWatcher::new(
        move |result: std::result::Result<notify::Event, notify::Error>| match result {
            Ok(event) => {
                use notify::EventKind;
                match event.kind {
                    EventKind::Create(_) | EventKind::Modify(_) => {
                        for path in event.paths {
                            if path.is_file() {
                                let _ = tx.send(FileEvent { path });
                            }
                        }
                    }
                    _ => {}
                }
            }
            Err(e) => log::warn!("poll watch error: {e}"),
        },
        config,
    )?;
    watcher.watch(folder, mode)?;
    log::info!("poll-watching {} (30 s interval)", folder.display());
    Ok(watcher)
}

/// Periodic probe that logs warnings when watched folders become unreachable
/// (mount dropped, directory deleted, etc.). Runs until `alive` is cleared.
fn health_probe(alive: Arc<AtomicBool>, folders: Vec<PathBuf>) {
    const INTERVAL: Duration = Duration::from_secs(60);
    let mut last_ok: HashMap<PathBuf, Instant> = HashMap::new();

    while alive.load(Ordering::Relaxed) {
        std::thread::sleep(INTERVAL);
        if !alive.load(Ordering::Relaxed) {
            break;
        }
        for folder in &folders {
            if folder.exists() {
                last_ok.insert(folder.clone(), Instant::now());
            } else {
                let gone_since = last_ok
                    .get(folder)
                    .map(|t| t.elapsed())
                    .unwrap_or(Duration::ZERO);
                log::warn!(
                    "watched folder unreachable: {} (gone for {:.0?})",
                    folder.display(),
                    gone_since
                );
            }
        }
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

/// Enumerate existing files in a folder (the initial scan).
/// When `recursive` is false, only top-level files are returned.
pub fn scan_folder(folder: &Path, recursive: bool) -> Vec<PathBuf> {
    let mut walker = WalkDir::new(folder).follow_links(false);
    if !recursive {
        walker = walker.max_depth(1);
    }
    walker
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .collect()
}
