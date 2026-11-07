import { formatLp, formatSl } from './audio/grain.js'
import { PAD_KEYS } from './keys.js'
import { FACTORY, KIT_LAYOUT } from './audio/presets.js'
import { defaultNumpadFx, normalizeNumpadFx } from './audio/numpadFx.js'
import { snapOctave } from './audio/knee.js'
import { defaultPatch, renderSynth, SYNTH_SR } from './audio/synth.js'

export const BANKS = ['A', 'B', 'C', 'D']
export const BUS_COUNT = 16
export const FX_TYPES = ['none', 'filter', 'drive', 'delay', 'reverb', 'chorus', 'crush', 'comp']
export const LANES = 16
export const TRACK_FIELDS = 4
export const TRACK_VEL = 128 / 255

/** NOTE INST VEL MOVE, plus SL and LP when the grain columns are open. */
export function trackerFields() {
  return TRACK_FIELDS + (model.tracker.grains ? 2 : 0)
}

export { formatLp, formatSl }

const SAVE_KEY = 'miya-music-maker-v1'
export const BACKUP_KEY = 'miya-music-maker-v1-backup'

export const audioBank = new Map()

let version = 0
const listeners = new Set()
let saveTimer = 0

export const model = {
  screen: 'pads',
  bank: 0,
  selected: 0,
  selection: [],
  hold: null,
  keyboard: false,
  keyMap: 'koala',
  octave: 4,
  renoiseOct: 3,
  playing: false,
  recording: false,
  metro: false,
  metroVol: 0.55,
  bpm: 96,
  swing: 0,
  pattern: 0,
  patterns: [],
  recNatural: false,
  seqHit: null,
  playhead: 0,
  pads: [],
  buses: [],
  master: 0.9,
  settings: { autoTrim: true, autoNorm: true, midiOffset: 36, velocity: true },
  browser: false,
  help: false,
  about: false,
  tracker: { row: 0, col: 0, focus: false, hex: '', sign: 1, edit: false, step: 1, follow: true, grains: false },
  library: null,
  wallet: '',
  fileWindow: '',
  keysHelp: false,
  dirTick: 0,
  sessionFiles: [],
  nftPacks: [],
  nftLocked: [],
  numpadFx: defaultNumpadFx(),
  fxHeld: -1,
  fxEdit: 0,
  browserNote: '',
  waveView: 2,
  mixPage: 0,
  compFocus: false,
  comp: defaultComp(),
  songOrder: null,
  songCursor: 0,
  songName: '',
  songFile: '',
  songPlay: false,
  sliceView: null,
  k3: false,
  saveError: '',
}

/** Set or clear the "not saved" line. Only redraws when it changes. */
export function setSaveError(message) {
  const next = message || ''
  if (model.saveError === next) return
  model.saveError = next
  touch(false)
}

let keepBackup = false

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let persistHook = null

export function setPersistHook(fn) {
  persistHook = fn
}

export function touch(persist = false) {
  version += 1
  listeners.forEach((fn) => fn(version))
  if (persist) {
    persistHook?.()
    scheduleSave()
  }
}

export function getVersion() {
  return version
}

function emptyFx() {
  return Array.from({ length: 5 }, () => ({ type: 'none', amount: 0.45 }))
}

const ENV_TARGETS = ['off', 'filter', 'reverb', 'width', 'chorus', 'amp']

export function defaultEnvelopes(filter) {
  const src = filter || {}
  return [
    { target: 'filter', a: src.a ?? 0.004, d: src.d ?? 0.12, s: src.s ?? 0.35, r: src.r ?? 0.08, depth: src.env ?? 0 },
    { target: 'off', a: 0.01, d: 0.18, s: 0.4, r: 0.2, depth: 1 },
    { target: 'off', a: 0.02, d: 0.24, s: 0, r: 0.3, depth: 1 },
  ]
}

export function normalizeEnvelopes(raw, filter) {
  const defaults = defaultEnvelopes(filter)
  const list = Array.isArray(raw) ? raw : []
  return defaults.map((fallback, index) => {
    const src = list[index] || {}
    const target = ENV_TARGETS.includes(src.target) ? src.target : fallback.target
    const depthMin = target === 'filter' ? -36 : 0
    const depthMax = target === 'filter' ? 60 : 1
    return {
      target,
      a: num(src.a, num(fallback.a, 0.004, 0.001, 1), 0.001, 1),
      d: num(src.d, num(fallback.d, 0.12, 0.001, 2), 0.001, 2),
      s: num(src.s, num(fallback.s, 0, 0, 1), 0, 1),
      r: num(src.r, num(fallback.r, 0.08, 0.005, 2), 0.005, 2),
      depth: num(src.depth, num(fallback.depth, 0, depthMin, depthMax), depthMin, depthMax),
    }
  })
}

function emptyPadFx() {
  return { drive: 0, crush: 0, amp: 0, tone: 0.65, reverb: 0, width: 0, chorus: 0 }
}

