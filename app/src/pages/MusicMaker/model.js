import { formatLp, formatSl } from './audio/grain.js'
import { PAD_KEYS } from './keys.js'
import { FACTORY, KIT_LAYOUT } from './audio/presets.js'
import { defaultNumpadFx, normalizeFxPresets, normalizeNumpadFx } from './audio/numpadFx.js'
import { CHORDS, PIANO_FROM, PIANO_WHITES, SCALES, TUNINGS, clampAxis, clampBank, clampBend, clampLead } from './audio/piano.js'
import { autoTarget, normalizeAuto, normalizeLaunch, withSongValues } from './audio/arrange.js'
import { snapOctave } from './audio/knee.js'
import { defaultEq, normalizeEq } from './audio/eq.js'
import { clampCrossovers, defaultBand, defaultCrossovers, normalizeBands } from './audio/multiband.js'
import { defaultPatch, MAX_PARTIALS, MAX_UNISON, renderSynth, safeEntries, SYNTH_SR } from './audio/synth.js'
import { SongChanged, bumpSong, exclusive, sameSong, songId } from './jobs.js'

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
/** Later unreadable saves go to `${BACKUP_KEY}-<time>`, newest few only. The first backup is never replaced. */
export const BACKUP_EXTRA = 3

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
  /** Off hides the on-screen pads and keys on a narrow window. The hardware map stays. */
  playSurface: 'pads',
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
  dockOpen: true,
  arrangeOpen: false,
  /** Share of the dock column given to the browser when the arranger is open too. */
  dockSplit: 0.5,
  /** Right-hand numpad column. Wide windows only. Not a phone page. */
  fxOpen: false,
  fxWidth: 280,
  /** Share of that column given to the numpad when the editor sits under it. */
  fxSplit: 0.55,
  /** Bytes per second while − or + bends the slots held with Shift. */
  porta: 72,
  /** Runtime. True when the music window's content box is wider than a phone. Not saved. */
  fxWide: false,
  /** Runtime. A phone, including landscape. The chord piano is one octave. Not saved. */
  chordHand: true,
  /** First white key of the on-screen piano, counted from A0, and how many whites show. */
  pianoFrom: PIANO_FROM,
  pianoWhites: PIANO_WHITES,
  pianoRoot: 0,
  pianoChord: '',
  pianoInv: 0,
  pianoScale: '',
  pianoTuning: 'equal',
  /** Pitch-wheel range in semitones. 24 is two octaves. */
  pianoBend: 24,
  /** Lead strip, in octaves relative to the root. */
  pianoLeadLo: -1,
  pianoLeadHi: 3,
  /** What the vertical position of a tap changes. */
  pianoAxis: 'velocity',
  /** Which page of the 15 harmony buttons is showing. */
  pianoBank: 0,
  /** Height of the on-screen Keys, Chords, or Strum palette. */
  pianoHeight: 240,
  help: false,
  about: false,
  tracker: { row: 0, col: 0, pair: 0, focus: false, hex: '', sign: 1, edit: false, step: 1, follow: true, grains: false },
  library: null,
  wallet: '',
  fileWindow: '',
  /** Which ? card is open. Empty means none. Not saved with the song. */
  coachTopic: '',
  keysHelp: false,
  dirTick: 0,
  sessionFiles: [],
  nftPacks: [],
  nftLocked: [],
  numpadFx: defaultNumpadFx(),
  fxPresets: [],
  fxHeld: -1,
  /** Digits held, oldest first. That order is the master FX chain. */
  fxStack: [],
  fxEdit: 0,
  browserNote: '',
  waveView: 2,
  mixPage: 0,
  compFocus: false,
  comp: defaultComp(),
  songOrder: null,
  songCursor: 0,
  /** wrap plays the order and repeats it. section repeats one cell. once plays through and stops. */
  songLoop: 'wrap',
  /** end waits until the part finishes. now takes a tap on the next step. grid keeps the step. */
  songLaunch: 'end',
  /** Cell queued by a tap, or null. */
  launchCursor: null,
  songName: '',
  songFile: '',
  songPlay: false,
  sliceView: null,
  k3: false,
  saveError: '',
  /** Why the saved session did not open (shown with Restore backup), or ''. */
  bootNotice: '',
  /** The name of the kit last loaded, for Save kit. */
  kitName: '',
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

/** Type choices for an envelope, shown after its target. Off has none. */
export const ENV_KINDS = {
  filter: [
    ['lowpass', 'Low pass'],
    ['highpass', 'High pass'],
    ['bandpass', 'Band pass'],
    ['notch', 'Notch'],
    ['lowshelf', 'Low shelf'],
    ['highshelf', 'High shelf'],
  ],
  amp: [
    ['tube', 'Tube'],
    ['clean', 'Clean'],
    ['tape', 'Tape'],
    ['fold', 'Fold'],
  ],
  chorus: [
    ['stereo', 'Stereo'],
    ['mono', 'Mono'],
  ],
  reverb: [
    ['room', 'Room'],
    ['hall', 'Hall'],
    ['plate', 'Plate'],
    ['spring', 'Spring'],
  ],
  width: [
    ['wide', 'Wide'],
    ['mid', 'Mid'],
    ['haas', 'Haas'],
  ],
}

export function envKind(target, kind, filterType) {
  const options = (ENV_KINDS[target] || []).map((pair) => pair[0])
  if (options.includes(kind)) return kind
  if (target === 'filter' && options.includes(filterType)) return filterType
  if (target === 'filter') return 'lowpass'
  return ''
}

