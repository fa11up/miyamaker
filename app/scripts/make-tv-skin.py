#!/usr/bin/env python3
"""
Renders miyatv's skin to tiling bitmaps, the way early web pages and media players were skinned: walnut veneer, brushed
gold, and a gold moulding with a beaded edge for the title bar. Everything is seeded, so a run gives the same files.
Needs numpy and pillow. Run: python3 scripts/make-tv-skin.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "src/pages/TV/skin"
rng = np.random.default_rng(1961)


def noise(h, w, fx, fy, power=1.5):
    """Noise that tiles both ways: shaped random spectrum, so fx and fy set the feature size along each axis."""
    kx = np.fft.fftfreq(w) * w
    ky = np.fft.fftfreq(h) * h
    gx, gy = np.meshgrid(kx, ky)
    spectrum = 1 / (1 + (gx / fx) ** 2 + (gy / fy) ** 2) ** power
    field = np.fft.ifft2(spectrum * np.exp(2j * np.pi * rng.random((h, w)))).real
    return (field - field.mean()) / field.std()


def colour_map(values, stops):
    """values in 0..1 through a list of (position, (r, g, b))."""
    pos = [s[0] for s in stops]
    return np.stack([np.interp(values, pos, [s[1][c] for s in stops]) for c in range(3)], axis=-1)


def save(name, rgb, quality):
    Image.fromarray(np.clip(rgb, 0, 255).astype("uint8")).save(OUT / name, quality=quality, method=6)
    print(name, (OUT / name).stat().st_size // 1024, "KB")


GOLD = [
    (0.00, (52, 30, 4)),
    (0.22, (122, 82, 16)),
    (0.45, (196, 146, 38)),
    (0.66, (236, 194, 76)),
    (0.84, (255, 232, 148)),
    (1.00, (255, 250, 220)),
]


def wood(size=1024):
    y = np.arange(size)[:, None] / size
    warp = noise(size, size, 1.6, 2.4, 1.8)
    figure = noise(size, size, 3, 14, 1.4)
    rings = 0.5 + 0.5 * np.sin(2 * np.pi * (15 * y + 0.62 * warp + 0.07 * figure))
    rings = rings**1.5
    fibre = noise(size, size, 8, 170, 0.9)
    pores = np.clip(noise(size, size, 14, 420, 0.55) - 1.25, 0, None)
    value = 0.42 + 0.34 * (rings - 0.5) + 0.075 * fibre + 0.05 * figure - 0.2 * pores
    rgb = colour_map(
        np.clip(value, 0, 1),
        [
            (0.00, (28, 12, 5)),
            (0.25, (66, 32, 13)),
            (0.50, (112, 60, 26)),
            (0.72, (156, 92, 44)),
            (1.00, (196, 132, 72)),
        ],
    )
    save("wood.webp", rgb, 82)


def brushed(h, w):
    """0..1 gold brightness: slow reflections rolling across fine brushing."""
    sheen = noise(h, w, 2.5, 3, 2)
    streak = noise(h, w, 6, 200, 0.8)
    return 0.56 + 0.17 * np.sin(2.1 * sheen) + 0.05 * streak


def gold(size=512):
    save("gold.webp", colour_map(np.clip(brushed(size, size), 0, 1), GOLD), 84)


def moulding(w=512, h=76):
    """Across the bar, top to bottom: bright fillet, wide concave band for the title, groove, row of beads."""
    v = np.arange(h)[:, None] * np.ones((1, w))
    base = brushed(h, w) - 0.56
    profile = np.interp(
        v,
        [0, 2, 5, 9, 12, 16, 34, 46, 53, 56, 58, 60],
        [0.1, 0.5, 1.0, 0.72, 0.28, 0.46, 0.60, 0.74, 0.92, 0.5, 0.12, 0.1],
    )
    value = profile + 0.55 * base

    # Beads: each a shaded sphere lit from the upper left, on a period that divides the tile.
    period, radius, cy = 16, 7.0, 67.0
    grid_x, grid_y = np.meshgrid(np.arange(w), np.arange(h))
    dx = ((grid_x + period / 2) % period - period / 2) / radius
    dy = (grid_y - cy) / radius
    r2 = dx**2 + dy**2
    inside = r2 < 1
    nz = np.sqrt(np.clip(1 - r2, 0, 1))
    light = np.array([-0.45, -0.62, 0.64])
    diffuse = np.clip(dx * light[0] + dy * light[1] + nz * light[2], 0, 1)
    spec = np.clip(diffuse, 0, 1) ** 18
    beads = 0.2 + 0.56 * diffuse + 0.5 * spec
    groove = np.clip((grid_y - 58) / 2, 0, 1) * 0.1
    value = np.where(grid_y >= 58, groove, value)
    value = np.where(inside, beads, value)
    save("moulding.webp", colour_map(np.clip(value, 0, 1), GOLD), 88)


def paper(size=512):
    """Cheap newsprint for the printed guide: warm cream, soft mottling, tiny fibres."""
    mottle = noise(size, size, 5, 5, 1.6)
    fibres = noise(size, size, 90, 90, 0.5)
    value = 0.55 + 0.05 * mottle + 0.07 * fibres
    save(
        "paper.webp",
        colour_map(np.clip(value, 0, 1), [(0.0, (214, 198, 160)), (0.5, (240, 228, 198)), (1.0, (250, 242, 220))]),
        80,
    )


if __name__ == "__main__":
    wood()
    gold()
    moulding()
    paper()
