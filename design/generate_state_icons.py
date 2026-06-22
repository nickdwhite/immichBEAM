#!/usr/bin/env python3
"""Generate per-status tray icons (no third-party deps).

Each icon is the immich-dock cloud mark, filled in a status colour, with a
small white glyph so the state reads even at menu-bar size:

  disconnected -> red    + slash      (no server / offline)
  insecure     -> amber  + "!"        (connected over plain HTTP)
  secure       -> green  + check      (connected over HTTPS)
  syncing      -> blue   + up-arrow   (uploading)
  paused       -> slate  + bars       (user paused)

Renders supersampled then box-downsamples for anti-aliasing.

Run:  python3 generate_state_icons.py
"""
import math
import os
import struct
import zlib

OUT = 64
SS = 4
N = OUT * SS  # supersampled canvas

WHITE = (255, 255, 255)

STATES = {
    "disconnected": (239, 68, 68),   # red
    "insecure": (245, 158, 11),      # amber
    "secure": (16, 185, 129),        # green
    "syncing": (26, 144, 245),       # logo blue
    "paused": (100, 116, 139),       # slate
}

GLYPH = {
    "disconnected": "slash",
    "insecure": "bang",
    "secure": "check",
    "syncing": "arrow",
    "paused": "pause",
}

# Map the logo cloud (designed in a 0-100 space) onto the icon, scaled to fill
# the width with a small margin and centered.
CLOUD_CX, CLOUD_CY = 50.95, 46.65   # cloud bbox center in design space
K = (N * 0.80) / 56.5               # cloud is ~56.5 wide; fill ~80% of icon


def m(px, py):
    return (px - CLOUD_CX) * K + N / 2, (py - CLOUD_CY) * K + N / 2


def blank():
    return [[(0.0, 0.0, 0.0, 0.0) for _ in range(N)] for _ in range(N)]


def over(dst, src):
    sr, sg, sb, sa = src
    dr, dg, db, da = dst
    oa = sa + da * (1 - sa)
    if oa == 0:
        return (0.0, 0.0, 0.0, 0.0)
    return (
        (sr * sa + dr * da * (1 - sa)) / oa,
        (sg * sa + dg * da * (1 - sa)) / oa,
        (sb * sa + db * da * (1 - sa)) / oa,
        oa,
    )


def paint(buf, x, y, color, cov):
    if cov <= 0 or x < 0 or y < 0 or x >= N or y >= N:
        return
    r, g, b = color
    buf[y][x] = over(buf[y][x], (r / 255, g / 255, b / 255, min(1.0, cov)))


def disc(buf, cx, cy, rad, color):
    for y in range(max(0, int(cy - rad - 1)), min(N, int(cy + rad + 2))):
        for x in range(max(0, int(cx - rad - 1)), min(N, int(cx + rad + 2))):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            paint(buf, x, y, color, (rad - d) + 0.5)


def rrect(buf, x0, y0, x1, y1, rad, color):
    for y in range(max(0, int(y0)), min(N, int(y1) + 1)):
        for x in range(max(0, int(x0)), min(N, int(x1) + 1)):
            dx = max(x0 + rad - x, x - (x1 - rad), 0)
            dy = max(y0 + rad - y, y - (y1 - rad), 0)
            d = math.hypot(dx, dy) - rad
            paint(buf, x, y, color, (-d) + 0.5)


def seg(buf, x0, y0, x1, y1, half, color):
    for y in range(max(0, int(min(y0, y1) - half - 1)), min(N, int(max(y0, y1) + half + 2))):
        for x in range(max(0, int(min(x0, x1) - half - 1)), min(N, int(max(x0, x1) + half + 2))):
            dx, dy = x1 - x0, y1 - y0
            L2 = dx * dx + dy * dy or 1.0
            t = max(0.0, min(1.0, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / L2))
            px, py = x0 + t * dx, y0 + t * dy
            d = math.hypot(x + 0.5 - px, y + 0.5 - py)
            paint(buf, x, y, color, (half - d) + 0.5)