export function emptyPad(i = 0) {
  const filter = { type: 'lowpass', cutoff: 18000, q: 0.7, env: 0, a: 0.004, d: 0.12, s: 0.35, r: 0.08 }
  return {
    name: 'Empty',
    source: 'empty',
    patch: null,
    bus: i % 4,
    volume: 0.85,
    pan: 0,
    pitch: 0,
    fine: 0,
    choke: 0,
    mode: 'oneshot',
    mute: false,
    solo: false,
    trimStart: 0,
    trimEnd: 1,
    loopPoint: 0.5,
    reverse: false,
    filter,
    amp: { a: 0.001, d: 0.001, s: 1, r: 0.015 },
    fx: emptyPadFx(),
    envelopes: defaultEnvelopes(filter),
    sampleName: '',
  }
}

/** A finite number from a saved or imported value, clamped, or the fallback. */
export function num(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  const v = Number.isFinite(n) ? n : fallback
  return Math.max(min, Math.min(max, v))
}

function int(value, fallback, min, max) {
  return Math.round(num(value, fallback, min, max))
}

function text(value, fallback, max = 80) {
  return typeof value === 'string' ? value.slice(0, max) : fallback
}

/** Synth patch from a file: numbers stay only when finite, other fields only when their type matches. */
export function normalizePatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const defaults = defaultPatch()
  const out = {}
  for (const key of Object.keys(raw)) {
    const value = raw[key]
    const want = defaults[key]
    if (key === 'oscs') {
      if (!Array.isArray(value)) continue
      out.oscs = value.slice(0, 8).filter((o) => o && typeof o === 'object').map((o) => {
        const osc = {}
        for (const k of Object.keys(o)) {
          if (typeof o[k] === 'number' ? Number.isFinite(o[k]) : typeof o[k] === 'string' || typeof o[k] === 'boolean') osc[k] = o[k]
        }
        return osc
      })
      continue
    }
    if (key === 'partials') {
      if (Array.isArray(value)) out.partials = value.slice(0, 32).map((v) => num(v, 0, -4, 4))
      continue
    }
    if (typeof want === 'number' || (want === undefined && typeof value === 'number')) {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = Math.max(-1e6, Math.min(1e6, value))
      continue
    }
    if (typeof want === 'string' || (want === undefined && typeof value === 'string')) {
      if (typeof value === 'string') out[key] = value.slice(0, 40)
      continue
    }
    if (typeof value === 'boolean') out[key] = value
  }
  return out
}

const PAD_SOURCES = ['empty', 'synth', 'sample']

/** Fill FX and envelopes on a pad from an older save. Every number is forced finite and in range. */
export function normalizePad(raw, index = 0) {
  const base = emptyPad(index)
  if (!raw || typeof raw !== 'object') return base
  const rf = raw.filter && typeof raw.filter === 'object' ? raw.filter : {}
  const filter = {
    type: ['lowpass', 'highpass', 'bandpass'].includes(rf.type) ? rf.type : 'lowpass',
    cutoff: num(rf.cutoff, base.filter.cutoff, 40, 18000),
    q: num(rf.q, base.filter.q, 0.1, 18),
    env: num(rf.env, base.filter.env, -36, 60),
    a: num(rf.a, base.filter.a, 0.001, 1),
    d: num(rf.d, base.filter.d, 0.001, 2),
    s: num(rf.s, base.filter.s, 0, 1),
    r: num(rf.r, base.filter.r, 0.005, 2),
  }
  const ra = raw.amp && typeof raw.amp === 'object' ? raw.amp : {}
  const rx = raw.fx && typeof raw.fx === 'object' ? raw.fx : {}
  const fx = emptyPadFx()
  for (const key of Object.keys(fx)) fx[key] = num(rx[key], fx[key], 0, 1)
  const trimStart = num(raw.trimStart, 0, 0, 0.98)
  const trimEnd = num(raw.trimEnd, 1, 0, 1)
  const pad = {
    ...base,
    name: text(raw.name, base.name),
    source: PAD_SOURCES.includes(raw.source) ? raw.source : 'empty',
    bus: int(raw.bus, base.bus, 0, BUS_COUNT - 1),
    volume: num(raw.volume, base.volume, 0, 1),
    pan: num(raw.pan, 0, -1, 1),
    pitch: num(raw.pitch, 0, -48, 48),
    fine: num(raw.fine, 0, -100, 100),
    choke: int(raw.choke, 0, 0, 16),
    mode: ['oneshot', 'gate', 'loop'].includes(raw.mode) ? raw.mode : 'oneshot',
    mute: !!raw.mute,
    solo: !!raw.solo,
    trimStart,
    trimEnd,
    loopPoint: num(raw.loopPoint, (trimStart + trimEnd) / 2, 0, 1),
    reverse: !!raw.reverse,
    filter,
    amp: {
      a: num(ra.a, base.amp.a, 0.001, 10),
      d: num(ra.d, base.amp.d, 0.001, 10),
      s: num(ra.s, base.amp.s, 0, 1),
      r: num(ra.r, base.amp.r, 0.005, 10),
    },
    fx,
    envelopes: normalizeEnvelopes(raw.envelopes, filter),
    sampleName: text(raw.sampleName, ''),
    patch: normalizePatch(raw.patch),
  }
  if (pad.source === 'synth' && !pad.patch) pad.source = 'empty'
  return pad
}

function emptyLanes() {
  return Array.from({ length: LANES }, () => null)
}

