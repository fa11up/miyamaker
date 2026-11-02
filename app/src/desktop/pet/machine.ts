/**
 * Desktop pet state machine. Pure: no DOM, no timers. The component feeds it frame deltas, pointer
 * events and the measured world (perches, pokeable buttons, the wave crest) and renders whatever
 * comes back. Side effects (speech, pressing a button) come back as `fx` for the component to run.
 * Kept import-free so `node --test` can run it.
 *
 * Coordinates: `x` is the sprite's left edge in px from the left of the layer, `y` is the height of
 * its feet above the ground (taskbar edge) in px, positive is up. `on` is the surface it stands on.
 */

/* ---------- the world: ground, perches and routes between them ----------
 * A surface is the top edge of a measured rect (icon art, the MiyaOS label); the component measures
 * DOM rects and hands them in. Heights are px above the ground; the pet's centre must be inside
 * [x0, x1] to stand on it.
 */

export interface Surface {
  id: string
  kind: 'ground' | 'icon' | 'perch'
  x0: number
  x1: number
  /** height of the top edge above the ground (where the pet's feet go) */
  top: number
  /** height of the bottom edge above the ground */
  bottom: number
}

export interface Poke {
  id: string
  /** centre x of the button, layer px */
  cx: number
}

export type Step =
  | { k: 'walk'; x: number }
  | { k: 'climb'; to: string; y: number }
  | { k: 'jump'; to: string; x: number; y: number }
  | { k: 'poke'; id: string }
  | { k: 'perch'; ms: number }
  | { k: 'surf'; ms: number }

export const WORLD = {
  /** how far above its feet the pet can grab the bottom of something to climb it, px */
  reach: 160,
  /** longest gap it will jump across, px */
  jumpX: 150,
  /** highest step up it will jump (more than this it climbs), px */
  jumpUp: 48,
} as const

export const GROUND_ID = 'ground'

export function ground(width: number): Surface {
  return { id: GROUND_ID, kind: 'ground', x0: 0, x1: width, top: 0, bottom: 0 }
}

/** Surfaces the pet can stand on: perches whose top leaves room for its head inside the layer. */
export function standable(surfaces: readonly Surface[], spriteH: number, layerH: number): Surface[] {
  return surfaces.filter((s) => s.kind === 'ground' || (s.top + spriteH * 0.8 <= layerH && s.x1 - s.x0 >= 12))
}

/** Highest surface under centre `cx` whose top is at or below `y` (where a falling pet lands). */
export function supportAt(surfaces: readonly Surface[], cx: number, y: number): Surface | undefined {
  let best: Surface | undefined
  for (const s of surfaces) {
    if (cx < s.x0 || cx > s.x1 || s.top > y + 0.5) continue
    if (!best || s.top > best.top) best = s
  }

  return best
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Gap between two x ranges (0 when they overlap). */
function gapX(a: Surface, b: Surface) {
  return Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1))
}

interface Move {
  steps: Step[]
  cost: number
  /** pet centre on arrival */
  cx: number
}

