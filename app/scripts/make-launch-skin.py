#!/usr/bin/env python3
"""
Renders Launch's materials to tiling bitmaps: polished malachite, the banded green stone, and brushed champagne gold for the
trim. Everything is seeded and periodic, so a run gives the same picture and the tiles have no seam.
Needs numpy and pillow. Run: python3 scripts/make-launch-skin.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "src/pages/Launch/skin"
rng = np.random.default_rng(1837)


def noise(h, w, fx, fy, power=1.5):
    """Noise that tiles both ways: a shaped random spectrum, so fx and fy set the feature size along each axis."""
    gx, gy = np.meshgrid(np.fft.fftfreq(w) * w, np.fft.fftfreq(h) * h)
    spectrum = 1 / (1 + (gx / fx) ** 2 + (gy / fy) ** 2) ** power
    field = np.fft.ifft2(spectrum * np.exp(2j * np.pi * rng.random((h, w)))).real
    return (field - field.mean()) / field.std()


def colour_map(values, stops):
    pos = [s[0] for s in stops]
    return np.stack([np.interp(values, pos, [s[1][c] for s in stops]) for c in range(3)], axis=-1)


def save(name, rgb, quality):
    Image.fromarray(np.clip(rgb, 0, 255).astype("uint8")).save(OUT / name, quality=quality, method=6)
    print(name, (OUT / name).stat().st_size // 1024, "KB")


def malachite(size=768):
    """Rings grown around a few seeds, as the stone forms, warped and then cut across by a polish."""
    v, u = np.mgrid[0:size, 0:size] / size
    seeds = [(0.2, 0.25, 1.0), (0.72, 0.18, 0.8), (0.5, 0.68, 1.15), (0.92, 0.72, 0.75), (0.14, 0.86, 0.85)]
    warp_x, warp_y = noise(size, size, 2.2, 2.2, 1.9), noise(size, size, 2.2, 2.2, 1.9)
    fine = noise(size, size, 9, 9, 1.5)
    distance = np.full((size, size), 9.0)
    for sx, sy, weight in seeds:
        dx = (u - sx + 0.5 + 0.035 * warp_x) % 1 - 0.5
        dy = (v - sy + 0.5 + 0.035 * warp_y) % 1 - 0.5
        distance = np.minimum(distance, np.hypot(dx, dy) / weight)
    bands = distance * 58 + 0.5 * fine
    wave = 0.5 + 0.5 * np.sin(2 * np.pi * bands / 2.2)
    thin = (0.5 + 0.5 * np.sin(2 * np.pi * bands * 1.5)) ** 8
    value = 0.26 + 0.3 * wave**1.5 + 0.09 * thin + 0.025 * fine
    rgb = colour_map(
        np.clip(value, 0, 1),
        [(0.0, (3, 28, 22)), (0.28, (6, 58, 44)), (0.5, (10, 92, 68)), (0.72, (22, 116, 86)), (1.0, (72, 164, 128))],
    )
    save("malachite.webp", rgb, 84)


def gold(size=512):
    sheen = noise(size, size, 2.5, 3, 2)
    streak = noise(size, size, 6, 200, 0.8)
    value = 0.62 + 0.05 * np.sin(2.1 * sheen) + 0.045 * streak
    rgb = colour_map(
        np.clip(value, 0, 1),
        [(0.0, (92, 70, 28)), (0.35, (164, 134, 74)), (0.6, (214, 188, 128)), (0.82, (240, 224, 178)), (1.0, (255, 250, 228))],
    )
    save("gold.webp", rgb, 84)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    malachite()
    gold()