export function normalizeEvent(ev) {
  const out = {
    pad: int(ev?.pad, 0, 0, 63),
    vel: num(ev?.vel, 0.9, 0, 1),
    pitch: num(ev?.pitch, 0, -96, 96),
    nudge: int(ev?.nudge, 0, -50, 50),
  }
  if (ev?.off) out.off = true
  else {
    if (Number.isFinite(ev?.sl)) out.sl = Math.max(0, Math.min(65535, ev.sl | 0))
    if (Number.isFinite(ev?.len) && Number.isFinite(ev?.move)) {
      out.len = Math.max(0, Math.min(65535, ev.len | 0))
      out.move = Math.max(-32768, Math.min(32767, ev.move | 0))
    }
  }
  return out
}

/** Fixed 16 lanes. A packed list from an older save is placed in lane order. */
function toLanes(cell) {
  const lanes = emptyLanes()
  if (!Array.isArray(cell)) return lanes
  const laneShaped = cell.length === LANES && cell.every((e) => e == null || (typeof e === 'object' && typeof e.pad === 'number'))
  if (laneShaped) {
    for (let i = 0; i < LANES; i++) lanes[i] = cell[i] ? normalizeEvent(cell[i]) : null
    return lanes
  }
  let n = 0
  for (const ev of cell) {
    if (!ev || typeof ev !== 'object' || typeof ev.pad !== 'number' || n >= LANES) continue
    lanes[n++] = normalizeEvent(ev)
  }
  return lanes
}

function emptyPattern() {
  return { name: '', bars: 1, steps: Array.from({ length: 16 }, emptyLanes) }
}

function clampUnit(v, a, b) {
  return Math.max(a, Math.min(b, v))
}

export function busLabel(index) {
  return String((index | 0) + 1).padStart(2, '0')
}

function defaultLfo() {
  return { on: false, rate: 1, depth: 0.5 }
}

function normalizeLfo(raw) {
  const d = defaultLfo()
  if (!raw || typeof raw !== 'object') return d
  return {
    on: !!raw.on,
    rate: clampUnit(Number(raw.rate ?? d.rate), 0.05, 12),
    depth: clampUnit(Number(raw.depth ?? d.depth), 0, 1),
  }
}

export function defaultComp() {
  return {
    threshold: -18,
    ratio: 4,
    knee: 10,
    attack: 0.003,
    release: 0.25,
    makeup: 1,
    justice: false,
    kKnee: 0.2,
    kPolice: 0,
    kFold: 0,
    kPitch: 0,
    kSnap: true,
    lfo: { kPolice: defaultLfo(), kFold: defaultLfo() },
  }
}

export function normalizeComp(raw) {
  const d = defaultComp()
  if (!raw || typeof raw !== 'object') return d
  return {
    threshold: clampUnit(raw.threshold ?? d.threshold, -60, 0),
    ratio: clampUnit(raw.ratio ?? d.ratio, 1, 20),
    knee: clampUnit(raw.knee ?? d.knee, 0, 40),
    attack: clampUnit(raw.attack ?? d.attack, 0.001, 0.5),
    release: clampUnit(raw.release ?? d.release, 0.01, 1.2),
    makeup: clampUnit(raw.makeup ?? d.makeup, 0.25, 4),
    justice: !!raw.justice,
    kKnee: clampUnit(raw.kKnee ?? d.kKnee, 0, 1),
    kPolice: clampUnit(raw.kPolice ?? d.kPolice, 0, 1),
    kFold: clampUnit(raw.kFold ?? d.kFold, 0, 1),
    kPitch: snapOctave(raw.kPitch ?? 0, false),
    kSnap: raw.kSnap !== false,
    lfo: {
      kPolice: normalizeLfo(raw.lfo?.kPolice),
      kFold: normalizeLfo(raw.lfo?.kFold),
    },
  }
}

function normalizeBus(raw, index) {
  const bus = {
    name: typeof raw?.name === 'string' && raw.name ? raw.name : busLabel(index),
    volume: clampUnit(raw?.volume ?? 0.82, 0, 1),
    pan: clampUnit(raw?.pan ?? 0, -1, 1),
    mute: !!raw?.mute,
    solo: !!raw?.solo,
    fx: emptyFx(),
  }
  if (Array.isArray(raw?.fx)) {
    for (let i = 0; i < 5; i++) {
      const slot = raw.fx[i]
      if (!slot) continue
      bus.fx[i] = {
        type: FX_TYPES.includes(slot.type) ? slot.type : 'none',
        amount: clampUnit(slot.amount ?? 0.45, 0, 1),
      }
    }
  }
  return bus
}

export function normalizeBuses(saved) {
  return Array.from({ length: BUS_COUNT }, (_, i) => normalizeBus(Array.isArray(saved) ? saved[i] : null, i))
}

function freshBuses() {
  return normalizeBuses(null)
}

/** Keep the loop point inside the trimmed region. */
export function fitLoop(pad) {
  const start = clampUnit(pad.trimStart || 0, 0, 0.98)
  const end = clampUnit(pad.trimEnd ?? 1, start + 0.01, 1)
  pad.trimStart = start
  pad.trimEnd = end
  const loop = typeof pad.loopPoint === 'number' ? pad.loopPoint : (start + end) / 2
  pad.loopPoint = clampUnit(loop, start, Math.max(start, end - 0.005))
}

