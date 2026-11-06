import { PAD_KEYS } from './keys.js'
import { FACTORY, KIT_LAYOUT } from './audio/presets.js'
import { defaultNumpadFx, normalizeNumpadFx } from './audio/numpadFx.js'
import { renderSynth, SYNTH_SR } from './audio/synth.js'

export const BANKS = ['A', 'B', 'C', 'D']
export const BUS_NAMES = ['BUS A', 'BUS B', 'BUS C', 'BUS D']
export const FX_TYPES = ['none', 'filter', 'drive', 'delay', 'reverb', 'chorus', 'crush', 'comp']
export const LANES = 16

const SAVE_KEY = 'miya-music-maker-v1'

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
  tracker: { row: 0, col: 0, focus: false, hex: '' },
  library: null,
  wallet: '',
  numpadFx: defaultNumpadFx(),
  fxHeld: -1,
  fxEdit: 0,
  browserNote: '',
  waveView: 0,
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function touch(persist = false) {
  version += 1
  listeners.forEach((fn) => fn(version))
  if (persist) scheduleSave()
}

export function getVersion() {
  return version
}

function emptyFx() {
  return Array.from({ length: 5 }, () => ({ type: 'none', amount: 0.45 }))
}

export function emptyPad(i = 0) {
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
    reverse: false,
    filter: { type: 'lowpass', cutoff: 18000, q: 0.7, env: 0, a: 0.004, d: 0.12, s: 0.35, r: 0.08 },
    amp: { a: 0.001, d: 0.001, s: 1, r: 0.015 },
    fx: { drive: 0, crush: 0 },
    sampleName: '',
  }
}

function emptyLanes() {
  return Array.from({ length: LANES }, () => null)
}

function normalizeEvent(ev) {
  return {
    pad: ev.pad | 0,
    vel: Math.max(0, Math.min(1, ev.vel ?? 0.9)),
    pitch: ev.pitch || 0,
    nudge: Math.max(-50, Math.min(50, Math.round(ev.nudge || 0))),
  }
}

/** Fixed 16 lanes. A packed list from an older save is placed in lane order. */
function toLanes(cell) {
  const lanes = emptyLanes()
  if (!Array.isArray(cell)) return lanes
  const laneShaped = cell.length === LANES && cell.every((e) => e == null || typeof e.pad === 'number')
  if (laneShaped) {
    for (let i = 0; i < LANES; i++) lanes[i] = cell[i] ? normalizeEvent(cell[i]) : null
    return lanes
  }
  let n = 0
  for (const ev of cell) {
    if (!ev || typeof ev.pad !== 'number' || n >= LANES) continue
    lanes[n++] = normalizeEvent(ev)
  }
  return lanes
}

function emptyPattern() {
  return { name: '', bars: 1, steps: Array.from({ length: 16 }, emptyLanes) }
}

function freshBuses() {
  return BUS_NAMES.map((name) => ({
    name,
    volume: 0.82,
    pan: 0,
    mute: false,
    solo: false,
    fx: emptyFx(),
  }))
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
  return seq.bars * 16
}

function ensureStepLength(seq) {
  seq.bars = Math.max(1, Math.min(16, seq.bars || 1))
  const n = seq.bars * 16
  if (!Array.isArray(seq.steps)) seq.steps = []
  for (let i = 0; i < n; i++) seq.steps[i] = toLanes(seq.steps[i])
  if (seq.steps.length > n) seq.steps.length = n
}

export function setPattern(index) {
  model.pattern = ((index % 256) + 256) % 256
  model.seqHit = null
  const seq = ensurePattern(model.pattern)
  if (model.tracker.row >= seq.bars * 16) model.tracker.row = 0
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

export function setBars(bars) {
  const seq = currentSequence()
  seq.bars = Math.max(1, Math.min(16, bars))
  ensureStepLength(seq)
  touch(true)
}

export function addBar() {
  setBars(currentSequence().bars + 1)
}

export function removeBar() {
  setBars(currentSequence().bars - 1)
}

export function doubleUp() {
  const seq = currentPattern()
  if (seq.bars >= 8) return
  const copy = seq.steps.map((s) => s.map((e) => (e ? { ...e } : null)))
  seq.bars *= 2
  seq.steps = seq.steps.concat(copy)
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
  selectionIds().forEach((id) => {
    const bus = model.pads[id].bus
    model.pads[id] = emptyPad(id)
    model.pads[id].bus = bus
    audioBank.delete(id)
    idbDelete(`pad:${id}`)
  })
  touch(true)
}

export function setScreen(id) {
  model.screen = id
  model.tracker.focus = id === 'track' ? model.tracker.focus : false
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

export function save() {
  if (typeof localStorage === 'undefined') return
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
    waveView: model.waveView || 0,
  }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
  } catch {
    /* quota: the kit still lives in this session */
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
  })
}

