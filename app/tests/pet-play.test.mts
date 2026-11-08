// Pure logic behind the wave crest, movable desktop icons and the pet's climbing / surfing. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  defaultLayout,
  gridDims,
  moveIcon,
  pxToCell,
  resolveLayout,
  sameAsDefault,
  stepCell,
} from '../src/desktop/icons/layout.ts'
import type { PetEnv, PetState, Surface } from '../src/desktop/pet/machine.ts'
import { initialPet, moveBetween, petEvent, route, stepPet, supportAt, WORLD } from '../src/desktop/pet/machine.ts'
import { crestHeight, crestParams, crestSlope, shaderTime } from '../src/pages/OperatingSystem/wave/surface.ts'

/* ---------- wave crest ---------- */

test('crest always clears the taskbar and stays on screen', () => {
  for (const [w, h, tb] of [
    [1280, 800, 34],
    [390, 844, 48],
    [2560, 1440, 34],
    [800, 300, 34],
  ] as const) {
    const p = crestParams(w, h, tb)
    for (let x = 0; x <= w; x += 7) {
      for (let t = 0; t < 60; t += 1.3) {
        const y = crestHeight(x, t, p)
        assert.ok(y > tb, `crest ${y} too low for ${w}x${h}`)
        assert.ok(y < h, `crest ${y} off screen for ${w}x${h}`)
      }
    }
  }
})

test('crest slope is the derivative of the crest height', () => {
  const p = crestParams(1280, 800, 34)
  for (const [x, t] of [
    [10, 0],
    [333, 4.2],
    [900, 77.7],
  ] as const) {
    const h = 0.01
    const numeric = (crestHeight(x + h, t, p) - crestHeight(x - h, t, p)) / (2 * h)
    assert.ok(Math.abs(numeric - crestSlope(x, t, p)) < 1e-2)
  }
})

test('the ride rises and falls with the swell, and the clock wraps only without highp', () => {
  const p = crestParams(1280, 800, 34)
  const heights = Array.from({ length: 30 }, (_, t) => crestHeight(640, t, p))
  assert.ok(Math.max(...heights) - Math.min(...heights) > 100)
  assert.equal(shaderTime(1234.5, true), 1234.5)
  assert.ok(shaderTime(1234.5, false) < 600)
})

/* ---------- movable desktop icons ---------- */

const IDS = ['a', 'b', 'c', 'd', 'e']

test('default layout fills columns top to bottom, like the old CSS grid', () => {
  assert.deepEqual(defaultLayout(IDS, 2), {
    a: { col: 0, row: 0 },
    b: { col: 0, row: 1 },
    c: { col: 1, row: 0 },
    d: { col: 1, row: 1 },
    e: { col: 2, row: 0 },
  })
  assert.deepEqual(gridDims(1280, 766), { cols: 12, rows: 6 })
  assert.deepEqual(gridDims(10, 10), { cols: 1, rows: 1 })
})

test('resolveLayout keeps valid saved cells, drops clashes / off-grid / junk, fills the rest', () => {
  const saved = { a: { col: 3, row: 1 }, b: { col: 3, row: 1 }, c: { col: 9, row: 0 }, d: 'x', zz: { col: 0, row: 0 } }
  const out = resolveLayout(IDS, saved, 4, 2)
  assert.deepEqual(out.a, { col: 3, row: 1 })
  const cells = Object.values(out).map((c) => `${c.col},${c.row}`)
  assert.equal(new Set(cells).size, IDS.length, 'no two icons share a cell')
  assert.ok(Object.values(out).every((c) => c.col < 4 && c.row < 2))
  assert.deepEqual(resolveLayout(IDS, null, 4, 2), defaultLayout(IDS, 2))
  assert.deepEqual(resolveLayout(IDS, 'garbage', 4, 2), defaultLayout(IDS, 2))
})

test('moving onto an occupied cell swaps; moving in place is a no-op', () => {
  const l = defaultLayout(IDS, 2)
  const m = moveIcon(l, 'a', { col: 1, row: 1 })
  assert.deepEqual(m.a, { col: 1, row: 1 })
  assert.deepEqual(m.d, { col: 0, row: 0 })
  assert.equal(moveIcon(l, 'a', { col: 0, row: 0 }), l)
  assert.ok(sameAsDefault(l, IDS, 2))
  assert.ok(!sameAsDefault(m, IDS, 2))
})

test('snapping and keyboard steps stay inside the grid', () => {
  assert.deepEqual(pxToCell(-50, 9999, 5, 4), { col: 0, row: 3 })
  assert.deepEqual(pxToCell(16 + 104 * 2 + 40, 16 + 112 + 60, 5, 4), { col: 2, row: 2 })
  assert.deepEqual(stepCell({ col: 0, row: 0 }, 'left', 5, 4), { col: 0, row: 0 })
  assert.deepEqual(stepCell({ col: 0, row: 0 }, 'down', 5, 4), { col: 0, row: 1 })
})

