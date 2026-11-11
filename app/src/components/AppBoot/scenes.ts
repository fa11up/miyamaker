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

/* ── shapes ────────────────────────────────────────────────────────────── */

/** A box with its four corner pixels cut, the way small sprites round off. */
const softBox = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string, cut = 1) => {
  for (let i = 0; i < cut; i += 1) {
    box(g, x + cut - i, y + i, w - (cut - i) * 2, 1, c)
    box(g, x + cut - i, y + h - 1 - i, w - (cut - i) * 2, 1, c)
  }
  box(g, x, y + cut, w, h - cut * 2, c)
}

/** A filled disc, row by row, so its edge is hard pixels. */
const disc = (g: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: string | CanvasPattern) => {
  g.fillStyle = c
  for (let y = -r; y <= r; y += 1) {
    const half = Math.round(Math.sqrt(r * r - y * y))
    g.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2 + 1, 1)
  }
}

/** Draw inside a rectangle only, with that rectangle's top left as 0, 0. */
const inside = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, draw: () => void) => {
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  g.translate(x, y)
  draw()
  g.restore()
}

/* ── the scenes ────────────────────────────────────────────────────────── */
/*
 * Each is a small card with its own outline, not a window-sized picture: a monitor, a ticker board, a coin, a banner,
 * a sampler. The card is drawn at `size` and shown at a whole multiple of it, so every pixel stays square.
 */

/** miyanet: a beige 1996 monitor dials out. On its screen, packets run down the line to a pixel globe. */
const miyanet: Scene = {
  ms: 2300,
  pixel: true,
  size: [128, 112],
  draw(g, t, w) {
    const done = part(t, 0.3, 2)
    // Stand and base.
    box(g, 50, 86, 28, 10, '#a39d8a')
    box(g, 50, 86, 28, 2, '#7d7867')
    softBox(g, 26, 96, 76, 12, '#c9c3b2', 2)
    box(g, 30, 98, 68, 1, '#f1ede0')
    box(g, 28, 106, 72, 2, '#a39d8a')
    // The case.
    softBox(g, 2, 2, w - 4, 86, '#2b2a24', 3)
    softBox(g, 3, 3, w - 6, 84, '#c9c3b2', 3)
    box(g, 6, 4, w - 12, 2, '#f1ede0')
    box(g, 4, 6, 2, 76, '#f1ede0')
    box(g, w - 6, 6, 2, 78, '#a39d8a')
    box(g, 6, 84, w - 12, 2, '#a39d8a')
    // The screen.
    box(g, 10, 9, w - 20, 66, '#4a4638')
    inside(g, 11, 10, w - 22, 64, () => {
      const sw = w - 22
      ramp(g, sw, 64, ['#0a1a6e', '#140b45', '#2a1a6e'])
      const rnd = seeded(31)
      for (let i = 0; i < 18; i += 1) {
        const x = rnd() * sw
        const y = rnd() * 30
        if ((Math.floor(t * 5) + i) % 5) box(g, x, y, 1, 1, '#c9c4ff')
      }
      typedTitle(g, 'MIYANET', sw, 5, 2, '#ffffff', '#2a1a6e', part(t, 0.1, 0.8))
      // A little desktop on the left, the globe on the right, the line between.
      const cy = 32
      box(g, 8, cy - 5, 12, 9, '#c9c3b2')
      box(g, 9, cy - 4, 10, 6, '#1f6fd6')
      box(g, 6, cy + 4, 16, 3, '#a39d8a')
      const gx = sw - 16
      disc(g, gx, cy, 9, '#1f6fd6')
      ;[
        [-6, -5, 6, 4],
        [-2, -1, 4, 5],
        [3, -7, 5, 3],
        [2, 2, 5, 4],
      ].forEach(([a, b, c, d]) => box(g, gx + a!, cy + b!, c!, d!, '#3ddc84'))
      box(g, gx - 5, cy - 8, 3, 1, '#bfe4ff')
      const from = 24
      const to = gx - 12
      for (let x = from; x < to; x += 3) box(g, x, cy, 1, 1, '#8d7ad6')
      if (t > 0.3 && done < 1) {
        for (let i = 0; i < 3; i += 1) box(g, from + ((t * 50 + i * 20) % (to - from)), cy - 1, 2, 3, '#9ffcff')
      }
      if (done >= 1) box(g, gx - 1, cy - 12, 3, 3, (Math.floor(t * 6) % 2) ? '#9ffcff' : '#ffffff')
      centred(g, done < 1 ? 'DIALING...' : 'CONNECTED', sw, 44, 1, '#e8e4ff')
      blocks(g, Math.round(sw / 2) - 40, 53, 80, done, '#7dff9a', '#8d7ad6')
    })
    // Scanlines over the glass.
    for (let y = 11; y < 74; y += 2) {
      g.fillStyle = 'rgba(0,0,0,0.18)'
      g.fillRect(11, y, w - 22, 1)
    }
    // Badge, modem lights and the power light.
    box(g, 12, 78, 22, 3, '#a39d8a')
    const rx = Math.floor(t * 9) % 3 !== 0 && done < 1
    const tx = Math.floor(t * 7) % 2 === 0 && done < 1
    box(g, w - 34, 78, 3, 3, rx ? '#ffd54a' : '#5a5236')
    box(g, w - 28, 78, 3, 3, tx ? '#ff5a4d' : '#5a2a24')
    box(g, w - 19, 77, 5, 5, '#2b2a24')
    box(g, w - 18, 78, 3, 3, '#7dff9a')
  },
}