def rect(buf, x0, y0, x1, y1, color):
    for y in range(max(0, int(y0)), min(N, int(y1))):
        for x in range(max(0, int(x0)), min(N, int(x1))):
            paint(buf, x, y, color, 1.0)


def cloud(buf, color):
    disc(buf, *m(35.4, 54.7), 12.7 * K, color)
    disc(buf, *m(64.6, 54.7), 14.6 * K, color)
    disc(buf, *m(47.1, 45.9), 17.1 * K, color)
    disc(buf, *m(60.7, 48.8), 12.7 * K, color)
    x0, y0 = m(25.6, 52.7)
    x1, y1 = m(75.4, 64.5)
    rrect(buf, x0, y0, x1, y1, 5.9 * K, color)


def glyph(buf, kind):
    # Centered on the cloud body, sized (in absolute pixels) to sit inside the
    # main puff and stay legible at menu-bar scale.
    cx, cy = m(49, 50)
    u = N * 0.105         # glyph unit (~half-height)
    h = N * 0.032         # stroke half-width
    if kind == "check":
        seg(buf, cx - 1.1 * u, cy + 0.1 * u, cx - 0.2 * u, cy + 1.0 * u, h, WHITE)
        seg(buf, cx - 0.2 * u, cy + 1.0 * u, cx + 1.3 * u, cy - 1.1 * u, h, WHITE)
    elif kind == "slash":
        seg(buf, cx - 1.1 * u, cy - 1.1 * u, cx + 1.1 * u, cy + 1.1 * u, h, WHITE)
    elif kind == "bang":
        seg(buf, cx, cy - 1.2 * u, cx, cy + 0.45 * u, h, WHITE)
        disc(buf, cx, cy + 1.15 * u, h * 0.85, WHITE)
    elif kind == "arrow":
        seg(buf, cx, cy - 1.2 * u, cx, cy + 1.2 * u, h, WHITE)
        seg(buf, cx, cy - 1.2 * u, cx - 0.95 * u, cy - 0.25 * u, h, WHITE)
        seg(buf, cx, cy - 1.2 * u, cx + 0.95 * u, cy - 0.25 * u, h, WHITE)
    elif kind == "pause":
        bw = 0.42 * u
        rect(buf, cx - 0.95 * u, cy - 1.05 * u, cx - 0.95 * u + bw, cy + 1.05 * u, WHITE)
        rect(buf, cx + 0.55 * u, cy - 1.05 * u, cx + 0.55 * u + bw, cy + 1.05 * u, WHITE)


def downsample(buf):
    rows = []
    for oy in range(OUT):
        row = []
        for ox in range(OUT):
            r = g = b = a = 0.0
            for dy in range(SS):
                for dx in range(SS):
                    pr, pg, pb, pa = buf[oy * SS + dy][ox * SS + dx]
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            n = SS * SS
            a /= n
            if a > 0:
                r = r / (a * n)
                g = g / (a * n)
                b = b / (a * n)
            row.append((int(r * 255), int(g * 255), int(b * 255), int(a * 255)))
        rows.append(row)
    return rows


def write_png(rows, path):
    raw = bytearray()
    for row in rows:
        raw.append(0)
        for (r, g, b, a) in row:
            raw += bytes((r, g, b, a))

    def chunk(typ, data):
        return (
            struct.pack(">I", len(data))
            + typ
            + data
            + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", OUT, OUT, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


if __name__ == "__main__":
    out = os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons", "states")
    )
    os.makedirs(out, exist_ok=True)
    for name, color in STATES.items():
        buf = blank()
        cloud(buf, color)
        glyph(buf, GLYPH[name])
        write_png(downsample(buf), os.path.join(out, f"tray-{name}.png"))
        print(f"wrote states/tray-{name}.png")