/** Ways to get from standing on `a` (centre at `cx`) onto `b`, cheapest first, or none. `w` = sprite width. */
export function moveBetween(a: Surface, b: Surface, cx: number, w: number): Move | undefined {
  if (a.id === b.id) return undefined
  const half = w / 2
  const options: Move[] = []

  // Climb up the side of b from a.
  if (b.top > a.top && b.bottom - a.top <= WORLD.reach && b.bottom >= a.top - 2) {
    for (const edge of [b.x0, b.x1]) {
      if (edge < a.x0 || edge > a.x1) continue
      const inward = edge === b.x0 ? Math.min(b.x1, edge + half * 0.6) : Math.max(b.x0, edge - half * 0.6)
      options.push({
        steps: [
          { k: 'walk', x: edge - half },
          { k: 'climb', to: b.id, y: b.top },
          { k: 'walk', x: inward - half },
        ],
        cost: Math.abs(edge - cx) + (b.top - a.top) * 1.5 + 20,
        cx: inward,
      })
    }
  }

  // Jump across a gap (or a small step up).
  const g = gapX(a, b)
  if (b.top - a.top <= WORLD.jumpUp && g <= WORLD.jumpX && !(b.top < a.top && g === 0)) {
    const toRight = (b.x0 + b.x1) / 2 >= (a.x0 + a.x1) / 2
    const takeoff = toRight ? a.x1 : a.x0
    const land = toRight ? clamp(b.x0 + half * 0.8, b.x0, b.x1) : clamp(b.x1 - half * 0.8, b.x0, b.x1)
    options.push({
      steps: [
        { k: 'walk', x: takeoff - half },
        { k: 'jump', to: b.id, x: land - half, y: b.top },
      ],
      cost: Math.abs(takeoff - cx) + g + 60,
      cx: land,
    })
  }

  // Hop down off an edge onto something lower that sticks out past it (the ground, a lower icon).
  if (b.top < a.top) {
    for (const [edge, out] of [
      [a.x0, a.x0 - half * 1.1],
      [a.x1, a.x1 + half * 1.1],
    ] as const) {
      if (out < b.x0 || out > b.x1) continue
      options.push({
        steps: [
          { k: 'walk', x: edge - half },
          { k: 'jump', to: b.id, x: out - half, y: b.top },
        ],
        cost: Math.abs(edge - cx) + 40,
        cx: out,
      })
    }
  }

  options.sort((p, q) => p.cost - q.cost)
  return options[0]
}

/**
 * Cheapest route (Dijkstra over surfaces) from `from` (centre `cx`) to `to`. Returns the steps,
 * or undefined when it cannot get there. Routes change as soon as icons move: the graph is
 * rebuilt from live rects every time.
 */
export function route(surfaces: readonly Surface[], from: string, cx: number, to: string, w: number): Step[] | undefined {
  if (from === to) return []
  const byId = new Map(surfaces.map((s) => [s.id, s]))
  if (!byId.has(from) || !byId.has(to)) return undefined
  const best = new Map<string, { cost: number; cx: number; steps: Step[] }>([[from, { cost: 0, cx, steps: [] }]])
  const done = new Set<string>()
  for (;;) {
    let cur: string | undefined
    for (const [id, v] of best) if (!done.has(id) && (!cur || v.cost < best.get(cur)!.cost)) cur = id
    if (!cur) return undefined
    if (cur === to) return best.get(cur)!.steps
    done.add(cur)
    const here = best.get(cur)!
    const a = byId.get(cur)!
    for (const b of surfaces) {
      if (done.has(b.id)) continue
      const m = moveBetween(a, b, here.cx, w)
      if (!m) continue
      const cost = here.cost + m.cost
      if (cost < (best.get(b.id)?.cost ?? Infinity)) best.set(b.id, { cost, cx: m.cx, steps: [...here.steps, ...m.steps] })
    }
  }
}

/** Every surface reachable from `from`, for picking somewhere to go. */
export function reachable(surfaces: readonly Surface[], from: string, cx: number, w: number): Surface[] {
  return surfaces.filter((s) => s.id !== from && route(surfaces, from, cx, s.id, w))
}

/* ---------- the pet ---------- */

export type PetMode =
  | 'idle'
  | 'walk'
  | 'sit'
  | 'sleep'
  | 'hop'
  | 'drag'
  | 'fall'
  | 'climb'
  | 'jump'
  | 'poke'
  | 'surf'

export interface Tween {
  x0: number
  y0: number
  x1: number
  y1: number
  /** ms */
  dur: number
  peak: number
  to: string
  /** land on the wave crest (y1 follows the moving crest) */
  toWave?: boolean
}

export interface SurfState {
  /** ms of surfing left */
  left: number
  /** ms until the next trick */
  nextTrick: number
  trick?: 'ollie' | 'spin'
  trickT: number
}

