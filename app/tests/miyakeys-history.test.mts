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
  syncCurrent,
  undo,
} from '../embed/miyakeys/js/core/history.js'
import { setOverride, setOverrides } from '../embed/miyakeys/js/core/perKey.js'
import { state as liveState } from '../embed/miyakeys/js/core/state.js'
import { BUILD_FIELDS, MAX_IMAGE_DATA, validBuild } from '../embed/miyakeys/js/core/validBuild.js'
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

/* ── undo/redo through the restore path ──────────────────────────────────────────────────────────────────────────
   update.js cannot load here (three.js), so this is its undo/redo with the drawing left out: commit what is on screen,
   step the stack, put the entry back through validBuild, then make the entry the state on screen. A source check
   below keeps update.js doing the same. */
const commitApp = (s: Build) => {
  if (isEmpty()) resetHistory(s)
  pushState(s)
}
const restoreApp = (s: Build, entry: Build | null) => {
  const snap = validBuild(entry)
  if (!snap) return false
  Object.assign(s, snap)
  syncCurrent(s)
  return true
}
const undoApp = (s: Build) => {
  commitApp(s)
  const e = undo()
  return e ? restoreApp(s, e) : false
}
const redoApp = (s: Build) => {
  commitApp(s)
  const e = redo()
  return e ? restoreApp(s, e) : false
}
const sortKeys = (v: any): any =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === 'object'
      ? Object.keys(v).sort().reduce((o: Build, k) => ((o[k] = sortKeys(v[k])), o), {})
      : v
/** The build on screen as a restore would leave it, independent of key order. */
const shown = (s: Build) => {
  const raw: Build = {}
  for (const k of BUILD_FIELDS) if (s[k] !== undefined) raw[k] = s[k]
  return JSON.stringify(sortKeys(validBuild(raw)))
}
const SMALL_IMG = 'data:image/png;base64,QUJD'

/** Walks every step back and forward again; each undo must land on a different, earlier build, and redo must
 *  give them all back in order. */
function walk(s: Build, label: string) {
  const forward = [shown(s)]
  while (undoApp(s)) {
    const now = shown(s)
    assert.notEqual(now, forward[forward.length - 1], label + ': undo moved to a different build')
    assert.equal(canRedo(), true, label + ': redo is there after an undo')
    forward.push(now)
    assert.ok(forward.length < 60, label + ': undo ends')
  }
  for (let i = forward.length - 2; i >= 0; i--) {
    assert.equal(redoApp(s), true, label + ': redo step ' + i)
    assert.equal(shown(s), forward[i], label + ': redo gives back the build undo left')
  }
  assert.equal(canRedo(), false, label + ': redo ends at the newest build')
}

test('undo/redo through validBuild: per-key fields set in a non-canonical order (glow, then bgColor)', () => {
  const s = base()
  resetHistory(s)
  s.perKeyOverrides['0-0'] = { glow: true }
  commitApp(s)
  s.perKeyOverrides['0-0'].bgColor = '#ff0000'
  commitApp(s)
  s.perKeyOverrides['0-1'] = { customText: 'A' }
  commitApp(s)
  assert.equal(_debugHistory().entries.length, 4)
  walk(s, 'glow+bgColor')
  assert.equal(_debugHistory().entries.length, 4, 'walking the history adds no step')
})

test('undo/redo through validBuild: an image with a fit (imageData, imageFit)', () => {
  const s = base()
  resetHistory(s)
  change(s, { colorway: 'gemini' })
  s.perKeyOverrides['0-0'] = { imageData: SMALL_IMG, imageFit: 'wrap' }
  commitApp(s)
  change(s, { colorway: 'sakura' }) // so undo has to land on the image step and leave it again
  walk(s, 'imageData+imageFit')
  assert.equal(JSON.stringify(s.perKeyOverrides['0-0']), JSON.stringify({ imageFit: 'wrap', imageData: SMALL_IMG }))
})

test('undo/redo through validBuild: an override left empty after its image is removed', () => {
  const s = base()
  resetHistory(s)
  s.perKeyOverrides['0-0'] = { imageData: SMALL_IMG }
  commitApp(s)
  delete s.perKeyOverrides['0-0'].imageData // leaves {}: the same build as no override
  commitApp(s)
  change(s, { colorway: 'gemini' })
  assert.equal(_debugHistory().entries.length, 4, 'start, image, image removed, colorway')
  commitApp(s)
  assert.equal(_debugHistory().entries.length, 4, 'the {} left behind reads as no override, not a change')
  walk(s, 'empty override')
})

test('undo/redo through validBuild: a legend with a zero-width character', () => {
  const s = base()
  resetHistory(s)
  s.perKeyOverrides['0-0'] = { customText: 'a\u200bb' }
  commitApp(s)
  change(s, { colorway: 'gemini' })
  walk(s, 'zero-width')
  assert.equal(s.perKeyOverrides['0-0'].customText, 'ab')
})

