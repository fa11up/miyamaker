import { parseMod, parseXm } from './module.js'
import { defaultNumpadFx, normalizeNumpadFx } from './numpadFx.js'
import { FACTORY, KIT_LAYOUT } from './presets.js'
import { beginUndo, endUndo, stashUndo } from '../history.js'
import { ensureLibrary } from '../media/library.js'
import { allowedMediaUrl } from '../media/allow.js'
import {
  audioBank,
  defaultComp,
  emptyPad,
  ensurePattern,
  normalizePad,
  fitLoop,
  idbDelete,
  idbGet,
  idbSet,
  model,
  normalizeBuses,
  normalizeComp,
  renderPad,
  touch,
} from '../model.js'

const PACK_SAMPLES = 2_000_000

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

function b64ToPcm(text) {
  const bin = atob(text)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 255
  if (bytes.byteLength % 4) throw new Error('That song sample is damaged')
  return new Float32Array(bytes.buffer.slice(0))
}

function packSamples(samples) {
  let total = 0
  return (samples || []).map((sample) => {
    if (!(sample.pcm instanceof Float32Array)) return sample
    total += sample.pcm.length
    if (total > PACK_SAMPLES) throw new Error('That song’s samples are too long to pack')
    return { ...sample, pcm: pcmToB64(sample.pcm) }
  })
}

function clonePads(pads) {
  return JSON.parse(JSON.stringify(pads || []))
}

