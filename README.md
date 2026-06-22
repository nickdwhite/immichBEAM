# Immich SyncDesk

A lightweight, cross-platform desktop sync client for [Immich](https://immich.app/).
It lives in the system tray, watches local folders, and automatically uploads new
photos and videos to your Immich server — much like the Google Drive or Dropbox
desktop apps.

Built with **Tauri 2**, **React 19 + TypeScript**, and a **Rust** backend.

## Features (MVP)

- System tray with dynamic status (idle / syncing / paused / offline) and a
  quick-action menu (pause/resume, open dashboard, open web UI, quit).
- Minimize-to-tray on window close; optional launch-on-login.
- Recursive folder watching with debounced filesystem events.
- SHA1 content hashing with an SQLite hash cache for deduplication.
- Server-side duplicate detection via `bulk-upload-check` before upload.
- Durable upload queue that survives restarts, with retries + exponential backoff
  and auto-resume on reconnect.
- Configurable concurrency and bandwidth throttling.
- Streaming uploads with live per-file and overall progress; only new/changed
  files are processed (synced files are skipped via the hash cache).
- API key stored in the OS keychain (read once per launch, cached in memory).
- Optional "disable TLS verification" for self-signed servers (clearly labeled).
- **Free Up Space**: trash local files already safely backed up (verified by
  checksum), with a background scan and batched, silent OS-trash move.
- **Dashboard** grouped into Activity (Overview / Queue / History / Errors),
  Settings (Server / Folders / Sync), and Tools (Free Up Space / Diagnostics /
  About): live queue, per-folder albums, file-type filters, queue repair/clear,
  upload history, error log with retry, log viewer, and in-app updates.
- First-run onboarding, toast feedback, light/dark/system theme, and a
  keyboard-accessible UI.
- In-app **auto-update** (Tauri updater) and CI that packages macOS, Windows,
  and Linux installers (see `docs/`).

## Project layout

```
src/                  React frontend (components, hooks, lib/tauri.ts)
src-tauri/src/
  api/                Immich API client + types
  sync/               engine, watcher, queue, hasher
  commands.rs         Tauri IPC commands
  config.rs           persisted settings (JSON)
  db.rs               SQLite: hash cache, queue, history
  keychain.rs         OS keychain access for the API key
  tray.rs             system tray menu + events
  lib.rs              app setup, plugin + state wiring
```

## Prerequisites

- [Rust](https://rustup.rs/) (stable) and the platform's Tauri build
  dependencies — see https://tauri.app/start/prerequisites/.
- Node 18+ and **pnpm** (`npm i -g pnpm`).
- Linux only: the keychain uses Secret Service, so `libsecret` must be present
  (`libsecret-1-dev` on Debian/Ubuntu).

## Develop

```bash
pnpm install
pnpm tauri dev
```

## Build installers

```bash
pnpm tauri build
```

Produces `.dmg` (macOS), `.msi`/NSIS (Windows), and `.deb`/`.AppImage` (Linux).

## First run

1. Open the dashboard from the tray.
2. **Server** tab → enter your server URL (e.g. `http://192.168.2.119:2283`) and
   an Immich API key (Account Settings → API Keys), then **Test Connection** and
   **Save**.
3. **Folders** tab → add one or more folders to watch.
4. New and existing media is hashed, de-duplicated, and uploaded automatically;
   watch progress in the **Queue** tab.

## Notes

- Auto-update (`tauri-plugin-updater`) is scaffolded but disabled; enable it by
  adding a signing key to `tauri.conf.json` and re-adding `updater:default` to
  `src-tauri/capabilities/default.json`.
- This project was rebuilt fresh from `IMPLEMENTATION_PLAN.md`. The earlier
  `immich-syncdesk-handoff/` bundle and `immich-syncdesk-handoff.zip` at the repo
  root are superseded and can be deleted.
