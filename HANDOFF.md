# HANDOFF

Last updated: 2026-06-28

## Repo and GitHub state

- Local repo path: `/Users/ndw-eiq/Downloads/projects/immich-syncdesk`
- App name: **Immich Beam** (renamed from Immich Dock on 2026-06-27)
- Package/folder name: `immich-syncdesk` (intentionally unchanged)
- Version: `0.3.6` (`tauri.conf.json`, `Cargo.toml`, `package.json`)
- Current branch: `main`
- Current HEAD: `5ee32dd` (`Add album organization modes (off/device/folder)`)
- Working tree status at handoff: **clean** (all changes committed and pushed)
- GitHub repo: `nickdwhite/immich-beam` — <https://github.com/nickdwhite/immich-beam>
- Visibility: `PRIVATE` · Default branch: `main`
- Git remote: `origin https://github.com/nickdwhite/immich-beam.git`
- GitHub CLI (`gh` 2.95.0) installed + authenticated for `nickdwhite` (HTTPS). Do not store/paste any token into the repo or docs.

## What this project is

Cross-platform Tauri v2 + React 19 + Rust desktop sync client for Immich (self-hosted photo server). Rust sync engine (streaming uploads, SHA1 hash cache in SQLite, TOFU cert pinning, file watcher via notify, Live Photo pairing, XMP sidecars, free-up-space). React frontend with multiple views (Overview, Folders, History, Server, Sync, Diagnostics, About). CI on Linux x64+ARM and Windows x64+ARM; release workflow on macOS universal, Windows x64+ARM, Linux x64+ARM.

## What shipped this arc (all on `main`, all CI green)

Original goal (Ubuntu ARM release) was already resolved before this session and verified live; this session's work:

- `4cb617b` **Username/password (JWT bearer) authentication** — `ImmichClient` holds an `AuthMethod` enum (`ApiKey`|`Bearer`) with a shared `authed()` header helper; all `x-api-key` sites migrated. `ImmichClient::login()` → `POST /api/auth/login`. Keychain entries + helpers in `keychain.rs`. `AuthMethodConfig` + `auth_method` on `AppConfig`. `login_with_password` + `clear_credentials` IPC. ServerSettings rewritten with API-Key / Email-Password tabs.
- `f09ad8d` Rewrite HANDOFF + mark username/password auth done in TODO.
- `b860ac7` **Bearer-token refresh on auth errors** — on a 401/403 with password auth, `SyncEngine::try_refresh_login` re-logs in from stored credentials, persists the new token via `keychain::set_login_token`, swaps the live client. Serialized (`refresh_lock`) + throttled (≥20s). Both auth-error sites in `process_one` use `on_auth_error`. Cleared the `set_login_token` dead-code warning.
- `a485510` **Auth UX polish + admin status** — `is_admin` added to `ConnectionInfo`, populated from `/api/users/me` and `LoginResponse`; "admin" pill in ServerSettings; "Test Session" button (validates the bearer session); login-failure toast. Cleared the `user_id`/`is_admin` dead-code warning.
- `5c6f253` **SSO/OAuth capability detection (detect-only)** — `ServerFeatures` DTO (`oauth`, `passwordLogin`), `ImmichClient::server_features()` (`GET /api/server/features`), `check_server_features` command, "Detect SSO" button in ServerSettings. Groundwork for the full OAuth flow.
- `2e1be29` **Fix password login endpoint** — was POSTing to `/auth/login` instead of `/api/auth/login` (Immich mounts everything under `/api`), so login 404'd regardless of credentials.
- `b3d4542` **Auth diagnostics logging + full error chain** — `login()` logs at every stage (attempt, endpoint, response status, 401, decode, success) with `{:#}` formatting so the full anyhow cause chain prints. `login_with_password` maps errors with `format!("{e:#}")` so the UI shows the real cause, not just "login request failed".
- `23f717a` **Load albums + advance onboarding for password auth** — album loading/creation and the onboarding checklist were gated on `config.has_api_key` (always false for password users). Fixed with the `isConfigured` check (server_url + (api_key OR password)) in `FolderSettings` and `Onboarding`.
- `b0606d7` **Album reconciliation + shared `isServerConfigured` helper** — `uploaded_assets(path, asset_id, album_id)` table for path→asset tracking; `record_uploaded` in `process_one`; `reconcile_folder_album` on reassign (bulk add/remove, batched at 250); `reorganize_albums` command + frontend button; `remove_from_album` client method; shared `isServerConfigured()` helper replacing 3 inline copies.
- `5ee32dd` **Album organization modes (off/device/folder)** — `AlbumMode` enum with `#[derive(Default)]`; `album_mode` + `device_album_id` config fields; mode-aware `album_for_path` resolver with precedence (explicit > device > folder > off); lazy `resolve_album_by_name` with in-memory cache; segmented control in FolderSettings.