export function packSong(doc) {
  const name = String(doc.name || 'Song').replace(/\.m1ya$/i, '').slice(0, 48) || 'Song'
  const packed = {
    type: 'm1ya',
    v: 2,
    name,
    bpm: Math.max(40, Math.min(240, Math.round(doc.bpm || 184))),
    swing: doc.swing || 0,
    order: (doc.order || [0]).map((n) => n & 255).slice(0, 256),
    patterns: doc.patterns || [],
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
  const name = String(doc.name || 'Kit').replace(/\.k1t$/i, '').slice(0, 48) || 'Kit'
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
    pad.name = inst.name || `Sample ${inst.index + 1}`
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
    name: parsed.title || 'Module',
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

async function rewriteSlice(set) {
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
  stashUndo(`song:${id}`, null)
  library.files.push({ id, folder: where, name: packed.name, ext: 'm1ya' })
  await idbSet(`song:${id}`, packed)
  const who = (model.wallet || '').trim().toLowerCase()
  if (/^0x[a-f0-9]{40}$/.test(who)) {
    const key = `profile:${who}:${id}`
    stashUndo(key, null)
    await idbSet(key, packed)
  }
  if (!quiet) touch(true)
  return { id, doc: packed }
}

export async function replaceSongFile(id, name, doc) {
  const library = ensureLibrary()
  const file = library.files.find((item) => item.id === id && item.ext === 'm1ya')
  if (!file) return storeSongFile(name, doc)
  const packed = packSong({ ...doc, name: name || file.name })
  const prev = await idbGet(`song:${id}`)
  stashUndo(`song:${id}`, prev || null)
  file.name = packed.name
  await idbSet(`song:${id}`, packed)
  const who = (model.wallet || '').trim().toLowerCase()
  if (/^0x[a-f0-9]{40}$/.test(who)) await idbSet(`profile:${who}:${id}`, packed)
  touch(true)
  return { id, doc: packed }
}

export async function storeKitFile(name, doc, { quiet = false } = {}) {
  const library = ensureLibrary()
  const packed = packKit({ ...doc, name: name || doc.name })
  const id = `k${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  stashUndo(`kit:${id}`, null)
  library.files.push({ id, folder: 'kits', name: packed.name, ext: 'k1t' })
  await idbSet(`kit:${id}`, packed)
  if (!quiet) touch(true)
  return { id, doc: packed }
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

function liveSamples() {
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

export async function captureSong(name) {
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
    samples: liveSamples(),
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

export async function captureKit(name) {
  return packKit({
    name: name || 'Kit',
    pads: model.pads.map((pad) => ({ ...pad })),
    samples: liveSamples(),
  })
}

export function downloadSong(doc) {
  const packed = doc.samples?.[0]?.pcm instanceof Float32Array ? packSong(doc) : doc
  const blob = new Blob([JSON.stringify(packed)], { type: 'application/octet-stream' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${packed.name || 'Song'}.m1ya`
  link.click()
  URL.revokeObjectURL(link.href)
}

export function downloadKit(doc) {
  const packed = doc.samples?.[0]?.pcm instanceof Float32Array ? packKit(doc) : doc
  const blob = new Blob([JSON.stringify(packed)], { type: 'application/octet-stream' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${packed.name || 'Kit'}.k1t`
  link.click()
  URL.revokeObjectURL(link.href)
}

function clonePad(index, src) {
  const pad = normalizePad(src, index)
  if (src?.patch) pad.patch = JSON.parse(JSON.stringify(src.patch))
  fitLoop(pad)
  return pad
}

async function applyKit(doc) {
  for (let i = 0; i < 64; i++) {
    const prev = await idbGet(`pad:${i}`)
    stashUndo(`pad:${i}`, prev || null)
  }
  for (let i = 0; i < 64; i++) {
    model.pads[i] = clonePad(i, doc.pads?.[i])
    audioBank.delete(i)
    await idbDelete(`pad:${i}`)
  }
  for (const sample of doc.samples || []) {
    const pcm = sample.pcm instanceof Float32Array ? sample.pcm : b64ToPcm(sample.pcm)
    const index = sample.pad | 0
    if (index < 0 || index > 63 || !(pcm instanceof Float32Array)) continue
    const pad = model.pads[index]
    pad.source = 'sample'
    pad.patch = null
    pad.sampleName = sample.name || pad.name
    if (!pad.name || pad.name === 'Empty') pad.name = sample.name || 'sample'
    audioBank.set(index, { pcm, sr: sample.sr || 44100, rev: Date.now() })
    await idbSet(`pad:${index}`, { pcm, sr: sample.sr || 44100, name: pad.sampleName })
  }
  model.pads.forEach((pad, i) => {
    if (pad.source === 'synth' && pad.patch) renderPad(i)
    if (pad.source !== 'sample') return
    if (!audioBank.get(i)) {
      pad.source = 'empty'
      pad.name = 'Empty'
      pad.patch = null
    }
  })
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

export async function clearKit() {
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

export async function loadKit(doc) {
  if (!doc || doc.type !== 'k1t') throw new Error('That file is not a .k1t kit')
  beginUndo()
  try {
    await applyKit(doc)
    model.browserNote = `${doc.name || 'Kit'} loaded`
    touch(true)
  } finally {
    endUndo()
  }
}

export async function loadSong(doc, fileId = '') {
  if (!doc || doc.type !== 'm1ya') throw new Error('That file is not an .m1ya song')
  beginUndo()
  try {
    if (songHasKit(doc)) await applyKit(doc)
    const mix = applySongMix(doc)
    model.patterns = Array.from({ length: 256 }, () => null)
    for (const pattern of doc.patterns || []) {
      if (!pattern || pattern.i < 0 || pattern.i > 255) continue
      model.patterns[pattern.i] = { name: pattern.name || '', bars: pattern.bars || 1, len: pattern.len, steps: pattern.steps || [] }
      ensurePattern(pattern.i)
    }
    const order = (doc.order || [0]).map((n) => n & 255)
    model.songOrder = order
    model.songCursor = 0
    model.songPlay = true
    model.songName = doc.name || 'Song'
    model.songFile = fileId || ''
    model.pattern = order[0] || 0
    ensurePattern(model.pattern)
    model.bpm = Math.max(40, Math.min(240, Math.round(doc.bpm || 184)))
    model.swing = doc.swing || 0
    model.browserNote = `${model.songName} ready at ${model.bpm} bpm`
    touch(true)
    if (mix) await pushMix()
  } finally {
    endUndo()
  }
}

export async function importSongBytes(buffer, name = 'Song') {
  const bytes = new Uint8Array(buffer)
  const head = String.fromCharCode(...bytes.subarray(0, 17))
  let doc
  if (head === 'Extended Module:') doc = moduleToDoc(parseXm(buffer))
  else if (bytes.length >= 1084 && magicMod(bytes)) doc = moduleToDoc(parseMod(buffer))
  else {
    let json
    try {
      json = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      throw new Error('That file is not an .m1ya, .mod, or .xm song')
    }
    if (json?.type !== 'm1ya') throw new Error('That file is not an .m1ya song')
    doc = json
  }
  if (name && (!doc.name || doc.name === 'Module')) doc.name = name.replace(/\.(m1ya|mod|xm)$/i, '')
  beginUndo()
  try {
    const stored = await storeSongFile(doc.name, doc)
    await loadSong(stored.doc, stored.id)
    return stored.doc
  } finally {
    endUndo()
  }
}

function magicMod(bytes) {
  const magic = String.fromCharCode(bytes[1080], bytes[1081], bytes[1082], bytes[1083])
  return ['M.K.', 'M!K!', 'FLT4', '4CHN', '6CHN', '8CHN', 'FLT8', '10CH', '12CH', '14CH', '16CH'].includes(magic)
}

export async function openPackedUrl(job) {
  if (!job?.href) return
  const res = await fetch(job.href)
  if (!res.ok) throw new Error('Could not download that file')
  const buffer = await res.arrayBuffer()
  if (job.kind === 'kit') {
    let json
    try {
      json = JSON.parse(new TextDecoder().decode(buffer))
    } catch {
      throw new Error('That file is not a .k1t kit')
    }
    if (!json || json.type !== 'k1t') throw new Error('That file is not a .k1t kit')
    const name = String(job.name || json.name || 'Kit').replace(/\.k1t$/i, '')
    beginUndo()
    try {
      const stored = await storeKitFile(name, json)
      await loadKit(stored.doc)
    } finally {
      endUndo()
    }
    return
  }
  await importSongBytes(buffer, job.name || 'Song')
}

export async function importSongFile(file) {
  const buffer = await file.arrayBuffer()
  await importSongBytes(buffer, file.name.replace(/\.(m1ya|mod|xm)$/i, ''))
}

export async function importKitFile(file) {
  let json
  try {
    json = JSON.parse(new TextDecoder().decode(await file.arrayBuffer()))
  } catch {
    throw new Error('That file is not a .k1t kit')
  }
  if (!json || json.type !== 'k1t') throw new Error('That file is not a .k1t kit')
  const name = String(file.name || json.name || 'Kit').replace(/\.k1t$/i, '')
  beginUndo()
  try {
    const stored = await storeKitFile(name, json)
    model.browserNote = `${stored.doc.name}.k1t saved in Kits`
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
  const res = await fetch(url)
  if (!res.ok) throw new Error('The gateway did not return that song')
  const buffer = await res.arrayBuffer()
  const leaf = decodeURIComponent(url.split('/').pop() || 'Song')
  await importSongBytes(buffer, leaf)
  model.browserNote = `${model.songName} loaded from the gateway`
  touch(false)
}

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
    const doc = await idbGet(key)
    if (!doc || doc.type !== 'm1ya') continue
    const exists = library.files.some((file) => file.folder === 'songs' && file.name === doc.name && file.ext === 'm1ya')
    if (exists) continue
    await storeSongFile(doc.name, doc, { quiet: true })
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
