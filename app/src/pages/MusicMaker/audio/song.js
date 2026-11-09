import { parseMod, parseXm } from './module.js'
import { defaultNumpadFx, normalizeNumpadFx } from './numpadFx.js'
import { FACTORY, KIT_LAYOUT } from './presets.js'
import { renderSynth } from './synth.js'
import { beginUndo, endUndo, songSwitch, stashUndo } from '../history.js'
import { bumpSong, exclusive, loadCurrent, loadTicket } from '../jobs.js'
import { ensureLibrary } from '../media/library.js'
import { allowedMediaUrl } from '../media/allow.js'
import { fetchCapped, TooLarge } from '../media/capped.js'
import {
  LANES,
  PACK_SAMPLES,
  PACK_SECONDS,
  assertPadsRead,
  audioBank,
  defaultComp,
  emptyPad,
  ensurePattern,
  normalizePad,
  num,
  fitLoop,
  idbDelete,
  idbGet,
  idbSet,
  model,
  normalizeBuses,
  normalizeComp,
  normalizeEvent,
  plainText,
  saveNow,
  touch,
} from '../model.js'

export { PACK_SAMPLES }

/** A packed song is base64 of its samples plus the arrangement: this is room for a full one. */
export const PACK_BYTES = 16 * 1024 * 1024
const FETCH_MS = 45000
const PATTERN_NAME_MAX = 48

/** Factory drum kit as pad settings only. Synth audio is rendered on load. */
export function factoryPads() {
  const pads = Array.from({ length: 64 }, (_, i) => emptyPad(i))
  KIT_LAYOUT.forEach((slot, i) => {
    const factory = FACTORY[slot.preset]
    if (!factory) return
    const pad = pads[i]
    pad.name = factory.name
    pad.source = 'synth'
    pad.patch = JSON.parse(JSON.stringify(factory.patch))
    pad.bus = slot.bus
    pad.choke = slot.choke
  })
  return pads
}

function factoryBuses() {
  const buses = normalizeBuses(null)
  buses[1].fx[0] = { type: 'filter', amount: 0.72 }
  buses[3].fx[0] = { type: 'reverb', amount: 0.28 }
  buses[3].fx[1] = { type: 'delay', amount: 0.22 }
  return buses
}

export function blankSong() {
  return {
    type: 'm1ya',
    v: 2,
    name: 'Blank',
    bpm: 184,
    swing: 0,
    order: [0],
    patterns: [{ i: 0, name: '', bars: 1, steps: [] }],
    pads: factoryPads(),
    samples: [],
    master: 0.9,
    buses: factoryBuses(),
    numpadFx: defaultNumpadFx(),
    comp: defaultComp(),
  }
}

function pcmToB64(pcm) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let bin = ''
  const chunk = 0x4000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + chunk)))
  }
  return btoa(bin)
}

/** Samples a base64 sample holds, from its length alone (4 bytes a sample, 3 bytes per 4 characters). */
export function b64Samples(text) {
  return typeof text === 'string' ? Math.floor((text.length * 3) / 4 / 4) : 0
}

function samplesTooLong() {
  return new Error(`That song’s samples are too long to pack (pads with samples hold more than ${PACK_SECONDS} s in all). Clear or shorten a pad.`)
}

function b64ToPcm(text, room = PACK_SAMPLES) {
  if (typeof text !== 'string') throw new Error('That song sample is damaged')
  // Checked before decoding, so a huge string is refused without a huge allocation.
  if (b64Samples(text) > room) throw samplesTooLong()
  let bin
  try {
    bin = atob(text)
  } catch {
    throw new Error('That song sample is damaged')
  }
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 255
  if (bytes.byteLength % 4) throw new Error('That song sample is damaged')
  return new Float32Array(bytes.buffer.slice(0))
}

/** Samples in either form, decoded or base64. */
export function sampleLength(sample) {
  if (sample?.pcm instanceof Float32Array) return sample.pcm.length
  return b64Samples(sample?.pcm)
}

