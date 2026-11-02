// Pure logic behind the wave crest, movable desktop icons and the pet's climbing / surfing. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

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