/* ---------- pet: climbing, perching, poking, surfing ---------- */

// two icons stacked in a column near the ground, one more across a gap, the MiyaOS label far right
const icon = (id: string, x0: number, bottom: number): Surface => ({ id, kind: 'icon', x0, x1: x0 + 60, top: bottom + 52, bottom })
const SURFACES: Surface[] = [
  icon('low', 100, 120),
  icon('high', 100, 120 + 52 + 8),
  icon('across', 290, 180),
  { id: 'miyaos', kind: 'perch', x0: 1180, x1: 1240, top: 60, bottom: 46 },
]
const world = (w: Partial<PetEnv> = {}): PetEnv => ({
  width: 1280,
  height: 766,
  spriteW: 61,
  spriteH: 104,
  reducedMotion: false,
  surfaces: SURFACES,
  ...w,
})
const seq = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]!
}
const GROUND: Surface = { id: 'ground', kind: 'ground', x0: 0, x1: 1280, top: 0, bottom: 0 }
const ALL = [GROUND, ...SURFACES]

function run(s: PetState, env: PetEnv, ms: number, until?: (s: PetState) => boolean, rand = seq(0.99)) {
  for (let t = 0; t < ms; t += 16) {
    s = stepPet(s, 16, env, rand)
    if (until?.(s)) break
  }

  return s
}

const go = (s: PetState, env: PetEnv, to: string, extra: PetState['plan'] = [{ k: 'perch', ms: 60_000 }]) => {
  const plan = route(worldOfTest(env), s.on || 'ground', s.x + env.spriteW / 2, to, env.spriteW)
  assert.ok(plan, `route to ${to}`)
  return { ...s, mode: 'idle' as const, t: 0, until: 0, plan: [...plan!, ...extra!] }
}
const worldOfTest = (env: PetEnv) => [{ ...GROUND, x1: env.width }, ...(env.surfaces || [])]

test('routes: climb a low icon from the ground, then the one stacked on it; jump across a gap', () => {
  const up = route(ALL, 'ground', 600, 'high', 61)!
  assert.deepEqual(
    up.filter((s) => s.k === 'climb').map((s) => (s as { to: string }).to),
    ['low', 'high']
  )
  const across = route(ALL, 'high', 130, 'across', 61)!
  assert.ok(across.some((s) => s.k === 'jump'))
  // too high to grab from the ground: no direct climb
  assert.equal(moveBetween(GROUND, icon('sky', 600, WORLD.reach + 40), 600, 61), undefined)
  assert.equal(route(ALL, 'ground', 600, 'nowhere', 61), undefined)
})

test('moving an icon changes the routes', () => {
  const far = SURFACES.map((s) => (s.id === 'low' ? icon('low', 700, 400) : s))
  // with "low" moved away and up, "high" can no longer be reached
  assert.equal(route([GROUND, ...far], 'ground', 600, 'high', 61), undefined)
})

test('the pet walks over, climbs up and sits on an icon; any sprite size works', () => {
  for (const [w, h] of [
    [61, 104], // fumo
    [84, 66], // a wide pixel fren
    [51, 66],
  ] as const) {
    const env = world({ spriteW: w, spriteH: h })
    let s: PetState = { ...initialPet(env, seq(0.5)), x: 800 }
    s = go(s, env, 'high')
    let climbed = false
    s = run(s, env, 60_000, (x) => {
      climbed ||= x.mode === 'climb'
      return x.on === 'high' && x.mode === 'sit'
    })
    assert.ok(climbed)
    assert.equal(s.on, 'high')
    assert.equal(s.y, SURFACES[1]!.top)
    const c = s.x + w / 2
    assert.ok(c >= SURFACES[1]!.x0 && c <= SURFACES[1]!.x1)
  }
})

test('perched pet falls to whatever is below when its icon moves away', () => {
  const env = world()
  let s: PetState = { ...initialPet(env, seq(0.5)), x: 100, y: SURFACES[0]!.top, on: 'low', mode: 'sit', until: 60_000 }
  assert.equal(petEvent(s, { type: 'world' }, env), s) // still there
  const moved = world({ surfaces: SURFACES.filter((x) => x.id !== 'low') })
  s = petEvent(s, { type: 'world' }, moved)
  assert.equal(s.mode, 'fall')
  s = run(s, moved, 5000, (x) => x.mode === 'idle')
  assert.equal(s.on, 'ground')
  assert.equal(s.y, 0)
  assert.equal(supportAt(ALL, 130, 1000)!.id, 'high')
})