export function applyTrim(pad, which, value) {
  if (which === 'start') pad.trimStart = value
  else if (which === 'end') pad.trimEnd = value
  else pad.loopPoint = value
  fitLoop(pad)
}

export function currentPads() {
  const start = model.bank * 16
  return model.pads.slice(start, start + 16)
}

export function selectedPad() {
  return model.pads[model.selected]
}

export function selectionIds() {
  return model.selection.length ? model.selection.slice() : [model.selected]
}

export function ensurePattern(index) {
  const i = ((index % 256) + 256) % 256
  if (!model.patterns[i]) model.patterns[i] = emptyPattern()
  ensureStepLength(model.patterns[i])
  return model.patterns[i]
}

export function currentPattern() {
  return ensurePattern(model.pattern || 0)
}

export function currentSequence() {
  return currentPattern()
}

export function stepCount(seq = currentPattern()) {
  if (!seq) return 16
  if (Number.isFinite(seq.len)) return Math.max(1, Math.min(256, seq.len | 0))
  return int(seq.bars, 1, 1, 16) * 16
}

function ensureStepLength(seq) {
  const fromBars = int(seq.bars, 1, 1, 16) * 16
  const n = Math.max(1, Math.min(256, Number.isFinite(seq.len) ? seq.len | 0 : fromBars))
  seq.len = n
  seq.bars = Math.max(1, Math.min(16, Math.ceil(n / 16)))
  if (!Array.isArray(seq.steps)) seq.steps = []
  for (let i = 0; i < n; i++) seq.steps[i] = toLanes(seq.steps[i])
  if (seq.steps.length > n) seq.steps.length = n
}

export function setPattern(index) {
  model.pattern = ((index % 256) + 256) % 256
  model.songPlay = false
  model.seqHit = null
  const seq = ensurePattern(model.pattern)
  if (model.tracker.row >= stepCount(seq)) model.tracker.row = 0
  touch(true)
}

/** Koala slots are groups of 8 across the 00–FF pattern list. */
export function setSeqSlot(slot) {
  const bank = Math.floor(model.pattern / 8)
  setPattern(bank * 8 + (((slot % 8) + 8) % 8))
}

export function setSeqBank(bank) {
  const slot = model.pattern % 8
  const b = ((bank % 32) + 32) % 32
  setPattern(b * 8 + slot)
}

export function formatNudge(n) {
  const v = Math.max(-50, Math.min(50, Math.round(n || 0)))
  return `${v < 0 ? '-' : '+'}${String(Math.abs(v)).padStart(2, '0')}`
}

export function setPatternLength(steps) {
  const seq = currentSequence()
  const n = Math.max(1, Math.min(256, steps | 0))
  if (stepCount(seq) === n) return
  seq.len = n
  ensureStepLength(seq)
  if (model.tracker.row >= seq.len) model.tracker.row = 0
  touch(true)
}

export function setBars(bars) {
  setPatternLength(Math.max(1, Math.min(16, bars | 0)) * 16)
}

export function addBar() {
  setPatternLength(Math.min(256, stepCount() + 16))
}

export function removeBar() {
  const n = stepCount()
  if (n <= 16) return
  setPatternLength(Math.max(16, n - 16))
}

export function doubleUp() {
  const seq = currentPattern()
  const n = stepCount(seq)
  if (n >= 256) return
  const copy = seq.steps.map((s) => s.map((e) => (e ? { ...e } : null)))
  const next = Math.min(256, n * 2)
  seq.len = next
  seq.steps = seq.steps.concat(copy).slice(0, next)
  ensureStepLength(seq)
  touch(true)
}

export function findHit(step, padIndex) {
  const cell = currentPattern().steps[step]
  if (!cell) return -1
  return cell.findIndex((e) => e && e.pad === padIndex)
}

export function setHit(step, padIndex, patch = {}) {
  const cell = currentPattern().steps[step]
  if (!cell) return null
  let lane = cell.findIndex((e) => e && e.pad === padIndex)
  if (lane < 0) {
    lane = cell.findIndex((e) => !e)
    if (lane < 0) return null
    cell[lane] = { pad: padIndex, vel: 0.9, pitch: 0, nudge: 0 }
  }
  const ev = cell[lane]
  if (patch.vel != null) ev.vel = Math.max(0, Math.min(1, patch.vel))
  if (patch.pitch != null) ev.pitch = patch.pitch
  if (patch.nudge != null) ev.nudge = Math.max(-50, Math.min(50, Math.round(patch.nudge)))
  if (patch.pad != null) ev.pad = patch.pad
  touch(true)
  return ev
}

export function clearHit(step, padIndex) {
  const cell = currentPattern().steps[step]
  const lane = findHit(step, padIndex)
  if (lane >= 0) cell[lane] = null
  touch(true)
}

export function writeLane(step, lane, ev) {
  const cell = currentPattern().steps[step]
  if (!cell || lane < 0 || lane >= LANES) return
  cell[lane] = ev ? normalizeEvent(ev) : null
  touch(true)
}

