/**
 * Each app's boot scene, its own idea in its own look, played when the app loads, the way programs once had to. `draw` gets
 * the seconds since the start and the size, and repaints the lot each frame, so a scene is only a function of time. A
 * `pixel` scene draws on a tiny canvas shown with hard square pixels: flat colours, checker dithering and bitmap type.
 * Pure of app imports, so `node --test` can check the list against the apps.
 */
export type Scene = {
  ms: number
  pixel?: boolean
  /** A fixed picture size, in scene pixels, for a scene smaller than its window. */
  size?: [number, number]
  draw: (g: CanvasRenderingContext2D, t: number, w: number, h: number) => void
}

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const part = (t: number, from: number, to: number) => clamp((t - from) / (to - from))

/** The same scatter every run. */
const seeded = (seed: number) => {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

/* ── pixels ────────────────────────────────────────────────────────────── */

const box = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) => {
  g.fillStyle = c
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

const checkers = new Map<string, HTMLCanvasElement>()
const checker = (g: CanvasRenderingContext2D, a: string, b: string) => {
  const key = `${a}${b}`
  let tile = checkers.get(key)
  if (!tile) {
    tile = document.createElement('canvas')
    tile.width = 2
    tile.height = 2
    const t = tile.getContext('2d')!
    t.fillStyle = a
    t.fillRect(0, 0, 2, 2)
    t.fillStyle = b
    t.fillRect(0, 0, 1, 1)
    t.fillRect(1, 1, 1, 1)
    checkers.set(key, tile)
  }
  return g.createPattern(tile, 'repeat')!
}

/** A top-to-bottom fade the old way: bands of flat colour with a checkered band between each. */
const ramp = (g: CanvasRenderingContext2D, w: number, h: number, colours: string[]) => {
  const bands = colours.length * 2 - 1
  const tall = Math.ceil(h / bands)
  for (let i = 0; i < bands; i += 1) {
    g.fillStyle = i % 2 === 0 ? colours[i / 2]! : checker(g, colours[(i - 1) / 2]!, colours[(i + 1) / 2]!)
    g.fillRect(0, i * tall, w, tall)
  }
}

/** The 5×7 letters of old text modes: seven rows per glyph, as hex, with the top bit on the left. */
const FONT: Record<string, string> = {
  A: '0E11111F111111',
  B: '1E11111E11111E',
  C: '0E11101010110E',
  D: '1E11111111111E',
  E: '1F10101E10101F',
  F: '1F10101E101010',
  G: '0E11101711110F',
  H: '1111111F111111',
  I: '0E04040404040E',
  J: '0702020202120C',
  K: '11121418141211',
  L: '1010101010101F',
  M: '111B1515111111',
  N: '11111915131111',
  O: '0E11111111110E',
  P: '1E11111E101010',
  Q: '0E11111115120D',
  R: '1E11111E141211',
  S: '0F10100E01011E',
  T: '1F040404040404',
  U: '1111111111110E',
  V: '11111111110A04',
  W: '1111111515150A',
  X: '11110A040A1111',
  Y: '1111110A040404',
  Z: '1F01020408101F',
  '0': '0E11131519110E',
  '1': '040C040404040E',
  '2': '0E11010204081F',
  '3': '1F02040201110E',
  '4': '02060A121F0202',
  '5': '1F101E0101110E',
  '6': '0608101E11110E',
  '7': '1F010204080808',
  '8': '0E11110E11110E',
  '9': '0E11110F01020C',
  '.': '00000000000C0C',
  '!': '04040404000004',
}
export const typeWidth = (text: string, size: number) => (text.length * 6 - 1) * size

export const type = (g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, c: string) => {
  g.fillStyle = c
  Array.from(text).forEach((letter, i) => {
    const glyph = FONT[letter]
    const left = Math.round(x) + i * 6 * size
    if (!glyph || left > g.canvas.width || left + 5 * size < 0) return
    for (let row = 0; row < 7; row += 1) {
      const bits = parseInt(glyph.slice(row * 2, row * 2 + 2), 16)
      for (let col = 0; col < 5; col += 1) {
        if (bits & (16 >> col)) g.fillRect(left + col * size, Math.round(y) + row * size, size, size)
      }
    }
  })
}

const centred = (g: CanvasRenderingContext2D, text: string, w: number, y: number, size: number, c: string) =>
  type(g, text, Math.round((w - typeWidth(text, size)) / 2), Math.round(y), size, c)

/** Letters arriving one at a time, with a hard shadow. */
const typedTitle = (
  g: CanvasRenderingContext2D,
  text: string,
  w: number,
  y: number,
  size: number,
  c: string,
  shadow: string,
  shown: number,
) => {
  const x = Math.round((w - typeWidth(text, size)) / 2)
  const now = text.slice(0, Math.floor(shown * text.length))
  type(g, now, x + size, Math.round(y) + size, size, shadow)
  type(g, now, x, Math.round(y), size, c)
}

/** A progress bar of separate blocks. */
const blocks = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  done: number,
  c: string,
  edge: string,
) => {
  box(g, x, y, w, 9, edge)
  box(g, x + 1, y + 1, w - 2, 7, '#000')
  const n = Math.floor((w - 4) / 6)
  for (let i = 0; i < Math.floor(n * done); i += 1) box(g, x + 2 + i * 6, y + 2, 5, 5, c)
}

