#!/usr/bin/env python3
"""
Renders Auction's sale room to tiling bitmaps: oxblood damask wallpaper, cream catalogue paper, mahogany for the title bar,
and burnished gold leaf for the frame, with red bole showing where the leaf has worn. Everything is seeded and periodic, so a
run gives the same picture and the tiles have no seam.
Needs numpy and pillow. Run: python3 scripts/make-auction-skin.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "src/pages/Auction/skin"
rng = np.random.default_rng(1766)


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


def bezier(p0, p1, p2, p3, steps=24):
    t = np.linspace(0, 1, steps)[:, None]
    p0, p1, p2, p3 = (np.array(p, float) for p in (p0, p1, p2, p3))
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t**2 * p2 + t**3 * p3


def motif(draw, cx, cy, s, ink):
    """One palmette in its ogee, drawn on the right and mirrored, as a woven damask repeats."""

    def shape(curves, fill=ink):
        pts = np.vstack([bezier(*c) for c in curves])
        for side in (1, -1):
            draw.polygon([(cx + side * x * s, cy + y * s) for x, y in pts], fill=fill)

    # The central spire and its side leaves.
    shape([((0, -1), (0.1, -0.7), (0.17, -0.5), (0, -0.28)), ((0, -0.28), (0, -0.5), (0, -0.7), (0, -1))])
    for dy, size in ((-0.28, 1.0), (0.02, 1.2), (0.34, 1.0)):
        shape(
            [
                ((0.03, dy + 0.1 * size), (0.2 * size, dy - 0.05), (0.42 * size, dy - 0.28 * size), (0.5 * size, dy - 0.3 * size)),
                ((0.5 * size, dy - 0.3 * size), (0.46 * size, dy + 0.02), (0.26 * size, dy + 0.17 * size), (0.03, dy + 0.1 * size)),
            ]
        )
    shape([((0, 0.42), (0.14, 0.56), (0.13, 0.74), (0, 0.96)), ((0, 0.96), (0, 0.8), (0, 0.6), (0, 0.42))])
    # The ogee's outline, an open line of small leaves.
    for t in np.linspace(0.04, 0.96, 15):
        p = (1 - t) ** 3 * np.array([0, -1.34]) + 3 * (1 - t) ** 2 * t * np.array([0.72, -0.88])
        p = p + 3 * (1 - t) * t**2 * np.array([0.98, -0.34]) + t**3 * np.array([0.74, 0.06])
        for mirror_y, side in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            x, y = cx + side * p[0] * s, cy + mirror_y * p[1] * s
            draw.ellipse([x - 0.042 * s, y - 0.042 * s, x + 0.042 * s, y + 0.042 * s], fill=ink)


def damask(size=512):
    """Tone on tone: the pattern only shows as a change in how the silk takes the light."""
    scale = 3
    big = size * scale
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    s = big * 0.255
    for cx, cy in ((big / 2, big / 2), (0, 0), (big, 0), (0, big), (big, big)):
        motif(draw, cx, cy, s, 255)
    mask = mask.filter(ImageFilter.GaussianBlur(scale * 0.55)).resize((size, size), Image.LANCZOS)
    pattern = np.asarray(mask, float) / 255

    weave = np.sin(np.arange(size) * 2 * np.pi * 128 / size)[:, None] * np.sin(np.arange(size) * 2 * np.pi * 128 / size)[None, :]
    slub = noise(size, size, 6, 90, 0.9)
    sheen = noise(size, size, 2, 2, 2)
    light = 0.33 + 0.055 * sheen + 0.018 * slub + 0.012 * weave + pattern * (0.13 + 0.03 * sheen)
    rgb = colour_map(
        np.clip(light, 0, 1),
        [(0.0, (30, 4, 8)), (0.3, (74, 12, 20)), (0.55, (110, 22, 30)), (0.8, (146, 40, 42)), (1.0, (178, 72, 60))],
    )
    save("damask.webp", rgb, 86)


def paper(size=512):
    """Heavy catalogue stock: laid lines, soft mottling and the odd warm fleck of age."""
    laid = np.sin(np.arange(size) * 2 * np.pi * 96 / size)[:, None] * np.ones((1, size))
    mottle = noise(size, size, 5, 5, 1.6)
    fibres = noise(size, size, 90, 140, 0.5)
    value = 0.62 + 0.03 * mottle + 0.035 * fibres + 0.016 * laid
    rgb = colour_map(np.clip(value, 0, 1), [(0.0, (222, 206, 172)), (0.6, (246, 238, 218)), (1.0, (255, 251, 238))])
    fox = np.clip(noise(size, size, 40, 40, 1.1) - 2.5, 0, 1)
    rgb -= fox[..., None] * np.array([18, 34, 56])
    save("paper.webp", rgb, 82)


def mahogany(size=512):
    y = np.arange(size)[:, None] / size
    warp = noise(size, size, 1.6, 2.4, 1.8)
    figure = noise(size, size, 3, 14, 1.4)
    rings = (0.5 + 0.5 * np.sin(2 * np.pi * (9 * y + 0.6 * warp + 0.06 * figure))) ** 1.4
    fibre = noise(size, size, 8, 170, 0.9)
    pores = np.clip(noise(size, size, 14, 420, 0.55) - 1.25, 0, None)
    value = 0.4 + 0.3 * (rings - 0.5) + 0.07 * fibre + 0.06 * figure - 0.2 * pores
    rgb = colour_map(
        np.clip(value, 0, 1),
        [(0.0, (22, 5, 4)), (0.3, (58, 15, 10)), (0.55, (96, 30, 18)), (0.8, (134, 50, 28)), (1.0, (170, 78, 44))],
    )
    save("mahogany.webp", rgb, 82)


def gilt(size=256):
    """Leaf laid in squares and burnished unevenly; the red clay under it shows through the worn spots."""
    sheen = noise(size, size, 3, 3, 2)
    grain = noise(size, size, 60, 60, 0.7)
    value = 0.58 + 0.16 * np.sin(2.1 * sheen) + 0.035 * grain
    rgb = colour_map(
        np.clip(value, 0, 1),
        [(0.0, (70, 40, 8)), (0.3, (142, 98, 26)), (0.55, (204, 158, 62)), (0.78, (236, 204, 118)), (1.0, (255, 244, 196))],
    )
    wear = np.clip((noise(size, size, 22, 22, 1.2) - 2.0) * 2, 0, 1)
    rgb = rgb * (1 - wear[..., None] * 0.75) + np.array([120, 34, 22]) * wear[..., None] * 0.75
    save("gilt.webp", rgb, 86)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    damask()
    paper()
    mahogany()
    gilt()
