import { useSyncExternalStore } from 'react'

/** How the handheld looks: picked from the main menu and kept in this browser. Storage can throw, so it is guarded. */
export type Tint = { id: string; name: string; hex: string; light: string; deep: string; edge: string; ink: string }

export const TINTS: Tint[] = [
  {
    id: 'grape',
    name: 'Grape',
    hex: '#9a6cf0',
    light: 'rgba(120, 70, 205, 0.62)',
    deep: 'rgba(52, 22, 112, 0.78)',
    edge: '#22104a',
    ink: '#ffffff',
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    hex: '#3fd2de',
    light: 'rgba(24, 169, 184, 0.62)',
    deep: 'rgba(6, 86, 110, 0.8)',
    edge: '#04343f',
    ink: '#ffffff',
  },
  {
    id: 'berry',
    name: 'Berry',
    hex: '#ff66b4',
    light: 'rgba(240, 60, 150, 0.62)',
    deep: 'rgba(130, 16, 90, 0.8)',
    edge: '#4a0632',
    ink: '#ffffff',
  },
  {
    id: 'tangerine',
    name: 'Tangerine',
    hex: '#ffa650',
    light: 'rgba(255, 140, 40, 0.66)',
    deep: 'rgba(170, 70, 0, 0.82)',
    edge: '#4f2100',
    ink: '#ffffff',
  },
  {
    id: 'lime',
    name: 'Lime',
    hex: '#97e052',
    light: 'rgba(130, 210, 60, 0.62)',
    deep: 'rgba(40, 110, 20, 0.82)',
    edge: '#123a08',
    ink: '#ffffff',
  },
  {
    id: 'smoke',
    name: 'Smoke',
    hex: '#67677a',
    light: 'rgba(90, 92, 105, 0.62)',
    deep: 'rgba(24, 24, 32, 0.84)',
    edge: '#0b0b10',
    ink: '#ffffff',
  },
  {
    id: 'clear',
    name: 'Clear',
    hex: '#e8eef4',
    light: 'rgba(235, 242, 248, 0.42)',
    deep: 'rgba(170, 186, 202, 0.6)',
    edge: '#3b4654',
    ink: '#14101f',
  },
]

/** A body's outline is an SVG path in device pixels, absolute M, H, V, L, C and Z only. */
export type Shape = { id: string; name: string; w: number; h: number; pad: number; line: string; path: string }

export const SHAPES: Shape[] = [
  {
    id: 'palm',
    name: 'Palm',
    w: 476,
    h: 710,
    pad: 48,
    line: 'Narrow shoulders, wide hips that fill the palm',
    path: 'M120 0H356C424 0 452 34 456 90L464 456C468 526 476 586 450 646C430 692 380 710 238 710C96 710 46 692 26 646C0 586 8 526 12 456L20 90C24 34 52 0 120 0Z',
  },
]

/** The path as points, for finding its edge and for drawing it elsewhere. */
export function pathPoints(path: string, steps = 20): [number, number][] {
  const points: [number, number][] = []
  let x = 0
  let y = 0
  const tokens = path.match(/[MHVLCZ]|-?\d+(?:\.\d+)?/g) ?? []
  let i = 0
  const num = () => Number(tokens[i++])
  let cmd = ''
  while (i < tokens.length) {
    if (/[MHVLCZ]/.test(tokens[i]!)) cmd = tokens[i++]!
    if (cmd === 'M' || cmd === 'L') {
      x = num()
      y = num()
      points.push([x, y])
    } else if (cmd === 'H') {
      x = num()
      points.push([x, y])
    } else if (cmd === 'V') {
      y = num()
      points.push([x, y])
    } else if (cmd === 'C') {
      const [x1, y1, x2, y2, x3, y3] = [num(), num(), num(), num(), num(), num()]
      for (let k = 1; k <= steps; k += 1) {
        const t = k / steps
        const u = 1 - t
        points.push([
          u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        ])
      }
      x = x3
      y = y3
    }
  }
  return points
}

/** Where the right edge of a body is at height `y`, for mounting the side buttons on it. */
export function rightEdge(path: string, y: number): number {
  const points = pathPoints(path)
  let best = 0
  points.forEach((p, n) => {
    const q = points[(n + 1) % points.length]!
    if ((p[1] <= y && q[1] >= y) || (q[1] <= y && p[1] >= y)) {
      const t = q[1] === p[1] ? 0 : (y - p[1]) / (q[1] - p[1])
      best = Math.max(best, p[0] + (q[0] - p[0]) * t)
    }
  })
  return best
}

export type Look = { tint: string; shape: string }
const KEY = 'miyaos.mint.look.v1'
export const DEFAULT_LOOK: Look = { tint: 'grape', shape: 'palm' }

/** Anything stored that is not a known choice falls back to the default. */
export function parseLook(raw: string | null): Look {
  try {
    const v = JSON.parse(raw ?? '{}') as Partial<Look>
    return {
      tint: TINTS.some((t) => t.id === v.tint) ? (v.tint as string) : DEFAULT_LOOK.tint,
      shape: SHAPES.some((s) => s.id === v.shape) ? (v.shape as string) : DEFAULT_LOOK.shape,
    }
  } catch {
    return DEFAULT_LOOK
  }
}

let current: Look | undefined
const listeners = new Set<() => void>()
const read = (): Look => {
  if (current) return current
  try {
    current = parseLook(window.localStorage.getItem(KEY))
  } catch {
    current = DEFAULT_LOOK
  }
  return current
}

export function setLook(patch: Partial<Look>) {
  current = { ...read(), ...patch }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export const useLook = () => useSyncExternalStore(subscribe, read, read)
export const tintOf = (id: string) => TINTS.find((t) => t.id === id) ?? TINTS[0]!
export const shapeOf = (id: string) => SHAPES.find((s) => s.id === id) ?? SHAPES[0]!
