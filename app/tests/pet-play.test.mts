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
import { crestHeight, crestParams, crestSlope, crestUniforms, shaderTime } from '../src/pages/OperatingSystem/wave/surface.ts'

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
        assert.ok(y > tb + 20, `crest ${y} too low for ${w}x${h}`)
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
    assert.ok(Math.abs(numeric - crestSlope(x, t, p)) < 1e-4)
  }
})

test('shader uniforms carry the params in the order the GLSL reads them', () => {
  const p = crestParams(1280, 800, 34)
  assert.deepEqual(crestUniforms(p), [p.base, p.a1, p.l1, p.w1, p.a2, p.l2, p.w2, 0])
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
