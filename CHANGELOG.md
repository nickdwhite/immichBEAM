# Changelog

All notable changes to Immich Beam are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

## [0.3.8] - 2026-06-28

### Added

- **Configurable watcher settings** — new Advanced section in Sync Settings for
  poll interval (NFS/SMB fallback), health probe interval, debounce window,
  max upload retries, and follow-symlinks toggle.
- **Bandwidth picker redesign** — slider stepping through common presets
  (Unlimited → 100 MB/s) with a clickable value label that opens an inline
  editor with KB/s ↔ MB/s unit selector for custom limits.
- **File size in History** — each history row shows the file size as a compact
  badge; hovering the filename includes the size in the tooltip. Backed by a new
  `size` column in `upload_history`, backfilled from cached file hashes.
- **Database rename** — `dock.db` (legacy "Immich Dock" branding) is
  automatically migrated to `immich-beam.db` on first launch, including WAL/SHM
  sidecar files.

### Fixed

- **History migration** — existing history rows keyed by UUID are re-keyed to
  file paths using `uploaded_assets` and `file_hashes` tables, with fallback
  matching by filename.

## [0.3.7] - 2026-06-28

### Added

- **Log viewer rewrite** — structured log parsing with level filtering (Error /
  Warn / Info / Debug), category toggle chips (Sync, Watcher, API, Queue, Hash,
  Cleanup, Config, DB), text search, and colorized output. Multi-line log entries
  are properly grouped. Reads 2000 lines (up from 500).
- **Log export** — save filtered log output to a file via native save dialog.
- **Log retention settings** — configurable `log_retention_days` (default 30,
  0 = keep forever) under Sync Settings → Diagnostics, with a "Purge now" button
  that deletes rotated log files older than the retention period.
- **History file links** — hovering a filename in History shows the full file
  path. A folder icon reveals the file in Finder; a link icon opens the asset on
  the Immich server (when an asset ID is available).
- **Album dropdown context** — when album mode is Device or Folder, per-folder
  dropdowns show the auto-assigned album name (e.g. "Auto: EIQMBP16") instead of
  "No album". Selecting a specific album overrides auto mode for that folder.
- **Device name display** — the Album Organization description now shows the
  actual device name when Device mode is selected.
- Section dividers and tooltips across all settings pages, toolbar buttons, and
  sidebar section headers.
- Expanded About page with GitHub repository link and organized sections.
- TODO items for multi-server support, diagnostics/logging improvements, and
  backup/restore.

### Fixed

- **History IDs stored file path instead of UUID** — history entries for
  successful, duplicate, unsupported, failed, and skipped uploads now store the
  full file path as the ID, enabling the "reveal in Finder" and tooltip features.
- **Device album name** — stripped domain suffix from hostname (e.g.
  `host.local` → `host`) for cleaner album names on the Immich server.
- Sidebar still said "Immich Dock" in one place — fixed to "Immich Beam".
- Server URL placeholder changed from a specific IP to `http://your-server:2283`.

## [0.3.6] - 2026-06-28

### Added

- **Album reconciliation** — changing a folder's assigned album now bulk-moves
  already-uploaded assets (adds to the new album, removes from the old). A new
  `uploaded_assets` table tracks path → asset id → album id for reconciliation.
- **"Reorganize into albums" button** — re-applies current album assignments to
  previously-uploaded assets that aren't yet in their target album (additive,
  matching the Immich mobile app's behavior).
- **Album organization modes** — a global setting at the top of the Folders tab:
  - **Off** (default): manual per-folder album dropdowns only.
  - **Device**: all uploads go to one album named after this computer's hostname.
  - **Folder**: each watched folder creates/finds an album by its basename.
  A folder's explicit album dropdown always overrides the mode. Mode switch
  affects future uploads only; use "Reorganize" to backfill existing assets.
- **Shared `isServerConfigured()` helper** — replaces three inline copies of the
  `server_url + (api_key OR password)` check, preventing regressions.
- `ImmichClient::remove_from_album` — `DELETE /api/albums/{id}/assets` for bulk
  removal (used by album reconciliation).