/** A thick line of square pixels, with no blurred edges. */
const blockLine = (
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thick: number,
  c: string,
) => {
  const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)))
  for (let i = 0; i <= steps; i += 1) {
    const f = steps ? i / steps : 0
    box(g, x0 + (x1 - x0) * f - thick / 2, y0 + (y1 - y0) * f - thick / 2, thick, thick, c)
  }
}

/* ── the scenes ────────────────────────────────────────────────────────── */

/** miyanet: 1996. A beige computer dials out to a pixel globe, packets running down the line. */
const miyanet: Scene = {
  ms: 2300,
  pixel: true,
  draw(g, t, w, h) {
    ramp(g, w, h, ['#140b45', '#2a1a6e', '#4a2a9e', '#6a3fc0'])
    const rnd = seeded(31)
    for (let i = 0; i < 40; i += 1) {
      const x = rnd() * w
      const y = rnd() * h * 0.6
      if ((Math.floor(t * 5) + i) % 5) box(g, x, y, 1, 1, '#e8e4ff')
    }
    const cx = Math.round(w / 2)
    const cy = Math.round(h * 0.54)
    const spread = Math.min(70, w * 0.3)
    // The computer.
    const px = cx - spread
    box(g, px - 15, cy - 13, 30, 22, '#c9c3b2')
    box(g, px - 15, cy - 13, 30, 1, '#f1ede0')
    box(g, px - 12, cy - 10, 24, 16, '#0a1a6e')
    box(g, px - 18, cy + 9, 36, 7, '#b3ad9c')
    box(g, px + 9, cy + 11, 6, 2, '#3a3a3a')
    if (t > 0.3) box(g, px - 9, cy - 7, 4 + (Math.floor(t * 8) % 14), 2, '#7dff9a')
    // The globe.
    const gx = cx + spread
    const r = 15
    for (let y = -r; y <= r; y += 1) {
      const half = Math.round(Math.sqrt(r * r - y * y))
      box(g, gx - half, cy + y, half * 2 + 1, 1, '#1f6fd6')
    }
    ;[
      [-9, -9, 9, 6],
      [-4, -3, 6, 8],
      [4, -11, 8, 5],
      [3, 3, 7, 7],
      [-11, 6, 6, 3],
    ].forEach(([a, b, c, d]) => box(g, gx + a!, cy + b!, c!, d!, '#3ddc84'))
    box(g, gx - 8, cy - 12, 5, 2, '#bfe4ff')
    // The line.
    const from = px + 18
    const to = gx - r - 3
    for (let x = from; x < to; x += 4) box(g, x, cy, 2, 1, '#8d7ad6')
    if (t > 0.3) {
      for (let i = 0; i < 3; i += 1) {
        box(g, from + (((t * 60 + i * 22) % 1000) % (to - from)), cy - 1, 3, 3, '#9ffcff')
      }
    }
    typedTitle(g, 'MIYANET', w, h * 0.17, 3, '#ffffff', '#2a1a6e', part(t, 0.1, 0.9))
    const done = part(t, 0.3, 2)
    centred(g, done < 1 ? 'CONNECTING...' : 'CONNECTED', w, h * 0.78, 1, '#e8e4ff')
    blocks(g, cx - 50, h * 0.84, 100, done, '#7dff9a', '#c9c3b2')
  },
}

/** Trade: an amber terminal, with chunky candles marching across a dotted grid. */
const trade: Scene = {
  ms: 2000,
  pixel: true,
  draw(g, t, w, h) {
    box(g, 0, 0, w, h, '#0a0f13')
    for (let y = 16; y < h - 14; y += 16) for (let x = 0; x < w; x += 4) box(g, x, y, 1, 1, '#3a2c08')
    for (let x = 16; x < w; x += 16) for (let y = 0; y < h - 14; y += 4) box(g, x, y, 1, 1, '#3a2c08')
    const rnd = seeded(77)
    const n = Math.floor(w / 7)
    let price = h * 0.62
    for (let i = 0; i < n; i += 1) {
      const next = Math.max(h * 0.28, Math.min(h * 0.76, price - (rnd() - 0.44) * 18))
      const wick = 2 + Math.floor(rnd() * 5)
      if (t > 0.1 + (i / n) * 1.1) {
        const up = next < price
        const top = Math.round(Math.min(price, next))
        const tall = Math.max(2, Math.round(Math.abs(next - price)))
        const c = up ? '#3ddc84' : '#ff5a4d'
        box(g, i * 7 + 3, top - wick, 1, tall + wick * 2, c)
        box(g, i * 7 + 1, top, 5, tall, c)
      }
      price = next
    }
    typedTitle(g, 'TRADE', w, h * 0.12, 4, '#ffb000', '#5a3d00', part(t, 0.9, 1.4))
    box(g, 0, h - 12, w, 12, '#ffb000')
    const tape = 'ETH  WBTC  INFER  IMDUSD  IMD  CULT  '.repeat(4)
    type(g, tape, 2 - Math.floor(t * 40), h - 9, 1, '#0a0f13')
  },
}

