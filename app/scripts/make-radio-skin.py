#!/usr/bin/env python3
"""
Renders miya radio's materials to bitmaps: chrome feathers with a real shaft and barbs for the wings and tail, a liquid
chrome tile for the rim and arms, and a dark violet anodized tile for the heart's plate. The tiles are periodic, so they have
no seam. Same picture every run.
Needs numpy and pillow. Run: python3 scripts/make-radio-skin.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "src/pages/Radio/skin"
TAU = 2 * np.pi
RNG = np.random.default_rng(1999)


def ramp(t, stops):
    """Colors along t, from (position, (r, g, b)) stops."""
    pos = [s[0] for s in stops]
    return np.stack([np.interp(t, pos, [s[1][i] for s in stops]) for i in range(3)], -1)


def wobble(h, w, cells, wrap_x=True):
    """Smooth noise, upscaled from a coarse grid."""
    gx, gy = cells
    grid = RNG.random((gy, gx))
    v, u = np.mgrid[0:h, 0:w]
    x, y = u / w * gx, v / h * gy
    x0, y0 = x.astype(int), y.astype(int)
    fx, fy = x - x0, y - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    x1, y1 = (x0 + 1) % gx if wrap_x else np.minimum(x0 + 1, gx - 1), (y0 + 1) % gy
    a = grid[y0, x0] * (1 - fx) + grid[y0, x1] * fx
    b = grid[y1, x0] * (1 - fx) + grid[y1, x1] * fx
    return a * (1 - fy) + b * fy


# The chrome of the old gradients, with a thin violet and pink shift where the horizon reflects.
CHROME = [
    (0.0, (250, 252, 255)),
    (0.2, (178, 190, 224)),
    (0.42, (44, 44, 92)),
    (0.47, (22, 18, 52)),
    (0.5, (226, 214, 250)),
    (0.56, (255, 255, 255)),
    (0.72, (116, 128, 176)),
    (0.88, (46, 44, 92)),
    (1.0, (12, 12, 32)),
]


def feather(w, h, shaft, bend, gain, name):
    """
    x runs from the shoulder to the tip, y across. `shaft`: where the shaft starts and ends across the height, matching the
    feather's outline in heartGeometry.ts.
    """
    v, u = np.mgrid[0:h, 0:w].astype(float)
    x, y = u / w, v / h
    centre = shaft[0] + (shaft[1] - shaft[0]) * x
    off = y - centre

    # Each side of the shaft is one chrome roll, so the feather bulges instead of lying flat.
    roll = np.where(off < 0, 0.5 + off * 1.5, 0.5 + off * 1.15)
    roll += (wobble(h, w, (9, 5)) - 0.5) * 0.09 + (x - 0.5) * bend
    rgb = ramp(np.clip(roll, 0, 1), CHROME)

    # Barbs are single strands sweeping from the shaft toward the tip. Each has its own brightness, and now and then one
    # parts from its neighbour in a thin slit that opens toward the feather's edge.
    strands = int(w * 0.075)
    warp = (wobble(h, w, (14, 4)) - 0.5) * 0.9
    phase = strands * (x - np.abs(off) * 0.43) + warp + np.where(off < 0, 0.37, 0)
    index = np.floor(phase).astype(int)
    across = phase - index
    side = (off < 0).astype(int)
    tone = RNG.random((strands * 3, 2))
    key = (index + strands) % (strands * 3)
    round_barb = np.sin(across * np.pi) ** 0.7
    rgb *= (0.5 + 0.56 * round_barb + 0.2 * (tone[key, side] - 0.5))[..., None]
    parts = RNG.random((strands * 3, 2)) > 0.9
    opening = np.clip((np.abs(off) - 0.05) * 7, 0, 1)
    slit = parts[key, side] * np.clip(1 - np.abs(across - 0.5) / (0.5 * opening + 1e-3), 0, 1) * opening
    rgb *= (1 - 0.88 * np.clip(slit * 1.6, 0, 1))[..., None]

    # A soft violet sheen along the length, then the shaft itself on top.
    sheen = np.exp(-(((x - 0.62) / 0.3) ** 2)) * np.exp(-((off / 0.16) ** 2))
    rgb += sheen[..., None] * np.array([46, 22, 74])
    halfwidth = 0.024 * (1.25 - x)
    core = np.exp(-((off / halfwidth) ** 2))
    glint = np.exp(-(((off + halfwidth * 0.4) / (halfwidth * 0.5)) ** 2))
    rgb = rgb * (1 - core[..., None] * 0.92) + core[..., None] * np.array([58, 60, 104])
    rgb += glint[..., None] * np.array([190, 195, 215])

    # Dark and downy at the root, where it tucks under the heart; the tip stays bright.
    root = np.clip(x / 0.26, 0, 1)
    rgb *= (0.42 + 0.58 * root)[..., None]
    rgb = np.clip(rgb * gain, 0, 255).astype(np.uint8)
    Image.fromarray(rgb).save(OUT / name, quality=84, method=6)


def chrome_tile(size, name):
    """Liquid chrome: a horizon line bent around by soft bumps."""
    v, u = np.mgrid[0:size, 0:size] / size
    bumps = 0.07 * np.sin(TAU * (u * 2 + 0.3 * np.sin(TAU * v))) + 0.05 * np.sin(TAU * (u * 3 - v + 0.2))
    bumps += 0.035 * np.sin(TAU * (u * 5 + v * 2)) + (wobble(size, size, (12, 12)) - 0.5) * 0.08
    t = (v + bumps) % 1
    rgb = ramp(t, CHROME)
    # The ramp's two ends meet here, so the bands wrap without a line.
    fade = np.clip((t - 0.9) / 0.1, 0, 1)[..., None]
    rgb = rgb * (1 - fade) + np.array([250, 252, 255]) * fade
    grain = RNG.normal(0, 3.5, (size, size, 1))
    Image.fromarray(np.clip(rgb + grain, 0, 255).astype(np.uint8)).save(OUT / name, quality=86, method=6)


def plate_tile(size, name):
    """Dark violet anodized metal: fine diagonal brushing with a metal fleck."""
    v, u = np.mgrid[0:size, 0:size]
    brush = sum(np.sin(TAU * (n * (u + v) / size + RNG.random())) * RNG.random() / np.sqrt(n) for n in range(30, 120, 3))
    brush = brush / np.abs(brush).max()
    base = np.array([44, 22, 76]) + brush[..., None] * np.array([17, 11, 26])
    base *= (0.85 + 0.3 * wobble(size, size, (6, 6)))[..., None]
    flecks = RNG.random((size, size)) > 0.992
    base[flecks] += np.array([90, 70, 130])
    Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).save(OUT / name, quality=88, method=6)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    # Wing feathers: the image spans across = -40..40 and the shaft runs -6 to -14.4 of it (heartGeometry.ts).
    feather(1024, 200, (0.425, 0.32), 0.0, 1.0, "feather.webp")
    feather(1024, 200, (0.425, 0.32), 0.06, 0.62, "feather-back.webp")
    feather(512, 160, (0.5, 0.5), 0.0, 0.9, "feather-tail.webp")
    chrome_tile(512, "chrome.webp")
    plate_tile(512, "plate.webp")
    for f in sorted(OUT.iterdir()):
        print(f.name, f.stat().st_size)
