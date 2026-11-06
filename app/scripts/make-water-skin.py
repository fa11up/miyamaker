#!/usr/bin/env python3
"""
Renders Drop Music's background to a tiling bitmap: the classic 90s water tile, deep pool blue crossed by a bright web of
caustic light. Everything is periodic in the tile, so it has no seam. Same picture every run.
Needs numpy and pillow. Run: python3 scripts/make-water-skin.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "src/pages/DropMusic/skin"
TAU = 2 * np.pi


def caustics(size, t):
    """Light focused by a moving surface: a few rounds of bending, then a sharp peak wherever the rays bunch up."""
    v, u = np.mgrid[0:size, 0:size] / size
    px, py = u * TAU - 250, v * TAU - 250
    ix, iy = px.copy(), py.copy()
    c = np.ones((size, size))
    strength = 0.005
    for n in range(5):
        tn = t * (1 - 3.5 / (n + 1))
        nx = px + np.cos(tn - ix) + np.sin(tn + iy)
        ny = py + np.sin(tn - iy) + np.cos(tn + ix)
        ix, iy = nx, ny
        a = px / (np.sin(ix + tn) / strength)
        b = py / (np.cos(iy + tn) / strength)
        c += 1 / np.sqrt(a**2 + b**2)
    c /= 5
    c = 1.17 - c**1.4
    return np.clip(np.abs(c) ** 8, 0, 1)


def water(size=512):
    light = caustics(size, 3.0) * 0.75 + caustics(size, 7.5) * 0.25
    light = np.clip(light * 1.15, 0, 1)
    deep = np.array([18, 92, 196.0])
    bright = np.array([196, 244, 255.0])
    rgb = deep[None, None, :] * (1 - light[..., None]) + bright[None, None, :] * light[..., None]
    # 256 colours' worth of banding, as a tile of the time would have.
    rgb = np.round(rgb / 6) * 6
    Image.fromarray(np.clip(rgb, 0, 255).astype("uint8")).save(OUT / "water.webp", quality=88, method=6)
    print("water.webp", (OUT / "water.webp").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    water()