export type PetFx =
  | { type: 'say'; kind: 'surfStart' | 'surfEnd' | 'wipeout' | 'trick' | 'perch' | 'pokeOn' | 'pokeOff' | 'climb' }
  | { type: 'press'; id: string }
  | { type: 'wipeout' }

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
  /** surface the pet stands on (ground unless it climbed somewhere) */
  on?: string
  /** queued steps of the current outing */
  plan?: Step[]
  /** walk target (left edge x) */
  tx?: number
  tween?: Tween
  surf?: SurfState
  /** board tilt while surfing, degrees (positive = nose down to the right) */
  tilt?: number
  /** button being poked */
  poke?: string
  /** side effects for the component, drained every frame */
  fx?: PetFx[]
}

export interface WaveSurface {
  /** crest height above the ground at layer x */
  height(x: number): number
  /** d(height)/dx */
  slope(x: number): number
}

export interface PetEnv {
  /** walkable width in px */
  width: number
  spriteW: number
  reducedMotion: boolean
  /** layer height, px (to keep perches with room for the head) */
  height?: number
  spriteH?: number
  /** perches measured from the DOM (icons, the MiyaOS label); the ground is implied */
  surfaces?: Surface[]
  /** buttons the pet likes to press (the wave button) */
  pokes?: Poke[]
  /** the wave crest, when the wave is on */
  wave?: WaveSurface
  /** whether the wave is on (the wave button reaction) */
  waveOn?: boolean
}

export type PetEvent =
  | { type: 'click' }
  | { type: 'dragStart' }
  | { type: 'dragMove'; x: number; y: number }
  | { type: 'dragEnd' }
  | { type: 'cursor'; x: number }
  /** the world was re-measured (icons moved, resize): drop off a perch that is gone */
  | { type: 'world' }
  /** go surfing now (the user just switched the wave on) */
  | { type: 'surf' }

export const PET_PHYSICS = {
  gravity: 2600, // px/s^2
  hopVelocity: 560, // px/s
  walkSpeed: 38, // px/s
  climbSpeed: 46, // px/s
  surfSpeed: 52, // px/s
  bounce: 0.42,
  restVelocity: 140, // below this the doll stops bouncing
  sleepAfter: 40_000, // ms without interaction
  /** chance an idle pick turns into an outing (climb, perch, poke, surf) */
  adventure: 0.32,
  wipeoutChance: 0.22,
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
    on: GROUND_ID,
  }
}

const clampX = (x: number, env: PetEnv) => Math.min(Math.max(0, env.width - env.spriteW), Math.max(0, x))

/** Ground plus measured perches the pet fits on. */
export function worldOf(env: PetEnv): Surface[] {
  const all = [ground(env.width), ...(env.surfaces || [])]
  return env.spriteH && env.height ? standable(all, env.spriteH, env.height) : all
}

function surfaceOf(s: PetState, env: PetEnv): Surface {
  const id = s.on || GROUND_ID
  return worldOf(env).find((x) => x.id === id) || ground(env.width)
}

const withFx = (s: PetState, fx: PetFx): PetState => ({ ...s, fx: [...(s.fx || []), fx] })

const centre = (s: PetState, env: PetEnv) => s.x + env.spriteW / 2

function calm(s: PetState, mode: 'idle' | 'sit', until: number): PetState {
  return { ...s, mode, t: 0, vy: 0, until, tx: undefined, tween: undefined, surf: undefined, tilt: 0, poke: undefined }
}

