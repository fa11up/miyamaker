/**
 * Desktop pet state machine. Pure: no DOM, no timers. The component feeds it frame deltas and
 * pointer events and renders whatever comes back. Kept import-free so `node --test` can run it.
 *
 * Coordinates: `x` is the sprite's left edge in px from the left of the walkable strip,
 * `y` is the height above the ground (taskbar edge) in px, positive is up.
 */

export type PetMode = 'idle' | 'walk' | 'sit' | 'sleep' | 'hop' | 'drag' | 'fall'

export interface PetState {
  mode: PetMode
  x: number
  y: number
  vy: number
  facing: 1 | -1
  /** ms spent in the current mode */
  t: number
  /** ms the current mode lasts before the machine picks something new (idle/walk/sit) */
  until: number
  /** ms since the last interaction (click, drag, cursor nearby) */
  bored: number
}

export interface PetEnv {
  /** walkable width in px */
  width: number
  spriteW: number
  reducedMotion: boolean
}

export type PetEvent =
  | { type: 'click' }
  | { type: 'dragStart' }
  | { type: 'dragMove'; x: number; y: number }
  | { type: 'dragEnd' }
  | { type: 'cursor'; x: number }

export const PET_PHYSICS = {
  gravity: 2600, // px/s^2
  hopVelocity: 560, // px/s
  walkSpeed: 38, // px/s
  bounce: 0.42,
  restVelocity: 140, // below this the doll stops bouncing
  sleepAfter: 40_000, // ms without interaction
} as const

export type Rand = () => number

export function initialPet(env: PetEnv, rand: Rand = Math.random): PetState {
  const max = Math.max(0, env.width - env.spriteW)
  return {
    mode: 'idle',
    x: Math.round(max * (0.55 + rand() * 0.35)),
    y: 0,
    vy: 0,
    facing: rand() < 0.5 ? -1 : 1,
    t: 0,
    until: 2500,
    bored: 0,
  }
}

const clampX = (x: number, env: PetEnv) => Math.min(Math.max(0, env.width - env.spriteW), Math.max(0, x))

/** What to do once a calm mode (idle / walk / sit) runs out. */
export function pickNext(s: PetState, env: PetEnv, rand: Rand): PetState {
  const base = { ...s, t: 0, vy: 0, y: 0 }
  if (s.bored >= PET_PHYSICS.sleepAfter) return { ...base, mode: 'sleep', until: Infinity }
  const r = rand()
  if (!env.reducedMotion && r < 0.55) {
    // Walk, usually keeping the current direction, sometimes turning around.
    const facing = rand() < 0.3 ? ((s.facing * -1) as 1 | -1) : s.facing
    return { ...base, mode: 'walk', facing, until: 3000 + rand() * 6000 }
  }

  if (r < 0.75) return { ...base, mode: 'sit', until: 4000 + rand() * 6000 }
  return { ...base, mode: 'idle', until: 2000 + rand() * 4000 }
}

export function stepPet(s: PetState, dtMs: number, env: PetEnv, rand: Rand = Math.random): PetState {
  const dt = Math.min(dtMs, 100) / 1000 // clamp: a backgrounded tab must not teleport the doll
  let next: PetState = { ...s, t: s.t + dtMs, bored: s.mode === 'drag' ? 0 : s.bored + dtMs }

  switch (next.mode) {
    case 'drag':
      return next
    case 'hop':
    case 'fall': {
      if (env.reducedMotion) return { ...next, mode: 'idle', y: 0, vy: 0, t: 0, until: 2500 }
      let vy = next.vy - PET_PHYSICS.gravity * dt
      let y = next.y + vy * dt
      if (y <= 0) {
        y = 0
        if (Math.abs(vy) > PET_PHYSICS.restVelocity && next.mode === 'fall') {
          vy = -vy * PET_PHYSICS.bounce
        } else {
          return { ...next, mode: 'idle', y: 0, vy: 0, t: 0, until: 1500 + rand() * 2000 }
        }
      }

      return { ...next, y, vy }
    }

    case 'walk': {
      if (env.reducedMotion) return pickNext({ ...next, mode: 'idle' }, env, rand)
      let x = next.x + next.facing * PET_PHYSICS.walkSpeed * dt
      let { facing } = next
      const max = Math.max(0, env.width - env.spriteW)
      if (x <= 0) {
        x = 0
        facing = 1
      } else if (x >= max) {
        x = max
        facing = -1
      }

      next = { ...next, x, facing }
      return next.t >= next.until ? pickNext(next, env, rand) : next
    }

    case 'sleep':
      return next
    case 'idle':
    case 'sit':
    default:
      if (next.mode === 'idle' && next.bored >= PET_PHYSICS.sleepAfter) {
        return { ...next, mode: 'sleep', t: 0, until: Infinity }
      }

      return next.t >= next.until ? pickNext(next, env, rand) : next
  }
}

export function petEvent(s: PetState, ev: PetEvent, env: PetEnv): PetState {
  switch (ev.type) {
    case 'click':
      if (s.mode === 'drag') return s
      if (env.reducedMotion || s.mode === 'hop' || s.mode === 'fall') {
        return { ...s, bored: 0, mode: s.mode === 'sleep' ? 'idle' : s.mode, t: 0, until: s.until }
      }

      return { ...s, mode: 'hop', vy: PET_PHYSICS.hopVelocity, t: 0, bored: 0 }
    case 'dragStart':
      return { ...s, mode: 'drag', vy: 0, t: 0, bored: 0 }
    case 'dragMove':
      if (s.mode !== 'drag') return s
      return { ...s, x: clampX(ev.x, env), y: Math.max(0, ev.y) }
    case 'dragEnd':
      if (s.mode !== 'drag') return s
      if (env.reducedMotion || s.y <= 0) return { ...s, mode: 'idle', y: 0, vy: 0, t: 0, until: 2000 }
      return { ...s, mode: 'fall', vy: 0, t: 0 }
    case 'cursor': {
      // Look at the cursor; a nearby cursor wakes a sleeping doll.
      if (s.mode === 'drag' || s.mode === 'hop' || s.mode === 'fall') return s
      const centre = s.x + env.spriteW / 2
      const facing: 1 | -1 = ev.x < centre ? -1 : 1
      if (s.mode === 'sleep') return { ...s, mode: 'idle', facing, t: 0, until: 2500, bored: 0 }
      if (s.mode === 'walk') return { ...s, bored: 0 }
      return { ...s, facing, bored: 0 }
    }

    default:
      return s
  }
}