/** Trade: an amber ticker board, bolted on. Candles march across, the name comes up, the tape runs underneath. */
const trade: Scene = {
  ms: 2000,
  pixel: true,
  size: [224, 64],
  draw(g, t, w, h) {
    softBox(g, 0, 0, w, h, '#ffb000', 2)
    softBox(g, 1, 1, w - 2, h - 2, '#5a3d00', 2)
    softBox(g, 3, 3, w - 6, h - 6, '#0a0f13', 1)
    ;[
      [5, 5],
      [w - 7, 5],
      [5, h - 7],
      [w - 7, h - 7],
    ].forEach(([x, y]) => {
      box(g, x!, y!, 2, 2, '#c98a00')
      box(g, x!, y!, 1, 1, '#ffe08a')
    })
    // The chart, left.
    inside(g, 10, 8, 102, 40, () => {
      for (let y = 8; y < 40; y += 8) for (let x = 0; x < 102; x += 3) box(g, x, y, 1, 1, '#3a2c08')
      const rnd = seeded(77)
      const n = 14
      let price = 32
      for (let i = 0; i < n; i += 1) {
        const next = Math.max(4, Math.min(36, price - (rnd() - 0.4) * 16))
        const wick = 1 + Math.floor(rnd() * 3)
        if (t > 0.1 + (i / n) * 1.0) {
          const up = next < price
          const top = Math.round(Math.min(price, next))
          const tall = Math.max(2, Math.round(Math.abs(next - price)))
          const c = up ? '#3ddc84' : '#ff5a4d'
          box(g, i * 7 + 3, top - wick, 1, tall + wick * 2, c)
          box(g, i * 7 + 1, top, 5, tall, c)
        }
        price = next
      }
    })
    box(g, 116, 8, 1, 40, '#3a2c08')
    // The name and a live number, right.
    const tx = 120
    const tw = w - tx - 8
    type(g, 'TRADE', tx + Math.round((tw - typeWidth('TRADE', 3)) / 2) + 1, 12, 3, '#5a3d00')
    type(g, 'TRADE', tx + Math.round((tw - typeWidth('TRADE', 3)) / 2), 11, 3, '#ffb000')
    if (t > 0.6) {
      const n = (1 + Math.min(1, t / 1.6) * 0.042).toFixed(4)
      const up = Math.floor(t * 6) % 4 !== 0
      type(g, 'ETH', tx + 4, 38, 1, '#c98a00')
      type(g, n, tx + tw - typeWidth(n, 1) - 4, 38, 1, up ? '#3ddc84' : '#ffb000')
    }
    // The tape.
    box(g, 6, h - 14, w - 12, 9, '#ffb000')
    inside(g, 6, h - 13, w - 12, 7, () => {
      const tape = 'ETH  WBTC  INFER  IMDUSD  IMD  CULT  '.repeat(4)
      type(g, tape, 2 - Math.floor(t * 40), 0, 1, '#0a0f13')
    })
  },
}

