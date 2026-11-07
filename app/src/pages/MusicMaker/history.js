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
import { bumpSong, exclusive } from './jobs.js'

const stack = []
const CAP = 30
let baseline = null
let pendingBlobs = []
let armed = false
/** Undos in flight. A counter, so an earlier one's finally cannot clear it while a later one runs. */
let restoring = 0
/** The next commit starts a new song's history: older entries hold another song's samples. */
let switchPending = false
let depth = 0
let dirty = false
let lastCommitAt = 0
let settleTimer = 0
/** A fader drag fires many edits. One snapshot when it settles, not one per move. */
const SETTLE_MS = 180

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
  if (switchPending) {
    // Keep only the step that undoes the switch itself. It holds every pad the switch replaced.
    switchPending = false
    stack.length = 0
    stack.push({ json: baseline, blobs: pendingBlobs })
    pendingBlobs = []
    baseline = takeSnapshot()
    lastCommitAt = now
    return
  }
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

function cancelSettle() {
  if (!settleTimer) return
  clearTimeout(settleTimer)
  settleTimer = 0
}

/** Commit an edit that is still settling. Undo calls this first, so the last move is undoable. */
export function flushHistory() {
  if (!settleTimer) return
  cancelSettle()
  commit()
}

function notePersist() {
  if (!armed || restoring) return
  if (depth > 0) {
    dirty = true
    return
  }
  if (pendingBlobs.length) {
    cancelSettle()
    commit()
    return
  }
  cancelSettle()
  settleTimer = setTimeout(() => {
    settleTimer = 0
    commit()
  }, SETTLE_MS)
}

setPersistHook(notePersist)

/** Hold a previous IndexedDB value so undo can put it back. Null deletes the key. */
export function stashUndo(key, value) {
  if (!armed || restoring) return
  pendingBlobs.push({ key, value })
}

export function beginUndo() {
  if (depth === 0) flushHistory()
  depth += 1
}

export function endUndo() {
  depth = Math.max(0, depth - 1)
  if (depth === 0 && dirty) {
    dirty = false
    cancelSettle()
    commit()
  }
}

export function historyDepth() {
  return depth
}

/**
 * A song load replaced the session. Undo may step back across the load once, to the song as it was,
 * but not further into that other song's history.
 */
export function songSwitch() {
  if (!armed || restoring) {
    stack.length = 0
    switchPending = false
    return
  }
  switchPending = true
}

/** A new session (the window opened). Nothing from an earlier session can be undone into this one. */
export function armHistory() {
  cancelSettle()
  stack.length = 0
  switchPending = false
  pendingBlobs = []
  depth = 0
  dirty = false
  baseline = takeSnapshot()
  armed = true
  lastCommitAt = 0
}

export async function withoutHistory(fn) {
  flushHistory()
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
  return stack.length > 0 || !!settleTimer
}

function synthSig(pad) {
  return pad?.source === 'synth' && pad.patch ? JSON.stringify(pad.patch) : ''
}

/** Runs as an exclusive job: a second Undo waits for the first, and neither interleaves with a load. */
export function undo() {
  return exclusive(undoNow)
}

async function undoNow() {
  flushHistory()
  const entry = stack.pop()
  if (!entry) return false
  restoring += 1
  const before = model.pads.map(synthSig)
  const fromSong = `${model.songFile}\n${model.songName}`
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
    // Rendering a synth pad is heavy. Only pads whose patch changed (or lost their audio) are redone.
    model.pads.forEach((pad, i) => {
      const sig = synthSig(pad)
      if (sig && (sig !== before[i] || !audioBank.has(i))) renderPad(i)
    })
    if (model.sliceView) {
      const sets = model.library?.sliceSets || []
      if (!sets.some((set) => set.id === model.sliceView)) model.sliceView = null
    }
    baseline = takeSnapshot()
    // Stepping back across a song load is a song change for anything still in flight.
    if (`${model.songFile}\n${model.songName}` !== fromSong) bumpSong()
    touch(true)
  } finally {
    restoring = Math.max(0, restoring - 1)
  }
  return true
}