export function defaultEnvelopes(filter) {
  const src = filter || {}
  return [
    { target: 'filter', kind: envKind('filter', src.type), a: src.a ?? 0.004, d: src.d ?? 0.12, s: src.s ?? 0.35, r: src.r ?? 0.08, depth: src.env ?? 0 },
    { target: 'off', kind: '', a: 0.01, d: 0.18, s: 0.4, r: 0.2, depth: 1 },
    { target: 'off', kind: '', a: 0.02, d: 0.24, s: 0, r: 0.3, depth: 1 },
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
    const kind = target === 'off'
      ? ''
      : (target === 'filter' ? envKind('filter', src.kind || fallback.kind, filter?.type) : envKind(target, src.kind))
    return {
      target,
      kind,
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
  return typeof value === 'string' ? plainText(value, max) : fallback
}

/**
 * A name from a file, a wallet, or a remote host, as plain text: a string, no control characters, capped.
 * Anything that is not a string or a number becomes ''.
 */
export function plainText(value, max = 80) {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) return ''
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)
}

const OSC_TYPES = ['sine', 'triangle', 'saw', 'square', 'pulse', 'metal']
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass']

/**
 * Synth patch from a file: numbers stay only when finite, other fields only when their type matches.
 * Unknown keys and prototype keys are dropped, oscillators are exactly the three the renderer reads,
 * and the fields that multiply render work (partials, unison) are capped.
 */
export function normalizePatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const defaults = defaultPatch()
  const out = {}
  for (const [key, value] of safeEntries(raw)) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue
    const want = defaults[key]
    if (key === 'oscs') {
      if (!Array.isArray(value)) continue
      out.oscs = defaults.oscs.map((base, i) => {
        const src = value[i]
        if (!src || typeof src !== 'object' || Array.isArray(src)) return base
        return {
          type: OSC_TYPES.includes(src.type) ? src.type : base.type,
          ratio: num(src.ratio, base.ratio, 0, 64),
          detune: num(src.detune, base.detune, -2400, 2400),
          level: num(src.level, base.level, 0, 4),
          duty: num(src.duty, base.duty, 0.01, 0.99),
        }
      })
      continue
    }
    if (key === 'partials') {
      if (Array.isArray(value)) out.partials = value.slice(0, MAX_PARTIALS).map((v) => num(v, 0, -4, 4))
      continue
    }
    if (key === 'unison') {
      out.unison = int(value, 1, 1, MAX_UNISON)
      continue
    }
    if (key === 'fmFrom') {
      out.fmFrom = int(value, defaults.fmFrom, -1, 2)
      continue
    }
    if (key === 'filterType') {
      if (FILTER_TYPES.includes(value)) out.filterType = value
      continue
    }
    if (key === 'filter2Type') {
      if (value === 'off' || FILTER_TYPES.includes(value)) out.filter2Type = value
      continue
    }
    if (typeof want === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = Math.max(-1e6, Math.min(1e6, value))
      continue
    }
    if (typeof want === 'string') {
      if (typeof value === 'string') out[key] = value.slice(0, 40)
      continue
    }
    if (typeof want === 'boolean' && typeof value === 'boolean') out[key] = value
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
  if (!ENV_KINDS.filter.some((pair) => pair[0] === pad.filter.type)) pad.filter.type = 'lowpass'
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
    rate: num(raw.rate, d.rate, 0.05, 12),
    depth: num(raw.depth, d.depth, 0, 1),
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
    eq: defaultEq(),
    multi: false,
    crossovers: defaultCrossovers(),
    bands: [defaultBand(), defaultBand(), defaultBand(), defaultBand()],
  }
}

export function normalizeComp(raw) {
  const d = defaultComp()
  if (!raw || typeof raw !== 'object') return d
  return {
    threshold: num(raw.threshold, d.threshold, -60, 0),
    ratio: num(raw.ratio, d.ratio, 1, 20),
    knee: num(raw.knee, d.knee, 0, 40),
    attack: num(raw.attack, d.attack, 0.001, 0.5),
    release: num(raw.release, d.release, 0.01, 1.2),
    makeup: num(raw.makeup, d.makeup, 0.25, 4),
    justice: !!raw.justice,
    kKnee: num(raw.kKnee, d.kKnee, 0, 1),
    kPolice: num(raw.kPolice, d.kPolice, 0, 1),
    kFold: num(raw.kFold, d.kFold, 0, 1),
    kPitch: snapOctave(num(raw.kPitch, 0, -2, 2), false),
    kSnap: raw.kSnap !== false,
    lfo: {
      kPolice: normalizeLfo(raw.lfo && typeof raw.lfo === 'object' ? raw.lfo.kPolice : null),
      kFold: normalizeLfo(raw.lfo && typeof raw.lfo === 'object' ? raw.lfo.kFold : null),
    },
    eq: normalizeEq(raw.eq),
    multi: !!raw.multi,
    crossovers: clampCrossovers(raw.crossovers),
    bands: normalizeBands(raw.bands),
  }
}

