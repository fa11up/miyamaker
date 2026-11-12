import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hatKey, padStep, readPad } from '../src/pages/MusicMaker/padNav.js'

function pad({
  mapping = 'standard',
  buttons = {},
  axes = [],
}: { mapping?: string; buttons?: Record<number, boolean>; axes?: number[] } = {}) {
  const list: { pressed: boolean; value: number }[] = []
  for (const [index, on] of Object.entries(buttons)) {
    list[Number(index)] = { pressed: !!on, value: on ? 1 : 0 }
  }
  return { mapping, buttons: list, axes }
}

test('r1 plus the top face button turns the page on switch, playstation, and xbox', () => {
  // Switch: R + X. PlayStation: R1 + Triangle. Xbox: RB + Y. All three are buttons 5 and 3.
  assert.deepEqual(readPad(pad({ buttons: { 5: true, 3: true, 15: true } })), { ctrl: true, key: 'ArrowRight' })
  assert.deepEqual(readPad(pad({ buttons: { 5: true, 3: true, 12: true } })), { ctrl: true, key: 'ArrowUp' })
  assert.deepEqual(readPad(pad({ buttons: { 5: true, 15: true } })), { ctrl: false, key: 'ArrowRight' })
  assert.deepEqual(readPad(pad({ buttons: { 3: true, 15: true } })), { ctrl: false, key: 'ArrowRight' })
  assert.deepEqual(readPad(pad({ buttons: { 7: true, 3: true, 12: true } })), { ctrl: false, key: 'ArrowUp' })
  assert.deepEqual(readPad(pad({ buttons: { 5: true, 3: true }, axes: [0.8, 0.1] })), { ctrl: true, key: 'ArrowRight' })
  assert.deepEqual(readPad(pad({ buttons: { 15: true }, axes: [-1, 0] })), { ctrl: false, key: 'ArrowRight' })
  assert.deepEqual(readPad(pad({ axes: [0.2, -0.2] })), { ctrl: false, key: '' })
  assert.deepEqual(readPad(pad({ axes: [0.1, -0.9] })), { ctrl: false, key: 'ArrowUp' })

  // Unmapped PS1 adapter: R1 on button 7, Triangle on button 0, d-pad on the first axes.
  const ps1 = pad({ mapping: '', buttons: { 7: true, 0: true }, axes: [-1, 0] })
  assert.deepEqual(readPad(ps1), { ctrl: true, key: 'ArrowLeft' })
  const ps1StandardFace = pad({ mapping: '', buttons: { 5: true, 3: true, 18: true } })
  assert.deepEqual(readPad(ps1StandardFace), { ctrl: true, key: 'ArrowLeft' })
  const shoulderOnly = pad({ mapping: '', buttons: { 7: true }, axes: [0, 1] })
  assert.deepEqual(readPad(shoulderOnly), { ctrl: false, key: 'ArrowDown' })
  const hat = pad({ mapping: '', buttons: { 5: true, 3: true }, axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, -1] })
  assert.deepEqual(readPad(hat), { ctrl: true, key: 'ArrowUp' })
  const idleHat = pad({ mapping: '', axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] })
  assert.deepEqual(readPad(idleHat), { ctrl: false, key: '' })
})

test('a hat at rest is not a direction, and the compass matches a d-pad', () => {
  assert.equal(hatKey(0), '')
  assert.equal(hatKey(-1), 'ArrowUp')
  assert.equal(hatKey(-0.5), 'ArrowRight')
  assert.equal(hatKey(0.2), 'ArrowDown')
  assert.equal(hatKey(0.6), 'ArrowLeft')
  assert.equal(hatKey(1), 'ArrowUp')
})

test('holding r1 and the top button flips one screen, and a plain direction repeats', () => {
  const state = { key: '', at: 0, paged: false }
  const held = pad({ buttons: { 5: true, 3: true, 15: true } })
  const first = padStep(state, held, 1000)
  assert.equal(first.fire, true)
  assert.equal(first.ctrl, true)
  assert.equal(padStep(state, held, 1600).fire, false)
  assert.equal(padStep(state, pad({ buttons: { 5: true, 3: true } }), 1700).fire, false)
  const again = padStep(state, held, 1800)
  assert.equal(again.fire, true)
  assert.equal(again.key, 'ArrowRight')

  const arrows = { key: '', at: 0, paged: false }
  const right = pad({ buttons: { 15: true } })
  assert.equal(padStep(arrows, right, 0).fire, true)
  assert.equal(padStep(arrows, right, 100).fire, false)
  assert.equal(padStep(arrows, right, 380).fire, true)
  assert.equal(padStep(arrows, right, 400).fire, false)
  assert.equal(padStep(arrows, right, 450).fire, true)

  const other = { key: '', at: 0, paged: false }
  assert.equal(padStep(other, pad({ buttons: { 14: true } }), 450).fire, true)
  assert.equal(other.key, 'ArrowLeft')
  assert.equal(arrows.key, 'ArrowRight')
})
