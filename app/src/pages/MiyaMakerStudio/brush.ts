/**
 * One brush for the 1024 plate.
 * Pixel mode keeps a hard edge: softness shapes the silhouette, then a Bayer matrix
 * turns partial coverage into ink or empty pixels. A mouse reports pressure 0.5 for
 * the whole stroke, so pressure only changes a pen. Spray count and scatter follow
 * that pen. Smudge drags pixels already on the plate and never uses the ink colour.
 */

export type Rgb = [number, number, number, number]

export type Brush = {
  /** Diameter in pixels. */
  size: number
  minSize: number
  opacity: number
  /** 0 is a hard circle. 1 fades to the rim. */
  softness: number
  /** Quantize coverage so the edge is never a blur. */
  pixel: boolean
  /** 0 is one dab. 1 scatters a full handful of dots. */
  spray: number
  /** How far spray dots may land, in pixels. */
  scatter: number
  /** 0 is solid. 1 lets the noise hash eat the whole dab. */
  noise: number
  pressureSize: boolean
  pressureOpacity: boolean
}

export type Dab = {
  pen: boolean
  pressure: number
  stroke: number
  dab: number
  color: Rgb
  erase: boolean
}

export type Pixels = {
  width: number
  height: number
  data: Uint8ClampedArray
}

