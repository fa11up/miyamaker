import assert from 'node:assert/strict'
import test from 'node:test'

import { besideLine, grainField, traceGrain } from '../src/pages/Mint/handheld/paintGrain.ts'

/** Light and dark bands whose lines run in the direction `angle`. */
const bands = (w: number, h: number, angle: number) => {
  const lum = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const across = -Math.sin(angle) * x + Math.cos(angle) * y
      lum[y * w + x] = Math.sin(across * 0.9)
    }
  }
  return lum
}

/** How far apart two line directions are, whichever way each one points. */
const apart = (a: number, b: number) => Math.abs(Math.asin(Math.sin(a - b)))

test('the field runs along painted strokes, not across them', () => {
  for (const angle of [0.3, -0.85, 1.2]) {
    const field = grainField(bands(40, 40, angle), 40, 40, 4)
    assert.ok(apart(field[20 * 40 + 20]!, angle) < 0.05, `${angle} came back ${field[20 * 40 + 20]}`)
  }
})

test('a traced line follows the grain, at the requested length, without doubling back', () => {
  const angle = -0.85
  const field = grainField(bands(40, 40, angle), 40, 40, 4)
  const line = traceGrain(field, 40, 40, 1, 20, 20, Math.PI + angle, 10, 1)
  assert.equal(line.length, 11)
  const [x0, y0] = line[0]!
  const [x1, y1] = line[10]!
  assert.ok(apart(Math.atan2(y1 - y0, x1 - x0), angle) < 0.1)
  // It started out heading backward along the grain, and stayed that way.
  assert.ok(x1 < x0)
})

test('the trace turns gradually when the grain turns', () => {
  // Left half running across, right half running steeply down.
  const w = 60
  const steep = 1.1
  const field = new Float32Array(w * w).map((_, i) => (i % w < 20 ? 0 : steep))
  const line = traceGrain(field, w, w, 1, 5, 5, 0, 40, 1)
  const [ax, ay] = line[38]!
  const [bx, by] = line[40]!
  assert.ok(apart(Math.atan2(by - ay, bx - ax), steep) < 0.05)
  // No corner on the way: each step bends only a little.
  for (let i = 2; i < line.length; i += 1) {
    const before = Math.atan2(line[i - 1]![1] - line[i - 2]![1], line[i - 1]![0] - line[i - 2]![0])
    const after = Math.atan2(line[i]![1] - line[i - 1]![1], line[i]![0] - line[i - 1]![0])
    assert.ok(Math.abs(after - before) < 0.3)
  }
})

test('a bristle keeps its distance from the middle of the brush', () => {
  const spine: [number, number][] = Array.from({ length: 20 }, (_, i) => [i * 2, 10])
  const beside = besideLine(spine, 5)
  assert.equal(beside.length, 20)
  for (const [i, [x, y]] of beside.entries()) {
    assert.equal(x, i * 2)
    assert.equal(y, 15)
  }
})
