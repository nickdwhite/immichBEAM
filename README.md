<p align="center">
  <img src="public/logo.png" width="120" alt="immichBEAM logo" />
</p>

<h1 align="center">immichBEAM</h1>

<p align="center">
  A cross-platform desktop sync client for <a href="https://immich.app">Immich</a>.<br/>
  Watches your folders, uploads automatically, and lets you browse your entire library — all from the system tray.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platforms" />
  <img src="https://img.shields.io/badge/built%20with-Tauri%202%20%2B%20React%2019%20%2B%20Rust-orange" alt="Built with" />
</p>

---

<p align="center">
  <img src="screenshots/overview.png" width="720" alt="Overview dashboard" />
</p>

## What it does

immichBEAM sits in your system tray and keeps your photos and videos backed up to your self-hosted [Immich](https://immich.app) server. Think Google Drive or Dropbox, but for your photo library.

- **Watch folders** and automatically upload new photos and videos
- **Browse your entire Immich library** — timeline, albums, people, places, and map
- **Smart search** with CLIP semantic search ("sunset at the beach")
- **System tray** with live status, pause/resume, and quick actions
- **Cross-platform** — macOS, Windows, and Linux

## Screenshots

<table>
  <tr>
    <td><img src="screenshots/browse.png" width="400" alt="Photo browser" /><br/><sub>Browse your library with filters, search, and smart search</sub></td>
    <td><img src="screenshots/lightbox.png" width="400" alt="Photo viewer" /><br/><sub>Full photo viewer with EXIF, GPS, download, and local path</sub></td>
  </tr>
  <tr>
    <td><img src="screenshots/folder.png" width="400" alt="Folder settings" /><br/><sub>Watch folders with per-folder album assignment</sub></td>
    <td><img src="screenshots/server.png" width="400" alt="Server settings" /><br/><sub>API key or email/password auth with certificate pinning</sub></td>
  </tr>
  <tr>
    <td><img src="screenshots/map.png" width="400" alt="Map view" /><br/><sub>Map view with clustered markers and hover previews</sub></td>
    <td align="center"><img src="screenshots/tray.png" width="280" alt="System tray menu" /><br/><sub>System tray with live status and quick actions</sub></td>
  </tr>
</table>

## Features

### Sync engine
- Recursive folder watching with debounced filesystem events
- SHA1 content hashing with an SQLite cache — only new/changed files are processed
- Server-side duplicate detection before upload
- Durable upload queue that survives restarts, with retries and exponential backoff
- Configurable upload concurrency and bandwidth throttling (global limit shared across all concurrent uploads)
- Streaming uploads with live per-file progress
- Live Photo pairing (still + video linked automatically)
- XMP sidecar support

### Library browser
- **Timeline** — infinite-scroll grid of your entire library
- **Albums** — browse, open, and filter album contents
- **People** — recognized faces; click to see their photos
- **Places** — browse by city
- **Map** — clustered markers with hover previews on a theme-aware map
- **Search** — filename search, quick filters (favorites, archive, not-in-album), tag filtering, and date ranges
- **Smart search** — CLIP semantic search when machine learning is enabled on the server
- **Lightbox** — full viewer with EXIF metadata, GPS coordinates, camera info, download, and local file path with Reveal in Finder

### Organization
- Per-folder album assignment (manual, by device name, or by folder name)
- Create albums and reorganize previously-uploaded assets
- Tag-based filtering with multi-select combobox

### Security
- Credentials stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) — never written to disk
- Trust-on-first-use **certificate pinning** for self-signed servers
- Least-privilege IPC capabilities
- Content Security Policy enforced

### Desktop integration
- System tray with connection-aware status icons and live queue depth
- Minimize-to-tray on close
- Launch on login
- Single-instance (second launch focuses the existing window)
- Light, dark, and system theme
- **Free Up Space** — safely trash local files already backed up (verified by checksum)
- Log viewer with level/category filtering and export

## Install

Download the latest release for your platform from [GitHub Releases](https://github.com/nickdwhite/immichBEAM/releases):

| Platform | Format |
|----------|--------|
| macOS | `.dmg` (universal) |
| Windows | `.msi` or `.exe` (NSIS) |
| Linux | `.deb` or `.AppImage` |

## Getting started

1. Launch immichBEAM — it appears in your system tray
2. Open the dashboard (click the tray icon or select **Open Dashboard**)
3. Go to **Server** — enter your Immich server URL and authenticate with an API key or email/password
4. Go to **Folders** — add folders to watch
5. Your photos start syncing automatically — monitor progress in **Overview** or **Queue**

## Build from source

### Prerequisites

- [Rust](https://rustup.rs/) (stable) and your platform's [Tauri dependencies](https://tauri.app/start/prerequisites/)
- Node 18+ and [pnpm](https://pnpm.io/)
- Linux: `libsecret-1-dev` (Debian/Ubuntu) for keychain support

### Development

```bash
pnpm install
pnpm tauri dev
```

### Build installers

```bash
pnpm tauri build
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri 2](https://tauri.app) |
| Frontend | React 19, TypeScript, Tailwind CSS |
| Backend | Rust (tokio, reqwest, rusqlite) |
| Database | SQLite with WAL mode and connection pooling |
| File watching | [notify](https://docs.rs/notify) with debouncing |

## Immich compatibility

Tested with Immich v2.x. Includes forward-compatibility shims for upcoming v3 API changes (visibility enum, duration format, search fields).

## License

MIT
