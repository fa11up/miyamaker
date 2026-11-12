// src/pages/MusicMaker: the parts of the sampler engine that run without a browser. Untrusted song and kit
// values are forced finite, the clock survives bad tempos and background tabs, voice and buffer bookkeeping stays
// bounded, the master DSP recovers from NaN, undo only re-renders what changed, and storage failures surface.
// Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BACKUP_KEY,
  audioBank,
  boot,
  emptyPad,
  idbSet,
  addAutoLane,
  clearAutoLane,
  compactPatterns,
  duplicateSongCell,
  loadFactoryKit,
  model as musicModel,
  normalizeEvent,
  normalizePad,
  normalizePatch,
  save,
  setAutoPoint,
  setPatternBpm,
  setPatternLengthAt,
  stepCount,
  touch,
} from '../src/pages/MusicMaker/model.js'
import { armHistory, beginUndo, endUndo, historyDepth, undo } from '../src/pages/MusicMaker/history.js'
import { decodeKitSamples, loadKit } from '../src/pages/MusicMaker/audio/song.js'
import {
  createBufferCache,
  heldForPort,
  liveVoices,
  locateStep,
  scrubPcm,
  stepSeconds,
  stepsBehind,
} from '../src/pages/MusicMaker/audio/voices.js'
import { createKnee } from '../src/pages/MusicMaker/audio/knee.js'
import { createFx, factoryFxSlots, glideSlot, normalizeFxPresets, normalizeSlot, repeatAmount } from '../src/pages/MusicMaker/audio/numpadFx.js'
import { parseXm } from '../src/pages/MusicMaker/audio/module.js'
import { bounceOrder } from '../src/pages/MusicMaker/audio/engine.js'

// The sampler's state is plain JS; the tests poke at it freely, so it is typed loosely here.
const model = musicModel as unknown as { pads: any[]; buses: any[]; [key: string]: any }

const g = globalThis as any

