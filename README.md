# Immich Dock

A lightweight, cross-platform desktop sync client for [Immich](https://immich.app/).
It lives in the system tray, watches local folders, and automatically uploads new
photos and videos to your Immich server — much like the Google Drive or Dropbox
desktop apps.

Built with **Tauri 2**, **React 19 + TypeScript**, and a **Rust** backend.

## Features

- System tray with dynamic, connection-aware status (offline / insecure /
  secure / syncing / paused) and a quick-action menu (pause/resume, open
  dashboard, open web UI, quit). The tray label shows live queue depth.
- Minimize-to-tray on window close; optional launch-on-login; single-instance
  (a second launch focuses the existing window).
- Recursive folder watching with debounced filesystem events.
- SHA1 content hashing (with a hashing-progress phase for large files) and an
  SQLite hash cache so only new/changed files are processed.
- Server-side duplicate detection via `bulk-upload-check` before upload.
- Durable upload queue that survives restarts, with retries + exponential
  backoff and auto-resume on reconnect, plus a typed error classifier.
- Configurable concurrency and bandwidth throttling.
- Streaming uploads with live per-file and overall progress.
- **Live Photos** (same-named still + video are paired and linked) and **XMP
  sidecars** (`name.xmp` / `name.ext.xmp`) attached on upload.
- Per-folder **albums**, with uploaded assets batched into album adds.
- Content sniffing for ambiguous extensions (e.g. `.ts` = MPEG-TS vs
  TypeScript), recorded in history with a reason.
- **Free Up Space**: trash local files already safely backed up (verified by
  checksum + not server-trashed), with a background scan and a batched, silent
  OS-trash move. Only scan-confirmed paths can be trashed.
- **Security**: API key stored only in the OS keychain (read once, cached in
  memory, never written to disk or logged); least-privilege IPC capabilities;
  trust-on-first-use **certificate pinning** for self-signed servers (captures
  and pins the cert on first connect, then trusts only that one).
- **Dashboard** grouped into Activity (Overview / Queue / History), Settings
  (Server / Folders / Sync), and Tools (Free Up Space / Diagnostics / About):
  live queue, per-folder albums, file-type filters, queue repair/clear, upload
  history with status filtering and per-row retry, and a log viewer.
- First-run onboarding, toast feedback, light/dark/system theme, and a
  keyboard-accessible UI.
- In-app **auto-update** (Tauri updater, minisign-signed) and CI that packages
  macOS, Windows, and Linux installers (see `docs/RELEASING.md`).

Built on an r2d2 SQLite connection pool (WAL) and reqwest 0.13. See
`docs/SECURITY_REVIEW.md` for the security posture and `CHANGELOG.md` for
release history.

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

- Auto-update is fully wired (Rust-side, no extra IPC capability). To activate
  it for releases, generate a minisign key, set `plugins.updater.pubkey` and the
  Releases `endpoint` in `tauri.conf.json`, and add the private key as a GitHub
  Actions secret. Step-by-step in `docs/RELEASING.md`.
- The app icon and tray icons are generated from `src-tauri/icons/logo-master.png`
  via `src-tauri/icons/generate_logo.py` and `generate_state_icons.py`, then
  `pnpm tauri icon`.