export function toggleStep(padIndex, step) {
  if (findHit(step, padIndex) >= 0) clearHit(step, padIndex)
  else setHit(step, padIndex, { vel: 0.9, nudge: 0 })
}

export function writeEvent(padIndex, step, vel = 0.9, pitch = 0, nudge = 0) {
  setHit(step, padIndex, { vel, pitch, nudge })
}

let undoApi = null
let undoOpen = false
let undoTimer = 0
let chord = null

export function setUndoBatch(api) {
  undoApi = api
}

function editStep() {
  const n = model.tracker.step
  return Number.isFinite(n) ? Math.max(0, Math.min(16, n | 0)) : 1
}

function armedLane() {
  return Math.max(0, Math.min(LANES - 1, Math.floor((model.tracker.col || 0) / trackerFields())))
}

/** One undo step for a chord or a short run of tracker edits. */
function batch(fn) {
  const opened = !undoOpen
  if (opened && undoApi) {
    undoApi.begin()
    undoOpen = true
  }
  try {
    fn()
  } finally {
    if (!undoApi) return
    clearTimeout(undoTimer)
    undoTimer = setTimeout(() => {
      if (!undoOpen) return
      undoOpen = false
      undoApi.end()
    }, 48)
  }
}

function stepCursor(fromRow) {
  const step = editStep()
  const rows = stepCount()
  if (!step || !rows) return
  model.tracker.row = (fromRow + step) % rows
}

/**
 * Write one tracker cell.
 * A performance hit spills across the row for 40ms, then the cursor steps once.
 * Live record (playing and Follow) uses the playhead row and spills for the rest of that step.
 * Typed instrument entry stays on the armed track and steps immediately.
 */
export function commitTrackerNote({ pad = 0, vel = TRACK_VEL, pitch = 0, off = false, row = null, nudge = 0, live = false, typed = false }) {
  const rows = stepCount()
  if (!rows) return
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  let writeRow = row == null ? (model.tracker.row | 0) : row
  writeRow = ((writeRow % rows) + rows) % rows
  let lane = armedLane()
  let advance = !live
  if (!typed && live) {
    const stepMs = 60000 / Math.max(1, model.bpm || 96) / 4
    const sameVisit = !!(chord?.live && chord.row === writeRow && now - chord.at < stepMs)
    if (sameVisit) lane = Math.min(LANES - 1, chord.next)
    chord = { live: true, row: writeRow, next: Math.min(LANES, lane + 1), at: sameVisit ? chord.at : now }
  } else if (!typed && chord && !chord.live && now - chord.at < 40) {
    writeRow = chord.row
    lane = Math.min(LANES - 1, chord.next)
    chord = { live: false, row: writeRow, next: Math.min(LANES, lane + 1), at: now }
    advance = false
  } else if (!typed) {
    chord = { live: false, row: writeRow, next: Math.min(LANES, lane + 1), at: now }
  } else {
    chord = null
  }
  const ev = off
    ? { pad: pad | 0, vel: 0, pitch: 0, nudge: 0, off: true }
    : {
      pad: Math.max(0, Math.min(63, pad | 0)),
      vel: Math.max(0, Math.min(1, vel)),
      pitch: pitch || 0,
      nudge: Math.max(-50, Math.min(50, Math.round(nudge || 0))),
    }
  const prev = currentPattern().steps[writeRow]?.[lane]
  if (!off && prev && !prev.off) {
    if (prev.sl != null) ev.sl = prev.sl
    if (prev.len != null && prev.move != null) {
      ev.len = prev.len
      ev.move = prev.move
    }
  }
  batch(() => {
    if (live) model.tracker.row = writeRow
    else if (advance) stepCursor(writeRow)
    model.tracker.hex = ''
    model.tracker.focus = true
    writeLane(writeRow, lane, ev)
  })
}

export function patchTrackerEvent(row, lane, patch) {
  batch(() => {
    const cell = currentPattern().steps[row]
    const ev = cell?.[lane]
    if (!ev) return
    if (patch.vel != null) ev.vel = Math.max(0, Math.min(1, patch.vel))
    if (patch.nudge != null) ev.nudge = Math.max(-50, Math.min(50, Math.round(patch.nudge)))
    if (patch.sl != null) ev.sl = Math.max(0, Math.min(65535, patch.sl | 0))
    if (patch.len != null && patch.move != null) {
      ev.len = Math.max(0, Math.min(65535, patch.len | 0))
      ev.move = Math.max(-32768, Math.min(32767, patch.move | 0))
    }
    model.tracker.hex = ''
    stepCursor(row)
    touch(true)
  })
}

/** Blank one grain column. The note stays, and hiding the column does not drop it. */
export function clearTrackerGrain(row, lane, field) {
  batch(() => {
    const ev = currentPattern().steps[row]?.[lane]
    if (!ev) return
    if (field === 4) delete ev.sl
    else {
      delete ev.move
      delete ev.len
    }
    model.tracker.hex = ''
    touch(true)
  })
}

/** Show or hide SL and LP. The cursor stays on the same lane. Values stay on the events. */
export function setGrainCols(on) {
  const was = trackerFields()
  const col = model.tracker.col | 0
  const lane = Math.floor(col / was)
  const field = col % was
  model.tracker.grains = !!on
  const next = trackerFields()
  model.tracker.col = lane * next + Math.min(field, next - 1)
  model.tracker.hex = ''
  touch(true)
}

