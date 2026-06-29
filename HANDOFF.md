# HANDOFF

Last updated: 2026-06-29

## Repo and branch state

- Local repo path: `/Users/ndw-eiq/Downloads/projects/immich-syncdesk`
- App name: **Immich Beam** (package/folder still `immich-syncdesk`, intentionally unchanged)
- Version: `0.3.8` (`tauri.conf.json`, `Cargo.toml`, `package.json`)
- **Active branch: `feat/remote-browser`** — ready to push + PR.
- GitHub repo: `nickdwhite/immich-beam` — <https://github.com/nickdwhite/immich-beam>
- Git remote: `origin https://github.com/nickdwhite/immich-beam.git`
- GitHub CLI (`gh`) installed + authenticated for `nickdwhite` (HTTPS).
- All commits unsigned (no `gpg` installed on this machine).

## What this branch adds

**Remote Immich Photo Browser** — a complete media browsing experience:

- **Timeline** — infinite-scroll grid with type filters (All/Photos/Videos).
- **Search** — filename search, smart/CLIP semantic search, quick filters
  (favorites/archive/not-in-album), tag dropdown, custom date calendar with
  presets (30d/90d/6mo/1yr).
- **Albums** — browse + open + client-side filter (type/extension/search) +
  render pagination for large albums.
- **People** — face grid; click → their photos; clickable People chips in the
  lightbox navigate to that person's photos.
- **Places** — city cards; click → photos in that city.
- **Map** — Leaflet + CartoDB theme-aware basemaps, clustered markers with
  hover-thumbnail previews, fit-all button.
- **Lightbox** — React portal (below header, no gap), theme-aware (light/dark),
  info panel (GPS, timezone, camera, EXIF, people, tags, status badges, rating,
  local path), download, server link, video autoplay toggle, Escape-to-close.
- **Custom URI scheme** (`immichasset://`) — Rust proxy that injects auth and
  serves thumbnails, video playback (Range passthrough), SVG originals, and
  person face thumbnails to the webview.
- **Version display** — dev builds show `0.3.8-dev (branch@commit*)`.
- **Content-filter fix** — `.mts`/`.m2ts`/`.cts` byte-sniffed to reject TS/text.

## Immich API version notes

The user's server is Immich v2.x (latest stable). The Immich `main` branch has
unreleased v3 changes. Key differences handled with dual-send shims:
- `duration`: v2 sends string `"0:00:12.34"`, v3 sends int ms → custom
  deserializer accepts both.
- `isArchived`/`isTrashed`: v3 replaced with `visibility` enum → both sent.
- `query`: v3 MetadataSearch removed it (use `originalFileName`) → both sent.
- `/api/search/explore`: no place data on v2 → Places uses `/api/search/cities`.
- `/api/search/map`: doesn't exist → Map uses `/api/map/markers`.

## Comprehensive review status

7 reviews completed (API audit, bundle size, race conditions, CSP, cross-platform,
accessibility, state management). All findings addressed or noted for follow-up.
See `.workspace/STATUS.md` for the full backlog.

## What this project is (durable context)

Cross-platform Tauri v2 + React 19 + Rust desktop sync client for Immich.
Rust sync engine (streaming uploads, SHA1 hash cache in SQLite, TOFU cert
pinning, file watcher, Live Photo pairing, XMP sidecars, free-up-space).
React frontend with a sectioned sidebar.

- Manual-update mode: `IN_APP_UPDATES_ENABLED = false` in `src/lib/release.ts`.
- Secrets: Immich API key / password in OS keychain, not in `.env`.
- Private cross-tool work queue: `.workspace/` (gitignored).

## Useful commands

```bash
pnpm build                          # tsc && vite build
npx tsc --noEmit
cargo test                          # from src-tauri/
cargo clippy --no-deps --all-targets
pnpm tauri dev                      # run the app
gh pr create --base main --head feat/remote-browser
```
