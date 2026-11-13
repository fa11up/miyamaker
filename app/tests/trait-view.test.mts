import assert from 'node:assert/strict'
import test from 'node:test'

import { canvasPointAtViewCenter, clampZoom, panForZoom } from '../src/pages/MiyaMakerStudio/view.ts'

test('zooming keeps the picture point under the center of the view', () => {
  const before = canvasPointAtViewCenter(100, 1, 1024)
  const nextPan = panForZoom(100, 1, 2)
  assert.equal(canvasPointAtViewCenter(nextPan, 2, 1024), before)
  assert.equal(panForZoom(0, 0.45, 1), 0)
  assert.equal(canvasPointAtViewCenter(0, 4, 1024), 512)
})

test('zoom out toward the center lands on the same point', () => {
  const before = canvasPointAtViewCenter(-40, 2, 1024)
  const nextPan = panForZoom(-40, 2, 0.5)
  assert.equal(canvasPointAtViewCenter(nextPan, 0.5, 1024), before)
})

test('zoom stays inside the usable range', () => {
  assert.equal(clampZoom(0.01), 0.1)
  assert.equal(clampZoom(20), 8)
  assert.equal(clampZoom(1), 1)
})
