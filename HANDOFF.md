# HANDOFF

Last updated: 2026-06-28

## Repo and branch state

- Local repo path: `/Users/ndw-eiq/Downloads/projects/immich-syncdesk`
- App name: **Immich Beam** (package/folder still `immich-syncdesk`, intentionally unchanged)
- Version: `0.3.8` (`tauri.conf.json`, `Cargo.toml`, `package.json`)
- Base branch: `main` @ `52d6bf4` ("Bump version to 0.3.8"), in sync with `origin/main`
- **Active branch: `feat/remote-browser`** — created off `main` for the new feature below.
- Not yet pushed (no remote tracking branch exists yet).
- Working tree status: clean except an untracked `.claude/` directory (carried over, harmless).
- GitHub repo: `nickdwhite/immich-beam` — <https://github.com/nickdwhite/immich-beam>
- Git remote: `origin https://github.com/nickdwhite/immich-beam.git`
- GitHub CLI (`gh`) installed + authenticated for `nickdwhite` (HTTPS). Do not store/paste any token into the repo or docs.

## What this branch is for

**New feature: a Remote Immich Photo Browser.**

Immich Beam today is a **one-way upload client** (local → server). Every existing
view — Overview, Queue, History, Free Up Space, Server, Folders, Sync,
Diagnostics, About — is about pushing files *up*. This feature adds the opposite
direction: browsing and downloading photos that already live *on* the server.

This is a genuinely new direction; it is **not** in `docs/TODO.md`'s roadmap. It
will be developed on this branch and PR'd back to `main` when ready.

### Agreed scope (first cut)

Grid + albums + search + download:
- Paginated thumbnail **grid** of server assets (timeline).
- **Albums** browsing (reuse existing `GET /api/albums`).
- **Search** (filename / metadata).
- **Lightbox** full-size view.
- **Download** original to disk.

Thumbnail-delivery mechanism (base64 command vs custom URI scheme) is **deferred
to plan mode** — see "Open design decision" below.

## What this project is (durable context)

Cross-platform Tauri v2 + React 19 + Rust desktop sync client for Immich
(self-hosted photo server). Rust sync engine (streaming uploads, SHA1 hash cache
in SQLite, TOFU cert pinning, file watcher via notify, Live Photo pairing, XMP
sidecars, free-up-space). React frontend with a sectioned sidebar.

- Manual-update mode is intentional (private repo can't serve anonymous feeds):
  `IN_APP_UPDATES_ENABLED = false` in `src/lib/release.ts`; updater
  pubkey/endpoint in `tauri.conf.json` are placeholders.
- Secrets: only release-signing values (`TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) are relevant; see `docs/RELEASE_SECRETS.md`.
  Immich API key / password live in the OS **keychain**, not in `.env`.

## Integration points for the new feature

Verified against the current tree — these are exactly where the browser wires in:

**Frontend**
- Navigation: `Tab` union + `SECTIONS` in `src/components/Sidebar.tsx:21,38`.
- Render switch + titles: `src/App.tsx:22` (`TITLES`) and `src/App.tsx:172` (the
  `{tab === "x" && <X/>}` block).
- IPC wrappers: `api` + `events` in `src/lib/tauri.ts:28,113`.
- Shared types: `src/types.ts`.
- Gate the view on the server being configured, like the rest of the app:
  `isServerConfigured()` in `src/lib/config.ts`.

**Backend (Rust)**
- `ImmichClient` — `src-tauri/src/api/client.rs`. Has an `authed()` header helper
  (line 162) covering both `ApiKey` and `Bearer` auth, so new browse methods drop
  in alongside the existing `albums()` / `me()` methods with no new auth plumbing.
- DTOs: `src-tauri/src/api/types.rs`.
- Commands: `src-tauri/src/commands.rs`. Commands reach the live client via
  `State<'_, SyncEngine>` (engine owns the client; `get_albums` is the closest
  existing template).
- Registration: add new commands to the `tauri::generate_handler![...]` list in
  `src-tauri/src/lib.rs:115`.

**Immich server endpoints needed (confirmed from the project's own research notes
+ OpenAPI; don't re-research)**
- `POST /api/search/metadata` — `{ page, size, withExif }` →
  `{ assets: { items: [AssetResponseDto…], nextPage } }`. The timeline/grid source.
- `GET /api/assets/{id}/thumbnail?size=preview|thumbnail` — JPEG bytes (auth req'd).
- `GET /api/assets/{id}/original` — original file bytes (download).
- `GET /api/albums` already wrapped (`ImmichClient::albums`, `api.getAlbums`).

## Open design decision (resolve in plan mode)

**How thumbnails reach the webview** — shapes the whole component layer:

| | A. Base64 command | B. Custom URI scheme |
|---|---|---|
| Effort | Small | Medium |
| Perf (large grid) | Poor (~33% bloat, 1 invoke/tile) | Good (webview-cached) |
| Auth | ApiKey + Bearer, trivially | Header injected in Rust handler |

Lean: start with **A** (matches existing IPC patterns, fastest to a working
grid), structure the component so **B** is a drop-in swap later.

## Useful commands

```bash
pnpm build                      # tsc && vite build  (frontend typecheck + build)
npx tsc --noEmit
cargo test                      # from src-tauri/
cargo clippy --no-deps --all-targets   # passes with known pre-existing warnings
pnpm tauri dev                  # run the app (frontend :1420, Rust hot-rebuild)
gh pr create --base main --head feat/remote-browser   # when ready to PR
```
