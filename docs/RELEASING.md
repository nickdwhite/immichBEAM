# Building & Releasing Immich Dock

## TL;DR

- **Local dev:** `pnpm tauri dev`
- **Local installer for your current OS:** `pnpm tauri build`
- **All three OSes, automatically:** push a git tag like `v0.3.1` — GitHub
  Actions builds macOS, Windows, and Linux installers and attaches them to a
  draft Release. **No Apple/Microsoft account required.**

## Next steps locally (macOS)

```bash
cd immich-dock
# run the unit tests
cd src-tauri && cargo test && cd ..
# produce a local installer (.dmg + .app) in src-tauri/target/release/bundle/
pnpm tauri build
```

## Per-OS build requirements

You generally build on the OS you're targeting (Tauri doesn't cross-compile the
webview). The CI does this for you, but to build locally on each:

### macOS
- Xcode Command Line Tools (`xcode-select --install`), Rust, Node, pnpm.
- Output: `.dmg` and `.app` (universal — Apple Silicon + Intel).

### Windows
- [Rust](https://rustup.rs/) with the MSVC toolchain, **Visual Studio Build
  Tools** (Desktop C++), Node, pnpm. WebView2 ships with Windows 10/11.
- Output: `.msi` (WiX) and an NSIS `.exe` installer.

### Linux (Ubuntu/Debian)
```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf \
  build-essential curl wget file libxdo-dev libssl-dev
```
- Output: `.deb` and `.AppImage` (and `.rpm` on Fedora-family systems).
- Runtime note: the OS-keychain feature uses the Secret Service, so a keyring
  daemon (GNOME Keyring / KWallet) must be running for API-key storage.

## CI / GitHub Actions

Two workflows live in `.github/workflows/`:

- **`ci.yml`** — runs on every push/PR: frontend typecheck + build, Rust unit
  tests, and clippy. Fast feedback, no installers.
- **`release.yml`** — runs on a `v*` tag (or manual dispatch): builds and
  packages all three platforms in parallel on GitHub-hosted runners and
  uploads the installers to a **draft** GitHub Release for you to review and
  publish.

To cut a release:
```bash
git tag v0.3.1
git push origin v0.3.1
```
GitHub-hosted runners are **free for public repositories** (private repos get a
monthly free-minutes allowance). You do **not** need any developer account to
build or distribute unsigned installers.

## Signing & notarization (optional)

Signing is *not required to build or distribute* — it only removes the OS
"unknown developer" warnings. Without it, the apps still install and run:

| OS | Unsigned experience | To remove the warning |
|----|--------------------|-----------------------|
| macOS | Gatekeeper blocks first launch; user right-clicks the app → **Open** → Open. | Apple Developer Program ($99/yr) + notarization. |
| Windows | SmartScreen shows "Windows protected your PC"; user clicks **More info → Run anyway**. | An EV/OV code-signing certificate (paid). |
| Linux | No warning; `.deb`/`.AppImage` just work. | N/A |

When you're ready to sign, Tauri supports it via environment secrets in the
release workflow (Apple notarization vars / Windows cert), and the
`tauri-action` step picks them up automatically — no code changes needed.

## Auto-update

`tauri-plugin-updater` is included but disabled. To enable later: generate a
signing keypair (`pnpm tauri signer generate`), add the public key and update
endpoint to `tauri.conf.json`, re-add `updater:default` to
`src-tauri/capabilities/default.json`, and have the release workflow publish the
update manifest. Until then, updates are manual (download the new installer).
