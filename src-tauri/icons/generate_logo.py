#!/usr/bin/env python3
"""Build the macOS-style app-icon source from the immich-dock logo.

The master (`logo-master.png`) is the blue cloud + photo-swirl + sync-arrows
mark on a transparent background. This composes it onto an Apple-style
"squircle" (continuous-corner superellipse) that fills ~82% of the canvas, in a
clean off-white, with transparent padding around it — the rounded-tile look
every native macOS dock icon has (macOS does not round icons itself).

Output: `logo-source.png`. Regenerate every platform size from it with:

    pnpm tauri icon src-tauri/icons/logo-source.png

Requires Pillow + numpy.
"""
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(__file__)
MASTER = os.path.join(HERE, "logo-master.png")
OUT = os.path.join(HERE, "logo-source.png")

SIZE = 1024              # output icon size
BODY_FRAC = 0.82         # squircle fraction of the canvas (rest is margin)
CLOUD_FRAC = 0.60        # cloud fraction of the canvas
CORNER_N = 5.0           # superellipse exponent (Apple-like continuous corners)
BG = (247, 248, 250)     # off-white squircle fill


def squircle_mask(size):
    n = size * 2
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    c = (n - 1) / 2.0
    half = n / 2.0
    v = (np.abs(xx - c) / half) ** CORNER_N + (np.abs(yy - c) / half) ** CORNER_N
    hi = Image.fromarray(((v <= 1.0).astype("uint8") * 255), "L")
    return hi.resize((size, size), Image.LANCZOS)


def main():
    cloud = Image.open(MASTER).convert("RGBA")
    a = np.asarray(cloud)
    ys, xs = np.where(a[..., 3] > 0)
    cloud = cloud.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

    body = int(SIZE * BODY_FRAC)
    margin = (SIZE - body) // 2
    panel = Image.new("RGBA", (body, body), BG + (255,))
    panel.putalpha(squircle_mask(body))

    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(panel, (margin, margin), panel)

    t = int(SIZE * CLOUD_FRAC)
    s = t / max(cloud.size)
    cc = cloud.resize((int(cloud.size[0] * s), int(cloud.size[1] * s)), Image.LANCZOS)
    canvas.alpha_composite(cc, ((SIZE - cc.size[0]) // 2, (SIZE - cc.size[1]) // 2))
    canvas.save(OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
