# Immich Beam — Security Review

_Date: 2026-06-21 · Scope: full codebase (Rust backend + React/Tauri frontend) · Reviewer: automated assist_

## Scope & method

This is a manual, whole-codebase review (not a diff). Every security-relevant
surface was read directly: credential storage (`keychain.rs`), TLS/transport
(`api/client.rs`, `engine.rs`), IPC command surface (`commands.rs`, `lib.rs`),
capabilities (`capabilities/default.json`, `tauri.conf.json`), persistence
(`db.rs`, `config.rs`), filesystem actions (`sync/cleanup.rs`, `engine.rs`
free-space/trash), the updater (`updater.rs`), and the frontend (`src/`).

## Threat model

Immich Beam is a single-user desktop client that talks only to the user's
own Immich server. The realistic adversaries are:

1. A network in-path attacker between the app and the server (especially on a
   LAN, or when "trust self-signed" is enabled).
2. Local malware trying to read the stored API key or other secrets.
3. A supply-chain issue in a dependency.
4. The app itself mishandling the user's files (e.g. deleting the wrong thing).

There is **no remote-attacker-controlled content rendered in the webview** — the
UI is first-party and loaded from the bundle, and all privileged work happens in
Rust behind a small, typed command surface. That single fact removes most of the
classic Tauri/desktop attack classes (XSS-to-IPC pivot, malicious deep links,
etc.), which is why nothing below rates higher than Medium.

