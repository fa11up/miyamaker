/**
 * miya radio's picture: several different visualizers drawn from the sound, the way media players of the time had modes
 * to flip through. A track's id picks its palette and first mode, so each song starts with its own look.
 */
export const VIZ_W = 320
export const VIZ_H = 180

type Rgb = readonly [number, number, number]

/** Each is a walk through colour, dark to bright. */
const GRADIENTS: Rgb[][] = [
  [
    [8, 4, 30],
    [120, 20, 140],
    [255, 80, 150],
    [255, 220, 170],
  ],
  [
    [2, 12, 34],
    [10, 90, 170],
    [40, 220, 220],
    [230, 255, 230],
  ],
  [
    [20, 4, 2],
    [170, 40, 10],
    [255, 160, 30],
    [255, 245, 190],
  ],
  [
    [2, 20, 10],
    [20, 120, 60],
    [150, 230, 60],
    [250, 255, 190],
  ],
  [
    [14, 2, 24],
    [70, 30, 200],
    [60, 170, 255],
    [250, 200, 255],
  ],
  [
    [24, 2, 12],
    [190, 10, 70],
    [250, 110, 60],
    [255, 230, 110],
  ],
  [
    [4, 6, 16],
    [70, 80, 110],
    [190, 200, 220],
    [255, 255, 255],
  ],
  [
    [6, 2, 20],
    [0, 150, 130],
    [240, 60, 180],
    [255, 240, 120],
  ],
]

export function buildPalette(stops: Rgb[]): Rgb[] {
  return Array.from({ length: 256 }, (_, i) => {
    const at = (i / 255) * (stops.length - 1)
    const low = Math.min(Math.floor(at), stops.length - 2)
    const mix = at - low
    const a = stops[low]!
    const b = stops[low + 1]!
    return [a[0] + (b[0] - a[0]) * mix, a[1] + (b[1] - a[1]) * mix, a[2] + (b[2] - a[2]) * mix] as const
  })
}