/** Launch: gold laurel leaves click on one by one, on dithered green stone, then a sparkle. */
const launch: Scene = {
  ms: 2300,
  pixel: true,
  draw(g, t, w, h) {
    ramp(g, w, h, ['#04201a', '#0a3527', '#0d4a36', '#0a3527'])
    const rnd = seeded(5)
    for (let i = 0; i < 26; i += 1) {
      const x = rnd() * w
      const y = rnd() * h
      blockLine(g, x, y, x + 6 + rnd() * 14, y + (rnd() - 0.5) * 8, 1, '#0f5a42')
    }
    const cx = Math.round(w / 2)
    const cy = Math.round(h * 0.47)
    const r = Math.min(w, h) * 0.33
    const leaves = 11
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < leaves; i += 1) {
        if (t > 0.15 + i * 0.09) {
          const a = Math.PI / 2 + side * (0.22 + (i / leaves) * 2.55)
          const x = cx + Math.cos(a) * r
          const y = cy + Math.sin(a) * r
          const tx = -Math.sin(a) * side
          const ty = Math.cos(a) * side
          const c = i % 2 ? '#f3dc9a' : '#c9a24c'
          blockLine(g, x, y, x + tx * 6 + Math.cos(a) * 3, y + ty * 6 + Math.sin(a) * 3, 3, c)
          blockLine(g, x, y, x + tx * 6 - Math.cos(a) * 2, y + ty * 6 - Math.sin(a) * 2, 2, '#8a6d24')
        }
      }
    }
    typedTitle(g, 'LAUNCH', w, cy - 6, 2, '#f3e7c2', '#04201a', part(t, 1.3, 1.8))
    if (t > 1.5) {
      ;[
        [cx - r * 0.6, cy - r * 0.7],
        [cx + r * 0.7, cy - r * 0.35],
        [cx + r * 0.1, cy + r * 1.15],
      ].forEach(([x, y], i) => {
        const size = (Math.floor(t * 8) + i) % 3
        box(g, x! - size, y!, size * 2 + 1, 1, '#fffbe0')
        box(g, x!, y! - size, 1, size * 2 + 1, '#fffbe0')
      })
    }
  },
}

const KNOCKS = [0.45, 0.95, 1.45]
const GAVEL_WORDS = ['GOING', 'GOING', 'SOLD!']
/** How far up the gavel is, in radians: three poses and no in-betweens, as a small sprite would be. */
const gavelPose = (t: number) => {
  if (t >= KNOCKS[2]!) return 0
  for (const at of KNOCKS) {
    if (t >= at - 0.1 && t < at) return 0.45
    if (t >= at && t < at + 0.1) return 0
    if (t >= at + 0.1 && t < at + 0.2) return 0.45
  }
  return 0.9
}