/** Every sample counts toward PACK_SAMPLES, decoded or already base64. Only known fields are kept. */
function packSamples(samples) {
  if (samples != null && !Array.isArray(samples)) throw new Error('That kit’s sample list is damaged')
  let total = 0
  const out = []
  for (const sample of samples || []) {
    if (!sample || typeof sample !== 'object') continue
    const pad = Number(sample.pad)
    if (!Number.isInteger(pad) || pad < 0 || pad > 63) continue
    total += sampleLength(sample)
    if (total > PACK_SAMPLES) throw samplesTooLong()
    const pcm = sample.pcm instanceof Float32Array ? pcmToB64(sample.pcm) : typeof sample.pcm === 'string' ? sample.pcm : null
    if (pcm == null) continue
    out.push({ pad, name: plainText(sample.name, 80), sr: Math.round(num(sample.sr, 44100, 3000, 192000)), pcm })
  }
  return out
}

/** Pads through normalizePad: unknown keys go, numbers are finite, patches are checked. */
function clonePads(pads) {
  if (!Array.isArray(pads)) return []
  return JSON.parse(JSON.stringify(pads.slice(0, 64).map((pad, i) => normalizePad(pad, i))))
}

/** Patterns from a file: at most 256, one per index, names capped, steps cut to 256 rows of 16 lanes. */
export function normalizePatterns(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const pattern of list) {
    if (out.length >= 256) break
    if (!pattern || typeof pattern !== 'object') continue
    const i = pattern.i
    if (!Number.isInteger(i) || i < 0 || i > 255 || seen.has(i)) continue
    seen.add(i)
    const steps = Array.isArray(pattern.steps)
      ? pattern.steps.slice(0, 256).map((cell) => (Array.isArray(cell)
        ? cell.slice(0, LANES).map((ev) => (ev && typeof ev === 'object' && typeof ev.pad === 'number' ? normalizeEvent(ev) : null))
        : null))
      : []
    const next = { i, name: plainText(pattern.name, PATTERN_NAME_MAX), bars: Math.round(num(pattern.bars, 1, 1, 16)), steps }
    if (Number.isFinite(pattern.len)) next.len = Math.max(1, Math.min(256, pattern.len | 0))
    out.push(next)
  }
  return out
}

export function packSong(doc) {
  const name = plainText(doc.name, 80).replace(/\.m1ya$/i, '').slice(0, 48) || 'Song'
  const packed = {
    type: 'm1ya',
    v: 2,
    name,
    bpm: Math.round(num(doc.bpm, 184, 40, 240)),
    swing: num(doc.swing, 0, 0, 0.6),
    order: (Array.isArray(doc.order) && doc.order.length ? doc.order : [0]).slice(0, 256).map((n) => n & 255),
    patterns: normalizePatterns(doc.patterns),
    pads: clonePads(doc.pads),
    samples: packSamples(doc.samples),
  }
  if (Array.isArray(doc.buses)) packed.buses = normalizeBuses(doc.buses)
  if (typeof doc.master === 'number' && Number.isFinite(doc.master)) packed.master = Math.max(0, Math.min(1, doc.master))
  if (Array.isArray(doc.numpadFx)) packed.numpadFx = normalizeNumpadFx(doc.numpadFx)
  if (doc.comp && typeof doc.comp === 'object') packed.comp = normalizeComp(doc.comp)
  return packed
}

export function packKit(doc) {
  const name = plainText(doc.name, 80).replace(/\.k1t$/i, '').slice(0, 48) || 'Kit'
  return {
    type: 'k1t',
    v: 1,
    name,
    pads: clonePads(doc.pads),
    samples: packSamples(doc.samples),
  }
}

function moduleToDoc(parsed) {
  const pads = Array.from({ length: 64 }, (_, i) => emptyPad(i))
  const samples = []
  for (const inst of parsed.instruments) {
    if (!inst.pcm || inst.index > 63) continue
    const pad = pads[inst.index]
    pad.name = plainText(inst.name, 80) || `Sample ${inst.index + 1}`
    pad.source = 'sample'
    pad.sampleName = pad.name
    pad.volume = inst.volume ?? 0.85
    pad.fine = inst.fine || 0
    pad.pitch = inst.pitch || 0
    pad.mode = inst.loop ? 'loop' : 'oneshot'
    if (inst.loop) {
      pad.trimStart = inst.loop.a
      pad.trimEnd = inst.loop.b
      pad.loopPoint = inst.loop.a
    }
    fitLoop(pad)
    samples.push({ pad: inst.index, name: pad.name, sr: inst.sr || 8363, pcm: inst.pcm })
  }
  return {
    type: 'm1ya',
    v: 1,
    name: plainText(parsed.title, 80) || 'Module',
    bpm: parsed.bpm || 125,
    swing: 0,
    order: parsed.order?.length ? parsed.order : [0],
    patterns: parsed.patterns || [],
    pads,
    samples,
  }
}