test('undo/redo through validBuild: a font size typed as a string', () => {
  const s = base()
  resetHistory(s)
  s.perKeyOverrides['0-0'] = { fontSize: '20' }
  commitApp(s)
  change(s, { colorway: 'gemini' })
  walk(s, 'fontSize string')
})

test('setOverride/setOverrides never leave an empty override behind', () => {
  liveState.perKeyOverrides = Object.create(null)
  setOverride('0-0', { imageData: SMALL_IMG })
  setOverride('0-0', { imageData: null })
  assert.equal(Object.hasOwn(liveState.perKeyOverrides, '0-0'), false)
  setOverrides(['0-1', '0-2'], { bgColor: '#ff0000' })
  setOverrides(['0-1', '0-2'], { bgColor: null })
  assert.deepEqual(Object.keys(liveState.perKeyOverrides), [])
})

test('randomized: undo then redo returns the same build, and an undo never loses redo (200 runs x 100 ops)', () => {
  let seed = 7
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed % n
  }
  const IMGS = ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB', 'data:image/jpeg;base64,CCCC']
  const COLORWAYS = ['claude', 'gemini', 'sakura']
  const FIELDS: Build[] = [
    { glow: true },
    { glow: false },
    { bgColor: '#ff0000' },
    { bgColor: null },
    { fgColor: '#00ff00' },
    { customText: 'x\u200by\u202e' },
    { fontSize: '20' },
    { labelHidden: true },
    { markId: 'cat' },
    { markId: null },
    { imageData: null },
  ]
  const s = liveState as Build
  for (let run = 0; run < 200; run++) {
    Object.assign(s, base(), { perKeyOverrides: Object.create(null) })
    resetHistory(s)
    for (let step = 0; step < 100; step++) {
      const op = rnd(12)
      const id = '0-' + rnd(4)
      if (op === 0) {
        if (isEmpty()) resetHistory(s)
        Object.assign(s, { colorway: COLORWAYS[rnd(3)] })
        pushState(s)
      } else if (op === 1) {
        Object.assign(s, { layout: rnd(2) ? '60' : '75' })
        pushState(s)
      } else if (op < 5) {
        setOverride(id, FIELDS[rnd(FIELDS.length)])
        commitApp(s)
      } else if (op === 5) {
        setOverride(id, { imageData: IMGS[rnd(3)], imageFit: rnd(2) ? 'wrap' : 'sticker' })
        commitApp(s)
      } else if (op === 6) {
        // an in-place edit the way the old editor could leave one: fields removed one by one, possibly to {}
        const o = s.perKeyOverrides[id]
        if (o) for (const k of Object.keys(o)) if (rnd(2)) delete o[k]
        commitApp(s)
      } else if (op < 10) {
        const before = shown(s)
        const had = canUndo()
        const moved = undoApp(s)
        assert.equal(moved, had, `run ${run} step ${step}: undo moves when it can`)
        if (moved) {
          const after = shown(s)
          assert.notEqual(after, before, `run ${run} step ${step}: undo is not stuck`)
          assert.equal(canRedo(), true, `run ${run} step ${step}: undo keeps redo`)
          if (rnd(2)) {
            assert.equal(redoApp(s), true, `run ${run} step ${step}: redo after undo`)
            assert.equal(shown(s), before, `run ${run} step ${step}: undo then redo is the same build`)
          }
        }
      } else {
        const before = shown(s)
        const had = canRedo()
        const moved = redoApp(s)
        assert.equal(moved, had, `run ${run} step ${step}: redo moves when it can`)
        if (moved) {
          assert.equal(undoApp(s), true, `run ${run} step ${step}: undo after redo`)
          assert.equal(shown(s), before, `run ${run} step ${step}: redo then undo is the same build`)
          assert.equal(redoApp(s), true, `run ${run} step ${step}: redo again`)
        }
      }
    }
  }
})

test('update.js restore syncs the entry to the screen, closes a stale key editor, and bumps the build generation', () => {
  const src = code('embed/miyakeys/js/core/update.js')
  const body = src.slice(src.indexOf('function restore'), src.indexOf('export function undo'))
  assert.match(body, /validBuild\(entry\)[\s\S]*buildGen\+\+[\s\S]*Object\.assign\(state, snap\)[\s\S]*syncCurrent\(state\)/)
  assert.match(body, /restoredHook\(\)/)
  const load = src.slice(src.indexOf('export function loadSnap'), src.indexOf('function ensureHistory'))
  assert.match(load, /buildGen\+\+/)
  const panels = code('embed/miyakeys/js/ui/panels.js')
  assert.match(panels, /onBuildRestored\(\(\) => \{\s*if \(_currentEditId && !keyInLayout\(_currentEditId\)\) hideKeyEditor\(\);/)
  assert.match(panels, /gen: buildGeneration\(\)/)
  assert.match(panels, /target\.gen === buildGeneration\(\)/)
})
