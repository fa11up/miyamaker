import {
  audioBank,
  compactPatterns,
  ensurePattern,
  model,
  renderPad,
  restorePatterns,
  setPersistHook,
  touch,
  idbDelete,
  idbSet,
} from './model.js'

const stack = []
const CAP = 30
let baseline = null
let pendingBlobs = []
let armed = false
let restoring = false
let depth = 0
let dirty = false
let lastCommitAt = 0

function takeSnapshot() {
  return JSON.parse(JSON.stringify({
    bpm: model.bpm,
    swing: model.swing,
    pattern: model.pattern,
    selected: model.selected,
    bank: model.bank,
    master: model.master,
    settings: model.settings,
    pads: model.pads,
    patterns: compactPatterns(),
    buses: model.buses,
    library: model.library,
    wallet: model.wallet || '',
    numpadFx: model.numpadFx,
    waveView: model.waveView,
    mixPage: model.mixPage,
    comp: model.comp,
    songOrder: model.songOrder,
    songName: model.songName || '',
    songFile: model.songFile || '',
    songPlay: !!model.songPlay,
  }))
}

function applySnapshot(data) {
  model.bpm = data.bpm
  model.swing = data.swing || 0
  model.pattern = data.pattern || 0
  model.selected = data.selected || 0
  model.bank = data.bank || 0
  model.master = data.master
  model.settings = data.settings
  model.pads = data.pads
  model.buses = data.buses
  model.library = data.library
  model.wallet = data.wallet || ''
  model.numpadFx = data.numpadFx
  model.waveView = data.waveView
  model.mixPage = data.mixPage === 1 ? 1 : 0
  model.comp = data.comp
  model.songOrder = data.songOrder || null
  model.songName = data.songName || ''
  model.songFile = data.songFile || ''
  model.songPlay = !!data.songPlay
  restorePatterns(data.patterns)
  ensurePattern(model.pattern || 0)
}

function commit() {
  if (!armed || restoring || !baseline) return
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const glide = !pendingBlobs.length && stack.length && now - lastCommitAt < 450
  if (glide) {
    baseline = takeSnapshot()
    lastCommitAt = now
    return
  }
  stack.push({ json: baseline, blobs: pendingBlobs })
  pendingBlobs = []
  while (stack.length > CAP) stack.shift()
  baseline = takeSnapshot()
  lastCommitAt = now
}

function notePersist() {
  if (!armed || restoring) return
  if (depth > 0) {
    dirty = true
    return
  }
  commit()
}

setPersistHook(notePersist)

/** Hold a previous IndexedDB value so undo can put it back. Null deletes the key. */
export function stashUndo(key, value) {
  if (!armed || restoring) return
  pendingBlobs.push({ key, value })
}

export function beginUndo() {
  depth += 1
}

export function endUndo() {
  depth = Math.max(0, depth - 1)
  if (depth === 0 && dirty) {
    dirty = false
    commit()
  }
}

export function armHistory() {
  pendingBlobs = []
  depth = 0
  dirty = false
  baseline = takeSnapshot()
  armed = true
  lastCommitAt = 0
}

export async function withoutHistory(fn) {
  const was = armed
  armed = false
  try {
    return await fn()
  } finally {
    if (was) baseline = takeSnapshot()
    armed = was
  }
}

export function canUndo() {
  return stack.length > 0
}

export async function undo() {
  const entry = stack.pop()
  if (!entry) return false
  restoring = true
  try {
    applySnapshot(entry.json)
    for (const blob of entry.blobs) {
      if (blob.value == null) {
        await idbDelete(blob.key)
        if (blob.key.startsWith('pad:')) audioBank.delete(Number(blob.key.slice(4)))
      } else {
        await idbSet(blob.key, blob.value)
        if (blob.key.startsWith('pad:') && blob.value.pcm) {
          const index = Number(blob.key.slice(4))
          audioBank.set(index, { pcm: blob.value.pcm, sr: blob.value.sr || 44100, rev: Date.now() })
        }
      }
    }
    model.pads.forEach((pad, i) => {
      if (pad?.source === 'synth' && pad.patch) renderPad(i)
    })
    if (model.sliceView) {
      const sets = model.library?.sliceSets || []
      if (!sets.some((set) => set.id === model.sliceView)) model.sliceView = null
    }
    baseline = takeSnapshot()
    touch(true)
  } finally {
    restoring = false
  }
  return true
}