/** Plan an outing: somewhere to climb and sit, the wave button, or surfing. */
function planOuting(s: PetState, env: PetEnv, rand: Rand): Step[] | undefined {
  const world = worldOf(env)
  const from = s.on || GROUND_ID
  const cx = centre(s, env)
  const w = env.spriteW
  const choices: { w: number; plan: () => Step[] | undefined }[] = []

  const perches = world.filter((x) => x.kind !== 'ground' && x.id !== from)
  if (perches.length) {
    choices.push({
      w: 0.5,
      plan: () => {
        // try a few random perches; moved icons give new ones
        for (let i = 0; i < 4; i++) {
          const target = perches[Math.floor(rand() * perches.length)]!
          const r = route(world, from, cx, target.id, w)
          if (r) return [...r, { k: 'perch', ms: 5000 + rand() * 7000 }]
        }

        return undefined
      },
    })
  }

  const miya = world.find((x) => x.id === 'miyaos' && x.id !== from)
  if (miya) {
    choices.push({
      w: 0.2,
      plan: () => {
        const r = route(world, from, cx, miya.id, w)
        return r && [...r, { k: 'perch', ms: 6000 + rand() * 6000 }]
      },
    })
  }

  const pokes = env.pokes || []
  if (pokes.length) {
    choices.push({
      w: 0.15,
      plan: () => {
        const p = pokes[Math.floor(rand() * pokes.length)]!
        const r = route(world, from, cx, GROUND_ID, w)
        return r && [...r, { k: 'walk', x: p.cx - w / 2 }, { k: 'poke', id: p.id }]
      },
    })
  }

  if (env.wave) {
    choices.push({
      w: 0.3,
      plan: () => {
        const r = route(world, from, cx, GROUND_ID, w)
        return r && [...r, { k: 'surf', ms: 14_000 + rand() * 16_000 }]
      },
    })
  }

  // when up on a perch, sometimes just come back down
  if (from !== GROUND_ID) choices.push({ w: 0.25, plan: () => route(world, from, cx, GROUND_ID, w) })

  const total = choices.reduce((a, c) => a + c.w, 0)
  let r = rand() * total
  for (const c of choices) {
    r -= c.w
    if (r <= 0) return c.plan()
  }

  return undefined
}

/** Start the next queued step, or go calm when the plan is done. */
function nextStep(s: PetState, env: PetEnv, rand: Rand): PetState {
  const plan = s.plan || []
  const [step, ...rest] = plan
  const base: PetState = { ...s, plan: rest, t: 0, vy: 0, tween: undefined, tx: undefined, poke: undefined }
  if (!step) return calm({ ...base, plan: undefined }, rand() < 0.5 ? 'sit' : 'idle', 2500 + rand() * 3000)
  const w = env.spriteW
  switch (step.k) {
    case 'walk': {
      const tx = clampX(step.x, env)
      if (Math.abs(tx - s.x) < 1) return nextStep({ ...base, x: tx }, env, rand)
      return { ...base, mode: 'walk', tx, facing: tx > s.x ? 1 : -1, until: Infinity }
    }

    case 'climb':
      return withFx(
        {
          ...base,
          mode: 'climb',
          until: Infinity,
          tween: { x0: s.x, y0: s.y, x1: s.x, y1: step.y, dur: (Math.abs(step.y - s.y) / PET_PHYSICS.climbSpeed) * 1000, peak: 0, to: step.to },
        },
        { type: 'say', kind: 'climb' }
      )
    case 'jump': {
      const dx = step.x - s.x
      const dy = step.y - s.y
      return {
        ...base,
        mode: 'jump',
        until: Infinity,
        facing: dx === 0 ? s.facing : dx > 0 ? 1 : -1,
        tween: {
          x0: s.x,
          y0: s.y,
          x1: clampX(step.x, env),
          y1: step.y,
          dur: 420 + Math.min(380, Math.hypot(dx, dy) * 1.4),
          peak: Math.max(0, dy) + 34,
          to: step.to,
        },
      }
    }

    case 'poke':
      return { ...base, mode: 'poke', until: 1300, poke: step.id }
    case 'perch':
      return withFx({ ...calm(base, 'sit', step.ms), plan: rest }, { type: 'say', kind: 'perch' })
    case 'surf': {
      if (!env.wave || env.reducedMotion) return nextStep(base, env, rand)
      const cx = centre(s, env)
      return withFx(
        {
          ...base,
          mode: 'jump',
          until: Infinity,
          surf: { left: step.ms, nextTrick: 2500 + rand() * 2500, trickT: 0 },
          tween: { x0: s.x, y0: s.y, x1: s.x, y1: env.wave.height(cx), dur: 650, peak: 40, to: 'wave', toWave: true },
        },
        { type: 'say', kind: 'surfStart' }
      )
    }

    default:
      return nextStep(base, env, rand)
  }
}