/** A steady number from a track's id. */
export function seedOf(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export const paletteIndex = (seed: number) => seed % GRADIENTS.length
export const firstMode = (seed: number) => (seed >>> 8) % VIZ_MODES.length

export type Sound = {
  freq: Uint8Array
  wave: Uint8Array
  bass: number
  mids: number
  highs: number
  beat: boolean
  time: number
  dt: number
}

type Scene = { ctx: CanvasRenderingContext2D; sound: Sound; palette: Rgb[]; memory: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any

const css = (c: Rgb, alpha = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`
const fade = (ctx: CanvasRenderingContext2D, alpha: number) => {
  ctx.fillStyle = `rgba(3,1,8,${alpha})`
  ctx.fillRect(0, 0, VIZ_W, VIZ_H)
}
const shade = (palette: Rgb[], t: number) => palette[Math.max(0, Math.min(255, Math.floor(t * 255)))]!

/** A small canvas for the per-pixel modes, scaled up: that much is what the machines of the time could afford. */
function lowRes(memory: Scene['memory']) {
  if (!memory.low) {
    const canvas = document.createElement('canvas')
    canvas.width = VIZ_W / 2
    canvas.height = VIZ_H / 2
    const ctx = canvas.getContext('2d')!
    memory.low = { canvas, ctx, image: ctx.createImageData(canvas.width, canvas.height) }
  }
  return memory.low as { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData }
}

function plasma({ ctx, sound, palette, memory }: Scene) {
  const low = lowRes(memory)
  const w = low.canvas.width
  const h = low.canvas.height
  memory.phase = (memory.phase ?? 0) + sound.dt * (0.25 + sound.mids * 1.6)
  const phase = memory.phase as number
  const petals = 5 + Math.round(sound.mids * 6)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = (x - w / 2) / h
      const dy = (y - h / 2) / h
      const v =
        Math.sin(Math.hypot(dx, dy) * (11 + sound.bass * 16) - phase * 2.4) +
        Math.sin(Math.atan2(dy, dx) * petals + phase) * (0.5 + sound.bass) +
        Math.sin((dx + dy) * 6 + phase * 1.3) * 0.5
      const c = shade(palette, (Math.sin(v * 1.4 + phase * 0.3) + 1) / 2)
      const n = (y * w + x) * 4
      low.image.data[n] = c[0]
      low.image.data[n + 1] = c[1]
      low.image.data[n + 2] = c[2]
      low.image.data[n + 3] = 255
    }
  }
  low.ctx.putImageData(low.image, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(low.canvas, 0, 0, VIZ_W, VIZ_H)
}

function equalizer({ ctx, sound, palette, memory }: Scene) {
  fade(ctx, 0.55)
  const bands = 32
  const peaks: number[] = (memory.peaks ??= new Array(bands).fill(0))
  const barW = VIZ_W / bands / 2
  const middle = VIZ_H / 2
  for (let i = 0; i < bands; i += 1) {
    // Wider slices further up, as hearing works.
    const from = Math.floor(2 + (i / bands) ** 1.8 * 200)
    const level = (sound.freq[from] ?? 0) / 255
    peaks[i] = Math.max(level, peaks[i]! - sound.dt * 0.5)
    const height = level * middle
    const cells = Math.ceil(height / 5)
    for (let c = 0; c < cells; c += 1) {
      ctx.fillStyle = css(shade(palette, 0.25 + (c * 5 * 0.75) / middle))
      const y = c * 5
      for (const side of [-1, 1]) {
        const x = VIZ_W / 2 + side * (i + 0.5) * barW - barW / 2
        ctx.fillRect(x, middle - y - 4, barW - 1, 4)
        ctx.fillRect(x, middle + y, barW - 1, 4)
      }
    }
    ctx.fillStyle = css(shade(palette, 1))
    for (const side of [-1, 1]) {
      const x = VIZ_W / 2 + side * (i + 0.5) * barW - barW / 2
      ctx.fillRect(x, middle - peaks[i]! * middle - 2, barW - 1, 1)
      ctx.fillRect(x, middle + peaks[i]! * middle + 1, barW - 1, 1)
    }
  }
}

function ribbon({ ctx, sound, palette }: Scene) {
  fade(ctx, 0.14 + sound.highs * 0.1)
  const lines = 3
  for (let l = 0; l < lines; l += 1) {
    const sway = Math.sin(sound.time * (0.5 + l * 0.3) + l) * 34
    ctx.beginPath()
    for (let x = 0; x <= VIZ_W; x += 2) {
      const sample = (sound.wave[Math.floor((x / VIZ_W) * (sound.wave.length - 1))] ?? 128) / 128 - 1
      const y = VIZ_H / 2 + sway + sample * (40 + sound.bass * 60) * (1 - l * 0.22)
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = css(shade(palette, 0.95 - l * 0.25), 0.9)
    ctx.lineWidth = 2 - l * 0.4
    ctx.stroke()
  }
}

function warp({ ctx, sound, palette }: Scene) {
  // The last frame, turned and pushed toward the viewer, is what makes the tunnel.
  ctx.save()
  ctx.globalAlpha = 0.93
  ctx.imageSmoothingEnabled = true
  ctx.translate(VIZ_W / 2, VIZ_H / 2)
  ctx.rotate(0.006 + sound.mids * 0.035)
  const zoom = 1.015 + sound.bass * 0.05
  ctx.scale(zoom, zoom)
  ctx.drawImage(ctx.canvas, -VIZ_W / 2, -VIZ_H / 2, VIZ_W, VIZ_H)
  ctx.restore()
  fade(ctx, 0.03)
  const r = 18 + sound.bass * 30
  ctx.beginPath()
  const steps = 96
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2 + sound.time * 0.6
    const sample = (sound.wave[Math.floor((i / steps) * (sound.wave.length - 1))] ?? 128) / 128 - 1
    const reach = r + sample * 26
    const x = VIZ_W / 2 + Math.cos(a) * reach
    const y = VIZ_H / 2 + Math.sin(a) * reach
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.strokeStyle = css(shade(palette, sound.beat ? 1 : 0.75))
  ctx.lineWidth = sound.beat ? 2.5 : 1.3
  ctx.stroke()
}

type Star = { x: number; y: number; z: number; hue: number }

function starfield({ ctx, sound, palette, memory }: Scene) {
  fade(ctx, 0.28)
  const newStar = (): Star => ({
    x: (Math.random() - 0.5) * 2,
    y: (Math.random() - 0.5) * 2,
    z: 0.2 + Math.random() * 0.8,
    hue: Math.random(),
  })
  const stars: Star[] = (memory.stars ??= Array.from({ length: 220 }, newStar))
  const speed = 0.08 + sound.bass * 0.9 + (sound.beat ? 0.5 : 0)
  ctx.lineCap = 'round'
  for (const star of stars) {
    const before = star.z
    star.z -= speed * sound.dt
    if (star.z <= 0.02) {
      Object.assign(star, newStar(), { z: 1 })
      continue
    }
    const x0 = VIZ_W / 2 + (star.x / before) * 60
    const y0 = VIZ_H / 2 + (star.y / before) * 60
    const x1 = VIZ_W / 2 + (star.x / star.z) * 60
    const y1 = VIZ_H / 2 + (star.y / star.z) * 60
    ctx.strokeStyle = css(shade(palette, 0.45 + star.hue * 0.55), Math.min(1, 1.2 - star.z))
    ctx.lineWidth = (1 - star.z) * 2 + 0.3
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }
}

function ripple({ ctx, sound, palette, memory }: Scene) {
  const low = lowRes(memory)
  const w = low.canvas.width
  const h = low.canvas.height
  let now: Float32Array = (memory.now ??= new Float32Array(w * h))
  let then: Float32Array = (memory.then ??= new Float32Array(w * h))
  const drop = (x: number, y: number, force: number) => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const n = (y + dy) * w + x + dx
        if (n >= 0 && n < now.length) now[n]! += force
      }
    }
  }
  if (sound.beat)
    drop(4 + Math.floor(Math.random() * (w - 8)), 4 + Math.floor(Math.random() * (h - 8)), 1.1 + sound.bass)
  if (sound.highs > 0.12 && Math.random() < sound.highs) {
    drop(4 + Math.floor(Math.random() * (w - 8)), 4 + Math.floor(Math.random() * (h - 8)), 0.35)
  }
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const n = y * w + x
      then[n] = ((now[n - 1]! + now[n + 1]! + now[n - w]! + now[n + w]!) / 2 - then[n]!) * 0.975
    }
  }
  ;[now, then] = [then, now]
  memory.now = now
  memory.then = then
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const n = y * w + x
      // Light catches the slope of the water.
      const slope = now[n - 1]! - now[n + 1]! + now[n - w]! - now[n + w]!
      const c = shade(palette, 0.28 + sound.bass * 0.18 + slope * 0.7)
      const p = n * 4
      low.image.data[p] = c[0]
      low.image.data[p + 1] = c[1]
      low.image.data[p + 2] = c[2]
      low.image.data[p + 3] = 255
    }
  }
  low.ctx.putImageData(low.image, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(low.canvas, 0, 0, VIZ_W, VIZ_H)
}

export const VIZ_MODES = [
  { id: 'plasma', name: 'Plasma', draw: plasma },
  { id: 'equalizer', name: 'Equalizer', draw: equalizer },
  { id: 'ribbon', name: 'Ribbons', draw: ribbon },
  { id: 'warp', name: 'Warp', draw: warp },
  { id: 'stars', name: 'Starfield', draw: starfield },
  { id: 'ripple', name: 'Ripples', draw: ripple },
] as const

const BEAT_GAP = 0.18

/**
 * Runs the picture on `canvas` until the returned stop is called. `read` is asked for the current mode and seed each frame,
 * so changing them does not restart anything.
 */
export function runVisuals(
  canvas: HTMLCanvasElement,
  read: () => { mode: number; seed: number; analyser: AnalyserNode | null; playing: boolean },
  reduced: boolean,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => undefined
  let raf = 0
  let last = 0
  let shownMode = -1
  let shownSeed = -1
  let palette = buildPalette(GRADIENTS[0]!)
  let memory: Scene['memory'] = {}
  let average = 0
  let sinceBeat = 1
  const freq = new Uint8Array(1024)
  const wave = new Uint8Array(1024)

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    if (now - last < (reduced ? 1000 : 33)) return
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    const { mode, seed, analyser, playing } = read()
    if (mode !== shownMode) {
      shownMode = mode
      memory = {}
      ctx.fillStyle = '#030108'
      ctx.fillRect(0, 0, VIZ_W, VIZ_H)
    }
    if (seed !== shownSeed) {
      shownSeed = seed
      palette = buildPalette(GRADIENTS[paletteIndex(seed)]!)
    }

    if (analyser && playing) {
      analyser.getByteFrequencyData(freq)
      analyser.getByteTimeDomainData(wave)
    } else {
      // Paused, or a host that blocks the analyser: a slow made-up signal keeps the picture alive.
      const level = playing ? 0.55 : 0.18
      for (let i = 0; i < freq.length; i += 1) {
        freq[i] = 255 * level * Math.max(0, Math.sin(now / 700 + i * 0.09) * 0.5 + 0.5) * Math.max(0, 1 - i / 300)
      }
      for (let i = 0; i < wave.length; i += 1) wave[i] = 128 + 70 * level * Math.sin(now / 240 + i * 0.03)
    }
    let bass = 0
    let mids = 0
    let highs = 0
    for (let i = 2; i < 12; i += 1) bass += freq[i]! / 2550
    for (let i = 12; i < 90; i += 1) mids += freq[i]! / 19890
    for (let i = 90; i < 300; i += 1) highs += freq[i]! / 53550
    sinceBeat += dt
    average += (bass - average) * 0.05
    const beat = bass > average * 1.25 && bass > 0.2 && sinceBeat > BEAT_GAP
    if (beat) sinceBeat = 0
    const sound: Sound = { freq, wave, bass, mids, highs, beat, time: now / 1000, dt }
    VIZ_MODES[mode]?.draw({ ctx, sound, palette, memory })
  }

  raf = requestAnimationFrame(frame)
  return () => cancelAnimationFrame(raf)
}
