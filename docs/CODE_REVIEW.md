# Immich SyncDesk — Comprehensive Review

A multi-dimensional review of the current codebase: code quality, security,
features, UI/UX, and performance. Findings are rated **High / Medium / Low** and
reference specific files. A prioritized action list is at the end.

Overall: the app is well-structured and functional, with good separation
(api / sync / db / config / commands / tray), parameterized SQL, secure key
storage, streaming uploads, and a sensible event-driven UI. The most valuable
improvements are tightening the IPC permission surface, correcting the
self-signed-certificate story, and a few performance fixes for large libraries.

---

## 1. Security

### S1 — IPC capabilities are not least-privilege · **Medium**
`src-tauri/capabilities/default.json` grants the webview `fs` (read/write/remove/
rename/mkdir), `http`, `shell`, `store`, `process`, and `notification`
permissions. But the frontend only actually uses three plugins: `opener`,
`dialog`, and `autostart` (verified — those are the only `@tauri-apps/plugin-*`
imports). All HTTP, file I/O, notifications, and logging happen in Rust, which
does **not** need webview capabilities. The unused grants — especially
`fs:allow-remove` / `fs:allow-write-text-file` and `http`/`shell` — widen the
attack surface if the webview is ever compromised. **Fix:** reduce to
`core:default`, `opener:*`, `autostart:default`, `dialog:default`/`allow-open`,
and drop the unused plugins from `lib.rs`.

### S2 — "Trust on first use" is actually full TLS-validation bypass · **Medium**
`client.rs::new()` uses `danger_accept_invalid_certs(allow_insecure)`. The
comments and UI call this "trust on first use," but it accepts **any** invalid
certificate for the whole session — it does not pin the server's certificate, so
it provides no protection against an in-path attacker swapping certs. **Fix:**
implement real TOFU by capturing the server's cert fingerprint on first connect
and pinning it (reqwest custom `Certificate` / a `ServerCertVerifier`), or at
minimum rename the feature to "Disable certificate validation (insecure)" so the
weaker guarantee is honest.

### S3 — API key transmitted over plaintext HTTP · **Low–Medium**
When the server URL is `http://`, the `x-api-key` header is sent unencrypted on
the LAN. The UI shows an insecure badge (good), but still proceeds. For a
self-hosted LAN tool this is a reasonable default; consider an explicit
one-time confirmation when saving an `http://` server.

### S4 — `free_space` trusts arbitrary paths from the frontend · **Low**
The `free_space` command moves any paths the frontend supplies to the trash.
In normal flow these come from a verified scan, but the command itself does not
re-validate that each path is inside a watched folder / confirmed synced. For a
local single-user app the risk is low, but adding a server-side re-check (path
within a watched folder, present in the last scan result) would harden it.

### Security positives
- All SQL uses parameterized `params!` — no injection risk (`db.rs`).
- API key stored in the OS keychain, cached in memory, and **never logged**
  (verified in `keychain.rs`, `client.rs`, engine logging).
- Auto-updater is disabled — no unsigned-update vector.
- CSP in `tauri.conf.json` is scoped to self plus the necessary http/https
  connect sources.
- Trash uses recoverable OS trash, never hard-delete.

---

## 2. Code quality

### C1 — Error classification by substring matching · **Low–Medium**
`engine.rs::is_permanent_error` / `is_auth_error` match on `"400"`, `"401"`,
`"timeout"`, etc. in the error's `Display` string. This is fragile (a `400` could
appear in a URL or byte count). **Fix:** have `ImmichClient` surface
`reqwest::StatusCode` (e.g. return a typed error enum) so classification is based
on the real status code rather than text.

### C2 — Single `Mutex<Connection>` serializes all DB access · **Medium**
`Inner.db: Mutex<Db>` means every hash lookup, status poll, queue claim, and
history write contends on one lock while uploads run concurrently. **Fix:** use a
small connection pool (`r2d2_sqlite`) with WAL (already enabled) so reads run in
parallel; keep writes serialized.

### C3 — Blocking filesystem work on async threads · **Medium**
`scan_all`, `inspect_folder`, and `run_freeable_scan` call `WalkDir` and
`std::fs::metadata` directly inside `async fn`. On a very large tree this blocks
a Tokio worker thread for the duration of the walk. **Fix:** wrap directory
walks in `tokio::task::spawn_blocking`.

### C4 — Thin test coverage · **Medium**
Only three unit tests exist (hasher, filter, bandwidth limiter). The high-value
logic — error classification, the dedup/duplicate-vs-unsupported branch, the
dispatcher backoff, queue state transitions — is untested. **Fix:** add unit
tests for `is_permanent_error`/`is_auth_error`, and DB-level tests for
`enqueue`/`claim_pending`/`retry`/`clear` using an in-memory SQLite.

