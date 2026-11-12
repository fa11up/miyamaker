import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PAD_TAP_MS,
  clampTrackZoom,
  padAim,
  padPointerDown,
  padPointerMove,
  padPointerUp,
  padTick,
  freshPad,
  stickRelease,
  zoomBy,
} from '../src/pages/MusicMaker/screens/trackerPad.js'

const rect = { left: 0, top: 0, width: 118, height: 118 }

test('the cross aims from its center and ignores the nub', () => {
  assert.equal(padAim(0, 0, 59).key, '')
  assert.equal(padAim(0, -40, 59).key, 'ArrowUp')
  assert.equal(padAim(0, 40, 59).key, 'ArrowDown')
  assert.equal(padAim(-40, 0, 59).key, 'ArrowLeft')
  assert.equal(padAim(40, 4, 59).key, 'ArrowRight')
})

test('a tap on an arm is one step, and a quick release adds none', () => {
  const down = padPointerDown(freshPad(), { id: 1, x: 59, y: 16, rect, now: 1000 })
  assert.equal(down.steps, 1)
  assert.equal(down.pad.key, 'ArrowUp')
  const early = padTick(down.pad, 1000 + PAD_TAP_MS - 20)
  assert.equal(early.steps, 0)
  const up = padPointerUp(early.pad, { id: 1 })
  assert.equal(up.on, false)
  assert.equal(up.key, '')
  assert.equal(up.acc, 0)
  assert.equal(padTick(up, 1000 + 400).steps, 0)
})

test('dragging away from the center repeats and speeds up, then the lift stops it', () => {
  const down = padPointerDown(freshPad(), { id: 1, x: 90, y: 59, rect, now: 0 })
  const dragged = padPointerMove(down.pad, { id: 1, x: 130, y: 59 })
  assert.equal(dragged.dragging, true)
  assert.equal(dragged.key, 'ArrowRight')
  const slow = padTick({ ...dragged, x: 80, y: 59, dragging: true, then: 0, acc: 0 }, 40)
  const fast = padTick({ ...dragged, then: 0, acc: 0 }, 40)
  assert.ok(fast.steps >= slow.steps)
  assert.ok(fast.steps >= 1)
  const up = padPointerUp(fast.pad, { id: 1 })
  assert.equal(padTick(up, 80).steps, 0)
  assert.equal('row' in up, false)
})

test('holding an arm past the tap waits, then repeats', () => {
  const down = padPointerDown(freshPad(), { id: 1, x: 59, y: 100, rect, now: 0 })
  const waiting = padTick(down.pad, 40)
  assert.equal(waiting.steps, 0)
  let pad = waiting.pad
  let steps = 0
  let now = PAD_TAP_MS
  for (let i = 0; i < 6; i++) {
    now += 50
    const frame = padTick(pad, now)
    pad = frame.pad
    steps += frame.steps
  }
  assert.ok(steps >= 1)
  assert.equal(pad.key, 'ArrowDown')
})

test('a grid drag does not land on the cell under the release', () => {
  const dragged = stickRelease({ moved: true, tapRow: 4, tapCol: 2 })
  assert.equal(dragged.place, false)
  assert.equal(dragged.swallowClick, true)
  const tap = stickRelease({ moved: false, tapRow: 4, tapCol: 2 })
  assert.equal(tap.place, true)
  assert.equal(tap.row, 4)
  assert.equal(tap.col, 2)
})

test('tracker zoom stays inside a readable range', () => {
  assert.equal(clampTrackZoom(undefined), 1)
  assert.equal(zoomBy(1, 4), clampTrackZoom(4))
  assert.equal(zoomBy(1, 0.1), clampTrackZoom(0.1))
  assert.ok(zoomBy(1, 1.2) > 1)
})