test('the pet walks to the wave button and presses it once, reacting to the wave state', () => {
  const env = world({ pokes: [{ id: 'wave', cx: 1264 }], waveOn: false })
  let s: PetState = { ...initialPet(env, seq(0.5)), x: 900 }
  s = go(s, env, 'ground', [
    { k: 'walk', x: 1264 - 61 / 2 },
    { k: 'poke', id: 'wave' },
  ])
  const fx: string[] = []
  for (let t = 0; t < 20_000 && fx.length < 2; t += 16) {
    s = stepPet(s, 16, env, seq(0.99))
    for (const f of s.fx || []) fx.push(f.type === 'say' ? f.kind : f.type)
    s = { ...s, fx: undefined }
  }

  assert.deepEqual(fx, ['press', 'pokeOff'])
})

const crest = (base = 120): PetEnv['wave'] => ({ height: (x) => base + 15 * Math.sin(x / 80), slope: (x) => (15 / 80) * Math.cos(x / 80) })

test('surfing: feet on the crest, board tilted with the slope, then back to the ground', () => {
  const env = world({ wave: crest(), surfaces: [] })
  let s: PetState = { ...initialPet(env, seq(0.5)), x: 400 }
  s = go(s, env, 'ground', [{ k: 'surf', ms: 6000 }])
  s = run(s, env, 5000, (x) => x.mode === 'surf')
  assert.equal(s.mode, 'surf')
  for (let i = 0; i < 100; i++) {
    s = stepPet(s, 16, env, seq(0.99))
    if (s.mode !== 'surf') break
    if (!s.surf?.trick) {
      const c = s.x + env.spriteW / 2
      assert.ok(Math.abs(s.y - env.wave!.height(c)) < 1e-9)
      assert.ok(Math.abs(s.tilt! + (Math.atan(env.wave!.slope(c)) * 180) / Math.PI) < 1e-9)
    }
  }

  s = run(s, env, 20_000, (x) => x.mode === 'idle' || x.mode === 'sit')
  assert.equal(s.y, 0)
})

test('a wipeout drops the pet in, then it climbs back onto the wave', () => {
  const env = world({ wave: crest(), surfaces: [] })
  let s: PetState = { ...initialPet(env, seq(0.5)), x: 400, mode: 'surf', on: undefined, y: 120, surf: { left: 20_000, nextTrick: 0, trickT: 0 } }
  // rand 0.01: always pick a trick and always wipe out
  const modes = new Set<string>()
  for (let t = 0; t < 8000; t += 16) {
    s = stepPet(s, 16, env, seq(0.01))
    modes.add(s.mode)
    if (modes.has('fall') && s.mode === 'surf') break
  }

  assert.ok(modes.has('fall'), 'fell off')
  assert.equal(s.mode, 'surf', 'back on the board')
})

test('the wave switching off mid-ride: falls off and lands', () => {
  let s: PetState = { ...initialPet(world(), seq(0.5)), x: 400, mode: 'surf', y: 120, surf: { left: 20_000, nextTrick: 9999, trickT: 0 } }
  const off = world({ surfaces: [] })
  s = stepPet(s, 16, off, seq(0.5))
  assert.equal(s.mode, 'fall')
  s = run(s, off, 5000, (x) => x.mode === 'idle')
  assert.equal(s.y, 0)
})

test('reduced motion: no outings, no surfing', () => {
  const env = world({ reducedMotion: true, wave: crest(), pokes: [{ id: 'wave', cx: 1264 }] })
  let s = initialPet(env, seq(0.5))
  const seen = new Set<string>()
  for (let i = 0; i < 3000; i++) {
    s = stepPet(s, 50, env, seq(0.01, 0.3, 0.7))
    seen.add(s.mode)
  }

  for (const m of ['walk', 'climb', 'jump', 'surf', 'poke']) assert.ok(!seen.has(m), m)
  assert.equal(petEvent({ ...s, mode: 'idle' }, { type: 'surf' }, env).mode, 'idle')
})

test('left alone, the pet sometimes heads out on its own (idle-driven outings)', () => {
  const env = world({ wave: crest(), pokes: [{ id: 'wave', cx: 1264 }] })
  let outings = 0
  for (let i = 0; i < 40; i++) {
    const r = seq((i % 10) / 10 + 0.01, 0.5, 0.3, 0.7)
    const s = stepPet({ ...initialPet(env, seq(0.5)), mode: 'idle', until: 0, t: 0 }, 16, env, r)
    if (s.plan?.length || ['climb', 'jump'].includes(s.mode) || (s.mode === 'walk' && s.tx !== undefined)) outings++
  }

  assert.ok(outings > 0 && outings < 40, `outings ${outings}`)
})
