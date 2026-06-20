#!/usr/bin/env python3
"""Generate per-status tray icons (no third-party deps).

Renders at 2x then box-downsamples for anti-aliasing. Each icon is a colored
disc with a white glyph indicating connection/sync status:

  disconnected -> red + slash      (no server / offline)
  insecure     -> amber + "!"      (connected over plain HTTP)
  secure       -> green + check    (connected over HTTPS)
  syncing      -> blue + up-arrow  (uploading)
  paused       -> slate + bars     (user paused)

Run:  python3 generate_state_icons.py
"""
import math
import os
import struct
import zlib

OUT = 64
SS = 2
N = OUT * SS  # supersampled canvas

WHITE = (255, 255, 255)

STATES = {
    "disconnected": (239, 68, 68),   # red
    "insecure": (245, 158, 11),      # amber
    "secure": (16, 185, 129),        # green
    "syncing": (59, 130, 246),       # blue
    "paused": (100, 116, 139),       # slate
}


def blank():
    return [[(0.0, 0.0, 0.0, 0.0) for _ in range(N)] for _ in range(N)]


def over(dst, src):
    # src/dst are (r,g,b,a) with a in 0..1; classic source-over compositing.
    sr, sg, sb, sa = src
    dr, dg, db, da = dst
    oa = sa + da * (1 - sa)
    if oa == 0:
        return (0.0, 0.0, 0.0, 0.0)
    orr = (sr * sa + dr * da * (1 - sa)) / oa
    og = (sg * sa + dg * da * (1 - sa)) / oa
    ob = (sb * sa + db * da * (1 - sa)) / oa
    return (orr, og, ob, oa)


def paint(buf, x, y, color, cov):
    if cov <= 0:
        return
    cov = min(1.0, cov)
    r, g, b = color
    buf[y][x] = over(buf[y][x], (r / 255, g / 255, b / 255, cov))


def fill_disc(buf, cx, cy, rad, color):
    for y in range(N):
        for x in range(N):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            paint(buf, x, y, color, (rad - d) + 0.5)


def seg(buf, x0, y0, x1, y1, half, color):
    minx = max(0, int(min(x0, x1) - half - 1))
    maxx = min(N - 1, int(max(x0, x1) + half + 1))
    miny = max(0, int(min(y0, y1) - half - 1))
    maxy = min(N - 1, int(max(y0, y1) + half + 1))
    dx, dy = x1 - x0, y1 - y0
    L2 = dx * dx + dy * dy or 1.0
    for y in range(miny, maxy + 1):
        for x in range(minx, maxx + 1):
            t = ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / L2
            t = max(0.0, min(1.0, t))
            px, py = x0 + t * dx, y0 + t * dy
            d = math.hypot(x + 0.5 - px, y + 0.5 - py)
            paint(buf, x, y, color, (half - d) + 0.5)


def rect(buf, x0, y0, x1, y1, color):
    for y in range(max(0, int(y0)), min(N, int(y1))):
        for x in range(max(0, int(x0)), min(N, int(x1))):
            paint(buf, x, y, color, 1.0)


def glyph(buf, kind):
    c = N / 2
    if kind == "check":
        seg(buf, c - 13, c + 1, c - 3, c + 11, 4, WHITE)
        seg(buf, c - 3, c + 11, c + 15, c - 11, 4, WHITE)
    elif kind == "slash":
        seg(buf, c - 13, c - 13, c + 13, c + 13, 4.5, WHITE)
    elif kind == "bang":
        seg(buf, c, c - 14, c, c + 5, 4.5, WHITE)         # stem
        fill_disc(buf, c, c + 13, 3.6, WHITE)             # dot
    elif kind == "arrow":
        seg(buf, c, c - 14, c, c + 13, 4.5, WHITE)        # shaft
        seg(buf, c, c - 14, c - 11, c - 3, 4.5, WHITE)    # left head
        seg(buf, c, c - 14, c + 11, c - 3, 4.5, WHITE)    # right head
    elif kind == "pause":
        rect(buf, c - 11, c - 12, c - 3, c + 12, WHITE)
        rect(buf, c + 3, c - 12, c + 11, c + 12, WHITE)


GLYPH = {
    "disconnected": "slash",
    "insecure": "bang",
    "secure": "check",
    "syncing": "arrow",
    "paused": "pause",
}


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
    out = os.path.join(os.path.dirname(__file__), "states")
    os.makedirs(out, exist_ok=True)
    for name, color in STATES.items():
        buf = blank()
        fill_disc(buf, N / 2, N / 2, N * 0.46, color)
        glyph(buf, GLYPH[name])
        write_png(downsample(buf), os.path.join(out, f"tray-{name}.png"))
        print(f"wrote states/tray-{name}.png")
