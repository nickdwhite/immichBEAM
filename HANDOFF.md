# HANDOFF

Last updated: 2026-06-27

## Repo and GitHub state

- Local repo path: `/Users/ndw-eiq/Downloads/projects/immich-syncdesk`
- App name: **Immich Beam** (renamed from Immich Dock on 2026-06-27)
- Package/folder name: `immich-syncdesk` (intentionally unchanged)
- Version: `0.3.5` (`tauri.conf.json`, `Cargo.toml`, `package.json`)
- Current branch: `main`
- Current HEAD: `4cb617b` (`Add username/password (JWT bearer) authentication`)
- Working tree status at handoff: clean (all changes committed and pushed)
- GitHub repo: `nickdwhite/immich-beam` — <https://github.com/nickdwhite/immich-beam>
- Visibility: `PRIVATE`
- Default branch: `main`
- Git remote: `origin https://github.com/nickdwhite/immich-beam.git`
- GitHub CLI (`gh` 2.95.0) is installed and authenticated for user `nickdwhite` (HTTPS). Do not store/paste any token into the repo or docs.

## What this project is

Cross-platform Tauri v2 + React 19 + Rust desktop sync client for Immich (self-hosted photo server). Rust sync engine (streaming uploads, SHA1 hash cache in SQLite, TOFU cert pinning, file watcher via notify, Live Photo pairing, XMP sidecars, free-up-space feature). React frontend with multiple views. CI on Linux x64+ARM and Windows x64+ARM; release workflow on macOS universal, Windows x64+ARM, Linux x64+ARM.

## What is done (all committed to main, all CI green)

### Release platform matrix — original goal, COMPLETE
- Ubuntu ARM AppImage failure (`xdg-open not found`) fixed by adding `xdg-utils` (`3064e0e`).
- Node 20 deprecation warnings silenced by bumping actions (`1f10df7`).
- Live Release run `28298680167` = **success**, all 5 lanes pass: macOS universal, ubuntu-24.04, **ubuntu-24.04-arm**, windows-latest, windows-11-arm.
- CI matrix covers frontend + Rust on ubuntu-24.04, ubuntu-24.04-arm, windows-latest, windows-11-arm (non-blocking).

### Project work shipped this arc
- `252d58c` Prepare private-repo release workflow (release-secret placeholders + docs, manual-update mode).
- `99c0ca7` Expand CI and release platform matrix (Ubuntu 24.04, Linux/Windows ARM64).
- `3064e0e` Add xdg-utils to Linux CI/release deps (fixes Ubuntu ARM AppImage).
- `1f10df7` Bump CI/release actions to silence Node 20 deprecation warnings.
- `d310347` Rebrand to Immich Beam and add feature roadmap (immich-dock → immich-beam across code/config/docs; GitHub repo renamed).
- `9d8d2e6` Implement feature roadmap and fix rename oversights (8 features, see `docs/TODO.md §7`).
- `3b7df01` Bump version to 0.3.5 and add auth features to roadmap.
- `4cb617b` Add username/password (JWT bearer) authentication.

### Feature roadmap items completed (docs/TODO.md §7)
Per-folder recursive toggle; bandwidth throttling; network share (NFS/SMB) poll-watcher fallback; watcher health monitoring; tray upload-progress tooltip; USB/SD card auto-detection; auto-detect media folders; drag-and-drop folder addition; conflict resolution policy.

### Authentication — NEW this session (`4cb617b`)
Username/password login as an alternative to API key:
- Backend: `ImmichClient` holds an `AuthMethod` enum (`ApiKey` | `Bearer`) with a shared `authed()` header helper; all `x-api-key` call sites migrated. `ImmichClient::login()` calls `POST /auth/login` and returns a Bearer-token client. `LoginResponse` DTO in `api/types.rs`.
- Keychain entries `login-email`/`login-password`/`login-token` with set/get/delete helpers in `keychain.rs` (`set_login_token` reserved for future refresh wiring).
- `AuthMethodConfig` enum + `auth_method` field on `AppConfig` (`config.rs`); `build_client()` in `sync/engine.rs` branches on it.
- IPC commands `login_with_password` and `clear_credentials`, registered in `lib.rs`.
- Frontend bindings in `src/lib/tauri.ts`; `AuthMethodConfig` TS type in `src/types.ts`; `ServerSettings.tsx` rewritten with API-Key / Email-Password tabs and login/logout flow.

Validated against `4cb617b`: `tsc --noEmit` clean, `cargo test` 28 passed, `cargo clippy --no-deps` warnings only, `pnpm build` clean, app launches under `pnpm tauri dev`.

## Current release/update posture

Manual-update mode (intentional):
- `IN_APP_UPDATES_ENABLED = false` in `src/lib/release.ts`.
- GitHub Releases in a private repo are not anonymously readable by shipped desktop clients, so in-app auto-update is disabled. Distribute installers via draft GitHub Releases.
- Reflected in: `src/lib/release.ts`, `src/components/About.tsx`, `docs/RELEASE_SECRETS.md`, `docs/RELEASING.md`, `README.md`.

## Secrets and placeholder status

Documented and wired into the release workflow (placeholders only — no real secrets in repo):
- `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — tracked example `.env.release.local.example`, explained in `docs/RELEASE_SECRETS.md`.
- Immich API key is NOT a repo secret — it lives in the OS keychain. The desktop app does not load a `.env` at runtime.

Not yet enabled for real auto-update (only needed if moving off manual mode):
- `plugins.updater.pubkey` and the updater endpoint in `src-tauri/tauri.conf.json`.

Optional future signing/notarization (not wired): macOS notarization, Windows code-signing.

## Known limitations / follow-ups

1. **JWT token refresh not wired.** When a bearer token expires (401), the app does not yet re-login automatically using the stored email/password. `keychain::set_login_token` is stubbed for this; the 401 → re-login path in `sync/engine.rs` is the next auth task. (Listed in `docs/TODO.md §7 Authentication`.)
2. **OAuth login not implemented.** Future TODO item; requires a browser authorization flow.
3. **Clippy emits warnings, no errors.** Notable new-code warnings: `keychain::set_login_token` is currently unused (reserved for refresh), and `LoginResponse` fields `user_id`/`is_admin` are deserialized but not yet read. Pre-existing warnings remain (ConflictPolicy Default derive style, `upload_asset` arg count, `Default::default()` field assignment, etc.). Consistent with the project's "clippy passes with warnings" tolerance.
4. **End-to-end login smoke test against a live Immich server has not been run by an agent.** The app builds, launches, and the code is symbol-consistent, but a real email/password login + sync cycle should be confirmed manually before tagging a release.

## Useful commands

```bash
# Frontend + backend checks
pnpm build                      # tsc && vite build
npx tsc --noEmit
cargo test                     # from src-tauri/
cargo clippy --no-deps --all-targets

# Run the app
pnpm tauri dev                 # hot-reload dev window (frontend on :1420)

# GitHub Actions
gh run list --repo nickdwhite/immich-beam --limit 10
gh workflow run Release --repo nickdwhite/immich-beam
gh run watch --repo nickdwhite/immich-beam <run-id>

# Cut a tagged release
git tag v0.3.5
git push origin v0.3.5
```

## Suggested next objective

1. **Confirm the username/password login end-to-end** against a real Immich server (run `pnpm tauri dev`, enter server URL + email/password, verify a sync cycle). Fix any runtime issues.
2. **Wire JWT token refresh** — on a 401 during a sync, re-login via the stored credentials and retry, so long-running background sync survives token expiry.
3. Then decide whether to (a) keep manual/private release posture, or (b) design a real updater feed for auto-update.