export function clearTrackerLane(row, lane) {
  batch(() => {
    writeLane(row, lane, null)
    model.tracker.hex = ''
  })
}

function storePcm(index, pcm, sr = SYNTH_SR) {
  audioBank.set(index, { pcm, sr, rev: (audioBank.get(index)?.rev || 0) + 1 })
}

export function renderPad(index) {
  const pad = model.pads[index]
  if (!pad || pad.source !== 'synth' || !pad.patch) return
  const rendered = renderSynth(pad.patch)
  storePcm(index, rendered.pcm, rendered.sampleRate)
}

export function loadFactoryKit() {
  model.pads = Array.from({ length: 64 }, (_, i) => emptyPad(i))
  audioBank.clear()
  KIT_LAYOUT.forEach((slot, i) => {
    const factory = FACTORY[slot.preset]
    const pad = model.pads[i]
    pad.name = factory.name
    pad.source = 'synth'
    pad.patch = factory.patch
    pad.bus = slot.bus
    pad.choke = slot.choke
    renderPad(i)
  })
  model.patterns = Array.from({ length: 256 }, () => null)
  model.pattern = 0
  model.recNatural = false
  model.seqHit = null
  const demo = ensurePattern(0)
  demo.name = 'Demo'
  const hit = (step, pad, vel = 0.9) => {
    const lane = demo.steps[step].findIndex((e) => !e)
    if (lane >= 0) demo.steps[step][lane] = { pad, vel, pitch: 0, nudge: 0 }
  }
  hit(0, 0, 1)
  hit(2, 3, 0.45)
  hit(4, 3, 0.7)
  hit(6, 3, 0.4)
  hit(8, 1, 0.95)
  hit(8, 3, 0.55)
  hit(10, 3, 0.5)
  hit(12, 0, 0.85)
  hit(12, 3, 0.6)
  hit(14, 3, 0.48)
  hit(14, 6, 0.7)
  model.buses = freshBuses()
  model.buses[1].fx[0] = { type: 'filter', amount: 0.72 }
  model.buses[3].fx[0] = { type: 'reverb', amount: 0.28 }
  model.buses[3].fx[1] = { type: 'delay', amount: 0.22 }
  model.bank = 0
  model.selected = 0
  model.selection = []
  model.songOrder = null
  model.songPlay = false
  model.songName = ''
  model.songFile = ''
  model.songCursor = 0
  model.sliceView = null
}

export function applyToSelection(mutator) {
  selectionIds().forEach((id) => mutator(model.pads[id], id))
  touch(true)
}

export function selectPad(index, mode) {
  if (mode === 'edit') {
    const set = new Set(model.selection.length ? model.selection : [model.selected])
    if (set.has(index)) set.delete(index)
    else set.add(index)
    model.selection = [...set]
    model.selected = index
  } else if (mode === 'solo') {
    const turningOn = !model.pads[index].solo
    model.pads.forEach((p, i) => {
      p.solo = turningOn && i === index
    })
    model.selected = index
  } else if (mode === 'mute') {
    model.pads[index].mute = !model.pads[index].mute
    model.selected = index
  } else {
    model.selected = index
    model.selection = []
  }
  touch(true)
}

export function deleteSelection() {
  const ids = selectionIds()
  Promise.all(ids.map(async (id) => {
    const prev = await idbGet(`pad:${id}`)
    const { stashUndo } = await import('./history.js')
    stashUndo(`pad:${id}`, prev || null)
    const bus = model.pads[id].bus
    model.pads[id] = emptyPad(id)
    model.pads[id].bus = bus
    audioBank.delete(id)
    await idbDelete(`pad:${id}`)
  })).catch((err) => {
    console.warn('delete did not reach storage', err)
  }).finally(() => touch(true))
}

export function setScreen(id) {
  model.screen = id
  if (id === 'track') {
    model.tracker.focus = true
    model.tracker.edit = true
  } else {
    model.tracker.focus = false
  }
  touch(false)
}

export function cycleScreen(dir) {
  const order = ['pads', 'edit', 'seq', 'mix', 'track', 'synth', 'fx']
  let i = order.indexOf(model.screen)
  i = (i + dir + order.length) % order.length
  setScreen(order[i])
}

export function setBank(bank) {
  model.bank = (bank + 4) % 4
  const local = model.selected % 16
  model.selected = model.bank * 16 + local
  touch(false)
}



function scheduleSave() {
  if (typeof window === 'undefined') return
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(save, 350)
}

/** Write a pending save now (page hidden, window closed). */
export function flushSave() {
  if (!saveTimer) return
  if (typeof window !== 'undefined') window.clearTimeout(saveTimer)
  saveTimer = 0
  save()
}