function normalizeBus(raw, index) {
  if (!raw || typeof raw !== 'object') raw = null
  const bus = {
    name: typeof raw?.name === 'string' && raw.name ? plainText(raw.name, 24) || busLabel(index) : busLabel(index),
    volume: num(raw?.volume, 0.82, 0, 1),
    pan: num(raw?.pan, 0, -1, 1),
    mute: !!raw?.mute,
    solo: !!raw?.solo,
    fx: emptyFx(),
    eq: normalizeEq(raw?.eq),
  }
  if (Array.isArray(raw?.fx)) {
    for (let i = 0; i < 5; i++) {
      const slot = raw.fx[i]
      if (!slot || typeof slot !== 'object') continue
      bus.fx[i] = {
        type: FX_TYPES.includes(slot.type) ? slot.type : 'none',
        amount: num(slot.amount, 0.45, 0, 1),
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
  const start = num(pad.trimStart, 0, 0, 0.98)
  const end = num(pad.trimEnd, 1, start + 0.01, 1)
  pad.trimStart = start
  pad.trimEnd = end
  pad.loopPoint = num(pad.loopPoint, (start + end) / 2, start, Math.max(start, end - 0.005))
}

export function applyTrim(pad, which, value) {
  if (which === 'start') pad.trimStart = value
  else if (which === 'end') pad.trimEnd = value
  else pad.loopPoint = value
  fitLoop(pad)
}

/** Move the whole trimmed span, then keep the loop point inside it. */
export function applyTrimSpan(pad, start, end) {
  pad.trimStart = start
  pad.trimEnd = end
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
  setPatternLengthAt(model.pattern || 0, steps)
}

/** Length of one address. The open pattern is not required. */
export function setPatternLengthAt(index, steps) {
  const i = ((index % 256) + 256) % 256
  const seq = ensurePattern(i)
  const n = Math.max(1, Math.min(256, steps | 0))
  if (stepCount(seq) === n) return
  seq.len = n
  ensureStepLength(seq)
  if ((model.pattern | 0) === i && model.tracker.row >= seq.len) model.tracker.row = 0
  touch(true)
}

/** A live name. Control characters go. Trim happens when the field closes. */
export function setPatternName(index, name) {
  const raw = typeof name === 'string' ? name : ''
  // eslint-disable-next-line no-control-regex
  ensurePattern(index).name = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 48)
  touch(true)
}

/** Absent tempo follows the song. A number is the tempo this pattern plays. */
export function setPatternBpm(index, bpm) {
  const seq = ensurePattern(index)
  if (bpm == null || bpm === '' || !Number.isFinite(Number(bpm))) delete seq.bpm
  else seq.bpm = Math.max(40, Math.min(240, Math.round(Number(bpm))))
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

/** Sounding events for one pad on a step, lane order. A chord is several of these. */
export function hitsFor(col, pad) {
  const out = []
  if (!col) return out
  for (let lane = 0; lane < col.length; lane++) {
    const ev = col[lane]
    if (ev && !ev.off && ev.pad === pad) out.push({ lane, ev })
  }
  return out
}

/**
 * Bars on one sequence row. Each pitch is its own bar, so a chord shows every note.
 * Consecutive steps of one pitch join. Two notes of the same pitch on one step stay apart.
 */
export function noteRuns(steps, pad) {
  const n = steps?.length || 0
  const open = []
  const runs = []
  for (let s = 0; s < n; s++) {
    const hits = hitsFor(steps[s], pad)
    const used = new Set()
    for (const run of open) {
      if (run.end !== s - 1) continue
      const idx = hits.findIndex((hit, i) => !used.has(i) && (hit.ev.pitch | 0) === run.pitch)
      if (idx < 0) continue
      used.add(idx)
      run.end = s
      run.ev = hits[idx].ev
    }
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i].end !== s) open.splice(i, 1)
    }
    hits.forEach((hit, i) => {
      if (used.has(i)) return
      const run = { start: s, end: s, pitch: hit.ev.pitch | 0, ev: hit.ev }
      open.push(run)
      runs.push(run)
    })
  }
  return runs
}