export function sliceSetForFolder(folderId) {
  return (ensureLibrary().sliceSets || []).find((set) => set.folder === folderId) || null
}

export function sliceMarkers(set) {
  if (!set?.cuts?.length) return []
  return set.cuts.map((cut, index) => ({
    at: cut.a,
    index,
    lock: index === 0 || cut.a <= 0.004,
  }))
}

export function openSliceSet(set) {
  if (!set) return
  model.sliceView = set.id
  model.screen = 'edit'
  touch(false)
}

export async function loadSliceSource(setId) {
  return idbGet(`src:${setId}`)
}

export async function moveSliceMarker(setId, cutIndex, fraction, done) {
  const set = (ensureLibrary().sliceSets || []).find((item) => item.id === setId)
  const cut = set?.cuts?.[cutIndex]
  if (!cut || cutIndex === 0) return
  const old = cut.a
  const next = Math.min(cut.b - 0.004, Math.max(0.004, fraction))
  for (const other of set.cuts) {
    if (other === cut) continue
    if (Math.abs(other.b - old) < 0.0015) other.b = next
    if (Math.abs(other.a - old) < 0.0015) other.a = next
  }
  cut.a = next
  touch(false)
  if (done) await rewriteSlice(set)
}

function rewriteSlice(set) {
  return exclusive(() => rewriteSliceNow(set))
}

async function rewriteSliceNow(set) {
  beginUndo()
  try {
    const src = await idbGet(`src:${set.id}`)
    if (!src?.pcm) throw new Error('The original sample for this folder is missing')
    const pcm = src.pcm
    const n = pcm.length
    for (const cut of set.cuts) {
      const a = Math.max(0, Math.min(n - 2, Math.floor(cut.a * n)))
      const b = Math.max(a + 1, Math.min(n, Math.floor(cut.b * n)))
      const piece = new Float32Array(pcm.subarray(a, b))
      const prev = await idbGet(`lib:${cut.fileId}`)
      stashUndo(`lib:${cut.fileId}`, prev || null)
      await idbSet(`lib:${cut.fileId}`, { pcm: piece, sr: src.sr, name: prev?.name || set.name })
      if (cut.pad == null || !model.pads[cut.pad]) continue
      const prevPad = await idbGet(`pad:${cut.pad}`)
      stashUndo(`pad:${cut.pad}`, prevPad || null)
      const pad = model.pads[cut.pad]
      pad.trimStart = 0
      pad.trimEnd = 1
      pad.mode = 'oneshot'
      pad.source = 'sample'
      fitLoop(pad)
      audioBank.set(cut.pad, { pcm: piece, sr: src.sr, rev: Date.now() })
      await idbSet(`pad:${cut.pad}`, { pcm: piece, sr: src.sr, name: pad.name })
    }
    model.browserNote = `${set.name} slices updated`
    touch(true)
  } finally {
    endUndo()
  }
}