/** Launch: a gold coin of green stone. The laurel clicks on leaf by leaf, the name sets, and a shine crosses it. */
const launch: Scene = {
  ms: 2300,
  pixel: true,
  size: [112, 112],
  draw(g, t, w, h) {
    const cx = Math.floor(w / 2)
    const cy = Math.floor(h / 2)
    disc(g, cx + 1, cy + 2, 54, '#1a1206')
    disc(g, cx, cy, 54, '#8a6d24')
    disc(g, cx - 1, cy - 1, 52, '#c9a24c')
    disc(g, cx, cy, 51, '#a8842f')
    disc(g, cx, cy, 47, '#04201a')
    // Stone face, clipped to the coin.
    g.save()
    g.beginPath()
    g.arc(cx, cy, 46.5, 0, Math.PI * 2)
    g.clip()
    ramp(g, w, h, ['#0d4a36', '#0a3527', '#04201a'])
    const rnd = seeded(5)
    for (let i = 0; i < 12; i += 1) {
      const x = rnd() * w
      const y = rnd() * h
      blockLine(g, x, y, x + 5 + rnd() * 10, y + (rnd() - 0.5) * 6, 1, '#0f5a42')
    }
    g.restore()
    // Rivets on the rim.
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2
      box(g, cx + Math.cos(a) * 49 - 0.5, cy + Math.sin(a) * 49 - 0.5, 1, 1, i % 2 ? '#f3dc9a' : '#8a6d24')
    }
    // The wreath sits out by the rim, so the name has the middle to itself.
    const r = 40
    const leaves = 10
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < leaves; i += 1) {
        if (t > 0.15 + i * 0.09) {
          const a = Math.PI / 2 + side * (0.3 + (i / leaves) * 2.35)
          const x = cx + Math.cos(a) * r
          const y = cy + Math.sin(a) * r
          const tx = -Math.sin(a) * side
          const ty = Math.cos(a) * side
          blockLine(g, x, y, x + tx * 5 + Math.cos(a) * 2, y + ty * 5 + Math.sin(a) * 2, 3, i % 2 ? '#f3dc9a' : '#c9a24c')
          blockLine(g, x, y, x + tx * 4 - Math.cos(a) * 2, y + ty * 4 - Math.sin(a) * 2, 2, '#8a6d24')
        }
      }
    }
    typedTitle(g, 'LAUNCH', w, cy - 7, 2, '#f3e7c2', '#04201a', part(t, 1.1, 1.6))
    const done = part(t, 0.3, 2)
    const dots = 5
    for (let i = 0; i < dots; i += 1) box(g, cx - 12 + i * 5, cy + 12, 3, 3, i < Math.round(done * dots) ? '#f3dc9a' : '#0a3527')
    // The shine: a pale band sweeping across the coin once it is struck.
    const s = part(t, 1.6, 2.1)
    if (s > 0 && s < 1) {
      g.save()
      g.beginPath()
      g.arc(cx, cy, 51.5, 0, Math.PI * 2)
      g.clip()
      const along = -60 + s * 180
      for (let k = 0; k < 6; k += 1) blockLine(g, along + k, 0, along + k - 50, h, 1, k % 3 ? 'rgba(255,251,224,0.35)' : 'rgba(255,251,224,0.6)')
      g.restore()
    }
    if (t > 1.6) {
      ;[
        [cx - 34, cy - 38],
        [cx + 40, cy - 22],
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

/** Auction: a banner in the sale room's velvet and gilt. The gavel knocks three times beside the name. */
const auction: Scene = {
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

/** MiyaMusicMaker: the sampler from its icon. The pads play a beat, the knobs turn, the waveform draws in as it loads. */
const music: Scene = {
  ms: 2200,
  pixel: true,
  size: [144, 112],
  draw(g, t, w, h) {
    // Shadow, outline, body and bevel.
    softBox(g, 3, 4, w - 3, h - 4, 'rgba(0,0,0,0.35)', 3)
    softBox(g, 0, 0, w - 2, h - 3, '#181028', 3)
    softBox(g, 1, 1, w - 4, h - 5, '#c4b0e8', 3)
    box(g, 4, 2, w - 10, 2, '#e6daf9')
    box(g, 2, 4, 2, h - 10, '#e6daf9')
    box(g, 4, h - 7, w - 10, 2, '#8c74be')
    box(g, w - 6, 4, 2, h - 10, '#8c74be')
    const beat = Math.floor(t * 8)
    const playing = t > 0.25
    // The screen: the name, then the waveform drawing in as the kit loads.
    box(g, 8, 8, 94, 30, '#181028')
    box(g, 9, 9, 92, 28, '#1e163c')
    inside(g, 9, 9, 92, 28, () => {
      typedTitle(g, 'MUSICMAKER', 92, 3, 1, '#78ffc8', '#0b3a2a', part(t, 0.05, 0.6))
      const done = part(t, 0.3, 2)
      const rnd = seeded(9)
      const across = Math.round(done * 88)
      for (let x = 2; x < 2 + across; x += 1) {
        const v = Math.round((rnd() - 0.5) * 12 * (0.5 + 0.5 * Math.abs(Math.sin(x / 5))))
        const y0 = 20
        box(g, x, Math.min(y0, y0 + v), 1, Math.abs(v) + 1, '#78ffc8')
      }
      if (done >= 1 && Math.floor(t * 4) % 2) type(g, 'READY', 92 - typeWidth('READY', 1) - 3, 3, 1, '#ffffff')
    })
    // Two knobs that turn, and a heart that beats.
    const knob = (x: number, y: number, a: number) => {
      disc(g, x, y, 7, '#181028')
      disc(g, x, y, 6, '#3c2c60')
      box(g, x + Math.round(Math.cos(a) * 4), y + Math.round(Math.sin(a) * 4), 2, 2, '#ff78c8')
    }
    knob(116, 17, -Math.PI / 2 + t * 2.2)
    knob(132, 17, Math.PI * 0.8 - t * 1.4)
    const beatOn = playing && beat % 2 === 0
    const heart = [
      [1, 0], [2, 0], [4, 0], [5, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1],
      [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [2, 4], [3, 4], [4, 4], [3, 5],
    ]
    heart.forEach(([dx, dy]) => box(g, 121 + dx!, 29 + dy!, 1, 1, beatOn ? '#ff4696' : '#a83a78'))
    // The pads: a kick-snare-hat pattern, lit on the sixteenths.
    const steps = [[0, 15], [10], [5, 10], [10], [3, 15], [10], [5, 10, 12], [10]]
    const lit = playing ? steps[beat % steps.length]! : []
    for (let i = 0; i < 16; i += 1) {
      const x = 8 + (i % 4) * 32
      const y = 44 + Math.floor(i / 4) * 15
      const on = lit.includes(i)
      box(g, x, y, 30, 13, '#181028')
      box(g, x + 1, y + 1, 28, 11, on ? '#ff46aa' : '#f496cd')
      box(g, x + 1, y + 1, 28, 2, on ? '#ffc8eb' : '#ffd6ec')
      box(g, x + 1, y + 10, 28, 2, on ? '#be3c8c' : '#d678b4')
      if (on) box(g, x + 12, y + 5, 6, 3, '#ffffff')
    }
  },
}

/**
 * By page id. The rest boot inside themselves, or not at all: Mint on its own screen, Infinite Upload's disc, miyaTV's picture
 * tube and Drop Music's studio. My Files, Display, the radio and Manager open straight away.
 */
export const SCENES: Record<string, Scene> = {
  home: miyanet,
  swap: trade,
  launch,
  auction,
  music,
}