### C5 — Minor cleanliness
- A few `#[allow(dead_code)]` markers (`PENDING`, `SyncState::Error`, `as_str`)
  flag reserved-but-unused code — fine, but worth revisiting.
- `basename()` is re-implemented in ~4 components; lift to `lib/format.ts`.
- Magic numbers (semaphore cap `64`, `3600s` item timeout, `100`-item batch)
  would read better as named constants.

---

## 3. Features

Strong coverage of the original P0 plan: tray + states, watched folders,
SHA1 dedup with cache, streaming uploads, durable queue, retries/backoff,
bandwidth limit, keychain, albums, free-up-space, overview, logs.

Gaps / opportunities:
- **Resumable uploads** — large files restart from zero on interruption (Immich's
  endpoint isn't chunked; would need client-side chunking if/when supported).
- **Real TOFU cert pinning** (see S2).
- **Auto-update** — scaffolded but disabled.
- **Live Photos / motion photos** — the paired video isn't linked
  (`livePhotoVideoId` unused).
- **XMP sidecars** — excluded from upload; fine for MVP, but metadata-heavy
  libraries may want them.
- **Scheduled / automatic free-up-space** — currently manual only (by design).
- **Selective sync rules** beyond extension filter (date ranges, sub-folder
  excludes).

---

## 4. UI / UX

### U1 — Queue list is not virtualized · **Medium (perf + UX)**
`QueueView` renders every pending+active row (`items.map`). With thousands of
queued files that's thousands of DOM nodes plus a multi-thousand-row IPC payload
every 2s (`useQueue`). **Fix:** virtualize the list (e.g. render a windowed
slice) and have `get_queue` accept a limit/offset; show "+N more" beyond the
window.

### U2 — First-run guidance is minimal
The app sensibly lands on the Server tab until a key is set, but there's no
guided onboarding (test connection → add folder → done). A short checklist or
empty-state hints on Overview would smooth first use.

### U3 — Accessibility gaps · **Low**
Some interactive controls lack `aria-label`s; status is conveyed with color plus
text (good), but focus order and keyboard operability of the custom toggles
aren't audited. Worth a pass for keyboard/screen-reader users.

### U4 — No in-app theme control
Dark mode follows the OS via Tailwind `dark:` classes but can't be toggled
in-app. Minor.

### UX positives
- Destructive actions (Clear queue, Free up space) require explicit confirms.
- The header **activity bar** gives always-visible progress, and the per-item
  size + live transfer is clear.
- Connection-status tray icons + the HTTPS/HTTP security badge communicate state
  well. Background scan with a sidebar spinner survives navigation.

---

## 5. Performance / optimization

### O1 — Batch the duplicate checks · **Medium**
Each `process_one` calls `bulk_upload_check` with a **single** item, so N files =
N round-trips. The endpoint is literally a *bulk* check. **Fix:** pre-check the
queue in batches of ~100 before dispatch, removing known duplicates without
per-file requests — a large win when re-scanning big libraries.

### O2 — Reduce queue polling / payload (see U1)
Move fully to event-driven refresh and cap the returned rows.

### O3 — DB read concurrency (see C2)
A connection pool removes lock contention between uploads, polling, and scans.

### O4 — Offload directory walks (see C3)
`spawn_blocking` keeps the async runtime responsive during large scans.

### O5 — Batch album additions
`add_to_album` is called once per uploaded asset; collect asset IDs per album and
add in batches.

### Performance positives
- Uploads are **streamed** (1 MB chunks) — a 6 GB file uses minimal RAM.
- The hash cache lets scans **skip already-synced files** entirely.
- The release profile is tuned (`lto`, `opt-level`, `strip`, `panic=abort`).
- Continuous semaphore dispatch keeps N uploads in flight without head-of-line
  blocking.

---

## Prioritized recommendations

**Done (this pass)**
- ✅ **S1** — IPC capabilities trimmed to `opener`/`dialog`/`autostart` only.
- ✅ **S2** — TLS-bypass now labeled honestly (real pinning deferred → TODO).
- ✅ **C3 / O4** — Directory walks moved to `spawn_blocking`.
- ✅ **U1 / O2** — `get_queue` capped (500) with active-first ordering + a
  "+N more" indicator.
- ✅ **C4** — Added tests for error classification, hex decode, and DB
  queue/cache/history ops.

**Remaining (tracked in docs/TODO.md)**
- C2 / O3 — SQLite connection pool (dependency change; verify under CI).
- S2 — Real trust-on-first-use certificate pinning.
- C1 — Typed `StatusCode` error classification (replace substring matching).
- O1 — Batch duplicate checks (lower value now that scan-skip handles re-scans).
- O5 — Batch album additions.
- U2/U3/U4 — Onboarding, accessibility pass, theme toggle.
- S4 — Re-validate `free_space` paths server-side.