function allFinite(value: unknown, path = 'pad'): void {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} is ${value}`)
    return
  }
  if (Array.isArray(value)) value.forEach((v, i) => allFinite(v, `${path}[${i}]`))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) allFinite(v, `${path}.${k}`)
}

function memoryStorage(fail: (key: string) => boolean = () => false) {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (fail(k)) {
        const err = new Error('full')
        err.name = 'QuotaExceededError'
        throw err
      }
      map.set(k, String(v))
    },
    removeItem: (k: string) => map.delete(k),
  }
}

test('normalizePad forces every number from a hostile file finite and in range', () => {
  const pad = normalizePad({
    name: 42,
    source: 'sample',
    bus: 'x',
    volume: NaN,
    pan: -Infinity,
    pitch: '1e999',
    fine: 'abc',
    choke: -3,
    mode: 'explode',
    trimStart: 'x',
    trimEnd: NaN,
    loopPoint: Infinity,
    filter: { type: 'notch', cutoff: 'x', q: NaN, env: Infinity, a: -1, d: 'x', s: 9, r: null },
    amp: { a: 'x', d: NaN, s: Infinity, r: -5 },
    fx: { drive: 'x', crush: NaN, amp: 3, tone: -1, reverb: Infinity, width: '0.5', chorus: null },
    envelopes: [{ target: 'filter', a: 'x', d: NaN, s: Infinity, r: -1, depth: 'deep' }],
  }, 5)
  allFinite(pad)
  assert.equal(pad.name, 'Empty')
  assert.equal(pad.mode, 'oneshot')
  assert.equal(pad.filter.type, 'lowpass')
  assert.equal(pad.bus, emptyPad(5).bus)
  assert.ok(pad.volume >= 0 && pad.volume <= 1)
  assert.equal(pad.pan, 0)
  assert.equal(pad.fx.amp, 1)
  assert.equal(pad.fx.width, 0.5)
  assert.equal(pad.filter.cutoff, 18000)
  assert.ok(pad.trimStart >= 0 && pad.trimEnd <= 1)
})

test('normalizePad keeps a good pad and a synth pad without a usable patch goes empty', () => {
  const good = { ...emptyPad(1), name: 'Kick', source: 'sample', volume: 0.5, pan: -0.25, pitch: -7, choke: 2 }
  const out = normalizePad(good, 1)
  assert.equal(out.name, 'Kick')
  assert.equal(out.volume, 0.5)
  assert.equal(out.pan, -0.25)
  assert.equal(out.pitch, -7)
  assert.equal(out.choke, 2)
  assert.equal(normalizePad({ source: 'synth', patch: 'nope' }, 0).source, 'empty')
})

test('normalizePatch drops non-finite numbers and wrong types so defaults fill in', () => {
  const p: any = normalizePatch({ freq: NaN, aA: 'x', aD: 0.3, filterType: 7, oscs: [{ type: 'saw', level: NaN, ratio: 2 }], partials: ['x', 0.5] })
  assert.ok(p)
  assert.equal('freq' in p, false)
  assert.equal('aA' in p, false)
  assert.equal(p.aD, 0.3)
  assert.equal('filterType' in p, false)
  // Always the three oscillators the renderer reads: the first from the file (NaN level back to default).
  assert.equal(p.oscs.length, 3)
  assert.deepEqual(p.oscs[0], { type: 'saw', ratio: 2, detune: 0, level: 0.8, duty: 0.5 })
  assert.equal(p.oscs[2].type, 'square')
  assert.deepEqual(p.partials, [0, 0.5])
  assert.equal(normalizePatch(null), null)
})

test('normalizeEvent turns junk pitch, velocity and pad into playable values', () => {
  const ev = normalizeEvent({ pad: 'x', vel: NaN, pitch: 'x', nudge: Infinity })
  assert.deepEqual(ev, { pad: 0, vel: 0.9, pitch: 0, nudge: 0 })
  const big: any = normalizeEvent({ pad: 400, vel: 7, pitch: -500, nudge: -99, sl: 12, len: 4, move: 2 })
  assert.equal(big.pad, 63)
  assert.equal(big.vel, 1)
  assert.equal(big.pitch, -96)
  assert.equal(big.nudge, -50)
  assert.deepEqual([big.sl, big.len, big.move], [12, 4, 2])
})

test('boot clamps a negative or broken saved bpm instead of hanging the scheduler', () => {
  const store = memoryStorage()
  g.localStorage = store
  const pads = Array.from({ length: 64 }, (_, i) => emptyPad(i))
  pads[0] = { ...pads[0], pitch: 'x', volume: NaN } as any
  store.setItem('miya-music-maker-v1', JSON.stringify({ v: 2, pads, bpm: -120, swing: 'x', master: 'loud', pattern: 'x', patterns: [{ i: 'x' }, { i: 3, bars: 'x', steps: [[{ pad: 1, vel: 'x', pitch: 'y' }]] }] }))
  boot()
  assert.ok(model.bpm >= 40 && model.bpm <= 240)
  assert.equal(model.swing, 0)
  assert.equal(model.master, 0.9)
  assert.equal(model.pattern, 0)
  allFinite(model.pads[0])
  const hit = model.patterns[3].steps[0].find(Boolean)
  assert.deepEqual(hit, { pad: 1, vel: 0.9, pitch: 0, nudge: 0 })
  assert.equal(store.map.has(BACKUP_KEY), false)
  delete g.localStorage
})

test('an unreadable or unknown-version save is backed up before the factory kit loads', () => {
  const warn = console.warn
  console.warn = () => {}
  for (const raw of ['{broken json', JSON.stringify({ v: 9, pads: [] })]) {
    const store = memoryStorage()
    g.localStorage = store
    store.setItem('miya-music-maker-v1', raw)
    boot()
    assert.equal(store.map.get(BACKUP_KEY), raw)
    assert.equal(model.pads[0].source, 'synth')
    save()
    assert.equal(store.map.get(BACKUP_KEY), raw, 'the next save leaves the backup alone')
  }
  delete g.localStorage
  console.warn = warn
})

test('save surfaces a quota failure, refuses to erase an old save it could not back up, and clears on success', () => {
  let full = true
  const store = memoryStorage((key) => full && key === 'miya-music-maker-v1')
  g.localStorage = store
  boot()
  save()
  assert.match(model.saveError, /Not saved/)
  full = false
  save()
  assert.equal(model.saveError, '')

  const locked = memoryStorage((key) => key === BACKUP_KEY)
  locked.map.set('miya-music-maker-v1', '{oops')
  g.localStorage = locked
  const warn = console.warn
  console.warn = () => {}
  boot()
  console.warn = warn
  save()
  assert.equal(locked.map.get('miya-music-maker-v1'), '{oops', 'the only copy is kept')
  assert.match(model.saveError, /backed up/)
  delete g.localStorage
  model.saveError = ''
})

test('stepSeconds never returns a negative, zero or NaN step', () => {
  for (const bpm of [-120, 0, NaN, 'x', Infinity, undefined]) {
    const s = stepSeconds(bpm)
    assert.ok(Number.isFinite(s) && s > 0, String(bpm))
  }
  assert.equal(stepSeconds(120), 60 / 120 / 4)
})

test('stepsBehind skips a background-tab backlog but not ordinary jitter', () => {
  const step = 0.125
  assert.equal(stepsBehind(10, 10.05, step), 0)
  assert.equal(stepsBehind(10, 10.1, step), 0)
  assert.equal(stepsBehind(10, 12, step), 16)
  assert.equal(stepsBehind(NaN, 12, step), 0)
})

test('locateStep anchors live hits to the last fired step, so a tempo change does not shift them', () => {
  // Played 64 steps at 120 bpm, then switched to 90. The last fired step is 4 (of 16) at t=20.
  const slow = stepSeconds(90)
  const hit = locateStep(20 + slow * 2, { step: 4, time: 20 }, slow, 16, false)
  assert.deepEqual(hit, { step: 6, nudge: 0 })
  const early = locateStep(20 - slow * 0.3, { step: 0, time: 20 }, slow, 16, true)
  assert.deepEqual(early, { step: 0, nudge: -30 })
  const wrap = locateStep(20 - slow, { step: 0, time: 20 }, slow, 16, false)
  assert.equal(wrap?.step, 15)
  assert.equal(locateStep(1, null, slow, 16, false), null)
})

test('liveVoices drops ended and long-quiet voices and keeps sounding ones', () => {
  const list: any[] = [
    { id: 1, quietAt: null },
    { id: 2, quietAt: 4.9 },
    { id: 3, quietAt: 5.2 },
    { id: 4, quietAt: null, ended: true },
  ]
  assert.deepEqual(liveVoices(list, 5).map((v: any) => v.id), [1, 3])
})

test('the buffer cache builds once per entry and direction, and again for a new rev', () => {
  const cache = createBufferCache()
  let made = 0
  const make = (_c: unknown, entry: any, reverse: boolean) => ({ made: ++made, reverse, rev: entry.rev })
  const ctx = {}
  const entry = { pcm: new Float32Array(10), sr: 44100, rev: 1 }
  const a = cache.get(ctx, entry, false, make)
  assert.equal(cache.get(ctx, entry, false, make), a)
  const b = cache.get(ctx, entry, true, make)
  assert.notEqual(a, b)
  assert.equal(made, 2)
  for (let i = 0; i < 500; i++) cache.get(ctx, entry, i % 2 === 1, make)
  assert.equal(made, 2, 'repeated hits reuse the buffers')
  entry.rev = 2
  cache.get(ctx, entry, false, make)
  assert.equal(made, 3)
  cache.get({}, entry, false, make)
  assert.equal(made, 4, 'a different context gets its own buffer')
})

test('heldForPort finds only that controller’s held notes', () => {
  const ids = ['midi:a:36', 'midi:a:40', 'midi:ab:36', 'key:KeyQ', 'ptr:3']
  assert.deepEqual(heldForPort(ids, 'a'), ['midi:a:36', 'midi:a:40'])
})

test('scrubPcm replaces NaN and Infinity samples with silence', () => {
  const pcm = new Float32Array([0.5, NaN, Infinity, -0.25])
  assert.equal(scrubPcm(pcm), 2)
  assert.deepEqual([...pcm], [0.5, 0, 0, -0.25])
})

function sine(n: number, amp = 0.5) {
  return Float32Array.from({ length: n }, (_, i) => Math.sin(i / 7) * amp)
}

test('knee compressor treats NaN input as silence and does not latch into NaN', () => {
  const knee = createKnee(44100)
  knee.set({ knee: 0.4, police: 0.6, fold: 0.5, pitch: 0.5, policeLfo: { on: true, rate: 2, depth: 0.3 } })
  const n = 256
  const bad = sine(n)
  bad[10] = NaN
  bad[20] = Infinity
  bad[30] = -Infinity
  const outL = new Float32Array(n)
  const outR = new Float32Array(n)
  knee.process(bad, bad, outL, outR)
  assert.ok(outL.every(Number.isFinite) && outR.every(Number.isFinite))
  for (let block = 0; block < 20; block++) knee.process(sine(n), sine(n), outL, outR)
  assert.ok(outL.every(Number.isFinite))
  assert.ok(outL.some((v) => Math.abs(v) > 0.01), 'audio comes back after the bad samples')
})

test('knee set ignores non-finite knob values', () => {
  const knee = createKnee(44100)
  knee.set({ knee: NaN, police: Infinity, fold: 'x', pitch: NaN })
  const outL = new Float32Array(128)
  const outR = new Float32Array(128)
  knee.process(sine(128), sine(128), outL, outR)
  assert.ok(outL.every(Number.isFinite))
})

test('numpad FX survive NaN input and reset clears the beat-repeat buffer', () => {
  const fx = createFx(44100)
  const slot = { type: 'repeat', a: 0x80, b: 0xff }
  const n = 512
  const bad = sine(n)
  bad[5] = NaN
  const outL = new Float32Array(n)
  const outR = new Float32Array(n)
  fx.process(bad, bad, outL, outR, slot, 120)
  assert.ok(outL.every(Number.isFinite))
  const filter = { type: 'filter', a: 0x40, b: 0xc0, div: 3, mix: 0x80 }
  fx.process(bad, bad, outL, outR, filter, NaN)
  assert.ok(outL.every(Number.isFinite))

  for (let i = 0; i < 40; i++) fx.process(sine(n, 0.9), sine(n, 0.9), outL, outR, slot, 120)
  fx.reset()
  const quiet = new Float32Array(n)
  fx.process(quiet, quiet, outL, outR, slot, 120)
  assert.ok(outL.every((v) => v === 0), 'nothing from before the press is replayed')
})

test('numpad FX passes the master through when no key is held', () => {
  const fx = createFx(44100)
  const n = 32
  const input = sine(n, 0.4)
  input[3] = NaN
  const outL = new Float32Array(n)
  const outR = new Float32Array(n)
  fx.process(input, input, outL, outR, null, 120)
  assert.equal(outL[0], input[0])
  assert.equal(outL[3], 0)
  assert.equal(outR[1], input[1])
  fx.process(input, input, outL, outR, undefined, 96)
  assert.equal(outL[0], input[0])
})

function renderFx(fx: ReturnType<typeof createFx>, slot: object, bpm: number, total: number, fill: (at: number) => number, time?: number, origin?: number) {
  const sr = 44100
  const got = new Float32Array(total)
  const block = 256
  for (let at = 0; at < total; at += block) {
    const n = Math.min(block, total - at)
    const input = new Float32Array(n)
    const outL = new Float32Array(n)
    const outR = new Float32Array(n)
    for (let i = 0; i < n; i++) input[i] = fill(at + i)
    fx.process(input, input, outL, outR, slot, bpm, time == null ? undefined : time + at / sr, origin)
    got.set(outL, at)
  }
  return got
}

test('repeat locks to a bpm note and plays that slice again', () => {
  for (let div = 0; div <= 6; div++) assert.equal((repeatAmount(div)! * 7 / 256) | 0, div)
  const saved = normalizeSlot({ type: 'repeat', a: 0xa0, b: 255 }, 0)
  assert.equal(saved.div, 4)
  assert.equal(normalizeSlot({ type: 'grain', div: 2, a: 3, b: 4, mix: 5 }, 1).type, 'grain')
  assert.equal(normalizeSlot({ type: 'slice', div: 9, a: 8, b: 9, mix: 300 }, 2).div, 6)

  const sr = 44100
  const quarter = sr * 60 / 120
  const fx = createFx(sr)
  const quarterHit = renderFx(fx, { type: 'repeat', div: 1, a: 0, b: 255, mix: 255 }, 120, quarter * 2 + 1, (t) => (t === 0 ? 1 : 0))
  assert.equal(quarterHit[0], 1)
  assert.equal(quarterHit[quarter], 1, 'a quarter note at 120 bpm comes back one beat later')
  assert.equal(quarterHit[quarter / 2], 0)
  fx.reset()
  const half = quarter * 2
  const halfHit = renderFx(fx, { type: 'repeat', div: 0, a: 0, b: 255, mix: 255 }, 120, half + 1, (t) => (t === 0 ? 1 : 0))
  assert.equal(halfHit[quarter], 0, 'a half note is not a quarter-note stutter')
  assert.equal(halfHit[half], 1)
  fx.reset()
  const ramp = renderFx(fx, { type: 'repeat', div: 1, a: 0, b: 255, mix: 255 }, 120, quarter * 2, (t) => (t < quarter ? (t % 50) / 50 : 0))
  for (let i = 0; i < quarter; i += 50) assert.equal(ramp[quarter + i], ramp[i])
  fx.reset()
  const dry = renderFx(fx, { type: 'repeat', div: 1, a: 0, b: 0, mix: 255 }, 120, quarter + 2, (t) => (t === 0 ? 1 : 0))
  assert.equal(dry[quarter], 0, 'mix 00 leaves the live output alone')
})

test('slice rearranges notes and grain does not retrigger the beat', () => {
  const sr = 44100
  const slice = Math.round((sr * 60 / 120) * 2 / 64)
  const window = slice * 8
  const fx = createFx(sr)
  const forward = renderFx(fx, { type: 'slice', div: 6, a: 0, b: 0, mix: 255 }, 120, window + slice + 1, (t) => (t === 0 ? 1 : 0))
  assert.equal(forward[window], 1)
  assert.equal(forward[window + slice], 0)
  fx.reset()
  const reverse = renderFx(fx, { type: 'slice', div: 6, a: 1, b: 0, mix: 255 }, 120, window + slice * 7 + 1, (t) => (t === 0 ? 1 : 0))
  assert.equal(reverse[window], 0)
  assert.equal(reverse[window + slice * 7], 1)

  fx.reset()
  const n = 3000
  const grain = renderFx(fx, { type: 'grain', div: 0, a: 0, b: 0, mix: 255 }, 120, n, (t) => Math.sin(t / 9) * 0.5)
  assert.ok(grain.every(Number.isFinite))
  fx.reset()
  const repeat = renderFx(fx, { type: 'repeat', div: 1, a: 0, b: 255, mix: 255 }, 120, n, (t) => Math.sin(t / 9) * 0.5)
  assert.ok(grain.some((v, i) => v !== repeat[i]), 'a grain spray is not a beat repeat')
  fx.reset()
  const waited: any = renderFx(fx, { type: 'repeat', div: 1, a: 0, b: 255, mix: 255 }, 120, 22050 + 3000, (t) => (t === 0 ? 1 : 0), 0.05, 0)
  const peaks = []
  for (let i = 0; i < waited.length; i++) if (waited[i] > 0.5) peaks.push(i)
  assert.deepEqual(peaks, [0], 'a press between beats waits for the next note instead of chopping a grain')
})

test('numpad FX chain follows press order, and move, stretch, and wander change the sound', () => {
  const sr = 44100
  const n = 4096
  const input = sine(n, 0.6)
  function chain(first: object, second: object) {
    const a = createFx(sr)
    const b = createFx(sr)
    const midL = new Float32Array(n)
    const midR = new Float32Array(n)
    const outL = new Float32Array(n)
    a.process(input, input, midL, midR, first, 120)
    b.process(midL, midR, outL, midR, second, 120)
    return outL
  }
  const low = { type: 'filter', a: 8, b: 40, c: 0, div: 2, mix: 255 }
  const chorus = { type: 'chorus', a: 220, b: 90, c: 0, div: 0, mix: 128 }
  const forward = chain(low, chorus)
  const reverse = chain(chorus, low)
  assert.ok(forward.every(Number.isFinite))
  assert.ok(forward.some((v, i) => Math.abs(v - reverse[i]!) > 0.0001), 'chorus into a filter is not the same chain as a filter into chorus')

  const still = renderFx(createFx(sr), { type: 'grain', div: 0, a: 90, b: 40, c: 0, mix: 255 }, 120, n, (t) => Math.sin(t / 9) * 0.5)
  const stretched = renderFx(createFx(sr), { type: 'grain', div: 0, a: 90, b: 40, c: 255, mix: 255 }, 120, n, (t) => Math.sin(t / 9) * 0.5)
  assert.ok(stretched.every(Number.isFinite))
  assert.ok(still.some((v, i) => v !== stretched[i]), 'stretch moves a grain')
  const dry = (t: number) => Math.sin(t / 9) * 0.5
  const wet = stretched.filter((v, i) => Math.abs(v - dry(i)) > 1e-4).length
  assert.ok(wet > n / 2, `stretched grain is heard, not dropped to dry (${wet} of ${n} wet)`)

  const fixed = renderFx(createFx(sr), { type: 'filter', a: 80, b: 40, c: 0, div: 2, mix: 255 }, 120, n, (t) => Math.sin(t / 7) * 0.5)
  const wander = renderFx(createFx(sr), { type: 'filter', a: 80, b: 40, c: 255, div: 2, mix: 255 }, 120, n, (t) => Math.sin(t / 7) * 0.5)
  assert.ok(wander.every(Number.isFinite))
  assert.ok(fixed.some((v, i) => Math.abs(v - wander[i]!) > 1e-5), 'wander steps the resonance')

  const slice = Math.round((sr * 60 / 120) * 2 / 8)
  const window = slice * 8
  const plain = renderFx(createFx(sr), { type: 'slice', div: 3, a: 0, b: 0, c: 0, mix: 255 }, 120, window + slice, (t) => ((t % slice) === 0 ? 1 : 0))
  const moved = renderFx(createFx(sr), { type: 'slice', div: 3, a: 0, b: 0, c: 128, mix: 255 }, 120, window + slice, (t) => ((t % slice) === 0 ? 1 : 0))
  assert.ok(moved.every(Number.isFinite))
  assert.ok(plain.some((v, i) => v !== moved[i]), 'move walks the slice')

  assert.equal(normalizeSlot({ type: 'filter', c: 900 }, 0).c, 255)
  assert.equal(normalizeSlot({ type: 'repeat', a: 10, b: 20 }, 0).c, 0)
  const saved = normalizeFxPresets([{ name: ' Night ', slots: [{ type: 'grain', c: 12 }] }, { name: 'Night', slots: [] }, { name: '', slots: [] }])
  assert.equal(saved.length, 1)
  assert.equal(saved[0]!.name, 'Night')
  assert.equal(saved[0]!.slots[0]!.type, 'grain')
  assert.equal(factoryFxSlots('Slices')[0]!.type, 'slice')
  assert.equal(factoryFxSlots('Retrig')[0]!.type, 'repeat')
})

test('portamento glides knob bytes and leaves menus where they are', () => {
  const carry: Record<string, number> = {}
  let slot = { type: 'filter', a: 10, b: 0, c: 4, div: 2, mix: 80 }
  slot = glideSlot(slot, 1, 0.4, carry)
  assert.equal(slot.a, 10)
  assert.equal(slot.div, 2)
  slot = glideSlot(slot, 1, 0.4, carry)
  assert.equal(slot.a, 11)
  assert.equal(slot.b, 1)
  assert.equal(slot.c, 5)
  assert.equal(slot.mix, 80)
  const slice = { type: 'slice', a: 3, b: 2, c: 10, div: 4, mix: 200 }
  const bent = glideSlot(slice, -1, 3, {})
  assert.equal(bent.a, 3)
  assert.equal(bent.b, 2)
  assert.equal(bent.div, 4)
  assert.equal(bent.c, 7)
  assert.equal(bent.mix, 197)
  const repeat = glideSlot({ type: 'repeat', a: 128, b: 5, c: 0, div: 3, mix: 255 }, 1, 2, {})
  assert.equal(repeat.a, 128)
  assert.equal(repeat.div, 3)
  assert.equal(repeat.b, 7)
  assert.equal(glideSlot({ type: 'grain', a: 254, b: 0, c: 0, div: 1, mix: 1 }, 1, 10, {}).a, 255)
})

test('undo re-renders only synth pads whose patch changed', async () => {
  loadFactoryKit()
  armHistory()
  const before = model.pads.map((_, i) => audioBank.get(i))
  const synthPads = model.pads.map((p, i) => (p.source === 'synth' ? i : -1)).filter((i) => i >= 0)
  assert.ok(synthPads.length > 2)
  const target = synthPads[1]!
  const first = synthPads[0]!
  model.pads[target].patch = { ...model.pads[target].patch, freq: 333 }
  touch(true)
  model.pads[first].volume = 0.3
  touch(true)
  assert.equal(await undo(), true, 'both quick edits are one step')
  assert.notEqual(model.pads[target].patch.freq, 333)
  assert.notEqual(model.pads[first].volume, 0.3)
  const after = model.pads.map((_, i) => audioBank.get(i))
  const redone = after.map((entry, i) => (entry !== before[i] ? i : -1)).filter((i) => i >= 0)
  assert.deepEqual(redone, [target])
})

test('a run of fader moves is one undo step', async () => {
  loadFactoryKit()
  armHistory()
  const start = model.buses[0].volume
  for (let i = 0; i < 25; i++) {
    model.buses[0].volume = i / 25
    touch(true)
  }
  assert.equal(await undo(), true)
  assert.equal(model.buses[0].volume, start)
  assert.equal(await undo(), false)
})

test('a kit with a damaged sample leaves the current kit as it was', async () => {
  loadFactoryKit()
  armHistory()
  const names = model.pads.map((p) => p.name)
  const entries = model.pads.map((_, i) => audioBank.get(i))
  const doc = {
    type: 'k1t',
    name: 'Bad',
    pads: Array.from({ length: 64 }, (_, i) => emptyPad(i)),
    samples: [
      { pad: 0, name: 'ok', sr: 44100, pcm: new Float32Array([0.1, 0.2]) },
      { pad: 1, name: 'bad', sr: 44100, pcm: '###not base64###' },
    ],
  }
  await assert.rejects(loadKit(doc), /damaged/)
  assert.deepEqual(model.pads.map((p) => p.name), names)
  assert.deepEqual(model.pads.map((_, i) => audioBank.get(i)), entries)
  assert.equal(historyDepth(), 0)
})

test('decodeKitSamples scrubs NaN samples and clamps a bogus sample rate', () => {
  const out = decodeKitSamples([{ pad: 2, name: 'n', sr: 'fast', pcm: new Float32Array([NaN, 0.5]) }, { pad: 99, pcm: 'x' }])
  assert.equal(out.size, 1)
  assert.deepEqual([...out.get(2).pcm], [0, 0.5])
  assert.equal(out.get(2).sr, 44100)
  assert.throws(() => decodeKitSamples([{ pad: 0, pcm: 'AAA' }]), /damaged/)
})

/** Just enough IndexedDB to abort a write the way a full disk does. */
function fakeIndexedDb(outcome: 'complete' | 'abort') {
  const state = { opened: 0, closed: 0 }
  const db = {
    objectStoreNames: { contains: () => true },
    close: () => {
      state.closed += 1
    },
    transaction() {
      const tx: any = { error: null }
      const req: any = {}
      tx.objectStore = () => ({
        put: () => req,
        delete: () => req,
        get: () => req,
        getAllKeys: () => req,
      })
      setTimeout(() => {
        if (outcome === 'abort') {
          const err = new Error('quota')
          err.name = 'QuotaExceededError'
          tx.error = err
          tx.onabort?.()
        } else {
          req.result = undefined
          req.onsuccess?.()
          tx.oncomplete?.()
        }
      }, 1)
      return tx
    },
  }
  return {
    state,
    api: {
      open() {
        state.opened += 1
        const req: any = {}
        setTimeout(() => {
          req.result = db
          req.onsuccess?.()
        }, 1)
        return req
      },
    },
  }
}

test('an aborted IndexedDB write rejects, closes the connection, and the caller still ends its undo batch', async () => {
  const fake = fakeIndexedDb('abort')
  g.indexedDB = fake.api
  try {
    beginUndo()
    await assert.rejects(
      (async () => {
        try {
          await idbSet('pad:0', { pcm: new Float32Array(4) })
        } finally {
          endUndo()
        }
      })(),
      /quota/,
    )
    assert.equal(historyDepth(), 0)
    assert.equal(fake.state.closed, fake.state.opened)
    assert.match(model.saveError, /Sample not saved/)

    const ok = fakeIndexedDb('complete')
    g.indexedDB = ok.api
    await idbSet('pad:0', { pcm: new Float32Array(4) })
    assert.equal(ok.state.closed, 1)
    assert.equal(model.saveError, '')
  } finally {
    delete g.indexedDB
  }
})

function xmWithRows(rows: number) {
  const headerSize = 276
  const perRow = 3
  const total = 60 + headerSize + 9 + rows * perRow
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('Extended Module: '), 0)
  bytes.set(new TextEncoder().encode('long'), 17)
  view.setUint32(60, headerSize, true)
  view.setUint16(64, 1, true) // song length
  view.setUint16(68, 1, true) // channels
  view.setUint16(70, 1, true) // patterns
  view.setUint16(72, 0, true) // instruments
  view.setUint16(76, 6, true)
  view.setUint16(78, 125, true)
  const pat = 60 + headerSize
  view.setUint32(pat, 9, true)
  view.setUint16(pat + 5, rows, true)
  view.setUint16(pat + 7, rows * perRow, true)
  for (let r = 0; r < rows; r++) {
    const at = pat + 9 + r * perRow
    bytes[at] = 0x83
    bytes[at + 1] = 49
    bytes[at + 2] = 1
  }
  return bytes.buffer
}

test('an XM pattern longer than 256 rows loads, cut to the 256-step limit', () => {
  const parsed: any = parseXm(xmWithRows(300))
  assert.equal(parsed.patterns.length, 1)
  assert.equal(parsed.patterns[0].steps.length, 256)
  assert.ok(parsed.patterns[0].steps[255][0])
})

test('a duplicated section copies into a free slot and keeps tempo and automation', () => {
  loadFactoryKit()
  model.songOrder = [0]
  setPatternBpm(0, 140)
  addAutoLane(0, 'master')
  setAutoPoint(0, 'master', 0, 0.5)
  setPatternLengthAt(3, 32)
  assert.equal(stepCount(model.patterns[0]), 16)
  assert.equal(stepCount(model.patterns[3]), 32)
  duplicateSongCell(0)
  assert.deepEqual(model.songOrder, [0, 1])
  assert.equal(model.patterns[1].bpm, 140)
  assert.equal(model.patterns[1].auto[0].points[0].v, 0.5)
  assert.notEqual(model.patterns[1].steps, model.patterns[0].steps)
  clearAutoLane(1, 'master')
  assert.equal(model.patterns[1].auto, undefined)
  const packed = compactPatterns().find((row) => row.i === 0) as { bpm?: number; auto: { id: string }[] } | undefined
  assert.equal(packed?.bpm, 140)
  assert.equal(packed?.auto[0]?.id, 'master')
  for (let i = 1; i < 256; i++) model.patterns[i] = { name: 'x', bars: 1, len: 16, steps: [] }
  model.songOrder = [0]
  duplicateSongCell(0)
  assert.deepEqual(model.songOrder, [0, 0])
})

test('the WAV bounce follows the song order when the song is playing', () => {
  loadFactoryKit()
  model.pattern = 5
  model.songOrder = [2, 3, 2]
  model.songPlay = true
  assert.deepEqual(bounceOrder(), [2, 3, 2])
  model.songPlay = false
  assert.deepEqual(bounceOrder(), [5])
  model.songOrder = null
})