/** What to do once a calm mode (idle / walk / sit) runs out. */
export function pickNext(s: PetState, env: PetEnv, rand: Rand): PetState {
  const base: PetState = { ...s, t: 0, vy: 0, tx: undefined, tween: undefined }
  if (s.bored >= PET_PHYSICS.sleepAfter) return { ...base, mode: 'sleep', until: Infinity }
  if (!env.reducedMotion && (env.surfaces?.length || env.pokes?.length || env.wave) && rand() < PET_PHYSICS.adventure) {
    const plan = planOuting(s, env, rand)
    if (plan && plan.length) return nextStep({ ...base, plan }, env, rand)
  }

  const r = rand()
  if (!env.reducedMotion && r < 0.55) {
    // Walk, usually keeping the current direction, sometimes turning around.
    const facing = rand() < 0.3 ? ((s.facing * -1) as 1 | -1) : s.facing
    return { ...base, mode: 'walk', facing, until: 3000 + rand() * 6000 }
  }

  if (r < 0.75) return { ...base, mode: 'sit', until: 4000 + rand() * 6000 }
  return { ...base, mode: 'idle', until: 2000 + rand() * 4000 }
}

/** Fall from where it is: lands on whatever is under it (a perch or the ground). */
function startFall(s: PetState): PetState {
  return { ...s, mode: 'fall', vy: Math.min(0, s.vy), t: 0, tween: undefined, tx: undefined, plan: undefined, surf: undefined, tilt: 0, on: undefined }
}

function stepSurf(s: PetState, dtMs: number, env: PetEnv, rand: Rand): PetState {
  const wave = env.wave
  if (!wave || env.reducedMotion || !s.surf) {
    return withFx(startFall({ ...s, vy: 120 }), { type: 'wipeout' })
  }

  const dt = Math.min(dtMs, 100) / 1000
  let { facing } = s
  let x = s.x + facing * PET_PHYSICS.surfSpeed * dt
  const max = Math.max(0, env.width - env.spriteW)
  if (x <= 0) {
    x = 0
    facing = 1
  } else if (x >= max) {
    x = max
    facing = -1
  }

  const cx = x + env.spriteW / 2
  const surf = { ...s.surf, left: s.surf.left - dtMs, nextTrick: s.surf.nextTrick - dtMs, trickT: s.surf.trickT + dtMs }
  let next: PetState = { ...s, x, facing, surf }
  const TRICK_MS = 750

  if (surf.trick && surf.trickT >= TRICK_MS) {
    // trick over: stick the landing, or wipe out
    surf.trick = undefined
    if (rand() < PET_PHYSICS.wipeoutChance) {
      const fell = startFall({ ...next, vy: 260 })
      // after the swim, climb back onto the wave with the time that was left
      return withFx(withFx({ ...fell, plan: [{ k: 'surf', ms: Math.max(4000, surf.left) }] }, { type: 'wipeout' }), {
        type: 'say',
        kind: 'wipeout',
      })
    }
  }

  if (!surf.trick && surf.nextTrick <= 0 && surf.left > 1500) {
    surf.trick = rand() < 0.5 ? 'ollie' : 'spin'
    surf.trickT = 0
    surf.nextTrick = 3000 + rand() * 4000
    next = withFx(next, { type: 'say', kind: 'trick' })
  }

  const air = surf.trick ? Math.sin(Math.min(1, surf.trickT / TRICK_MS) * Math.PI) * (surf.trick === 'ollie' ? 46 : 30) : 0
  const tilt = (-Math.atan(wave.slope(cx)) * 180) / Math.PI
  next = { ...next, y: wave.height(cx) + air, tilt }

  if (surf.left <= 0) {
    // ride over: hop back to the ground
    return withFx(
      {
        ...next,
        mode: 'jump',
        surf: undefined,
        tilt: 0,
        t: 0,
        tween: { x0: x, y0: next.y, x1: x, y1: 0, dur: 600, peak: 30, to: GROUND_ID },
      },
      { type: 'say', kind: 'surfEnd' }
    )
  }

  return next
}

