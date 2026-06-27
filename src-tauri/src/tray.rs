//! System tray icon, menu, and event wiring.

use anyhow::Result;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

use crate::sync::SyncEngine;

/// Managed handle to the disabled "Status:" menu item so we can update its
/// text on status changes (the tray exposes no menu getter to look it up).
struct StatusMenuItem<R: Runtime>(MenuItem<R>);

const ID_STATUS: &str = "status";
const ID_PAUSE: &str = "pause";
const ID_RESUME: &str = "resume";
const ID_DASHBOARD: &str = "dashboard";
const ID_WEB: &str = "web";
const ID_QUIT: &str = "quit";

/// Build the tray icon and attach menu + click handlers.
pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let status = MenuItem::with_id(app, ID_STATUS, "Status: starting…", false, None::<&str>)?;
    let pause = MenuItem::with_id(app, ID_PAUSE, "Pause syncing", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, ID_RESUME, "Resume syncing", true, None::<&str>)?;
    let dashboard = MenuItem::with_id(app, ID_DASHBOARD, "Open Dashboard", true, None::<&str>)?;
    let web = MenuItem::with_id(app, ID_WEB, "Open Web UI", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Quit Immich Beam", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &status, &sep1, &pause, &resume, &dashboard, &web, &sep2, &quit,
        ],
    )?;

    // Keep a handle to the status item so status updates can rewrite its text.
    app.manage(StatusMenuItem(status.clone()));

    let initial_icon = tauri::image::Image::from_bytes(state_icon_bytes("disconnected"))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(initial_icon)
        .icon_as_template(false)
        .tooltip("Immich Beam")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| handle_menu_event(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            // Left-click toggles the dashboard window.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_dashboard(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        ID_PAUSE => set_paused(app, true),
        ID_RESUME => set_paused(app, false),
        ID_DASHBOARD => show_dashboard(app),
        ID_WEB => open_web_ui(app),
        ID_QUIT => app.exit(0),
        _ => {}
    }
}

fn set_paused<R: Runtime>(app: &AppHandle<R>, paused: bool) {
    if let Some(engine) = app.try_state::<SyncEngine>() {
        let engine = engine.inner().clone();
        tauri::async_runtime::spawn(async move {
            engine.set_paused(paused).await;
        });
    }
}

fn show_dashboard<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn open_web_ui<R: Runtime>(app: &AppHandle<R>) {
    if let Some(engine) = app.try_state::<SyncEngine>() {
        let engine = engine.inner().clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let url = engine.current_config().await.server_url;
            if !url.is_empty() {
                let _ = app.opener().open_url(url, None::<&str>);
            }
        });
    }
}

/// Raw PNG bytes for each tray icon key (compiled into the binary).
fn state_icon_bytes(icon: &str) -> &'static [u8] {
    match icon {
        "syncing" => include_bytes!("../icons/states/tray-syncing.png"),
        "paused" => include_bytes!("../icons/states/tray-paused.png"),
        "insecure" => include_bytes!("../icons/states/tray-insecure.png"),
        "secure" => include_bytes!("../icons/states/tray-secure.png"),
        _ => include_bytes!("../icons/states/tray-disconnected.png"),
    }
}

/// Human-readable tooltip suffix for each icon key.
fn icon_tooltip(icon: &str) -> &'static str {
    match icon {
        "syncing" => "Syncing",
        "paused" => "Paused",
        "insecure" => "Connected (insecure HTTP)",
        "secure" => "Connected (secure)",
        _ => "Not connected",
    }
}

/// The "Status: …" line shown at the top of the tray menu, including queue
/// depth so a quick right-click tells you what the app is doing.
fn status_menu_label(icon: &str, pending: i64) -> String {
    let body = match icon {
        "syncing" if pending > 0 => format!("Syncing — {pending} left"),
        "syncing" => "Syncing".to_string(),
        "paused" => "Paused".to_string(),
        "insecure" if pending > 0 => format!("Connected (insecure) — {pending} queued"),
        "insecure" => "Connected (insecure)".to_string(),
        "secure" if pending > 0 => format!("Connected — {pending} queued"),
        "secure" => "Up to date".to_string(),
        _ => "Not connected".to_string(),
    };
    format!("Status: {body}")
}

/// Update the tray icon, tooltip, and the "Status:" menu line in response to a
/// status change. `icon` is the icon key from `SyncStatus` (not the raw state).
pub fn update_status_label<R: Runtime>(app: &AppHandle<R>, icon: &str, pending: i64) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(format!("Immich Beam — {}", icon_tooltip(icon))));
        if let Ok(image) = tauri::image::Image::from_bytes(state_icon_bytes(icon)) {
            let _ = tray.set_icon(Some(image));
        }
    }
    // Refresh the disabled "Status:" line in the menu.
    if let Some(item) = app.try_state::<StatusMenuItem<R>>() {
        let _ = item.0.set_text(status_menu_label(icon, pending));
    }
}
