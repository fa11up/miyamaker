/**
 * Where the desktop pet rides: the swell of the background water itself. The shader (shader.ts, `de()`) draws a 3D surface
 * seen through a tilted camera; its long rolling swell is one sine. This takes a fixed line of water out in front of the
 * camera, lifts it by that same sine at the same clock (`bus.frameTime`) and projects it to the screen, so the board goes
 * up and down with the water the user sees. The small voronoi cells are left out: they would only make the board jitter.
 * Kept import-free so `node --test` can run it.
 *
 * Units are CSS px. `x` runs left to right across the canvas, heights are measured up from the canvas bottom (the bottom
 * of the viewport, under the taskbar).
 */

export interface CrestParams {
  width: number
  height: number
  /** how far out the line of water sits, in the shader's world units */
  reach: number
}

// The camera: for a screen point (ux, uy), the ray from `main()` in the shader runs along
// (-COS_TILT - SIN_TILT * 0.6 * uy, -0.6 * ux, -SIN_TILT + COS_TILT * 0.6 * uy), its two rotations multiplied out.
const TILT = 3.16 + 4.15 * 1.5 - 3 * Math.PI
const COS_TILT = Math.cos(TILT)
const SIN_TILT = -Math.sin(TILT)
const SCROLL = 1.5
const FROM_BOTTOM = 0.8

/** The mean height the voronoi cells add above the swell, measured against the shader's own ray march. */
const CELL_MEAN = 0.16
const SWELL = 0.4
/** Water height at the lowest trough. */
const LOWEST = -(SWELL + 0.2) - 1 + CELL_MEAN

const swellHeight = (worldX: number, worldY: number, t: number) =>
  -(Math.sin((worldX * 0.005 + worldY * 0.051) * 4 + t * 0.5) * SWELL + 0.2) - 1 + CELL_MEAN

const rise = (uy: number) => -SIN_TILT + COS_TILT * 0.6 * uy
const ahead = (uy: number) => COS_TILT - SIN_TILT * 0.6 * uy

/** Params for a viewport. `taskbar` is the taskbar height: even the lowest trough stays above it. */
export function crestParams(width: number, height: number, taskbar: number): CrestParams {
  const uyLow = (2 * (taskbar + 10) - height) / width
  const distance = LOWEST / rise(uyLow)
  return { width, height, reach: distance * ahead(uyLow) }
}

/** Water height above the canvas bottom at `x` (px) and time `t` (s). */
export function crestHeight(x: number, t: number, p: CrestParams): number {
  const ux = (x / p.width) * 2 - 1
  let uy = (2 * FROM_BOTTOM - 1) * -0.25
  // The height of the water depends on where the ray lands and the other way round; this settles in a few passes.
  for (let pass = 0; pass < 4; pass += 1) {
    const distance = p.reach / ahead(uy)
    const water = swellHeight(-p.reach - SCROLL * t, -0.6 * ux * distance, t)
    uy = (water / distance + SIN_TILT) / (COS_TILT * 0.6)
  }

  return (uy * p.width + p.height) / 2
}

/** d(height)/dx at `x`: the board tilts along this slope. */
export function crestSlope(x: number, t: number, p: CrestParams): number {
  return (crestHeight(x + 2, t, p) - crestHeight(x - 2, t, p)) / 4
}

/**
 * Time the shader sees. GPUs without highp floats in fragment shaders (some older mobile GPUs) lose
 * precision as `t` grows, so there the clock wraps; with highp it runs on.
 */
export function shaderTime(seconds: number, highp: boolean): number {
  return highp ? seconds : seconds % 600
}