export const DEFAULT_BRUSH: Brush = {
  size: 8,
  minSize: 1,
  opacity: 1,
  softness: 0,
  pixel: true,
  spray: 0,
  scatter: 24,
  noise: 0,
  pressureSize: true,
  pressureOpacity: true,
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

export function blankPixels(width: number, height: number): Pixels {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

export function hash32(n: number): number {
  let x = n | 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  return (x ^ (x >>> 16)) >>> 0
}

export function unit(n: number): number {
  return hash32(n) / 4294967296
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/** Radius of this dab. A mouse or a finger keeps the size on the knob. */
export function brushRadius(brush: Brush, pressure: number, pen: boolean): number {
  const size = brush.pressureSize && pen ? brush.minSize + (brush.size - brush.minSize) * clamp01(pressure) : brush.size
  return Math.max(0.5, size / 2)
}

function dabOpacity(brush: Brush, pressure: number, pen: boolean): number {
  const opacity = brush.pressureOpacity && pen ? brush.opacity * clamp01(pressure) : brush.opacity
  return clamp01(opacity)
}

function coverage(dist: number, radius: number, softness: number): number {
  if (dist > radius || radius <= 0) return 0
  if (softness <= 0) return 1
  return 1 - clamp01(softness) * (dist / radius)
}

function quantize(cover: number, x: number, y: number, pixel: boolean): number {
  if (cover <= 0) return 0
  if (!pixel || cover >= 1) return cover
  const cell = BAYER[((y & 3) << 2) + (x & 3)] ?? 0
  const threshold = (cell + 0.5) / 16
  return cover >= threshold ? 1 : 0
}

type Dot = { x: number; y: number; gain: number }

/** 1 keeps the knob. A pen scales spray toward 0 as it lifts. */
function penScale(pressure: number, pen: boolean): number {
  return pen ? clamp01(pressure) : 1
}

function dotsFor(brush: Brush, dab: Pick<Dab, 'stroke' | 'dab' | 'pressure' | 'pen'>): Dot[] {
  const center = hash32(dab.stroke * 1000003 + dab.dab * 131)
  const dots: Dot[] = [{ x: 0, y: 0, gain: 1 - clamp01(brush.noise) * unit(center) }]
  if (brush.spray <= 0 || brush.scatter <= 0) return dots
  const scale = penScale(dab.pressure, dab.pen)
  const count = Math.round(Math.max(1, Math.round(clamp01(brush.spray) * 16)) * scale)
  for (let i = 0; i < count; i += 1) {
    const h = hash32(dab.stroke * 1000003 + dab.dab * 131 + (i + 1) * 17)
    const angle = unit(h) * Math.PI * 2
    const reach = unit(hash32(h ^ 0x9e3779b9)) * brush.scatter * scale
    dots.push({
      x: Math.cos(angle) * reach,
      y: Math.sin(angle) * reach,
      gain: 1 - clamp01(brush.noise) * unit(hash32(h ^ 0x85ebca6b)),
    })
  }
  return dots
}

function blend(data: Uint8ClampedArray, index: number, color: Rgb, amount: number, erase: boolean) {
  const dstA = (data[index + 3] ?? 0) / 255
  const srcA = clamp01(amount) * (color[3] / 255)
  if (erase) {
    data[index + 3] = Math.round(dstA * (1 - srcA) * 255)
    return
  }
  const outA = srcA + dstA * (1 - srcA)
  if (outA <= 0) {
    data[index] = 0
    data[index + 1] = 0
    data[index + 2] = 0
    data[index + 3] = 0
    return
  }
  const keep = dstA * (1 - srcA)
  data[index] = Math.round(((color[0] * srcA + (data[index] ?? 0) * keep) / outA) || 0)
  data[index + 1] = Math.round(((color[1] * srcA + (data[index + 1] ?? 0) * keep) / outA) || 0)
  data[index + 2] = Math.round(((color[2] * srcA + (data[index + 2] ?? 0) * keep) / outA) || 0)
  data[index + 3] = Math.round(outA * 255)
}

function stamp(pixels: Pixels, cx: number, cy: number, radius: number, brush: Brush, opacity: number, color: Rgb, erase: boolean) {
  const x0 = Math.max(0, Math.floor(cx - radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const x1 = Math.min(pixels.width - 1, Math.ceil(cx + radius))
  const y1 = Math.min(pixels.height - 1, Math.ceil(cy + radius))
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const cover = quantize(coverage(dist, radius, brush.softness), x, y, brush.pixel)
      if (cover <= 0) continue
      blend(pixels.data, (y * pixels.width + x) * 4, color, cover * opacity, erase)
    }
  }
}

export function paintDab(pixels: Pixels, cx: number, cy: number, brush: Brush, dab: Dab) {
  const radius = brushRadius(brush, dab.pressure, dab.pen)
  const opacity = dabOpacity(brush, dab.pressure, dab.pen)
  for (const dot of dotsFor(brush, dab)) {
    stamp(pixels, cx + dot.x, cy + dot.y, radius, brush, opacity * dot.gain, dab.color, dab.erase)
  }
}

function lay(data: Uint8ClampedArray, index: number, color: Rgb, amount: number) {
  const t = clamp01(amount)
  if (t <= 0) return
  if (t >= 1) {
    data[index] = color[0]
    data[index + 1] = color[1]
    data[index + 2] = color[2]
    data[index + 3] = color[3]
    return
  }
  data[index] = Math.round((data[index] ?? 0) + (color[0] - (data[index] ?? 0)) * t)
  data[index + 1] = Math.round((data[index + 1] ?? 0) + (color[1] - (data[index + 1] ?? 0)) * t)
  data[index + 2] = Math.round((data[index + 2] ?? 0) + (color[2] - (data[index + 2] ?? 0)) * t)
  data[index + 3] = Math.round((data[index + 3] ?? 0) + (color[3] - (data[index + 3] ?? 0)) * t)
}

function sampleAt(snapshot: Uint8ClampedArray, width: number, height: number, left: number, top: number, x: number, y: number): Rgb {
  const ix = Math.round(x)
  const iy = Math.round(y)
  if (ix < left || iy < top || ix >= left + width || iy >= top + height) return [0, 0, 0, 0]
  const index = ((iy - top) * width + (ix - left)) * 4
  return [snapshot[index] ?? 0, snapshot[index + 1] ?? 0, snapshot[index + 2] ?? 0, snapshot[index + 3] ?? 0]
}

/**
 * Drag ink that is already on the plate one step.
 * Strength is the opacity knob. A pen scales that strength. The brush colour is ignored.
 */
export function smudgeDab(pixels: Pixels, x0: number, y0: number, x1: number, y1: number, brush: Brush, dab: Dab) {
  const dx = x1 - x0
  const dy = y1 - y0
  const dist = Math.hypot(dx, dy)
  if (dist < 0.001) return
  const radius = brushRadius(brush, dab.pressure, dab.pen)
  const strength = clamp01(brush.opacity) * penScale(dab.pressure, dab.pen)
  if (strength <= 0 || radius <= 0) return
  const pull = Math.min(dist, radius) * strength
  const sx = (dx / dist) * pull
  const sy = (dy / dist) * pull
  const left = Math.max(0, Math.floor(x1 - radius - sx) - 1)
  const top = Math.max(0, Math.floor(y1 - radius - sy) - 1)
  const right = Math.min(pixels.width - 1, Math.ceil(x1 + radius - sx) + 1)
  const bottom = Math.min(pixels.height - 1, Math.ceil(y1 + radius - sy) + 1)
  const width = right - left + 1
  const height = bottom - top + 1
  if (width <= 0 || height <= 0) return
  const snapshot = new Uint8ClampedArray(width * height * 4)
  for (let y = top; y <= bottom; y += 1) {
    const from = (y * pixels.width + left) * 4
    snapshot.set(pixels.data.subarray(from, from + width * 4), (y - top) * width * 4)
  }
  const xStart = Math.max(0, Math.floor(x1 - radius))
  const yStart = Math.max(0, Math.floor(y1 - radius))
  const xEnd = Math.min(pixels.width - 1, Math.ceil(x1 + radius))
  const yEnd = Math.min(pixels.height - 1, Math.ceil(y1 + radius))
  for (let y = yStart; y <= yEnd; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      const distFrom = Math.hypot(x + 0.5 - x1, y + 0.5 - y1)
      const amount = quantize(coverage(distFrom, radius, brush.softness) * strength, x, y, brush.pixel)
      if (amount <= 0) continue
      const picked = sampleAt(snapshot, width, height, left, top, x - sx, y - sy)
      lay(pixels.data, (y * pixels.width + x) * 4, picked, amount)
    }
  }
}

/** Step between dabs, so a fast pen does not leave a dotted line. */
export function dabSpacing(radius: number): number {
  return Math.max(1, radius / 4)
}
