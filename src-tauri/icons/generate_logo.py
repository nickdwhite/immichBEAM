#!/usr/bin/env python3
"""Generate the Immich SyncDesk app logo source (1024x1024, no deps).

Produces logo-source.png: a rounded squircle with an Immich-orange vertical
gradient, a white upload cloud, and a blue up-arrow. Feed it to Tauri:

    pnpm tauri icon src-tauri/icons/logo-source.png

which regenerates icon.png/.icns/.ico and all platform sizes.
"""
import math
import os
import struct
import zlib

S = 1024
TOP = (240, 110, 70)     # warm orange
BOT = (206, 47, 21)      # immich deep red
WHITE = (255, 255, 255)
BLUE = (37, 99, 235)     # brand blue

buf = [[(0.0, 0.0, 0.0, 0.0) for _ in range(S)] for _ in range(S)]


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


def paint(x, y, color, cov):
    if cov <= 0 or x < 0 or y < 0 or x >= S or y >= S:
        return
    r, g, b = color
    buf[y][x] = over(buf[y][x], (r / 255, g / 255, b / 255, min(1.0, cov)))


def rounded_rect_gradient(radius, margin):
    x0, y0, x1, y1 = margin, margin, S - margin, S - margin
    for y in range(S):
        t = y / (S - 1)
        col = (
            TOP[0] + (BOT[0] - TOP[0]) * t,
            TOP[1] + (BOT[1] - TOP[1]) * t,
            TOP[2] + (BOT[2] - TOP[2]) * t,
        )
        for x in range(S):
            # signed distance to rounded rect
            dx = max(x0 + radius - x, x - (x1 - radius), 0)
            dy = max(y0 + radius - y, y - (y1 - radius), 0)
            if x < x0 or x > x1 or y < y0 or y > y1:
                d = 9
            else:
                d = math.hypot(dx, dy) - radius
            paint(x, y, col, (-d) + 0.5 if d > -1 else 1.0)


def disc(cx, cy, rad, color):
    for y in range(max(0, int(cy - rad - 1)), min(S, int(cy + rad + 2))):
        for x in range(max(0, int(cx - rad - 1)), min(S, int(cx + rad + 2))):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            paint(x, y, color, (rad - d) + 0.5)


def rrect(x0, y0, x1, y1, rad, color):
    for y in range(max(0, int(y0)), min(S, int(y1) + 1)):
        for x in range(max(0, int(x0)), min(S, int(x1) + 1)):
            dx = max(x0 + rad - x, x - (x1 - rad), 0)
            dy = max(y0 + rad - y, y - (y1 - rad), 0)
            d = math.hypot(dx, dy) - rad
            paint(x, y, color, (-d) + 0.5)


def seg(x0, y0, x1, y1, half, color):
    for y in range(max(0, int(min(y0, y1) - half - 1)), min(S, int(max(y0, y1) + half + 2))):
        for x in range(max(0, int(min(x0, x1) - half - 1)), min(S, int(max(x0, x1) + half + 2))):
            dx, dy = x1 - x0, y1 - y0
            L2 = dx * dx + dy * dy or 1.0
            t = max(0.0, min(1.0, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / L2))
            px, py = x0 + t * dx, y0 + t * dy
            d = math.hypot(x + 0.5 - px, y + 0.5 - py)
            paint(x, y, color, (half - d) + 0.5)


def write_png(path):
    raw = bytearray()
    for row in buf:
        raw.append(0)
        for (r, g, b, a) in row:
            raw += bytes((int(r * 255), int(g * 255), int(b * 255), int(a * 255)))

    def chunk(typ, data):
        return struct.pack(">I", len(data)) + typ + data + struct.pack(
            ">I", zlib.crc32(typ + data) & 0xFFFFFFFF
        )

    with open(path, "wb") as f:
        f.write(
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b"")
        )


if __name__ == "__main__":
    # Background squircle.
    rounded_rect_gradient(radius=230, margin=40)

    # Upload cloud (white): overlapping puffs + flat base.
    cx = S / 2
    disc(cx - 150, 560, 130, WHITE)
    disc(cx + 150, 560, 150, WHITE)
    disc(cx - 30, 470, 175, WHITE)
    disc(cx + 110, 500, 130, WHITE)
    rrect(cx - 250, 540, cx + 260, 660, 110, WHITE)

    # Blue up-arrow rising out of the cloud.
    ax = cx
    seg(ax, 360, ax, 600, 34, BLUE)          # shaft
    seg(ax, 360, ax - 95, 455, 34, BLUE)     # left head
    seg(ax, 360, ax + 95, 455, 34, BLUE)     # right head

    out = os.path.join(os.path.dirname(__file__), "logo-source.png")
    write_png(out)
    print("wrote", out)
