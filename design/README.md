# Design assets

Source artwork and the scripts that generate the app's icons. None of this is
needed to build or run the app — only the generated outputs in
`src-tauri/icons/` are. These live here so the icons are reproducible if the
logo changes.

## Files

- `logo-master.png` — the canonical brand mark (blue cloud + photo-swirl +
  sync-arrows) on a transparent background.
- `generate_logo.py` — composes the master onto a macOS-style squircle and
  writes `src-tauri/icons/logo-source.png` (the app-icon source).
- `generate_state_icons.py` — renders the connection-status menu-bar/tray icons
  (cloud tinted by state + glyph) to `src-tauri/icons/states/tray-*.png`.

## Requirements

```bash
pip install pillow numpy
```

## Regenerate the icons

```bash
# from the repo root
python3 design/generate_logo.py          # -> src-tauri/icons/logo-source.png
pnpm tauri icon src-tauri/icons/logo-source.png   # -> icon.png/.icns/.ico, Square*, mobile sets
python3 design/generate_state_icons.py   # -> src-tauri/icons/states/tray-*.png
```

The in-app logo / favicon (`public/logo.png`) is the same master trimmed to a
square transparent PNG.