export function stepPet(s: PetState, dtMs: number, env: PetEnv, rand: Rand = Math.random): PetState {
  const dt = Math.min(dtMs, 100) / 1000 // clamp: a backgrounded tab must not teleport the doll
  let next: PetState = { ...s, t: s.t + dtMs, bored: s.mode === 'drag' ? 0 : s.bored + dtMs }

  switch (next.mode) {
    case 'drag':
      return next
    case 'hop':
    case 'fall': {
      if (env.reducedMotion) {
        const land = supportAt(worldOf(env), centre(next, env), next.y) || ground(env.width)
        return calm({ ...next, y: land.top, on: land.id, plan: undefined }, 'idle', 2500)
      }

      const prevY = next.y
      let vy = next.vy - PET_PHYSICS.gravity * dt
      let y = next.y + vy * dt
      const floor = supportAt(worldOf(env), centre(next, env), prevY) || ground(env.width)
      if (y <= floor.top) {
        y = floor.top
        if (Math.abs(vy) > PET_PHYSICS.restVelocity && next.mode === 'fall') {
          vy = -vy * PET_PHYSICS.bounce
        } else {
          const landed: PetState = { ...next, y, vy: 0, t: 0, on: floor.id }
          if (landed.plan?.length) return nextStep(landed, env, rand)
          return calm({ ...landed, plan: undefined }, 'idle', 1500 + rand() * 2000)
        }
      }

      return { ...next, y, vy }
    }

    case 'climb':
    case 'jump': {
      const tw = next.tween
      if (!tw || env.reducedMotion) {
        if (tw?.toWave) return nextStep({ ...next, plan: [] }, env, rand)
        return tw ? nextStep({ ...next, x: tw.x1, y: tw.y1, on: tw.to }, env, rand) : nextStep(next, env, rand)
      }

      const p = Math.min(1, next.t / Math.max(1, tw.dur))
      const y1 = tw.toWave && env.wave ? env.wave.height(tw.x1 + env.spriteW / 2) : tw.y1
      if (tw.toWave && !env.wave) return startFall(next)
      const ease = next.mode === 'climb' ? p : p
      const x = tw.x0 + (tw.x1 - tw.x0) * ease
      const y = tw.y0 + (y1 - tw.y0) * ease + 4 * tw.peak * p * (1 - p)
      if (p < 1) return { ...next, x, y }
      if (tw.toWave) return { ...next, x, y: y1, mode: 'surf', t: 0, tween: undefined, on: undefined }
      // landed: check the perch is still there (it may have moved mid-jump)
      const target = worldOf(env).find((w) => w.id === tw.to)
      if (!target || Math.abs(target.top - tw.y1) > 3) return startFall({ ...next, x, y })
      return nextStep({ ...next, x, y: tw.y1, on: tw.to }, env, rand)
    }

    case 'surf':
      return stepSurf(next, dtMs, env, rand)
    case 'poke': {
      if (next.t - dtMs < 380 && next.t >= 380 && next.poke) next = withFx(next, { type: 'press', id: next.poke })
      if (next.t >= next.until) {
        const reacted = withFx(next, { type: 'say', kind: env.waveOn ? 'pokeOn' : 'pokeOff' })
        return nextStep(reacted, env, rand)
      }

      return next
    }

    case 'walk': {
      if (env.reducedMotion) return pickNext({ ...next, mode: 'idle', plan: undefined, tx: undefined }, env, rand)
      const surface = surfaceOf(next, env)
      const lo = Math.max(0, surface.x0 - env.spriteW / 2)
      const hi = Math.min(Math.max(0, env.width - env.spriteW), surface.x1 - env.spriteW / 2)
      let { facing } = next
      if (next.tx !== undefined) {
        // walking somewhere on purpose
        const tx = Math.min(hi, Math.max(lo, next.tx))
        facing = tx > next.x ? 1 : -1
        const x = next.x + facing * PET_PHYSICS.walkSpeed * dt
        if ((facing > 0 && x >= tx) || (facing < 0 && x <= tx)) return nextStep({ ...next, x: tx, facing }, env, rand)
        return { ...next, x, facing }
      }

      let x = next.x + facing * PET_PHYSICS.walkSpeed * dt
      if (x <= lo) {
        x = lo
        facing = 1
      } else if (x >= hi) {
        x = hi
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

      if (next.t < next.until) return next
      return next.plan?.length ? nextStep(next, env, rand) : pickNext(next, env, rand)
  }
}

export function petEvent(s: PetState, ev: PetEvent, env: PetEnv): PetState {
  switch (ev.type) {
    case 'click':
      if (s.mode === 'drag') return s
      if (env.reducedMotion || s.mode === 'hop' || s.mode === 'fall' || s.mode === 'climb' || s.mode === 'jump' || s.mode === 'surf') {
        return { ...s, bored: 0, mode: s.mode === 'sleep' ? 'idle' : s.mode, t: s.mode === 'sleep' ? 0 : s.t, until: s.until }
      }

      // a poke interrupts an outing: hop in place, then carry on from wherever it lands
      return { ...s, mode: 'hop', vy: PET_PHYSICS.hopVelocity, t: 0, bored: 0, plan: undefined, tx: undefined, poke: undefined, on: undefined }
    case 'dragStart':
      return { ...s, mode: 'drag', vy: 0, t: 0, bored: 0, plan: undefined, tween: undefined, surf: undefined, tilt: 0, tx: undefined, on: undefined }
    case 'dragMove':
      if (s.mode !== 'drag') return s
      return { ...s, x: clampX(ev.x, env), y: Math.max(0, ev.y) }
    case 'dragEnd': {
      if (s.mode !== 'drag') return s
      const land = supportAt(worldOf(env), centre(s, env), s.y) || ground(env.width)
      if (env.reducedMotion || s.y <= land.top + 0.5) {
        return { ...s, mode: 'idle', y: land.top, on: land.id, vy: 0, t: 0, until: 2000 }
      }

      return { ...s, mode: 'fall', vy: 0, t: 0 }
    }

    case 'cursor': {
      // Look at the cursor; a nearby cursor wakes a sleeping doll.
      if (['drag', 'hop', 'fall', 'climb', 'jump', 'surf', 'poke'].includes(s.mode)) return s
      const c = s.x + env.spriteW / 2
      const facing: 1 | -1 = ev.x < c ? -1 : 1
      if (s.mode === 'sleep') return { ...s, mode: 'idle', facing, t: 0, until: 2500, bored: 0 }
      if (s.mode === 'walk') return { ...s, bored: 0 }
      return { ...s, facing, bored: 0 }
    }

    case 'world': {
      // perch moved or vanished under the pet: fall to whatever is below now
      if (s.mode === 'drag' || s.mode === 'hop' || s.mode === 'fall' || s.mode === 'surf') return s
      if (s.mode === 'climb' || s.mode === 'jump') {
        const tw = s.tween
        if (!tw || tw.toWave || tw.to === GROUND_ID) return s
        const target = worldOf(env).find((w) => w.id === tw.to)
        return target && Math.abs(target.top - tw.y1) <= 3 ? s : startFall(s)
      }

      const on = s.on || GROUND_ID
      if (on === GROUND_ID) return s.y === 0 ? s : startFall(s)
      const surf = worldOf(env).find((w) => w.id === on)
      const c = centre(s, env)
      if (surf && Math.abs(surf.top - s.y) <= 3 && c >= surf.x0 - 2 && c <= surf.x1 + 2) return s
      return startFall(s)
    }

    case 'surf': {
      if (env.reducedMotion || !env.wave || s.mode === 'drag' || s.mode === 'surf' || s.surf) return s
      const plan = route(worldOf(env), s.on || GROUND_ID, centre(s, env), GROUND_ID, env.spriteW)
      if (!plan || !['idle', 'sit', 'walk', 'sleep'].includes(s.mode)) return s
      return nextStep({ ...s, plan: [...plan, { k: 'surf', ms: 16_000 }], bored: 0 }, env, Math.random)
    }

    default:
      return s
  }
}