### Fixed

- `LoginResponse` doc comment referenced wrong endpoint (`/auth/login` →
  `/api/auth/login`).
- `authTab` state in ServerSettings could desync from `config.auth_method` after
  disconnecting (added `useEffect` sync).

## [0.3.1] - 2026-06-22

The "immich-beam" release: a full rebrand plus a round of features, security
hardening, and dependency cleanup on top of the initial client.

### Added

- **Live Photos** — a same-named still + video are detected, the video is
  uploaded first and linked to the still via `livePhotoVideoId`, and the video's
  own queue item is deferred.
- **XMP sidecars** — a sibling `name.xmp` or `name.ext.xmp` is attached as
  `sidecarData` on upload.
- **Batched album additions** — uploaded assets are queued in a durable
  `pending_album` table and added in batched PUTs (≤250 ids) once enough
  accumulate or the queue goes idle. Idempotent and crash-safe.
- **Single-instance guard** — launching a second copy focuses the existing
  window instead of starting another engine.
- **History upgrades** — status filtering, filename search, "Clear history", and
  per-row **Retry**; the standalone Errors view was folded in.
- **Hashing-phase progress** for large files, and a tray status line that shows
  live queue depth.
- Content sniffing for ambiguous extensions (`.ts` = MPEG-TS vs TypeScript),
  recorded in history with a reason.
- Light / dark / system theme toggle, in-app toasts, first-run onboarding, and
  window size/position persistence.

### Changed

- **Rebranded** from "Immich SyncDesk" to **Immich Beam** — name, bundle
  identifier (`com.immichdock.desktop`), keychain service, app-data dir, logs,
  and user agent.
- **New logo & icons** — a blue cloud + photo-swirl + sync-arrows mark; a
  macOS-style squircle app icon, cloud-shaped status tray icons, and a
  theme-matched blue / orange / navy color palette.
- **SQLite connection pool** — `r2d2` + `r2d2_sqlite` (WAL, `busy_timeout`)
  replaces the single mutex-guarded connection, so status/history/cache reads run
  concurrently with uploads.
- **reqwest 0.12 → 0.13** — matches Tauri's stack so only one copy is compiled;
  cert pinning now uses `tls_certs_only` (trusts only the pinned cert).

### Security

- **Trust-on-first-use certificate pinning** — in insecure mode the server's
  leaf certificate is captured and pinned on first connect; afterwards only that
  exact certificate is trusted. Hostname checking is relaxed only for IP-literal
  servers. Server Settings shows the SHA-256 fingerprint with a "Forget &
  re-trust" action; changing the server URL drops a stale pin.
- Removed five unused Tauri plugins (`store`, `fs`, `http`, `shell`, `process`)
  to shrink the attack and supply-chain surface.
- Tightened the production Content-Security-Policy (a separate dev CSP keeps Vite
  HMR working) and dropped the unused `opener:allow-open-path` capability.
- Percent-encode server-supplied `album_id` in URL paths; log basenames rather
  than absolute paths at the default level.
- Full assessment in `docs/SECURITY_REVIEW.md` (no Critical/High findings).

### Fixed

- Tray "Status:" menu line now updates live (was stuck on "starting…").
- Log viewer repaints correctly when toggling theme in WKWebView.

## [0.1.0]

Initial client: system-tray sync engine with recursive folder watching, SHA1
hash cache + server-side dedup, a durable retrying upload queue with bandwidth
limits and streaming progress, per-folder albums, "Free Up Space", a grouped
dashboard, OS-keychain API-key storage, in-app auto-update wiring, and CI +
release workflows for macOS / Windows / Linux.

[0.3.7]: https://github.com/nickdwhite/immich-beam/releases/tag/v0.3.7
[0.3.6]: https://github.com/nickdwhite/immich-beam/releases/tag/v0.3.6
[0.3.1]: https://github.com/nickdwhite/immich-beam/releases/tag/v0.3.1
[0.1.0]: https://github.com/nickdwhite/immich-beam/releases/tag/v0.1.0
