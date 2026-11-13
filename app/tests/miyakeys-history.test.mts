// embed/miyakeys/js/core/history.js: undo holds the state after each change, keeps key images out of its entries,
// and is capped. update.js (setState / undo) pulls in three.js, so its order is checked from source. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  _debugHistory,
  canRedo,
  canUndo,
  isEmpty,
  pushState,
  redo,
  resetHistory,
  undo,
} from '../embed/miyakeys/js/core/history.js'
import { MAX_IMAGE_DATA } from '../embed/miyakeys/js/core/validBuild.js'
import { code } from './source-scan.mts'

type Build = Record<string, any>
const IMG = 'data:image/png;base64,' + 'A'.repeat(200_000)

const base = (): Build => ({
  layout: '75',
  profile: 'cherry',
  brand: 'claude',
  colorway: 'claude',
  caseColor: 'porcelain',
  caseCustomColor: null,
  finish: 'anodized',
  plate: 'brass',
  plateColor: null,
  sw: 'boba',
  switchColor: null,
  material: 'pbt',
  light: { mode: 'static', color: '#cc785c', bright: 0.7 },
  extras: { knob: true, cable: false, wrist: false, lube: false },
  customColors: null,
  perKeyOverrides: Object.create(null),
  view: '3d',
  theme: 'light',
})

/* What update.js does: setState applies the change, then records the state after it. */
const change = (s: Build, patch: Build) => {
  if (isEmpty()) resetHistory(s)
  Object.assign(s, patch)
  pushState(s)
}

test('undo/redo walk S0 -> S1 -> S2 and back without losing a state', () => {
  const s = base()
  resetHistory(s)
  change(s, { colorway: 'mono' }) // S1
  change(s, { layout: '60' }) // S2
  const u1 = undo()
  assert.equal(u1?.layout, '75', 'undo from S2 lands on S1')
  assert.equal(u1?.colorway, 'mono')
  assert.equal(undo()?.colorway, 'claude', 'second undo lands on S0')
  assert.equal(canUndo(), false)
  const r1 = redo()
  assert.equal(r1?.colorway, 'mono')
  assert.equal(r1?.layout, '75', 'redo lands on S1')
  const r2 = redo()
  assert.equal(r2?.layout, '60', 'redo lands on S2, not lost')
  assert.equal(canRedo(), false)
})

test('the first change after reset is undoable', () => {
  const s = base()
  resetHistory(s)
  change(s, { finish: 'matte' })
  assert.equal(canUndo(), true)
  assert.equal(undo()?.finish, 'anodized')
})

test('a change with nothing recorded yet starts history at the state before it', () => {
  // Fresh module state is not reachable here, so check the rule update.js follows instead.
  const src = code('embed/miyakeys/js/core/update.js')
  const body = src.slice(src.indexOf('export function setState'), src.indexOf('function restore'))
  assert.match(body, /ensureHistory\(\)[\s\S]*Object\.assign\(state, patch\)[\s\S]*pushState\(state\)/)
  assert.doesNotMatch(body, /pushState\(stateSlice\(\)\)/)
})

test('a per-key edit (in-place mutation) is its own undo step', () => {
  const s = base()
  resetHistory(s)
  s.perKeyOverrides['0-0'] = { customText: 'Hi' }
  pushState(s)
  s.perKeyOverrides['0-0'].customText = 'Hello' // same object mutated again
  pushState(s)
  assert.equal(undo()?.perKeyOverrides['0-0'].customText, 'Hi')
  assert.equal(undo()?.perKeyOverrides['0-0'], undefined)
  assert.equal(redo()?.perKeyOverrides['0-0'].customText, 'Hi')
})

test('pushing an unchanged build adds no step', () => {
  const s = base()
  resetHistory(s)
  pushState(s)
  s.view = 'top' // viewer field, not part of a build
  pushState(s)
  assert.equal(canUndo(), false)
})

test('history entries hold image ids, not image data; undo puts the image back', () => {
  const s = base()
  resetHistory(s)
  for (let i = 0; i < 10; i++) {
    s.perKeyOverrides['0-' + i] = { imageData: IMG }
    pushState(s)
  }
  const { entries, images } = _debugHistory()
  assert.ok(!JSON.stringify(entries).includes('base64'), 'no data URL in any entry')
  assert.ok(JSON.stringify(entries).length < 20_000)
  assert.equal(images, 1, 'the same image is stored once')
  assert.ok(IMG.length <= MAX_IMAGE_DATA)
  const back = undo()
  assert.equal(back?.perKeyOverrides['0-0'].imageData, IMG)
  assert.equal(back?.perKeyOverrides['0-0'].imageRef, undefined)
  assert.equal(back?.perKeyOverrides['0-9'], undefined)
})

test('images no entry names any more are dropped', () => {
  const s = base()
  s.perKeyOverrides['0-0'] = { imageData: IMG }
  resetHistory(s)
  assert.equal(_debugHistory().images, 1)
  resetHistory(base())
  assert.equal(_debugHistory().images, 0)
})

test('history is capped at 50 entries', () => {
  const s = base()
  resetHistory(s)
  for (let i = 0; i < 80; i++) change(s, { light: { mode: 'static', color: '#cc785c', bright: i / 100 } })
  const { entries, pos } = _debugHistory()
  assert.equal(entries.length, 50)
  assert.equal(pos, 49)
  let n = 0
  while (undo()) n++
  assert.equal(n, 49)
})

test('panels: brightness slider has no per-step setState; legend field is capped', () => {
  const src = code('embed/miyakeys/js/ui/panels.js')
  assert.doesNotMatch(src, /\.oninput\s*=\s*\(\)\s*=>\s*\{\s*setState/)
  assert.match(src, /id="cuText"[^>]*maxlength="\$\{MAX_LEGEND\}"/)
})