export async function storeSongFile(name, doc, { quiet = false, folder = 'songs' } = {}) {
  const library = ensureLibrary()
  const packed = packSong({ ...doc, name: name || doc.name })
  const id = `g${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  const where = folder === 'templates' ? 'templates' : 'songs'
  // Storage first: a failed write must not leave a library entry that points at nothing.
  await idbSet(`song:${id}`, packed)
  stashUndo(`song:${id}`, null)
  library.files.push({ id, folder: where, name: packed.name, ext: 'm1ya' })
  const who = (model.wallet || '').trim().toLowerCase()
  if (/^0x[a-f0-9]{40}$/.test(who)) {
    const key = `profile:${who}:${id}`
    await idbSet(key, packed)
    stashUndo(key, null)
  }
  if (!quiet) touch(true)
  // The song is in IndexedDB, but the Songs list lives in the session save. If that write fails, the
  // song is not really kept: `persisted` says so, and the caller must not say "saved".
  return { id, doc: packed, persisted: saveNow() }
}

export async function replaceSongFile(id, name, doc) {
  const library = ensureLibrary()
  const file = library.files.find((item) => item.id === id && item.ext === 'm1ya')
  if (!file) return storeSongFile(name, doc)
  const packed = packSong({ ...doc, name: name || file.name })
  const prev = await idbGet(`song:${id}`)
  await idbSet(`song:${id}`, packed)
  stashUndo(`song:${id}`, prev || null)
  file.name = packed.name
  const who = (model.wallet || '').trim().toLowerCase()
  if (/^0x[a-f0-9]{40}$/.test(who)) await idbSet(`profile:${who}:${id}`, packed)
  touch(true)
  return { id, doc: packed, persisted: saveNow() }
}

export async function storeKitFile(name, doc, { quiet = false } = {}) {
  const library = ensureLibrary()
  const packed = packKit({ ...doc, name: name || doc.name })
  const id = `k${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  await idbSet(`kit:${id}`, packed)
  stashUndo(`kit:${id}`, null)
  library.files.push({ id, folder: 'kits', name: packed.name, ext: 'k1t' })
  if (!quiet) touch(true)
  return { id, doc: packed, persisted: saveNow() }
}

function songHasKit(doc) {
  return (Array.isArray(doc?.pads) && doc.pads.length > 0) || (Array.isArray(doc?.samples) && doc.samples.length > 0)
}

export async function ensureBlankSong() {
  const library = ensureLibrary()
  const songs = library.files.filter((file) => file.folder === 'songs' && file.ext === 'm1ya')
  if (!songs.length) {
    await storeSongFile('Blank', blankSong(), { quiet: true })
    return
  }
  for (const file of songs) {
    if (file.name !== 'Blank') continue
    const doc = await idbGet(`song:${file.id}`)
    if (!doc || songHasKit(doc)) continue
    await idbSet(`song:${file.id}`, packSong(blankSong()))
  }
}

/** The pads' samples as they are now. Refuses while any sample pad is unread: it would drop out of the file. */
function liveSamples(what = 'Save') {
  assertPadsRead(what)
  const samples = []
  for (let i = 0; i < 64; i++) {
    const pad = model.pads[i]
    if (pad.source !== 'sample') continue
    const entry = audioBank.get(i)
    if (!entry?.pcm) continue
    samples.push({ pad: i, name: pad.sampleName || pad.name, sr: entry.sr || 44100, pcm: entry.pcm })
  }
  return samples
}

/** The session as a packed song. `what` names the action in the refusal when a pad is unread. */
export async function captureSong(name, what = 'Save') {
  assertPadsRead(what)
  const order = Array.isArray(model.songOrder) && model.songOrder.length
    ? model.songOrder.slice()
    : usedPatternIds()
  const doc = packSong({
    name: name || model.songName || 'Song',
    bpm: model.bpm,
    swing: model.swing,
    order,
    patterns: model.patterns
      .map((pattern, i) => (pattern ? { i, name: pattern.name || '', bars: pattern.bars, len: pattern.len, steps: pattern.steps } : null))
      .filter((pattern) => pattern && (pattern.name || (pattern.len ?? pattern.bars * 16) !== 16 || pattern.steps.some((cell) => cell?.some(Boolean)))),
    pads: model.pads.map((pad) => ({ ...pad })),
    samples: liveSamples(what),
    master: model.master,
    buses: model.buses,
    numpadFx: model.numpadFx,
    comp: model.comp,
  })
  if (!doc.patterns.length) {
    doc.patterns = [{ i: model.pattern || 0, name: '', bars: 1, steps: [] }]
    doc.order = [model.pattern || 0]
  }
  return doc
}

function usedPatternIds() {
  const ids = []
  for (let i = 0; i < 256; i++) {
    const pattern = model.patterns[i]
    if (!pattern) continue
    const used = pattern.name || (pattern.len ?? pattern.bars * 16) !== 16 || pattern.steps.some((cell) => cell?.some(Boolean))
    if (used) ids.push(i)
  }
  if (!ids.length) ids.push(model.pattern || 0)
  return ids
}

export async function captureKit(name, what = 'Save') {
  return packKit({
    name: name || 'Kit',
    pads: model.pads.map((pad) => ({ ...pad })),
    samples: liveSamples(what),
  })
}

/** Some browsers start the download after click() returns, so the URL must outlive it. */
function revokeLater(href) {
  setTimeout(() => URL.revokeObjectURL(href), 30000)
}

export function downloadSong(doc) {
  const packed = doc.samples?.[0]?.pcm instanceof Float32Array ? packSong(doc) : doc
  const blob = new Blob([JSON.stringify(packed)], { type: 'application/octet-stream' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${packed.name || 'Song'}.m1ya`
  link.click()
  revokeLater(link.href)
}

export function downloadKit(doc) {
  const packed = doc.samples?.[0]?.pcm instanceof Float32Array ? packKit(doc) : doc
  const blob = new Blob([JSON.stringify(packed)], { type: 'application/octet-stream' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${packed.name || 'Kit'}.k1t`
  link.click()
  revokeLater(link.href)
}

/** normalizePad alone: a file's patch goes through normalizePatch like every other field. */
function clonePad(index, src) {
  const pad = normalizePad(src, index)
  fitLoop(pad)
  return pad
}

/**
 * Every sample in a kit or song, decoded and checked before anything is replaced.
 * Throws on the first damaged one, so a bad file leaves the current kit as it was.
 */
export function decodeKitSamples(samples) {
  const out = new Map()
  if (samples != null && !Array.isArray(samples)) throw new Error('That kit’s sample list is damaged')
  let total = 0
  for (const sample of samples || []) {
    if (!sample || typeof sample !== 'object') throw new Error('That song sample is damaged')
    const index = Number(sample.pad)
    if (!Number.isInteger(index) || index < 0 || index > 63) continue
    // The same total a save allows, counted before each decode.
    const pcm = sample.pcm instanceof Float32Array ? sample.pcm : b64ToPcm(sample.pcm, PACK_SAMPLES - total)
    total += pcm?.length || 0
    if (total > PACK_SAMPLES) throw samplesTooLong()
    if (!(pcm instanceof Float32Array) || !pcm.length) throw new Error('That song sample is damaged')
    for (let i = 0; i < pcm.length; i++) {
      if (!Number.isFinite(pcm[i])) pcm[i] = 0
    }
    const name = plainText(sample.name, 80)
    out.set(index, { pcm, sr: Math.round(num(sample.sr, 44100, 3000, 192000)), name })
  }
  return out
}

/**
 * Replace all 64 pads. Only call from inside an exclusive job. `stillWanted` is checked after the slow
 * reads and before anything is replaced: a superseded load returns false and changes nothing.
 */
async function applyKit(doc, stillWanted = () => true) {
  // Everything is checked and built before the first pad record is touched: samples decoded, pads normalized,
  // synth pads rendered. A damaged kit throws here and leaves the current kit and its storage as they were.
  if (doc.pads != null && !Array.isArray(doc.pads)) throw new Error('That kit’s pad list is damaged')
  const decoded = decodeKitSamples(doc.samples)
  const pads = Array.from({ length: 64 }, (_, i) => clonePad(i, Array.isArray(doc.pads) ? doc.pads[i] : null))
  const rendered = new Map()
  pads.forEach((pad, i) => {
    if (decoded.has(i) || pad.source !== 'synth' || !pad.patch) return
    try {
      const out = renderSynth(pad.patch)
      rendered.set(i, { pcm: out.pcm, sr: out.sampleRate })
    } catch (err) {
      throw new Error(`That kit’s synth pad ${i + 1} is damaged${err?.message ? ` (${err.message})` : ''}`)
    }
  })
  const prevs = []
  for (let i = 0; i < 64; i++) {
    prevs.push(await idbGet(`pad:${i}`))
    if (!stillWanted()) return false
  }
  prevs.forEach((prev, i) => stashUndo(`pad:${i}`, prev || null))
  for (let i = 0; i < 64; i++) {
    model.pads[i] = pads[i]
    audioBank.delete(i)
  }
  for (const [index, sample] of decoded) {
    const pad = model.pads[index]
    pad.source = 'sample'
    pad.patch = null
    pad.sampleName = sample.name || pad.name
    if (!pad.name || pad.name === 'Empty') pad.name = sample.name || 'sample'
    audioBank.set(index, { pcm: sample.pcm, sr: sample.sr, rev: Date.now() })
  }
  for (let i = 0; i < 64; i++) {
    const sample = decoded.get(i)
    if (sample) await idbSet(`pad:${i}`, { pcm: sample.pcm, sr: sample.sr, name: model.pads[i].sampleName })
    else await idbDelete(`pad:${i}`)
  }
  model.pads.forEach((pad, i) => {
    const synth = rendered.get(i)
    if (pad.source === 'synth' && synth) audioBank.set(i, { pcm: synth.pcm, sr: synth.sr, rev: Date.now() })
    if (pad.source !== 'sample') return
    if (!audioBank.get(i)) {
      pad.source = 'empty'
      pad.name = 'Empty'
      pad.patch = null
    }
  })
  return true
}

async function pushMix() {
  const { syncMixer, syncMasterComp, pushNumpadFx } = await import('./engine.js')
  syncMixer(true)
  syncMasterComp()
  pushNumpadFx()
}

function applySongMix(doc) {
  let changed = false
  if (Array.isArray(doc.buses)) {
    model.buses = normalizeBuses(doc.buses)
    changed = true
  }
  if (typeof doc.master === 'number' && Number.isFinite(doc.master)) {
    model.master = Math.max(0, Math.min(1, doc.master))
    changed = true
  }
  if (Array.isArray(doc.numpadFx)) {
    model.numpadFx = normalizeNumpadFx(doc.numpadFx)
    changed = true
  }
  if (doc.comp && typeof doc.comp === 'object') {
    model.comp = normalizeComp(doc.comp)
    changed = true
  }
  return changed
}

export function clearKit() {
  return exclusive(clearKitNow)
}

async function clearKitNow() {
  beginUndo()
  try {
    for (let i = 0; i < 64; i++) {
      const prev = await idbGet(`pad:${i}`)
      stashUndo(`pad:${i}`, prev || null)
      model.pads[i] = emptyPad(i)
      audioBank.delete(i)
      await idbDelete(`pad:${i}`)
    }
    model.browserNote = 'Empty kit'
    touch(true)
  } finally {
    endUndo()
  }
}

/** Kit loads run one at a time with song loads and undo, so two never mix their pads. */
export function loadKit(doc) {
  return exclusive(() => loadKitNow(doc))
}

async function loadKitNow(doc) {
  if (!doc || doc.type !== 'k1t') throw new Error('That file is not a .k1t kit')
  beginUndo()
  try {
    await applyKit(doc)
    model.kitName = plainText(doc.name, 48) || 'Kit'
    model.browserNote = `${model.kitName} loaded`
    touch(true)
  } finally {
    endUndo()
  }
}

/**
 * Open a song. Loads run one at a time (with kit loads and undo). The ticket is taken when the user asks,
 * so pass the one taken before any slow read of the file: a newer load supersedes this one, and a
 * superseded load resolves false without touching the session or storage.
 */
export function loadSong(doc, fileId = '', ticket = loadTicket()) {
  return exclusive(() => loadSongNow(doc, fileId, ticket))
}

async function loadSongNow(doc, fileId, ticket) {
  if (!doc || doc.type !== 'm1ya') throw new Error('That file is not an .m1ya song')
  const wanted = () => loadCurrent(ticket)
  if (!wanted()) return false
  beginUndo()
  try {
    if (songHasKit(doc) && !(await applyKit(doc, wanted))) return false
    bumpSong()
    songSwitch()
    const mix = applySongMix(doc)
    model.patterns = Array.from({ length: 256 }, () => null)
    for (const pattern of normalizePatterns(doc.patterns)) {
      model.patterns[pattern.i] = {
        name: pattern.name,
        bars: pattern.bars,
        len: Number.isFinite(pattern.len) ? pattern.len : undefined,
        steps: Array.isArray(pattern.steps) ? pattern.steps : [],
      }
      ensurePattern(pattern.i)
    }
    const order = (Array.isArray(doc.order) && doc.order.length ? doc.order : [0]).slice(0, 256).map((n) => n & 255)
    model.songOrder = order
    model.songCursor = 0
    model.songLoop = 'wrap'
    model.launchCursor = null
    model.songPlay = true
    model.songName = plainText(doc.name, 80) || 'Song'
    model.songFile = fileId || ''
    model.pattern = order[0] || 0
    ensurePattern(model.pattern)
    model.bpm = Math.round(num(doc.bpm, 184, 40, 240))
    model.swing = num(doc.swing, 0, 0, 0.6)
    model.browserNote = `${model.songName} ready at ${model.bpm} bpm`
    touch(true)
    if (mix) await pushMix()
  } finally {
    endUndo()
  }
  return true
}

/** Store a song file in Songs and open it. Take `ticket` before reading the bytes. */
export async function importSongBytes(buffer, name = 'Song', ticket = loadTicket()) {
  const bytes = new Uint8Array(buffer)
  const head = String.fromCharCode(...bytes.subarray(0, 17))
  let doc
  if (head === 'Extended Module:') doc = moduleToDoc(parseXm(buffer))
  else if (bytes.length >= 1084 && magicMod(bytes)) doc = moduleToDoc(parseMod(buffer))
  else {
    if (bytes.length > PACK_BYTES) throw new TooLarge(PACK_BYTES)
    let json
    try {
      json = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      throw new Error('That file is not an .m1ya, .mod, or .xm song')
    }
    if (json?.type !== 'm1ya') throw new Error('That file is not an .m1ya song')
    doc = json
  }
  checkSongSamples(doc)
  if (name && (!doc.name || doc.name === 'Module')) doc.name = plainText(name, 80).replace(/\.(m1ya|mod|xm)$/i, '')
  beginUndo()
  try {
    const stored = await storeSongFile(doc.name, doc)
    // A newer load won: the file stays in Songs, the session stays on the newer song.
    if (!(await loadSong(stored.doc, stored.id, ticket))) model.browserNote = stored.persisted ? `${stored.doc.name}.m1ya saved in Songs` : `${stored.doc.name}.m1ya not saved: browser storage refused the Songs list`
    return stored.doc
  } finally {
    endUndo()
  }
}

/** Refuses up front, with the length, a song or module whose samples are more than a saved song holds. */
export function checkSongSamples(doc) {
  if (!Array.isArray(doc?.samples)) return
  const total = doc.samples.reduce((sum, sample) => sum + sampleLength(sample), 0)
  if (total <= PACK_SAMPLES) return
  const seconds = Math.ceil(total / 44100)
  throw new Error(`That song’s samples run about ${seconds} s; a song here holds ${PACK_SECONDS} s of samples in all. It was not imported.`)
}

function magicMod(bytes) {
  const magic = String.fromCharCode(bytes[1080], bytes[1081], bytes[1082], bytes[1083])
  return ['M.K.', 'M!K!', 'FLT4', '4CHN', '6CHN', '8CHN', 'FLT8', '10CH', '12CH', '14CH', '16CH'].includes(magic)
}

export async function openPackedUrl(job) {
  if (!job?.href) return
  const ticket = job.kind === 'kit' ? 0 : loadTicket()
  const { res, buffer } = await fetchCapped(job.href, { limit: PACK_BYTES, timeoutMs: FETCH_MS })
  if (!buffer) throw new Error(`Could not download that file (${res.status})`)
  if (job.kind === 'kit') {
    let json
    try {
      json = JSON.parse(new TextDecoder().decode(buffer))
    } catch {
      throw new Error('That file is not a .k1t kit')
    }
    if (!json || json.type !== 'k1t') throw new Error('That file is not a .k1t kit')
    const name = (plainText(job.name, 80) || plainText(json.name, 80) || 'Kit').replace(/\.k1t$/i, '')
    checkSongSamples(json)
    beginUndo()
    try {
      const stored = await storeKitFile(name, json)
      await loadKit(stored.doc)
    } finally {
      endUndo()
    }
    return
  }
  await importSongBytes(buffer, plainText(job.name, 80) || 'Song', ticket)
}

export async function importSongFile(file, ticket = loadTicket()) {
  if (file.size > PACK_BYTES) throw new TooLarge(PACK_BYTES)
  const buffer = await file.arrayBuffer()
  await importSongBytes(buffer, file.name.replace(/\.(m1ya|mod|xm)$/i, ''), ticket)
}

export async function importKitFile(file) {
  if (file.size > PACK_BYTES) throw new TooLarge(PACK_BYTES)
  let json
  try {
    json = JSON.parse(new TextDecoder().decode(await file.arrayBuffer()))
  } catch {
    throw new Error('That file is not a .k1t kit')
  }
  if (!json || json.type !== 'k1t') throw new Error('That file is not a .k1t kit')
  const name = (plainText(file.name, 80) || plainText(json.name, 80) || 'Kit').replace(/\.k1t$/i, '')
  checkSongSamples(json)
  beginUndo()
  try {
    const stored = await storeKitFile(name, json)
    model.browserNote = stored.persisted ? `${stored.doc.name}.k1t saved in Kits` : `${stored.doc.name}.k1t not saved: browser storage refused the Kits list`
    touch(true)
  } finally {
    endUndo()
  }
}

export function gatewayUrl(raw) {
  const text = String(raw || '').trim()
  if (text.startsWith('ipfs://')) {
    const rest = text.slice('ipfs://'.length).replace(/^ipfs\//, '')
    return `https://ipfs.io/ipfs/${rest}`
  }
  return text
}

export async function importSongUrl(raw) {
  const url = gatewayUrl(raw)
  if (!allowedMediaUrl(url)) throw new Error('Use an ipfs:// URI or an allowed IPFS gateway link')
  const ticket = loadTicket()
  const { res, buffer } = await fetchCapped(url, { limit: PACK_BYTES, timeoutMs: FETCH_MS })
  if (!buffer) throw new Error(res.status === 429 ? 'The gateway says too many requests: wait a moment and try again' : 'The gateway did not return that song')
  const tail = url.split('/').pop() || 'Song'
  let leaf = tail
  try {
    leaf = decodeURIComponent(tail)
  } catch {
    /* a stray % in the link: the name stays as typed */
  }
  leaf = plainText(leaf, 80) || 'Song'
  await importSongBytes(buffer, leaf, ticket)
  if (!loadCurrent(ticket)) return
  model.browserNote = `${model.songName} loaded from the gateway`
  touch(false)
}

/**
 * Songs this browser kept under the wallet, back in Songs when the list lost them (a reset library).
 * Each one keeps its own id, and nothing is written under the wallet again: a song deleted from Songs has
 * its wallet copy deleted too (removeCached), so it does not come back.
 */
export async function syncProfileSongs(address) {
  const who = String(address || '').trim().toLowerCase()
  if (!/^0x[a-f0-9]{40}$/.test(who)) return 0
  const { idbKeys } = await import('../model.js')
  const keys = await idbKeys()
  const prefix = `profile:${who}:`
  let added = 0
  const library = ensureLibrary()
  for (const key of keys) {
    if (typeof key !== 'string' || !key.startsWith(prefix)) continue
    const id = key.slice(prefix.length)
    if (!/^[a-z0-9]{1,40}$/i.test(id)) continue
    if (library.files.some((file) => file.id === id)) continue
    const doc = await idbGet(key)
    if (!doc || doc.type !== 'm1ya') continue
    if (!(await idbGet(`song:${id}`))) await idbSet(`song:${id}`, doc)
    library.files.push({ id, folder: 'songs', name: plainText(doc.name, 48) || 'Song', ext: 'm1ya' })
    added += 1
  }
  if (added) touch(true)
  return added
}

export async function duplicateFiles(ids) {
  const { cachePcm, loadCached } = await import('../media/library.js')
  beginUndo()
  try {
    for (const id of ids) {
      const file = ensureLibrary().files.find((item) => item.id === id)
      if (!file) continue
      if (file.ext === 'm1ya') {
        const doc = await idbGet(`song:${id}`)
        if (doc) await storeSongFile(`${file.name} copy`, doc)
        continue
      }
      if (file.ext === 'k1t') {
        const doc = await idbGet(`kit:${id}`)
        if (doc) await storeKitFile(`${file.name} copy`, doc)
        continue
      }
      const rec = await loadCached(id)
      if (!rec?.pcm) continue
      await cachePcm(file.folder, `${file.name} copy`, rec.pcm, rec.sr, file.ext || 'wav')
    }
    model.browserNote = ids.length > 1 ? `${ids.length} copies` : 'Copied'
    touch(true)
  } finally {
    endUndo()
  }
}

export async function deleteFiles(ids) {
  const { removeCached } = await import('../media/library.js')
  beginUndo()
  try {
    for (const id of ids) await removeCached(id)
    model.browserNote = ids.length > 1 ? `${ids.length} removed` : 'Removed'
    touch(false)
  } finally {
    endUndo()
  }
}