/** Auction's opening banner, in the sale room's velvet and gilt: the gavel knocks three times beside the name. */
export const auctionBanner: Scene = {
  ms: 2100,
  pixel: true,
  size: [200, 84],
  draw(g, t, w, h) {
    ramp(g, w, h, ['#2b060c', '#4a0b14', '#6a111d', '#4a0b14'])
    ;[0, 3].forEach((inset, i) => {
      const c = i ? '#8a6d24' : '#c9a24c'
      box(g, inset, inset, w - inset * 2, i ? 1 : 2, c)
      box(g, inset, h - inset - (i ? 1 : 2), w - inset * 2, i ? 1 : 2, c)
      box(g, inset, inset, i ? 1 : 2, h - inset * 2, c)
      box(g, w - inset - (i ? 1 : 2), inset, i ? 1 : 2, h - inset * 2, c)
    })
    const cx = 48
    const top = 62
    // The sound block.
    box(g, cx - 25, top, 50, 4, '#a56a2a')
    box(g, cx - 25, top, 50, 1, '#d6994d')
    box(g, cx - 30, top + 4, 60, 5, '#6b3a16')
    box(g, cx - 30, top + 9, 60, 1, '#2b1608')
    // The gavel: pivots at the hand on the right, and its head falls on the block.
    const a = gavelPose(t)
    const long = 36
    const hx = cx + 26
    const hy = top - 7
    const headX = hx - Math.cos(a) * long
    const headY = hy - Math.sin(a) * long
    blockLine(g, hx, hy, headX, headY, 2, '#8a4f1f')
    const nx = Math.sin(a) * 6
    const ny = -Math.cos(a) * 6
    blockLine(g, headX + nx, headY + ny, headX - nx, headY - ny, 10, '#6b3a16')
    blockLine(g, headX + nx, headY + ny, headX - nx * 0.4, headY - ny * 0.4, 3, '#8a4f1f')
    const bandX = Math.cos(a) * 3
    const bandY = Math.sin(a) * 3
    blockLine(g, headX + nx + bandX, headY + ny + bandY, headX - nx + bandX, headY - ny + bandY, 1, '#c9a24c')
    blockLine(g, headX + nx - bandX, headY + ny - bandY, headX - nx - bandX, headY - ny - bandY, 1, '#c9a24c')
    // What the knock throws off.
    KNOCKS.forEach((at) => {
      const d = t - at
      if (d >= 0 && d < 0.18) {
        const far = 4 + d * 70
        for (let i = 0; i < 6; i += 1) {
          const dir = Math.PI + (i / 5) * Math.PI
          box(g, cx - 10 + Math.cos(dir) * far * 1.5, top - 1 + Math.sin(dir) * far * 0.6, 1, 1, '#f4dd9c')
        }
      }
    })
    const x = 100
    const wide = w - x - 8
    type(g, 'AUCTION', x + (wide - typeWidth('AUCTION', 2)) / 2 + 1, 23, 2, '#2b060c')
    type(g, 'AUCTION', x + (wide - typeWidth('AUCTION', 2)) / 2, 22, 2, '#f4dd9c')
    box(g, x + 4, 39, wide - 8, 1, '#8a6d24')
    const said = KNOCKS.filter((at) => t >= at).length
    if (said) {
      const word = GAVEL_WORDS[said - 1]!
      type(g, word, x + (wide - typeWidth(word, 1)) / 2, 46, 1, '#c9a24c')
    }
  },
}

/** MiyaMusicMaker: a 4x4 pad grid lighting up on the beat, a level meter bouncing beside it. */
const music: Scene = {
  ms: 2200,
  pixel: true,
  draw(g, t, w, h) {
    ramp(g, w, h, ['#2a0f3a', '#45175e', '#6a2a8a', '#8d3fb0'])
    const pad = 13
    const gap = 3
    const grid = pad * 4 + gap * 3
    const gx = Math.round(w / 2 - grid / 2 - 10)
    const gy = Math.round(h * 0.34)
    // A kick-snare-hat pattern: which pads light on each sixteenth.
    const steps = [[0, 15], [10], [5, 10], [10], [3, 15], [10], [5, 10, 12], [10]]
    const step = Math.floor(t * 8) % steps.length
    for (let i = 0; i < 16; i += 1) {
      const x = gx + (i % 4) * (pad + gap)
      const y = gy + Math.floor(i / 4) * (pad + gap)
      const lit = t > 0.25 && steps[step]!.includes(i)
      box(g, x, y, pad, pad, lit ? '#ff7ad9' : '#3a1850')
      box(g, x, y, pad, 1, lit ? '#ffd1f3' : '#5a2a78')
    }
    // The meter: higher on the beat, falling between.
    const mx = gx + grid + 10
    const level = t > 0.25 ? 0.35 + 0.6 * Math.abs(Math.sin(t * Math.PI * 4)) : 0
    const bars = 12
    for (let i = 0; i < bars; i += 1) {
      const on = i < Math.round(level * bars)
      const c = i > 9 ? '#ff5a5a' : i > 6 ? '#ffd54a' : '#7dff9a'
      box(g, mx, gy + grid - (i + 1) * 5 + 1, 8, 4, on ? c : '#2a1040')
    }
    typedTitle(g, 'MUSICMAKER', w, h * 0.15, 2, '#ffffff', '#2a0f3a', part(t, 0.05, 0.8))
    const done = part(t, 0.3, 2)
    centred(g, done < 1 ? 'LOADING KIT...' : 'READY', w, h * 0.8, 1, '#f3d9ff')
    blocks(g, Math.round(w / 2) - 50, h * 0.86, 100, done, '#ff7ad9', '#c9a6e0')
  },
}

/**
 * By page id. The rest boot inside themselves, or not at all: Mint on its own screen, Infinite Upload's disc, miyaTV's picture
 * tube, Drop Music's studio and Auction's banner. MiyaMusicMaker boots on its pads. My Files, Display, the radio and Manager open straight away.
 */
export const SCENES: Record<string, Scene> = {
  home: miyanet,
  swap: trade,
  launch,
  music,
}
