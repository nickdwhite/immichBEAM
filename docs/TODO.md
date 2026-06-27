# Immich Beam — Setup & TODO

Operational steps that require *your* accounts/keys (so they can't be fully
automated), plus deferred engineering work. For the architecture review see
`docs/CODE_REVIEW.md`; for build details see `docs/RELEASING.md`.

---

## 1. Publish to GitHub

The repo is already initialized locally with an initial commit. To publish:

```bash
cd ~/Downloads/projects/immich-beam

# Install + log in to the GitHub CLI (browser-based; no token to paste)
brew install gh
gh auth login          # choose GitHub.com → HTTPS → login with a browser

# Create the repo and push
gh repo create immich-beam --public --source=. --push
```

## 2. GitHub Actions (already configured)

Two workflows live in `.github/workflows/`:

- **`ci.yml`** — on every push/PR: frontend typecheck + build, Rust unit tests,
  clippy. This is your free Windows/Linux compile-and-test check.
- **`release.yml`** — on a `v*` tag: builds macOS, Windows, and Linux installers
  in parallel and uploads them to a **draft** GitHub Release.

Cut a release:

```bash
git tag v0.3.1
git push origin v0.3.1
# → watch the Actions tab; ~10-15 min; review & publish the draft Release
```

GitHub-hosted runners are free for public repos. No Apple/Microsoft account is
needed to build or distribute unsigned installers (users see a one-time
"unknown developer" prompt — see §4).

---

## 3. Enable auto-update (free, no developer account)

Tauri's updater checks a `latest.json` manifest published with each GitHub
Release and installs signed updates. The signing key here is a **free,
self-generated** key — unrelated to OS code signing.

> Platform note: macOS and Windows (NSIS) auto-update in place. On Linux only the
> **AppImage** self-updates; `.deb`/`.rpm` users update via their package manager.

### One-time, done by you (handles the private key)

1. Generate the updater key pair:
   ```bash
   pnpm tauri signer generate -w ~/.tauri/immich-beam.key
   ```
   Save the password somewhere safe. **Losing this key means you can never push
   updates to already-installed apps.**

2. Copy the **public** key it prints and paste it into `tauri.conf.json` →
   `plugins.updater.pubkey` (replace the `REPLACE_WITH_PUBLIC_KEY` placeholder
   once §code-wiring below is done).