## Findings summary

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| M1 | Medium | Five Tauri plugins initialized but unused (`store`, `fs`, `http`, `shell`, `process`) — needless attack/supply-chain surface | **Fixed** |
| M2 | Medium (by design) | TOFU first-connection trust window — a MITM present at the very first connect can have their cert pinned | Accepted |
| L1 | Low | Content-Security-Policy is broad (`connect-src`/`img-src` allow any `http:`/`https:`/`ws:`/`wss:`) | **Fixed** |
| L2 | Low | `opener:allow-open-path` capability granted but the frontend never opens an arbitrary path | **Fixed** |
| L3 | Low | Pinned-cert mode disables hostname verification (accepted tradeoff for IP-issued certs) | Accepted |
| L4 | Low | Logs can contain absolute local file paths (local-only info disclosure) | **Fixed** |
| L5 | Low | No single-instance guard — two copies can run and double-watch folders | **Fixed** |
| L6 | Low (defense-in-depth) | Server-supplied `album_id` is interpolated into a URL path without encoding | **Fixed** |
| I1 | Info | Updater `pubkey`/`endpoint` are placeholders — auto-update is inert until set | Release gate |
| I2 | Info | `device_id` embeds the machine hostname (sent to the user's own server) | Accepted |

> **Update (2026-06-21):** M1, L1, L2 were remediated immediately after the
> review; L3, L4, L5, and L6 were addressed in a follow-up hardening pass. The
> only open items are I1 (a release gate) and the accepted residual risks
> (M2, I2). See the per-finding notes and the checklist below.

## What's done well (no action needed)

The credential model is the strongest part of the app and is implemented
correctly. The Immich API key is stored **only** in the OS keychain
(`keychain.rs`, via the `keyring` crate → Keychain/Credential Manager/Secret
Service). It is never written to `config.json`, never logged, and never returned
to the frontend — `get_config` exposes only a `has_api_key` boolean
(`commands.rs`). At runtime the key is read from the keychain exactly once and
cached in memory (`engine.rs`), so there's no repeated keychain access to prompt
on. On the frontend the key lives transiently in React state and the input is
cleared after save; nothing sensitive is placed in `localStorage` (only the UI
theme is).

Other solid points:

- **Least-privilege IPC.** `capabilities/default.json` grants only
  `core:default`, a subset of `opener`, `autostart`, and `dialog`. No `fs`,
  `http`, `shell`, or `process` permissions are exposed to the webview, so the
  frontend cannot touch the filesystem, spawn processes, or make arbitrary
  network calls — everything goes through ~30 narrow, typed commands.
- **TLS pinning (TOFU).** In "trust self-signed" mode the server's leaf cert is
  captured and pinned on first use; afterwards only that exact certificate is
  trusted (built-in roots disabled), so a later swapped cert is rejected. The
  pin is applied **only** in insecure mode and is dropped automatically when the
  server URL changes, so it can't break a switch to a real CA cert.
- **Safe destructive actions.** "Free up space" only ever trashes files that the
  most recent scan confirmed are byte-identical on the server and not
  server-trashed (`engine.rs` `free_space` partitions the requested paths against
  an allow-list before touching anything), and it uses the recoverable OS
  trash — never a permanent delete.
- **No SQL injection.** Every query in `db.rs` uses bound parameters (`params!`,
  `?N`), including the history status filter; no user value is concatenated into
  SQL.
- **No unsafe rendering.** The React code has no `dangerouslySetInnerHTML`,
  `eval`, or `innerHTML`; values are auto-escaped.
- **Signed updates over HTTPS.** The updater uses the Tauri updater plugin
  (minisign-signed artifacts) pointed at a GitHub Releases HTTPS endpoint.

## Detailed findings

### M1 — Unused plugins increase attack & supply-chain surface

`lib.rs` initializes `tauri_plugin_store`, `tauri_plugin_fs`,
`tauri_plugin_http`, `tauri_plugin_shell`, and `tauri_plugin_process`, but none
of them are used: the backend talks to Immich via `reqwest` directly, reads/writes
config and the database with `std::fs`/`rusqlite`, and the frontend has no
capability to invoke any of them. Each initialized plugin still registers its
command handlers in the app and pulls a dependency tree into the binary, so this
is needless attack surface and supply-chain footprint. (`notification` is
genuinely used via `NotificationExt`; `opener`, `dialog`, `autostart`,
`updater`, and `window-state` are used.)

**Recommendation:** remove those five `.plugin(...)` lines from `lib.rs` and the
corresponding entries from `Cargo.toml`. Rebuild and confirm nothing breaks
(nothing should). This is the highest-value, lowest-risk hardening step.

**Status: Fixed.** The `store`, `fs`, `http`, `shell`, and `process` plugin
inits were removed from `lib.rs` and their five `tauri-plugin-*` dependencies
dropped from `Cargo.toml`. Verified neither side imported them.

### M2 — TOFU first-connection trust window (by design)

Trust-on-first-use means the very first HTTPS connection in insecure mode accepts
*any* certificate in order to capture and pin it (`client.rs` `new` builds with
`danger_accept_invalid_certs(true)` until a pin exists). An attacker who is
already in-path at that exact first connection could present their own cert,
which then gets pinned. This is the inherent TOFU limitation, not a bug, and it's
a large improvement over the previous "accept any cert forever" behavior.

**Recommendation (optional):** let advanced users paste/verify the expected
SHA-256 fingerprint out-of-band before the first connect, and/or surface the
captured fingerprint prominently after pinning (the value is already shown in
Server Settings) so a careful user can compare it against the server. Document
the residual risk in user-facing help. Acceptable as-is for the homelab threat
model.

### L1 — Broad Content-Security-Policy

`tauri.conf.json` sets `connect-src`/`img-src` to allow any `http:`, `https:`,
`ws:`, and `wss:` origin. Because the frontend makes no direct network requests
(all traffic is via Rust commands), this is broader than necessary. Tightening it
reduces what injected script could do in the unlikely event of a frontend
compromise.

**Recommendation:** narrow to `default-src 'self'` with `img-src 'self' data:`
and drop the remote `connect-src` entries unless a concrete need appears.

**Status: Fixed.** The shipped `csp` is now
`default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'`
(Tauri still auto-injects the IPC/asset sources because
`dangerousDisableAssetCspModification` is `false`). The previous permissive
policy was moved to a separate `devCsp` so Vite's dev server and HMR websocket
keep working under `pnpm tauri dev`. Best verified with a `pnpm tauri build`.

### L2 — `opener:allow-open-path` granted but unused

The frontend only opens `https://` URLs (`openUrl`) and reveals the
backend-derived log path (`revealItemInDir`). It never calls `openPath` with a
caller-supplied path, yet `opener:allow-open-path` is granted.

**Recommendation:** drop `opener:allow-open-path` from
`capabilities/default.json` (keep `allow-reveal-item-in-dir` and the URL open).

**Status: Fixed.** `opener:allow-open-path` was removed from the capability
file; `opener:default` (URL open) and `opener:allow-reveal-item-in-dir` remain.

### L3 — Hostname verification disabled when pinned

In pinned mode the client sets `danger_accept_invalid_hostnames(true)` because
self-signed homelab certs are usually issued to an IP rather than a hostname. The
exact-certificate pin still rejects a swapped cert, so this is a reasonable
tradeoff, but it does mean the connection isn't bound to the hostname.

**Recommendation:** none required; optionally only relax hostname checking when
the URL host is an IP literal, and keep full verification for DNS names.

**Status: Fixed.** `client.rs` now relaxes hostname checking
(`danger_accept_invalid_hostnames`) only when the server host is an IP literal
(`host_is_ip`); DNS-named servers keep full hostname verification on top of the
pin. Covered by a unit test.

### L4 — Local file paths in logs

Engine logging records filenames and, in debug mode, full paths and server-side
asset ids. The log file is local to the user's machine and readable only by them,
so this is a minor info-disclosure/privacy note rather than a vulnerability.

**Recommendation:** prefer basenames over absolute paths at the default `info`
level; keep full paths behind the existing debug toggle.

**Status: Fixed (pragmatic).** Routine `info`/`warn` logs already use basenames;
the one remaining full-path media log (the Live Photo video warning) now logs a
basename. Full paths in `anyhow`/`ApiError` *error context* (stat/open failures,
config/DB paths) are intentionally retained — they only appear on failure and
are valuable for diagnosis, and the log file is local and user-readable.

### L5 — No single-instance guard

Nothing prevents two copies of the app from running at once. With WAL the shared
database tolerates concurrent access, and server-side dedup prevents duplicate
uploads, but two instances would double-watch folders and double-scan.

**Recommendation:** add `tauri-plugin-single-instance` to focus the existing
window instead of starting a second engine.

**Status: Fixed.** `tauri-plugin-single-instance` is registered first in
`lib.rs`; a second launch shows/unminimizes/focuses the existing main window
instead of starting another engine and watcher.

### L6 — Unencoded server value in URL path (defense-in-depth)

`add_to_album` builds `"/api/albums/{album_id}/assets"` by interpolation. The
`album_id` comes from the user's own server (album list or create response), so
the trust boundary is the server you already trust, but a hardened client would
percent-encode path segments rather than interpolate them.

**Recommendation:** encode the segment (or validate it as a UUID) before
formatting the URL.

**Status: Fixed.** `add_to_album` now percent-encodes the `album_id` path
segment via `encode_path_segment` (RFC 3986 unreserved set); normal UUIDs pass
through unchanged while separators like `/` are escaped. Covered by a unit test.

### I1 — Updater placeholders

`tauri.conf.json` still has `pubkey: REPLACE_WITH_…` and a `REPLACE_OWNER`
endpoint, so auto-update is inert (and fails closed) until configured. This is
expected and documented in `docs/TODO.md`.

**Recommendation:** before the first real release, set a genuine minisign public
key and the real HTTPS Releases endpoint, and keep the private key only in GitHub
Actions secrets (never committed).

### I2 — Hostname in device id

`config.rs` `generate_device_id` embeds the machine hostname plus a UUID. It's
sent to the user's own server as the device identifier — minor, expected for a
sync client.

## Prioritized remediation checklist

1. ~~**M1** — remove the five unused plugins from `lib.rs` + `Cargo.toml`.~~ ✅ done
2. ~~**L2** — drop `opener:allow-open-path` from the capability file.~~ ✅ done
3. ~~**L1** — tighten the CSP.~~ ✅ done (prod `csp` tightened, `devCsp` kept for HMR)
4. ~~**L5** — add single-instance handling.~~ ✅ done
5. ~~**L3** — relax hostname check only for IP servers.~~ ✅ done
6. ~~**L6** — encode the `album_id` URL segment.~~ ✅ done
7. ~~**L4** — basename the routine media-path log.~~ ✅ done
8. **I1** — set the real updater pubkey/endpoint before release. _(release gate — needs your signing key)_
9. **M2 / I2** — accepted residual risks (TOFU first-use; hostname in device id).

Every actionable finding (M1, L1–L6) is now resolved. The only remaining item,
I1, is a release step that requires your updater signing key.

No Critical or High issues were found. The credential handling, IPC
least-privilege, certificate pinning, and safe-delete design are all sound; the
main opportunity is trimming unused capability/plugin surface (M1, L1, L2).