export function save() {
  saveTimer = 0
  if (typeof localStorage === 'undefined') return
  if (keepBackup) {
    // The old save could not be backed up. Writing now would erase the only copy.
    setSaveError('Not saved: an older save could not be read or backed up')
    return
  }
  const data = {
    v: 2,
    screen: model.screen,
    bank: model.bank,
    selected: model.selected,
    bpm: model.bpm,
    swing: model.swing,
    metroVol: model.metroVol,
    master: model.master,
    pattern: model.pattern,
    recNatural: !!model.recNatural,
    editStep: editStep(),
    grainCols: !!model.tracker.grains,
    settings: model.settings,
    octave: model.octave,
    keyMap: model.keyMap === 'renoise' ? 'renoise' : 'koala',
    renoiseOct: model.renoiseOct,
    pads: model.pads,
    patterns: compactPatterns(),
    buses: model.buses,
    library: model.library,
    wallet: model.wallet || '',
    numpadFx: model.numpadFx,
    waveView: model.waveView === 0 || model.waveView === 1 || model.waveView === 2 ? model.waveView : 2,
    waveDefault: 2,
    mixPage: model.mixPage === 1 ? 1 : 0,
    comp: normalizeComp(model.comp),
    songOrder: Array.isArray(model.songOrder) ? model.songOrder.slice(0, 256) : null,
    songName: model.songName || '',
    songFile: model.songFile || '',
    songPlay: !!model.songPlay,
  }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
    if (model.saveError && !model.saveError.startsWith('Sample')) setSaveError('')
  } catch (err) {
    // Quota or a blocked store: the session still has everything, but say so.
    setSaveError(err?.name === 'QuotaExceededError' ? 'Not saved: browser storage is full' : 'Not saved: browser storage refused the write')
  }
}

/** Keep a save this version cannot read, so the next edit does not overwrite it. */
function backupRaw(raw) {
  if (!raw) return
  try {
    localStorage.setItem(BACKUP_KEY, raw)
    keepBackup = false
  } catch {
    keepBackup = true
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('miya-music-maker', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('Storage is busy in another tab'))
  })
}

/**
 * One transaction, then the connection closes. Resolves on complete and rejects on error or
 * abort (a quota abort fires only onabort), so callers always reach their finally.
 */
function withStore(mode, run) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        let settled = false
        let result
        const finish = (err) => {
          if (settled) return
          settled = true
          try { db.close() } catch { /* already closed */ }
          if (err) reject(err)
          else resolve(result)
        }
        let tx
        try {
          tx = db.transaction('audio', mode)
          const req = run(tx.objectStore('audio'))
          if (req) {
            req.onsuccess = () => {
              result = req.result
            }
          }
        } catch (err) {
          finish(err)
          return
        }
        tx.oncomplete = () => finish(null)
        tx.onerror = () => finish(tx.error || new Error('Storage write failed'))
        tx.onabort = () => finish(tx.error || new Error('Storage write was aborted'))
      }),
  )
}

function noteWrite(promise) {
  return promise.then(
    (value) => {
      if (model.saveError.startsWith('Sample')) setSaveError('')
      return value
    },
    (err) => {
      setSaveError(err?.name === 'QuotaExceededError' ? 'Sample not saved: browser storage is full' : 'Sample not saved: browser storage refused the write')
      throw err
    },
  )
}

export function idbSet(key, value) {
  if (typeof indexedDB === 'undefined') return Promise.resolve()
  return noteWrite(withStore('readwrite', (store) => {
    store.put(value, key)
  }).then(() => undefined))
}

export function idbGet(key) {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return withStore('readonly', (store) => store.get(key)).then((value) => value || null)
}

export function idbDelete(key) {
  if (typeof indexedDB === 'undefined') return Promise.resolve()
  return noteWrite(withStore('readwrite', (store) => {
    store.delete(key)
  }).then(() => undefined))
}

export function idbKeys() {
  if (typeof indexedDB === 'undefined') return Promise.resolve([])
  return withStore('readonly', (store) => store.getAllKeys()).then((keys) => keys || [])
}

export async function rememberSample(index, record) {
  const prev = await idbGet(`pad:${index}`)
  const { stashUndo } = await import('./history.js')
  stashUndo(`pad:${index}`, prev || null)
  audioBank.set(index, { pcm: record.pcm, sr: record.sr, rev: Date.now() })
  const pad = model.pads[index]
  pad.source = 'sample'
  pad.patch = null
  pad.sampleName = record.name || 'sample'
  if (record.forceName || !pad.name || pad.name === 'Empty') pad.name = record.name || 'sample'
  await idbSet(`pad:${index}`, { pcm: record.pcm, sr: record.sr, name: pad.sampleName })
  touch(true)
}

export function compactPatterns() {
  const out = []
  for (let i = 0; i < 256; i++) {
    const p = model.patterns[i]
    if (!p) continue
    const len = stepCount(p)
    const used = p.name || len !== 16 || p.steps.some((cell) => cell && cell.some((e) => e))
    if (!used) continue
    out.push({ i, name: p.name || '', bars: p.bars, len, steps: p.steps })
  }
  return out
}

export function restorePatterns(list) {
  model.patterns = Array.from({ length: 256 }, () => null)
  ;(Array.isArray(list) ? list : []).forEach((p) => {
    if (!p || !Number.isInteger(p.i) || p.i < 0 || p.i > 255) return
    model.patterns[p.i] = { name: text(p.name, ''), bars: int(p.bars, 1, 1, 16), len: Number.isFinite(p.len) ? p.len : undefined, steps: Array.isArray(p.steps) ? p.steps : [] }
    ensureStepLength(model.patterns[p.i])
  })
}

