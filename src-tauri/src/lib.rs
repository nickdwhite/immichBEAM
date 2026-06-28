//! Immich Beam — Tauri application entry point and setup.

mod api;
mod commands;
mod config;
mod db;
mod keychain;
mod sync;
mod tray;
mod updater;

use tauri::{Listener, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use crate::config::AppConfig;
use crate::db::Db;
use crate::sync::engine::EVT_STATUS;
use crate::sync::SyncEngine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin: if a second copy is launched, focus the
        // existing window instead of starting another engine/watcher.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("immich-beam".to_string()),
                    }),
                ])
                .max_file_size(5_000_000)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(updater::PendingUpdate::default())
        .setup(|app| {
            let handle = app.handle().clone();

            // Keep the title bar in sync with the running version, e.g.
            // "immich-beam v0.1.0", regardless of what's baked into
            // tauri.conf.json at build time.
            if let Some(window) = app.get_webview_window("main") {
                let version = app.package_info().version.to_string();
                let _ = window.set_title(&format!("immich-beam v{version}"));
            }

            // Load persisted config and open the database.
            let config = AppConfig::load().unwrap_or_default();
            let db = Db::open_default().expect("failed to open database");

            // Create and register the sync engine.
            let engine = SyncEngine::new(handle.clone(), config, db);
            app.manage(engine.clone());

            // Build the system tray.
            if let Err(e) = tray::build_tray(&handle) {
                log::error!("failed to build tray: {e}");
            }

            // Keep the tray label in sync with engine status.
            {
                let handle = handle.clone();
                app.listen(EVT_STATUS, move |event| {
                    if let Ok(value) =
                        serde_json::from_str::<serde_json::Value>(event.payload())
                    {
                        if let Some(icon) = value.get("icon").and_then(|s| s.as_str()) {
                            let pending =
                                value.get("pending").and_then(|p| p.as_i64()).unwrap_or(0);
                            let uploaded_session = value
                                .get("uploaded_session")
                                .and_then(|u| u.as_u64())
                                .unwrap_or(0);
                            tray::update_status_label(&handle, icon, pending, uploaded_session);
                        }
                    }
                });
            }

            // Start the engine (watcher + worker loop).
            let engine_start = engine.clone();
            tauri::async_runtime::spawn(async move {
                engine_start.start().await;
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Minimize to tray instead of quitting when the window is closed.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::test_connection,
            commands::check_server_features,
            commands::save_server,
            commands::save_config,
            commands::add_folder,
            commands::remove_folder,
            commands::clear_api_key,
            commands::login_with_password,
            commands::clear_credentials,
            commands::get_status,
            commands::get_connection_info,
            commands::get_cert_fingerprint,
            commands::forget_cert_pin,
            commands::default_extensions,
            commands::get_log_path,
            commands::read_log,
            commands::get_queue,
            commands::get_failed,
            commands::get_history,
            commands::clear_history,
            commands::pause_sync,
            commands::resume_sync,
            commands::retry_failed,
            commands::retry_item,
            commands::get_stats,
            commands::rescan,
            commands::repair_queue,
            commands::clear_queue,
            commands::inspect_folder,
            commands::get_albums,
            commands::create_album,
            commands::reorganize_albums,
            commands::suggest_folders,
            commands::export_log,
            commands::purge_old_logs,
            commands::start_freeable_scan,
            commands::get_freeable_state,
            commands::free_space,
            updater::check_for_update,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Immich Beam");
}