### Verified live against a real server
Password login confirmed working against `http://192.168.2.119:2283` (user is admin). Diagnostics emit correctly to stdout + `~/Library/Logs/com.immichbeam.desktop/immich-beam.log`.

## Current release/update posture

Manual-update mode (intentional — private repo can't serve anonymous update feeds):
- `IN_APP_UPDATES_ENABLED = false` in `src/lib/release.ts`.
- Reflected in `src/lib/release.ts`, `src/components/About.tsx`, `docs/RELEASE_SECRETS.md`, `docs/RELEASING.md`, `README.md`.
- Updater pubkey/endpoint in `src-tauri/tauri.conf.json` are placeholders; only needed if moving off manual mode.
- Optional future: macOS notarization, Windows code-signing (not wired).

## Secrets

Only release-signing values are relevant; tracked example `.env.release.local.example`, explained in `docs/RELEASE_SECRETS.md`:
- `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (placeholders, not in repo).
- The Immich API key / password live in the OS keychain, NOT in `.env`. The app does not load `.env` at runtime.

## Completed this arc — Album reconciliation + organization modes (v0.3.6)

Both stages shipped on `main`, each committed green (`tsc` + `cargo test` + `clippy`):

- **Stage 1** (`b0606d7`): `uploaded_assets` table, `record_uploaded`/`assets_for_folder`/`update_uploaded_album` in db.rs, `remove_from_album` client method, engine reconciliation on folder album reassign, `reorganize_albums` command + frontend button, shared `isServerConfigured()` helper.
- **Stage 2** (`5ee32dd`): `AlbumMode` enum (off/device/folder), config fields (`album_mode`, `device_album_id`), mode-aware `album_for_path` resolver, lazy `resolve_album_by_name` with cache, segmented control in FolderSettings.tsx.

## Critical research findings (don't re-research these)

Confirmed from Immich `main` source + OpenAPI spec:
1. **Immich v3 has NO device tracking.** `deviceId`/`deviceAssetId`, the `x-immich-device-id` header, and `/api/devices` were all **removed**. The "devices" in the web UI are auth **sessions** (login browser/OS), not upload sources. There is **no server-side way** to query "assets uploaded by client X." Our `beam-<uuid>` device id is **client-side only** — don't send it expecting server grouping.
2. **The mobile app does NOT auto-create albums per folder by default.** Per-folder albums are an opt-in, **mobile-only** "Album Sync" setting (exact-name match/merge, one-way, with a "Reorganize into album" backfill button). External Libraries have no auto-album. ⇒ Our `album_mode` defaults to `off` to match.
3. **Album reconciliation must use our local DB** (path→asset_id), since the server can't answer it. Useful server endpoints we're not yet using: `PUT /api/albums/assets` (bulk add many→many), `DELETE /api/albums/{id}/assets` (bulk remove), `POST /api/search/metadata` with `isNotInAlbum:true`.
4. **OAuth loopback flow** (designed, not built — see TODO §7): `POST /api/oauth/authorize` (needs `cookies` feature on reqwest) → system browser → loopback `TcpListener` captures `code&state` → `POST /api/oauth/callback` `{url}` replaying cookies → `LoginResponse`. Deferred until an OAuth-configured server is confirmed.

## Known limitations / follow-ups

1. **OAuth full flow not built** — detect-only is in place; full loopback flow deferred.
2. **Clippy: 7 individual warnings, all pre-existing** (ConflictPolicy/AuthMethodConfig Default-derive style, `upload_asset` 9-arg count, `Default::default()` field assignment, manual `is_multiple_of`, `io::Error::other`, `u64` cast). Consistent with the project's "clippy passes with warnings" tolerance.

## Useful commands

```bash
# Frontend + backend checks
pnpm build                      # tsc && vite build
npx tsc --noEmit
cargo test                     # from src-tauri/  (29 tests)
cargo clippy --no-deps --all-targets

# Run the app (hot-reload; frontend on :1420, Rust rebuilds on src-tauri changes)
pnpm tauri dev

# Live logs (macOS): stdout in the terminal that ran `pnpm tauri dev`, plus
tail -f ~/Library/Logs/com.immichbeam.desktop/immich-beam.log

# GitHub Actions
gh run list --repo nickdwhite/immich-beam --limit 10
gh workflow run Release --repo nickdwhite/immich-beam
gh run watch --repo nickdwhite/immich-beam <run-id>

# Cut a tagged release
git tag v0.3.5
git push origin v0.3.5
```

## Suggested next objective

1. **OAuth full loopback flow** (if a server with SSO is available) — detect-only is in place; see `docs/TODO.md §7 OAuth`.
2. Or pick another roadmap item from `docs/TODO.md`.
