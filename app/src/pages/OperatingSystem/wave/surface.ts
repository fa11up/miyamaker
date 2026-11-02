/**
 * The surfable crest of the desktop wave. One function, used twice:
 *  - the fragment shader draws the foam line with the same formula (see shader.ts, `crest()`),
 *  - the desktop pet rides on `crestHeight()`.
 * Both read the same params (sent to the GPU as uniforms) and the same clock (`bus.frameTime`),
 * so the board sits on the line the user sees. Kept import-free so `node --test` can run it.
 *
 * Units are CSS px. `x` runs left to right across the canvas, heights are measured up from the
 * canvas bottom (the bottom of the viewport, under the taskbar).
 */

export interface CrestParams {
  /** resting height of the crest above the canvas bottom, px */
  base: number
  /** swell 1: amplitude px, wavelength px, angular speed rad/s */
  a1: number
  l1: number
  w1: number
  /** swell 2 (shorter chop going the other way) */
  a2: number
  l2: number
  w2: number
}

const TAU = Math.PI * 2
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Crest params for a viewport. `taskbar` is the taskbar height: the crest always clears it. */
export function crestParams(width: number, height: number, taskbar: number): CrestParams {
  const free = Math.max(0, height - taskbar)
  return {
    base: taskbar + clamp(free * 0.15, 58, 150),
    a1: clamp(free * 0.028, 9, 22),
    l1: clamp(width * 0.62, 360, 980),
    w1: 0.9,
    a2: clamp(free * 0.01, 3, 8),
    l2: clamp(width * 0.21, 150, 330),
    w2: 1.7,
  }
}

/** Crest height above the canvas bottom at `x` (px) and time `t` (s). Mirrors `crest()` in the shader. */
export function crestHeight(x: number, t: number, p: CrestParams): number {
  return p.base + p.a1 * Math.sin((TAU * x) / p.l1 - p.w1 * t) + p.a2 * Math.sin((TAU * x) / p.l2 + p.w2 * t + 1.7)
}

/** d(height)/dx at `x`: the board tilts along this slope. */
export function crestSlope(x: number, t: number, p: CrestParams): number {
  return (
    ((p.a1 * TAU) / p.l1) * Math.cos((TAU * x) / p.l1 - p.w1 * t) +
    ((p.a2 * TAU) / p.l2) * Math.cos((TAU * x) / p.l2 + p.w2 * t + 1.7)
  )
}

/** The six floats the shader needs, in uniform order: uCrestA = (base, a1, l1, w1), uCrestB = (a2, l2, w2, _). */
export function crestUniforms(p: CrestParams): [number, number, number, number, number, number, number, number] {
  return [p.base, p.a1, p.l1, p.w1, p.a2, p.l2, p.w2, 0]
}

/**
 * Time the shader sees. GPUs without highp floats in fragment shaders (some older mobile GPUs) lose
 * precision as `t` grows, so there the clock wraps; with highp it runs on.
 */
export function shaderTime(seconds: number, highp: boolean): number {
  return highp ? seconds : seconds % 600
}