function migrateSequences(sequences, seqBank, seqSlot) {
  model.patterns = Array.from({ length: 256 }, () => null)
  if (Array.isArray(sequences)) {
    sequences.forEach((bank, b) => {
      if (!Array.isArray(bank)) return
      bank.forEach((seq, s) => {
        const i = b * 8 + s
        if (i > 255 || !seq || typeof seq !== 'object') return
        model.patterns[i] = { name: '', bars: int(seq.bars, 1, 1, 16), steps: Array.isArray(seq.steps) ? seq.steps : [] }
        ensureStepLength(model.patterns[i])
      })
    })
  }
  model.pattern = Math.max(0, Math.min(255, int(seqBank, 0, 0, 31) * 8 + int(seqSlot, 0, 0, 7)))
  ensurePattern(model.pattern)
}

const SCREEN_IDS = ['pads', 'edit', 'seq', 'mix', 'track', 'synth', 'fx']

export function boot() {
  loadFactoryKit()
  keepBackup = false
  model.saveError = ''
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flushSave)
  if (typeof localStorage === 'undefined') return
  let raw = null
  try {
    raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    if (!data || (data.v !== 1 && data.v !== 2) || !Array.isArray(data.pads) || data.pads.length !== 64) {
      backupRaw(raw)
      return
    }
    const settings = data.settings && typeof data.settings === 'object' ? data.settings : {}
    Object.assign(model, {
      screen: SCREEN_IDS.includes(data.screen) ? data.screen : 'pads',
      bank: int(data.bank, 0, 0, 3),
      selected: int(data.selected, 0, 0, 63),
      bpm: num(data.bpm, 96, 40, 240),
      swing: num(data.swing, 0, 0, 0.6),
      metroVol: num(data.metroVol, 0.55, 0, 1),
      master: num(data.master, 0.9, 0, 1),
      recNatural: !!data.recNatural,
      settings: {
        ...model.settings,
        ...settings,
        midiOffset: int(settings.midiOffset, model.settings.midiOffset, 0, 127),
      },
      octave: int(data.octave, 4, 1, 7),
      keyMap: data.keyMap === 'renoise' ? 'renoise' : 'koala',
      renoiseOct: Math.max(0, Math.min(8, Number.isFinite(data.renoiseOct) ? data.renoiseOct : 3)),
      pads: data.pads,
      buses: normalizeBuses(data.buses),
      mixPage: data.mixPage === 1 ? 1 : 0,
      comp: normalizeComp(data.comp),
      library: data.library || null,
      wallet: typeof data.wallet === 'string' ? data.wallet : '',
      numpadFx: normalizeNumpadFx(data.numpadFx),
      waveView: data.waveDefault === 2
        ? (data.waveView === 0 || data.waveView === 1 || data.waveView === 2 ? data.waveView : 2)
        : (data.waveView === 1 || data.waveView === 2 ? data.waveView : 2),
      songOrder: Array.isArray(data.songOrder) ? data.songOrder.slice(0, 256).map((n) => int(n, 0, 0, 255)) : null,
      songName: typeof data.songName === 'string' ? data.songName : '',
      songFile: typeof data.songFile === 'string' ? data.songFile : '',
      songPlay: !!data.songPlay,
    })
    if (data.v === 2) {
      restorePatterns(data.patterns)
      model.pattern = int(data.pattern, 0, 0, 255)
      ensurePattern(model.pattern)
    } else {
      migrateSequences(data.sequences, data.seqBank, data.seqSlot)
    }
    if (Number.isFinite(data.editStep)) model.tracker.step = Math.max(0, Math.min(16, data.editStep | 0))
    model.tracker.grains = !!data.grainCols
    if (model.screen === 'track') {
      model.tracker.focus = true
      model.tracker.edit = true
    }
    audioBank.clear()
    model.pads.forEach((pad, i) => {
      const next = normalizePad(pad, i)
      if (typeof next.loopPoint !== 'number') next.loopPoint = 0.5
      if (typeof next.bus !== 'number' || next.bus < 0 || next.bus >= BUS_COUNT) next.bus = 0
      model.pads[i] = next
      fitLoop(next)
      if (next.source === 'synth' && next.patch) renderPad(i)
    })
  } catch (err) {
    console.warn('saved session could not be read, factory kit loaded', err)
    backupRaw(raw)
    loadFactoryKit()
  }
}

export async function restoreSamples() {
  await Promise.all(
    model.pads.map(async (pad, i) => {
      if (pad.source !== 'sample') return
      const rec = await idbGet(`pad:${i}`)
      if (rec && rec.pcm) {
        audioBank.set(i, { pcm: rec.pcm, sr: rec.sr || 44100, rev: 1 })
      }
    }),
  )
  touch(false)
}

export function padKeyLabel(localIndex) {
  return PAD_KEYS[localIndex].toUpperCase()
}

export function hexByte(n) {
  const v = Math.max(0, Math.min(255, n | 0))
  return v.toString(16).toUpperCase().padStart(2, '0')
}

export function parseHex(text) {
  if (!text) return null
  const n = parseInt(text, 16)
  return Number.isFinite(n) ? n : null
}
