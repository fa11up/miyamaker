/**
 * Squeekchain's public feed, read straight from the page (it allows any origin), shaped for the screen and the sidebar.
 * The wheel is real hardware; `rpmMilli` is its speed right now. Pure, so `node --test` can run it.
 */
export const SQUEEK_API = 'https://api.squeekchain.com/v1'
const BLOCK_UNITS = 1e9

export type SqueekVitals = {
  online: boolean
  /** The wheel is turning. Its speed is what says so: the core's status can read IDLE while it spins. */
  running: boolean
  rpm: number
  metresPerMinute: number
  distanceMetres: number
  work: string
  blockHeight: string
  /** 0..1 through the current block. */
  blockProgress: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseVitals(status: any): SqueekVitals {
  const m = status?.measurement ?? {}
  const anchor = status?.builder?.projected ?? status?.builder?.anchor ?? {}
  const rpm = Number(m.rpmMilli ?? 0) / 1000
  return {
    online: m.freshness === 'online',
    running: rpm > 0,
    rpm,
    metresPerMinute: (Number(m.speedMmPerSecond ?? 0) * 60) / 1000,
    distanceMetres: Number(m.distanceMm ?? 0) / 1000,
    work: String(m.cumulativeWorkUnits ?? anchor.cumulativeWork ?? '0'),
    blockHeight: String(anchor.blockHeight ?? '0'),
    blockProgress: Math.min(1, Math.max(0, Number(anchor.blockProgress ?? 0) / BLOCK_UNITS)),
  }
}

/** Distance rounded to what matters. */
export const formatDistance = (metres: number) =>
  metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${metres.toFixed(1)} m`

/** Seconds for one turn of the drawn wheel, or 0 for not turning. Capped so it stays a wheel and not a blur. */
export const wheelSeconds = (rpm: number) => (rpm > 0 ? Math.max(0.35, 60 / rpm) : 0)