export function setHit(step, padIndex, patch = {}, matchPitch = null) {
  const cell = currentPattern().steps[step]
  if (!cell) return null
  const wanted = matchPitch == null ? null : matchPitch | 0
  let lane = cell.findIndex((e) => e && e.pad === padIndex && (wanted == null || (e.pitch | 0) === wanted))
  if (lane < 0) {
    if (wanted != null) return null
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

export function clearHit(step, padIndex, matchPitch = null) {
  const cell = currentPattern().steps[step]
  if (!cell) return
  if (matchPitch == null) {
    const lane = findHit(step, padIndex)
    if (lane >= 0) cell[lane] = null
  } else {
    const wanted = matchPitch | 0
    for (let lane = 0; lane < cell.length; lane++) {
      const ev = cell[lane]
      if (ev && ev.pad === padIndex && (ev.pitch | 0) === wanted) cell[lane] = null
    }
  }
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

/** Playing with record off. The play row moves, and the cursor does not. */
export function trackerLocked() {
  return !!(model.playing && !model.tracker.edit)
}

/** Rec off. The pattern does not change, stopped or playing. */
function trackerWrites() {
  return !!model.tracker.edit
}

/**
 * Write one tracker cell.
 * A performance hit spills across the row for 40ms, then the cursor steps once.
 * Live record (playing and Follow) writes the playhead row and leaves the edit cursor where it is.
 * Typed instrument entry stays on the armed track and steps immediately.
 */
export function commitTrackerNote({ pad = 0, vel = TRACK_VEL, pitch = 0, off = false, row = null, nudge = 0, live = false, typed = false, stay = false }) {
  if (!trackerWrites()) return
  const rows = stepCount()
  if (!rows) return
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  let writeRow = row == null ? (model.tracker.row | 0) : row
  writeRow = ((writeRow % rows) + rows) % rows
  let lane = armedLane()
  let advance = !live && !stay
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
    if (!live && advance) stepCursor(writeRow)
    model.tracker.hex = ''
    model.tracker.focus = true
    writeLane(writeRow, lane, ev)
  })
}

export function patchTrackerEvent(row, lane, patch, { step = true } = {}) {
  if (!trackerWrites()) return
  batch(() => {
    const cell = currentPattern().steps[row]
    const ev = cell?.[lane]
    if (!ev) return
    if (patch.pitch != null && !ev.off) ev.pitch = Math.max(-60, Math.min(67, patch.pitch | 0))
    if (patch.pad != null && !ev.off) ev.pad = Math.max(0, Math.min(63, patch.pad | 0))
    if (patch.vel != null) ev.vel = Math.max(0, Math.min(1, patch.vel))
    if (patch.nudge != null) ev.nudge = Math.max(-50, Math.min(50, Math.round(patch.nudge)))
    if (patch.sl != null) ev.sl = Math.max(0, Math.min(65535, patch.sl | 0))
    if (patch.len != null && patch.move != null) {
      ev.len = Math.max(0, Math.min(65535, patch.len | 0))
      ev.move = Math.max(-32768, Math.min(32767, patch.move | 0))
    }
    model.tracker.hex = ''
    if (step) stepCursor(row)
    touch(true)
  })
}

/** Blank one grain column. The note stays, and hiding the column does not drop it. */
export function clearTrackerGrain(row, lane, field) {
  if (!trackerWrites()) return
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
  if (!trackerWrites()) return
  batch(() => {
    writeLane(row, lane, null)
    model.tracker.hex = ''
  })
}

/**
 * One tracker column. NOTE replaces or removes the hit.
 * INST, VEL, MOVE, SL, and LP change a hit that is already there, and do not create one.
 * An empty snap clears that column: pad 00, velocity 0, MOVE 0, or a blank grain.
 */
export function writeTrackerField(row, lane, field, snap) {
  if (!trackerWrites()) return
  batch(() => {
    if (field === 0) {
      if (!snap) writeLane(row, lane, null)
      else {
        const ev = {
          pad: Math.max(0, Math.min(63, snap.pad | 0)),
          vel: Math.max(0, Math.min(1, snap.vel ?? TRACK_VEL)),
          pitch: snap.pitch || 0,
          nudge: Math.max(-50, Math.min(50, Math.round(snap.nudge || 0))),
        }
        if (snap.sl != null) ev.sl = snap.sl & 0xffff
        if (snap.len != null && snap.move != null) {
          ev.len = snap.len
          ev.move = snap.move
        }
        writeLane(row, lane, ev)
      }
      model.tracker.hex = ''
      return
    }
    const ev = currentPattern().steps[row]?.[lane]
    if (!ev || ev.off) return
    if (field === 1) ev.pad = snap ? Math.max(0, Math.min(63, snap.pad | 0)) : 0
    else if (field === 2) ev.vel = snap ? Math.max(0, Math.min(1, Number(snap.vel) || 0)) : 0
    else if (field === 3) ev.nudge = snap ? Math.max(-50, Math.min(50, Math.round(snap.nudge || 0))) : 0
    else if (field === 4) {
      if (!snap || snap.sl == null) delete ev.sl
      else ev.sl = snap.sl & 0xffff
    } else if (field === 5) {
      if (!snap || snap.len == null) {
        delete ev.move
        delete ev.len
      } else {
        ev.len = snap.len
        ev.move = snap.move || 0
      }
    }
    model.tracker.hex = ''
    touch(true)
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
  model.songLaunch = 'end'
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
  // Pads and their stored samples change together, so this waits its turn with loads and undo.
  exclusive(() => Promise.all(ids.map(async (id) => {
    const prev = await idbGet(`pad:${id}`)
    const { stashUndo } = await import('./history.js')
    stashUndo(`pad:${id}`, prev || null)
    const bus = model.pads[id].bus
    model.pads[id] = emptyPad(id)
    model.pads[id].bus = bus
    audioBank.delete(id)
    await idbDelete(`pad:${id}`)
  }))).catch((err) => {
    console.warn('delete did not reach storage', err)
  }).finally(() => touch(true))
}

const SURFACES = ['off', 'pads', 'keys', 'chords', 'strum', 'fx']

export function setPlaySurface(id) {
  const next = SURFACES.includes(id) ? id : 'pads'
  model.playSurface = next
  if (next === 'pads') {
    model.keyboard = false
    model.keyMap = 'koala'
  } else if (next === 'keys' || next === 'chords' || next === 'strum') {
    model.keyboard = true
    model.keyMap = 'renoise'
  }
  touch(true)
}

export function cyclePlaySurface() {
  const order = model.fxWide ? SURFACES.filter((id) => id !== 'fx') : SURFACES
  let i = order.indexOf(model.playSurface)
  if (i < 0) i = -1
  setPlaySurface(order[(i + 1) % order.length])
}

export function setSongLoop(loop) {
  model.songLoop = loop === 'section' || loop === 'once' ? loop : 'wrap'
  touch(true)
}

export function setSongLaunch(mode) {
  model.songLaunch = normalizeLaunch(mode)
  touch(true)
}

function patternLanes(seq) {
  if (!Array.isArray(seq.auto)) seq.auto = []
  return seq.auto
}

export function addAutoLane(index, id) {
  const spec = autoTarget(id)
  if (!spec) return
  const seq = ensurePattern(index)
  const lanes = patternLanes(seq)
  if (lanes.some((lane) => lane.id === spec.id) || lanes.length >= 64) return
  lanes.push({ id: spec.id, points: [] })
  touch(true)
}

export function setAutoPoint(index, id, step, value) {
  const spec = autoTarget(id)
  if (!spec) return
  const seq = ensurePattern(index)
  const lanes = patternLanes(seq)
  let lane = lanes.find((item) => item.id === spec.id)
  if (!lane) {
    if (lanes.length >= 64) return
    lane = { id: spec.id, points: [] }
    lanes.push(lane)
  }
  const n = stepCount(seq)
  const s = Math.max(0, Math.min(n - 1, step | 0))
  const raw = Number(value)
  if (!Number.isFinite(raw)) return
  const v = spec.step >= 1 ? Math.round(Math.max(spec.min, Math.min(spec.max, raw))) : Math.max(spec.min, Math.min(spec.max, raw))
  lane.points = lane.points.filter((point) => point.s !== s)
  lane.points.push({ s, v })
  lane.points.sort((a, b) => a.s - b.s)
  touch(true)
}

export function removeAutoPoint(index, id, step) {
  const seq = ensurePattern(index)
  const lane = Array.isArray(seq.auto) ? seq.auto.find((item) => item.id === id) : null
  if (!lane) return
  lane.points = lane.points.filter((point) => point.s !== (step | 0))
  touch(true)
}

export function clearAutoLane(index, id) {
  const i = ((index % 256) + 256) % 256
  const seq = model.patterns[i]
  if (!seq || !Array.isArray(seq.auto)) return
  seq.auto = seq.auto.filter((lane) => lane.id !== id)
  if (!seq.auto.length) delete seq.auto
  touch(true)
}

/** A pattern address holds something worth keeping. */
export function patternOccupied(pattern) {
  if (!pattern) return false
  if (pattern.name) return true
  if (Number.isFinite(pattern.bpm)) return true
  if (Array.isArray(pattern.auto) && pattern.auto.length) return true
  const len = Number.isFinite(pattern.len)
    ? Math.max(1, Math.min(256, pattern.len | 0))
    : Math.max(1, Math.min(16, Math.round(Number(pattern.bars) || 1))) * 16
  if (len !== 16) return true
  return Array.isArray(pattern.steps) && pattern.steps.some((cell) => Array.isArray(cell) && cell.some((event) => event))
}

function clonePattern(src) {
  const copy = JSON.parse(JSON.stringify(src))
  return copy
}

/** Copy the cell's pattern into the next free address and insert it after this cell. */
export function duplicateSongCell(index) {
  const order = Array.isArray(model.songOrder) ? model.songOrder.slice() : []
  if (index < 0 || index >= order.length) return
  const srcIndex = order[index] & 255
  const src = ensurePattern(srcIndex)
  let dest = null
  for (let i = 0; i < 256; i++) {
    if (i === srcIndex) continue
    if (!patternOccupied(model.patterns[i])) {
      dest = i
      break
    }
  }
  if (dest == null) order.splice(index + 1, 0, srcIndex)
  else {
    model.patterns[dest] = clonePattern(src)
    ensureStepLength(model.patterns[dest])
    order.splice(index + 1, 0, dest)
  }
  model.songOrder = order.slice(0, 256)
  if (model.songCursor > index) model.songCursor += 1
  if (model.launchCursor != null && model.launchCursor > index) model.launchCursor += 1
  if (model.songCursor >= model.songOrder.length) model.songCursor = Math.max(0, model.songOrder.length - 1)
  if (model.launchCursor != null && model.launchCursor >= model.songOrder.length) model.launchCursor = null
  touch(true)
}

export function setSongCellPattern(index, pat) {
  const order = Array.isArray(model.songOrder) ? model.songOrder.slice() : []
  if (index < 0 || index >= order.length) return
  order[index] = (pat | 0) & 255
  model.songOrder = order
  touch(true)
}

export function appendSongPattern(pat = model.pattern) {
  const order = Array.isArray(model.songOrder) ? model.songOrder.slice() : []
  order.push((pat | 0) & 255)
  model.songOrder = order.slice(0, 256)
  model.songPlay = true
  touch(true)
}

export function removeSongCell(index) {
  const order = Array.isArray(model.songOrder) ? model.songOrder.slice() : []
  if (index < 0 || index >= order.length) return
  order.splice(index, 1)
  model.songOrder = order
  if (model.songCursor >= order.length) model.songCursor = Math.max(0, order.length - 1)
  if (model.launchCursor != null && model.launchCursor >= order.length) model.launchCursor = null
  touch(true)
}

export function moveSongCell(from, to) {
  const order = Array.isArray(model.songOrder) ? model.songOrder.slice() : []
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return
  const [item] = order.splice(from, 1)
  order.splice(to, 0, item)
  const shift = (cursor) => {
    if (cursor == null) return cursor
    if (cursor === from) return to
    if (from < cursor && to >= cursor) return cursor - 1
    if (from > cursor && to <= cursor) return cursor + 1
    return cursor
  }
  model.songOrder = order
  model.songCursor = shift(model.songCursor | 0)
  model.launchCursor = model.launchCursor == null ? null : shift(model.launchCursor | 0)
  touch(true)
}

export function setScreen(id) {
  if (id === 'fx' && model.fxWide) {
    model.fxOpen = true
    if ((model.fxWidth || 0) < 168) model.fxWidth = 280
    touch(true)
    return
  }
  model.screen = id
  if (id === 'track') model.tracker.focus = true
  else model.tracker.focus = false
  touch(false)
}

export function cycleScreen(dir) {
  const order = model.fxWide
    ? ['pads', 'edit', 'seq', 'mix', 'track', 'synth']
    : ['pads', 'edit', 'seq', 'mix', 'track', 'synth', 'fx']
  let i = order.indexOf(model.screen)
  if (i < 0) i = 0
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

/** Write the session now. True when localStorage took it (or there is none to write, as under Node). */
export function saveNow() {
  if (typeof window !== 'undefined' && saveTimer) window.clearTimeout(saveTimer)
  save()
  return !model.saveError.startsWith('Not saved')
}

function clampDockSplit(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0.15, Math.min(0.85, n))
}

function clampFxSplit(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0.55
  return Math.max(0.22, Math.min(0.78, n))
}

function clampPorta(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 72
  return Math.max(1, Math.min(255, Math.round(n)))
}

export function clampPianoHeight(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 240
  return Math.max(180, Math.min(640, Math.round(n)))
}

function knownId(list, value, fallback) {
  return list.some((item) => item.id === value) ? value : fallback
}

export function save() {
  saveTimer = 0
  if (typeof localStorage === 'undefined') return
  if (keepBackup) {
    // The old save could not be backed up. Writing now would erase the only copy.
    setSaveError('Not saved: an older save could not be read or backed up')
    return
  }
  // Playback may be holding a pattern tempo or automated levels. The session keeps the song's own.
  const json = withSongValues(model, () => JSON.stringify({
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
    dockOpen: model.dockOpen !== false,
    arrangeOpen: !!model.arrangeOpen,
    dockSplit: clampDockSplit(model.dockSplit),
    fxOpen: !!model.fxOpen,
    fxWidth: Math.max(168, Math.min(640, model.fxWidth | 0 || 280)),
    fxSplit: clampFxSplit(model.fxSplit),
    porta: clampPorta(model.porta),
    pianoFrom: Math.max(0, Math.min(51, model.pianoFrom | 0)),
    pianoWhites: Math.max(7, Math.min(21, model.pianoWhites | 0 || PIANO_WHITES)),
    pianoRoot: Math.max(0, Math.min(11, model.pianoRoot | 0)),
    pianoChord: knownId(CHORDS, model.pianoChord, ''),
    pianoInv: Math.max(-3, Math.min(3, model.pianoInv | 0)),
    pianoScale: knownId(SCALES, model.pianoScale, ''),
    pianoTuning: knownId(TUNINGS, model.pianoTuning, 'equal'),
    pianoBend: clampBend(model.pianoBend),
    pianoLeadLo: clampLead(model.pianoLeadLo, model.pianoLeadHi).lo,
    pianoLeadHi: clampLead(model.pianoLeadLo, model.pianoLeadHi).hi,
    pianoAxis: clampAxis(model.pianoAxis),
    pianoBank: clampBank(model.pianoBank),
    pianoHeight: clampPianoHeight(model.pianoHeight),
    playSurface: SURFACES.includes(model.playSurface) ? model.playSurface : 'pads',
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
    fxPresets: normalizeFxPresets(model.fxPresets),
    waveView: model.waveView === 0 || model.waveView === 1 || model.waveView === 2 ? model.waveView : 2,
    waveDefault: 2,
    mixPage: model.mixPage === 1 ? 1 : 0,
    comp: normalizeComp(model.comp),
    songOrder: Array.isArray(model.songOrder) ? model.songOrder.slice(0, 256) : null,
    songName: model.songName || '',
    songFile: model.songFile || '',
    songPlay: !!model.songPlay,
    songLoop: model.songLoop === 'section' || model.songLoop === 'once' ? model.songLoop : 'wrap',
    songLaunch: normalizeLaunch(model.songLaunch),
    songCursor: model.songCursor | 0,
  }))
  try {
    localStorage.setItem(SAVE_KEY, json)
    if (model.saveError && !model.saveError.startsWith('Sample')) setSaveError('')
  } catch (err) {
    // Quota or a blocked store: the session still has everything, but say so.
    setSaveError(err?.name === 'QuotaExceededError' ? 'Not saved: browser storage is full' : 'Not saved: browser storage refused the write')
  }
}

function backupKeys() {
  const keys = []
  try {
    const n = Number(localStorage.length) || 0
    for (let i = 0; i < n; i++) {
      const key = localStorage.key(i)
      if (typeof key === 'string' && key.startsWith(`${BACKUP_KEY}-`)) keys.push(key)
    }
  } catch { /* a store without key(): only the first backup is kept */ }
  return keys.sort()
}

/**
 * Keep a save this version cannot read, so the next edit does not overwrite it.
 * A second unreadable save never replaces the first backup: it gets a timestamped key, and only the
 * newest BACKUP_EXTRA of those are kept.
 */
function backupRaw(raw) {
  if (!raw) return
  try {
    const first = localStorage.getItem(BACKUP_KEY)
    if (first == null || first === raw) {
      if (first == null) localStorage.setItem(BACKUP_KEY, raw)
      keepBackup = false
      return
    }
    const extra = backupKeys()
    if (extra.some((key) => localStorage.getItem(key) === raw)) {
      keepBackup = false
      return
    }
    localStorage.setItem(`${BACKUP_KEY}-${String(Date.now()).padStart(15, '0')}`, raw)
    const kept = backupKeys()
    while (kept.length > BACKUP_EXTRA) localStorage.removeItem(kept.shift())
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
      setSaveError(err?.name === 'QuotaExceededError'
        ? 'Sample not saved: browser storage is full'
        : err?.name === 'NoStorage' ? 'Sample not saved: this browser has no storage for samples' : 'Sample not saved: browser storage refused the write')
      throw err
    },
  )
}

/** Thrown by a write when this browser has no IndexedDB (private mode in some browsers, a locked-down profile). */
export function noStorage() {
  const err = new Error('Browser storage is not available here, so samples and songs cannot be kept')
  err.name = 'NoStorage'
  return err
}

export function idbSet(key, value) {
  if (typeof indexedDB === 'undefined') return noteWrite(Promise.reject(noStorage()))
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

/**
 * Put a sample on a pad. Storage is written first: when that write fails, the pad, its audio and the
 * undo stack keep the old sample and saveError says why. Runs as an exclusive job, so a song load or an
 * undo cannot interleave with it.
 * `record.song` (a songId() taken when the take or import started) makes it throw SongChanged instead
 * of writing into a song that was opened since. `record.padPatch` (trim, mode) is applied once it lands.
 */
export function rememberSample(index, record) {
  return exclusive(() => rememberSampleNow(index, record))
}

async function rememberSampleNow(index, record) {
  if (record.song != null && !sameSong(record.song)) throw new SongChanged()
  if (!model.pads[index]) throw new Error('That pad does not exist')
  const { stashUndo } = await import('./history.js')
  const prev = await idbGet(`pad:${index}`)
  const sampleName = plainText(record.name, 80) || 'sample'
  await idbSet(`pad:${index}`, { pcm: record.pcm, sr: record.sr, name: sampleName })
  stashUndo(`pad:${index}`, prev || null)
  audioBank.set(index, { pcm: record.pcm, sr: record.sr, rev: Date.now() })
  const pad = model.pads[index]
  pad.source = 'sample'
  pad.patch = null
  pad.sampleName = sampleName
  if (record.forceName || !pad.name || pad.name === 'Empty') pad.name = sampleName
  if (record.padPatch) {
    Object.assign(pad, record.padPatch)
    fitLoop(pad)
  }
  touch(true)
  return sampleBudget()
}

export function compactPatterns() {
  const out = []
  for (let i = 0; i < 256; i++) {
    const p = model.patterns[i]
    if (!patternOccupied(p)) continue
    const len = stepCount(p)
    const row = { i, name: p.name || '', bars: p.bars, len, steps: p.steps }
    if (Number.isFinite(p.bpm)) row.bpm = Math.max(40, Math.min(240, Math.round(p.bpm)))
    const auto = normalizeAuto(p.auto)
    if (auto.length) row.auto = auto
    out.push(row)
  }
  return out
}

export function restorePatterns(list) {
  model.patterns = Array.from({ length: 256 }, () => null)
  ;(Array.isArray(list) ? list : []).forEach((p) => {
    if (!p || !Number.isInteger(p.i) || p.i < 0 || p.i > 255) return
    const seq = { name: text(p.name, ''), bars: int(p.bars, 1, 1, 16), len: Number.isFinite(p.len) ? p.len : undefined, steps: Array.isArray(p.steps) ? p.steps : [] }
    if (Number.isFinite(p.bpm)) seq.bpm = Math.max(40, Math.min(240, Math.round(Number(p.bpm))))
    const auto = normalizeAuto(p.auto)
    if (auto.length) seq.auto = auto
    model.patterns[p.i] = seq
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
  // A new session: anything still in flight from the last one must not land in this one.
  bumpSong()
  loadFactoryKit()
  keepBackup = false
  model.saveError = ''
  model.bootNotice = ''
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flushSave)
  if (typeof localStorage === 'undefined') return
  let raw = null
  try {
    raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    if (!data || (data.v !== 1 && data.v !== 2) || !Array.isArray(data.pads) || data.pads.length !== 64) {
      backupRaw(raw)
      noteBootFallback(data && typeof data === 'object' && data.v !== 1 && data.v !== 2
        ? `Your saved session is from another version (v${plainText(data.v, 8) || '?'}) and was not opened.`
        : 'Your saved session is damaged and was not opened.')
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
      fxPresets: normalizeFxPresets(data.fxPresets),
      waveView: data.waveDefault === 2
        ? (data.waveView === 0 || data.waveView === 1 || data.waveView === 2 ? data.waveView : 2)
        : (data.waveView === 1 || data.waveView === 2 ? data.waveView : 2),
      songOrder: Array.isArray(data.songOrder) ? data.songOrder.slice(0, 256).map((n) => int(n, 0, 0, 255)) : null,
      songName: typeof data.songName === 'string' ? data.songName : '',
      songFile: typeof data.songFile === 'string' ? data.songFile : '',
      songPlay: !!data.songPlay,
      songLoop: data.songLoop === 'section' || data.songLoop === 'once' ? data.songLoop : 'wrap',
      songLaunch: normalizeLaunch(data.songLaunch),
      songCursor: Math.max(0, data.songCursor | 0),
      playSurface: SURFACES.includes(data.playSurface)
        ? data.playSurface
        : (data.keyMap === 'renoise' ? 'keys' : 'pads'),
      arrangeOpen: !!data.arrangeOpen,
      dockSplit: clampDockSplit(data.dockSplit),
      fxOpen: !!data.fxOpen,
      fxWidth: Math.max(168, Math.min(640, Number(data.fxWidth) || 280)),
      fxSplit: clampFxSplit(data.fxSplit),
      porta: clampPorta(data.porta),
      pianoFrom: Math.max(0, Math.min(51, Number.isFinite(Number(data.pianoFrom)) ? Number(data.pianoFrom) : PIANO_FROM)),
      pianoWhites: Math.max(7, Math.min(21, Number(data.pianoWhites) || PIANO_WHITES)),
      pianoRoot: Math.max(0, Math.min(11, Number(data.pianoRoot) || 0)),
      pianoChord: knownId(CHORDS, data.pianoChord, ''),
      pianoInv: Math.max(-3, Math.min(3, Number(data.pianoInv) || 0)),
      pianoScale: knownId(SCALES, data.pianoScale, ''),
      pianoTuning: knownId(TUNINGS, data.pianoTuning, 'equal'),
      pianoBend: clampBend(data.pianoBend),
      pianoLeadLo: clampLead(data.pianoLeadLo, data.pianoLeadHi).lo,
      pianoLeadHi: clampLead(data.pianoLeadLo, data.pianoLeadHi).hi,
      pianoAxis: clampAxis(data.pianoAxis),
      pianoBank: clampBank(data.pianoBank),
      pianoHeight: clampPianoHeight(data.pianoHeight),
    })
    model.keyboard = model.playSurface === 'keys' || model.playSurface === 'chords' || model.playSurface === 'strum' || (model.playSurface === 'off' && model.keyMap === 'renoise')
    if (data.v === 2) {
      restorePatterns(data.patterns)
      model.pattern = int(data.pattern, 0, 0, 255)
      ensurePattern(model.pattern)
    } else {
      migrateSequences(data.sequences, data.seqBank, data.seqSlot)
    }
    if (Number.isFinite(data.editStep)) model.tracker.step = Math.max(0, Math.min(16, data.editStep | 0))
    model.tracker.grains = !!data.grainCols
    model.dockOpen = data.dockOpen !== false
    if (model.screen === 'track') model.tracker.focus = true
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
    noteBootFallback('Your saved session could not be read.')
  }
}

function noteBootFallback(why) {
  model.bootNotice = keepBackup
    ? `${why} The factory kit is loaded. The old save could not be backed up, so nothing is saved until you restore it or download it.`
    : `${why} The factory kit is loaded and the old save is kept as a backup.`
}

/** The newest backup of a save this version could not open, or null. */
export function latestBackup() {
  if (typeof localStorage === 'undefined') return null
  try {
    const extra = backupKeys()
    const key = extra.length ? extra[extra.length - 1] : BACKUP_KEY
    const raw = localStorage.getItem(key)
    return raw ? { key, raw } : null
  } catch {
    return null
  }
}

/**
 * Put the newest backup back as the save and open it again. True when it opened; false (and a notice)
 * when it still cannot be read. Pads with samples still need restoreSamples() afterwards.
 */
export function restoreBackup() {
  const backup = latestBackup()
  if (!backup) {
    model.bootNotice = 'There is no backup to restore.'
    touch(false)
    return false
  }
  try {
    localStorage.setItem(SAVE_KEY, backup.raw)
  } catch {
    model.bootNotice = 'The backup could not be put back: browser storage refused the write. Download it to keep it.'
    touch(false)
    return false
  }
  model.bootNotice = ''
  boot()
  const opened = !model.bootNotice
  if (!opened) model.bootNotice = 'That backup still cannot be opened by this version. Download it to keep it.'
  touch(false)
  return opened
}

export function downloadBackup() {
  const backup = latestBackup()
  if (!backup || typeof document === 'undefined') return false
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([backup.raw], { type: 'application/json' }))
  link.download = 'miya-music-maker-backup.json'
  link.click()
  const href = link.href
  setTimeout(() => URL.revokeObjectURL(href), 30000)
  return true
}

export function dismissBootNotice() {
  model.bootNotice = ''
  touch(false)
}

/**
 * Pads that say they hold a sample but have no audio in this session: their stored sample could not be read
 * (or is not there). Saving, minting or uploading now would drop those samples for good, so those refuse
 * until every one is read back (retryUnreadPads) or the pad is cleared.
 */
export function unreadPads() {
  const out = []
  model.pads.forEach((pad, i) => {
    if (pad?.source === 'sample' && !audioBank.get(i)?.pcm?.length) out.push(i)
  })
  return out
}

export function padLabel(index) {
  return `${BANKS[Math.floor(index / 16)] || '?'}${(index % 16) + 1}`
}

/** Throws a message naming the unreadable pads when there are any. `what` is the action refused. */
export function assertPadsRead(what = 'Save') {
  const unread = unreadPads()
  if (!unread.length) return
  const names = unread.slice(0, 8).map(padLabel).join(', ') + (unread.length > 8 ? ` and ${unread.length - 8} more` : '')
  throw new Error(`${what} is off: the sample${unread.length > 1 ? 's' : ''} on pad${unread.length > 1 ? 's' : ''} ${names} could not be read from browser storage, and ${what.toLowerCase()} would drop ${unread.length > 1 ? 'them' : 'it'}. Retry reading them, or clear those pads.`)
}

/**
 * Read each sample pad's audio back from IndexedDB. One unreadable pad does not stop the rest.
 * Rejects after the others are in, with a message for the user, when any could not be read: a failed read
 * and a sample pad with no stored record both count. `only` limits it to those pads (a retry).
 */
export async function restoreSamples(only = null) {
  const session = songId()
  let failed = 0
  await Promise.all(
    model.pads.map(async (pad, i) => {
      if (pad.source !== 'sample') return
      if (only && !only.includes(i)) return
      try {
        const rec = await idbGet(`pad:${i}`)
        if (!sameSong(session)) return
        if (rec && rec.pcm instanceof Float32Array && rec.pcm.length) {
          audioBank.set(i, { pcm: rec.pcm, sr: rec.sr || 44100, rev: (audioBank.get(i)?.rev || 0) + 1 })
        } else {
          failed += 1
          console.warn(`pad ${i + 1} sample is missing from browser storage`)
        }
      } catch (err) {
        failed += 1
        console.warn(`pad ${i + 1} sample could not be read`, err)
      }
    }),
  )
  touch(false)
  if (failed) {
    const names = unreadPads().slice(0, 8).map(padLabel).join(', ')
    throw new Error(`${failed} sample${failed > 1 ? 's' : ''} could not be read from browser storage${names ? ` (pad ${names})` : ''}. Those pads are silent, and Save is off until they load.`)
  }
}

/** Try the unreadable pads again. Resolves with how many are still unread. */
export function retryUnreadPads() {
  return exclusive(async () => {
    const list = unreadPads()
    if (!list.length) return 0
    try {
      await restoreSamples(list)
    } catch {
      /* counted below */
    }
    return unreadPads().length
  })
}

/**
 * Give up on the unreadable pads: they become empty pads (bus kept). The stored records are left alone,
 * so nothing that might still be read later is deleted.
 */
export function clearUnreadPads() {
  for (const i of unreadPads()) {
    const bus = model.pads[i].bus
    model.pads[i] = emptyPad(i)
    model.pads[i].bus = bus
  }
  touch(true)
}

/** Samples a .m1ya can hold in all (base64 of 32-bit floats: about 10.7 MB of text). */
export const PACK_SAMPLES = 2_000_000
export const PACK_SECONDS = Math.round(PACK_SAMPLES / 44100)

/** How much sample time the song's pads use and how much can still be saved. */
export function sampleBudget(extra = 0, exceptPad = -1) {
  let used = 0
  model.pads.forEach((pad, i) => {
    if (i === exceptPad || pad?.source !== 'sample') return
    used += audioBank.get(i)?.pcm?.length || 0
  })
  used += Math.max(0, extra | 0)
  const left = PACK_SAMPLES - used
  return { used, limit: PACK_SAMPLES, over: left < 0, leftSeconds: Math.max(0, Math.floor(left / 44100)), overSeconds: left < 0 ? Math.ceil(-left / 44100) : 0 }
}

/** A short line for after an import or a take: time left, or how far over a saved song can hold. */
export function budgetNote(budget = sampleBudget()) {
  if (budget.over) return `Samples now run ${budget.overSeconds} s past the ${PACK_SECONDS} s a saved song holds: shorten or clear a pad before saving.`
  if (budget.leftSeconds < 10) return `${budget.leftSeconds} s of sample time left in this song.`
  return ''
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