3. Add the **private** key + password as GitHub repo secrets
   (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` = contents of `~/.tauri/immich-beam.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the password you chose

4. Update the `endpoints` URL in `tauri.conf.json` to your actual repo:
   `https://github.com/<your-user>/immich-beam/releases/latest/download/latest.json`

### Code wiring — DONE ✅

The auto-update feature is fully coded (Rust-side, no extra IPC capabilities):

- `src-tauri/src/updater.rs` — `check_for_update` / `install_update` commands.
- `lib.rs` — registers `tauri_plugin_updater` and manages the pending-update state.
- `tauri.conf.json` — `plugins.updater` block (with **placeholder** pubkey +
  endpoint to replace) and Windows `installMode: passive`.
- `src/components/UpdateChecker.tsx` — "Check for updates" UI in the Sync tab,
  showing the current version, available version + notes, and Download & install.
- `release.yml` — already passes the `TAURI_SIGNING_PRIVATE_KEY` secrets.

### Activation — 3 manual edits (need your key)

1. Replace `pubkey` in `tauri.conf.json` with the public key from
   `tauri signer generate`.
2. Replace `REPLACE_OWNER` in the `endpoints` URL with your GitHub username.
3. Add `"createUpdaterArtifacts": true` under `bundle` in `tauri.conf.json`
   (left off for now so local `pnpm tauri build` keeps working without a key),
   and add the `TAURI_SIGNING_PRIVATE_KEY` / `..._PASSWORD` repo secrets.

Until then, the "Check for updates" button works but reports an error (no valid
key configured) — expected.

---

## 4. (Optional) OS code signing — removes first-install warnings

Not required for auto-update; only removes the OS "unknown developer" prompts.

- **macOS:** Apple Developer Program ($99/yr) → notarization. Add the certs as
  workflow secrets; `tauri-action` picks them up.
- **Windows:** an OV/EV code-signing certificate (paid).
- **Linux:** not applicable.

---

## 5. Deferred engineering work (from CODE_REVIEW.md)

Tracked here so they aren't lost. Severity in brackets.

- [x] **Typed error/status classification** (C1) — `ApiError` carries the HTTP
      status; retry/permanent/auth decided by code, not text. ✅
- [x] **Re-validate paths in `free_space`** (S4) — only files confirmed by the
      last scan may be trashed. ✅
- [x] **Real TOFU certificate pinning** [Med] — in insecure mode the server's
      leaf cert is captured and pinned on first connect (`pinned_cert` in
      config); afterwards only that exact certificate is trusted (built-in roots
      disabled, hostname check relaxed for IP-issued homelab certs), so a swapped
      cert is rejected. Server Settings shows the SHA-256 fingerprint with a
      "Forget & re-trust" action; changing the server URL drops the stale pin.
      ✅ (S2)
- [x] **SQLite connection pool** [Med] — `r2d2` + `r2d2_sqlite` (max 4 conns,
      WAL + `busy_timeout=5000`) so status polls / history / cache lookups run
      concurrently with uploads instead of serializing on one mutex. The engine's
      `Mutex<Db>` is gone (the pool handles concurrency). ✅ (C2/O3)
- [x] **Batch album additions** [Low] — uploaded assets are queued in a durable
      `pending_album` table and added in batched PUTs (≤250 ids) once 50
      accumulate or the queue goes idle, instead of one PUT per file. Idempotent
      and crash-safe (rows clear only on confirmation). ✅ (O5)
- [ ] **Batch duplicate checks** [Low] — marginal in this design: the scan-time
      hash cache already skips files we've uploaded before, so the per-item
      `bulk-upload-check` only runs for genuinely new files (which must upload
      regardless) or files synced by another device. Batching would require
      restructuring the continuous per-item dispatcher into hash→check→upload
      stages for little real saving. Left as-is; revisit if profiling shows the
      check is a bottleneck (O1).
- [x] **Live Photos pairing** — same-named still+video detected; video uploaded
      first and linked via `livePhotoVideoId`; the video's own queue item is
      deferred. ✅
- [x] **XMP sidecars** — sibling `.xmp` (`name.xmp` or `name.ext.xmp`) attached
      as `sidecarData` on upload. ✅
- ~~Resumable uploads~~ — moved to `docs/research/resumable-uploads.md`
  (blocked on Immich server support; not actionable client-side).

---

## 6. UI/UX improvement plan

Comprehensive, phased plan. Implemented iteratively (build → compile/test →
next). Checked off as completed.

### Phase A — Feedback & friendliness
- [x] **A1. Toast notifications** — lightweight in-app toasts (success/error/
      info, auto-dismiss), wired into server/folder/album/filter/sync saves and
      queue repair/clear. ✅
- [x] **A2. Notification preferences** — Sync-tab toggle to enable/disable
      desktop notifications. ✅
- [x] **A3. Friendlier empty states** — onboarding card + existing per-tab empty
      states cover first-run and "all caught up". ✅
- [x] **A4. First-run onboarding** — checklist on Overview (connect server → add
      folder), hides when complete, with jump-to-tab buttons. ✅

### Phase B — Navigation reorganization
- [x] **B1. Split the overloaded Sync tab** — Updates → **About** tab, logs →
      **Diagnostics** tab; Sync keeps just settings. ✅
- [x] **B2. Group the sidebar** into Activity / Settings / Tools sections. ✅
- [x] **B3. Fold Errors into History** — the standalone Errors tab is gone;
      History now shows failed uploads with per-row **Retry** and a **Retry all**
      action, the failed-count badge moved to the History nav item, and
      `ErrorLog.tsx` was removed. ✅

### Phase C — Data usefulness
- [x] **C1. Per-folder stats** — file count + total size per watched folder
      (lazy background scan). ✅
- [x] **C2. History filtering** — status filter + filename search + "Clear
      history"; cap raised to 500. ✅
- [x] **C3. Last-sync indicator** — Overview shows "last upload {time ago}". ✅

### Phase D — Polish & accessibility
- [x] **D1. Theme toggle** — light / dark / system, persisted; header control. ✅
- [x] **D2. Accessibility pass** — global focus-visible rings, `aria-label`s /
      `aria-pressed` / `aria-current` on icon controls and nav. ✅
- [x] **D3. Window-state persistence** — `tauri-plugin-window-state` remembers
      window size/position. ✅
- [x] **D4. Loading skeletons** — spinner replaces bare "Loading…". ✅

All phases (A–D) complete.

---

## 7. Feature roadmap

New feature ideas, partially inspired by reviewing
[ImmichSync](https://github.com/bees-roadhouse/immichsync/).

### Watch behavior
- [x] **Per-folder recursive toggle** — `WatchedFolder.recursive` flag
      (default true), FolderTree icon toggle in Folders UI, watcher and
      scanner honour the per-folder setting. ✅

### Upload & sync improvements
- [x] **Bandwidth throttling** — token-bucket rate limiter in `queue.rs` +
      KB/s slider in Sync Settings. ✅ (implemented earlier)
- [x] **Network share fallback** — when `notify`'s native watcher fails on a
      folder (NFS/SMB), `watcher.rs` automatically falls back to a 30-second
      `PollWatcher` for that folder. ✅
- [x] **Watcher health monitoring** — background `watcher-health` thread
      probes every 60 s, logs warnings when a watched folder becomes
      unreachable (mount dropped, etc.). ✅
- [ ] **Batch duplicate checks** — group hash lookups into batch
      `bulk-upload-check` calls instead of per-item (deferred from §5, revisit
      if profiling shows the check is a bottleneck).

### Device & media detection
- [x] **USB / SD card auto-detection** — `removable.rs` polls for new volumes
      (macOS `/Volumes`, Linux `/media/$USER`, Windows drive letters), detects
      DCIM folders, and shows an in-app banner offering to add them. ✅
- [x] **Auto-detect media folders** — `suggest_folders` command suggests
      Pictures/Videos/Photos/DCIM if they exist; shown in Onboarding when the
      server is connected but no folders are added yet. ✅

### UX enhancements
- [x] **Drag-and-drop folder addition** — Tauri `onDragDropEvent` handler in
      App.tsx; drop a folder on the window to add it, with a visual overlay. ✅
- [x] **Upload progress in tray tooltip** — tray tooltip shows
      "Uploading N/M files" when syncing. ✅
- [x] **Conflict resolution UI** — `conflict_policy` config (reupload/skip),
      enforced in both the watcher ingest and initial scan paths, with a
      dropdown in Sync Settings. ✅