export function idbSet(key, value) {
  if (typeof indexedDB === 'undefined') return Promise.resolve()
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('audio', 'readwrite')
        tx.objectStore('audio').put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }),
  )
}

export function idbGet(key) {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('audio', 'readonly')
        const req = tx.objectStore('audio').get(key)
        req.onsuccess = () => resolve(req.result || null)
        req.onerror = () => reject(req.error)
      }),
  )
}

export function idbDelete(key) {
  if (typeof indexedDB === 'undefined') return Promise.resolve()
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('audio', 'readwrite')
        tx.objectStore('audio').delete(key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }),
  )
}

export function idbKeys() {
  if (typeof indexedDB === 'undefined') return Promise.resolve([])
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('audio', 'readonly')
        const req = tx.objectStore('audio').getAllKeys()
        req.onsuccess = () => resolve(req.result || [])
        req.onerror = () => reject(req.error)
      }),
  )
}

export async function rememberSample(index, record) {
  audioBank.set(index, { pcm: record.pcm, sr: record.sr, rev: Date.now() })
  const pad = model.pads[index]
  pad.source = 'sample'
  pad.patch = null
  pad.sampleName = record.name || 'sample'
  if (record.forceName || !pad.name || pad.name === 'Empty') pad.name = record.name || 'sample'
  await idbSet(`pad:${index}`, { pcm: record.pcm, sr: record.sr, name: pad.sampleName })
  touch(true)
}

function compactPatterns() {
  const out = []
  for (let i = 0; i < 256; i++) {
    const p = model.patterns[i]
    if (!p) continue
    const used = p.name || p.bars > 1 || p.steps.some((cell) => cell && cell.some((e) => e))
    if (!used) continue
    out.push({ i, name: p.name || '', bars: p.bars, steps: p.steps })
  }
  return out
}

function restorePatterns(list) {
  model.patterns = Array.from({ length: 256 }, () => null)
  ;(list || []).forEach((p) => {
    if (!p || p.i < 0 || p.i > 255) return
    model.patterns[p.i] = { name: p.name || '', bars: p.bars || 1, steps: p.steps || [] }
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
        if (i > 255 || !seq) return
        model.patterns[i] = { name: '', bars: seq.bars || 1, steps: seq.steps || [] }
        ensureStepLength(model.patterns[i])
      })
    })
  }
  model.pattern = Math.max(0, Math.min(255, (seqBank || 0) * 8 + (seqSlot || 0)))
  ensurePattern(model.pattern)
}

export function boot() {
  loadFactoryKit()
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    if (!data || (data.v !== 1 && data.v !== 2) || !Array.isArray(data.pads) || data.pads.length !== 64) return
    Object.assign(model, {
      screen: data.screen || 'pads',
      bank: data.bank || 0,
      selected: data.selected || 0,
      bpm: data.bpm || 96,
      swing: data.swing || 0,
      metroVol: data.metroVol ?? 0.55,
      master: data.master ?? 0.9,
      recNatural: !!data.recNatural,
      settings: { ...model.settings, ...(data.settings || {}) },
      octave: data.octave || 4,
      keyMap: data.keyMap === 'renoise' ? 'renoise' : 'koala',
      renoiseOct: Math.max(0, Math.min(8, Number.isFinite(data.renoiseOct) ? data.renoiseOct : 3)),
      pads: data.pads,
      buses: data.buses,
      library: data.library || null,
      wallet: typeof data.wallet === 'string' ? data.wallet : '',
      numpadFx: normalizeNumpadFx(data.numpadFx),
      waveView: data.waveView === 1 || data.waveView === 2 ? data.waveView : 0,
    })
    if (data.v === 2) {
      restorePatterns(data.patterns)
      model.pattern = data.pattern || 0
      ensurePattern(model.pattern)
    } else {
      migrateSequences(data.sequences, data.seqBank, data.seqSlot)
    }
    audioBank.clear()
    model.pads.forEach((pad, i) => {
      if (pad.source === 'synth' && pad.patch) renderPad(i)
    })
  } catch {
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
