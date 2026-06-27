# Release Secrets

This project does **not** use `.env` files for normal app runtime.

- The Immich API key is stored in the OS keychain, not in env vars.
- Frontend and Rust runtime config are file- and keychain-based, not env-based.
- The only currently wired secret inputs are for **release/update signing**.
- In the current private-repo release plan, desktop updates stay **manual**.

## Currently used secrets

These names are already consumed by the GitHub release workflow:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

See [.github/workflows/release.yml](/Users/ndw-eiq/Downloads/projects/immich-syncdesk/.github/workflows/release.yml:77).

## Local placeholder file

A tracked example file lives at:

- [.env.release.local.example](/Users/ndw-eiq/Downloads/projects/immich-syncdesk/.env.release.local.example:1)

Use it only for local/manual release work if you want a consistent place to keep
the updater-signing env names documented. The real local file should remain
gitignored as `.env.release.local`.

## Current private-repo mode

If release artifacts remain in a private GitHub repository, keep the shipped
desktop app on manual updates. GitHub Actions can still build installers and
draft Releases, but the app cannot anonymously fetch private update manifests
or assets.

## Not secrets

These still need real values before auto-update is live, but they should **not**
go in a secrets file:

- `plugins.updater.pubkey` in [src-tauri/tauri.conf.json](/Users/ndw-eiq/Downloads/projects/immich-syncdesk/src-tauri/tauri.conf.json:64)
- the GitHub Releases endpoint / owner in [src-tauri/tauri.conf.json](/Users/ndw-eiq/Downloads/projects/immich-syncdesk/src-tauri/tauri.conf.json:66)

## Not yet wired

Optional future signing/notarization secrets for macOS and Windows are not yet
explicitly wired in this repo. Add those only when you decide to ship signed
installers.
