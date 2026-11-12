import { importFile, importRemote, noteOff, noteOn } from './audio/engine.js'
import { importPictureUrl } from './media/pictures.js'
import { beginUndo, endUndo, stashUndo } from './history.js'
import { loadCached, readDirectoryFile } from './media/library.js'
import {
  TRACK_VEL,
  audioBank,
  fitLoop,
  idbDelete,
  idbGet,
  idbSet,
  model,
  normalizePad,
  rememberSample,
  renderPad,
  selectPad,
  touch,
} from './model.js'

const HOLD_MS = 480
const MEDIA_RE = /\.(wav|mp3|m4a|aac|ogg|flac|aiff|aif|mp4|webm|mov|m4v)$/i

let clip = null
let menu = null
let hold = null
let armListener = null
const menuListeners = new Set()

function emitMenu() {
  menuListeners.forEach((fn) => fn())
}

export function padClipReady() {
  return clip != null
}

export function getPadMenu() {
  return menu
}

export function subscribePadMenu(fn) {
  menuListeners.add(fn)
  return () => menuListeners.delete(fn)
}

function clearArm() {
  if (!armListener) return
  window.removeEventListener('pointerup', armListener)
  window.removeEventListener('pointercancel', armListener)
  armListener = null
}

export function closePadMenu() {
  clearArm()
  if (!menu) return
  menu = null
  emitMenu()
}

function placeMenu(clientX, clientY) {
  const width = 168
  const height = 72
  const margin = 8
  let x = clientX
  let y = clientY - height - 10
  if (y < margin) y = Math.min(clientY + 18, window.innerHeight - height - margin)
  if (x + width > window.innerWidth - margin) x = window.innerWidth - width - margin
  if (x < margin) x = margin
  return { x, y }
}

/** ready is false while the finger that opened the menu is still down. */
export function openPadMenu(index, clientX, clientY, ready) {
  const pos = placeMenu(clientX, clientY)
  if (!ready && menu && !menu.ready && armListener) {
    menu = { ...menu, index, x: pos.x, y: pos.y }
    emitMenu()
    return
  }
  clearArm()
  menu = { index, x: pos.x, y: pos.y, ready: !!ready }
  emitMenu()
  if (ready) return
  const openedIndex = index
  armListener = () => {
    clearArm()
    window.setTimeout(() => {
      if (!menu || menu.index !== openedIndex || menu.ready) return
      menu = { ...menu, ready: true }
      emitMenu()
    }, 180)
  }
  window.addEventListener('pointerup', armListener)
  window.addEventListener('pointercancel', armListener)
}

function clonePad(src, index) {
  const pad = normalizePad(JSON.parse(JSON.stringify(src)), index)
  fitLoop(pad)
  return pad
}

export async function copyPad(index) {
  const src = model.pads[index]
  if (!src) return
  const pad = clonePad(src, index)
  pad.mute = false
  pad.solo = false
  let entry = audioBank.get(index)
  if (!entry?.pcm && pad.source === 'sample') {
    const rec = await idbGet(`pad:${index}`)
    if (rec?.pcm) entry = { pcm: rec.pcm, sr: rec.sr || 44100 }
  }
  clip = {
    pad,
    pcm: entry?.pcm ? new Float32Array(entry.pcm) : null,
    sr: entry?.sr || 44100,
  }
  model.browserNote = `Copied ${pad.name || 'pad'} from pad ${index + 1}`
  touch(false)
}

export async function pastePad(index) {
  if (!clip || index < 0 || index > 63) return
  const src = clip.pad
  const prev = await idbGet(`pad:${index}`)
  beginUndo()
  try {
    const keepMute = !!model.pads[index]?.mute
    const keepSolo = !!model.pads[index]?.solo
    const pad = clonePad(src, index)
    pad.mute = keepMute
    pad.solo = keepSolo
    // Storage first. A failed write leaves the pad and its audio as they were.
    if (pad.source === 'sample' && clip.pcm) {
      const pcm = new Float32Array(clip.pcm)
      await idbSet(`pad:${index}`, { pcm, sr: clip.sr, name: pad.sampleName || pad.name })
      stashUndo(`pad:${index}`, prev || null)
      audioBank.set(index, { pcm, sr: clip.sr, rev: Date.now() })
    } else {
      await idbDelete(`pad:${index}`)
      stashUndo(`pad:${index}`, prev || null)
      audioBank.delete(index)
    }
    model.pads[index] = pad
    model.selected = index
    model.bank = Math.floor(index / 16)
    model.selection = []
    if (!(pad.source === 'sample' && clip.pcm) && pad.source === 'synth' && pad.patch) renderPad(index)
    const name = pad.name || 'pad'
    model.browserNote = pad.source === 'sample' && !clip.pcm
      ? `Pasted ${name} onto pad ${index + 1}. The sample audio was not loaded.`
      : `Pasted ${name} onto pad ${index + 1}`
    touch(true)
  } finally {
    endUndo()
  }
}

function clearHoldTimer() {
  if (!hold) return
  window.clearTimeout(hold.timer)
  hold.timer = 0
}

function beginHold(index, event, play) {
  clearHoldTimer()
  hold = {
    index,
    x: event.clientX,
    y: event.clientY,
    pointerId: event.pointerId,
    opened: false,
    timer: 0,
  }
  const skipMenu = event.shiftKey || !!model.hold
  if (!skipMenu) {
    hold.timer = window.setTimeout(() => {
      if (!hold || hold.index !== index) return
      hold.opened = true
      if (play) noteOff(`ptr:${index}`)
      openPadMenu(index, hold.x, hold.y, false)
    }, HOLD_MS)
  }
  try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* the pointer already ended */ }
  if (!play) return
  event.preventDefault()
  if (event.shiftKey || model.hold === 'edit') selectPad(index, 'edit')
  else if (model.hold === 'solo') selectPad(index, 'solo')
  else if (model.hold === 'mute') selectPad(index, 'mute')
  else {
    selectPad(index)
    noteOn(index, TRACK_VEL, `ptr:${index}`)
  }
}

function moveHold(event) {
  if (!hold || hold.pointerId !== event.pointerId || !hold.timer) return
  const dx = event.clientX - hold.x
  const dy = event.clientY - hold.y
  if (dx * dx + dy * dy > 144) clearHoldTimer()
}

function endHold(index, play, pointerId) {
  if (hold?.index === index && (pointerId == null || hold.pointerId === pointerId)) {
    clearHoldTimer()
    hold = null
  }
  if (play) noteOff(`ptr:${index}`)
}

function rootOf(hint) {
  const root = hint?.getRootNode?.()
  if (root && root.querySelectorAll) return root
  return document
}

function elementAt(x, y, hint) {
  const root = hint?.getRootNode?.()
  if (root instanceof ShadowRoot) {
    const inner = root.elementFromPoint(x, y)
    if (inner) return inner
  }
  const top = document.elementFromPoint(x, y)
  if (top?.shadowRoot) return top.shadowRoot.elementFromPoint(x, y) || top
  return top
}

function padIndexAt(x, y, hint) {
  let el = elementAt(x, y, hint)
  while (el) {
    if (el.dataset && el.dataset.pad != null && el.dataset.pad !== '') {
      const index = Number(el.dataset.pad)
      return Number.isInteger(index) ? index : -1
    }
    el = el.parentElement
  }
  return -1
}

function clearMarks(hint) {
  rootOf(hint).querySelectorAll('.drop-over').forEach((el) => el.classList.remove('drop-over'))
}

function markPad(x, y, hint) {
  clearMarks(hint)
  const index = padIndexAt(x, y, hint)
  if (index < 0) return -1
  rootOf(hint).querySelectorAll(`[data-pad="${index}"]`).forEach((el) => el.classList.add('drop-over'))
  return index
}

let drag = null

function endDrag() {
  if (!drag) return
  const { source, ghost, move, up } = drag
  drag = null
  window.removeEventListener('pointermove', move)
  window.removeEventListener('pointerup', up)
  window.removeEventListener('pointercancel', up)
  ghost?.remove()
  clearMarks(source)
  source?.closest?.('.mmm')?.classList.remove('sample-dragging')
}

/** Press a browser row, then drag onto a pad. A vertical flick inside the list still scrolls. */
export function armSampleDrag(event, payload) {
  if (!payload || event.button !== 0) return
  endDrag()
  const source = event.currentTarget
  const startX = event.clientX
  const startY = event.clientY
  const pointerId = event.pointerId
  const mouse = event.pointerType === 'mouse'
  let active = false
  let decided = false
  let ghost = null

  const move = (e) => {
    if (!drag || e.pointerId !== pointerId) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (!decided) {
      const reach = dx * dx + dy * dy
      if (mouse) {
        if (reach < 36) return
      } else if (reach < 144) return
      decided = true
      if (!mouse) {
        const dock = source.closest('.browser-dock')
        const over = elementAt(e.clientX, e.clientY, source)
        const inDock = !dock || (over && dock.contains(over))
        if (inDock && Math.abs(dy) > Math.abs(dx)) {
          endDrag()
          return
        }
      }
      active = true
      try { source.setPointerCapture(pointerId) } catch { /* synthetic events have no live pointer */ }
      const kill = (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        source.removeEventListener('click', kill, true)
      }
      source.addEventListener('click', kill, true)
      ghost = document.createElement('div')
      ghost.className = 'drag-ghost'
      ghost.textContent = payload.name || 'sample'
      const host = source.closest('.mmm') || source.getRootNode()
      host.appendChild(ghost)
      host.classList?.add('sample-dragging')
      drag.ghost = ghost
    }
    if (!active || !ghost) return
    ghost.style.left = `${e.clientX}px`
    ghost.style.top = `${e.clientY}px`
    markPad(e.clientX, e.clientY, source)
  }

  const up = (e) => {
    if (!drag || e.pointerId !== pointerId) return
    const x = e.clientX
    const y = e.clientY
    const dropped = active
    endDrag()
    if (!dropped) return
    const index = padIndexAt(x, y, source)
    if (index >= 0) dropSample(index, payload)
  }

  drag = { source, ghost: null, move, up }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

export async function dropSample(index, payload) {
  if (!payload || index < 0 || index > 63) return
  model.selected = index
  model.bank = Math.floor(index / 16)
  model.selection = []
  touch(false)
  try {
    if (payload.kind === 'cache') {
      const rec = await loadCached(payload.id)
      if (!rec?.pcm) {
        model.browserNote = 'That sample is missing'
        touch(false)
        return
      }
      await rememberOnto(index, rec.pcm, rec.sr || 44100, payload.name)
    } else if (payload.kind === 'file') {
      await importFile(payload.file, index)
    } else if (payload.kind === 'handle') {
      const file = await readDirectoryFile(payload.handle)
      await importFile(file, index)
    } else if (payload.kind === 'remote') {
      await importRemote(payload.url, index, payload.name)
    } else if (payload.kind === 'picture') {
      await importPictureUrl(payload.url, payload.name, { toPad: true, index })
    }
  } catch (error) {
    model.browserNote = error.message || 'Could not drop that sample'
    touch(false)
  }
}

async function rememberOnto(index, pcm, sr, name) {
  await rememberSample(index, { pcm, sr, name, forceName: true })
  model.browserNote = `${name} on pad ${index + 1}`
  touch(false)
}

function mediaFiles(dataTransfer) {
  return [...(dataTransfer?.files || [])].filter((file) => (
    file.type.startsWith('audio') || file.type.startsWith('video') || MEDIA_RE.test(file.name)
  ))
}

function dragOverPad(event) {
  const types = [...(event.dataTransfer?.types || [])]
  if (!types.includes('Files')) return
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = 'copy'
  event.currentTarget.classList.add('drop-over')
}

function dragLeavePad(event) {
  const next = event.relatedTarget
  if (next && event.currentTarget.contains(next)) return
  event.currentTarget.classList.remove('drop-over')
}

function dropOnPad(index, event) {
  const files = mediaFiles(event.dataTransfer)
  if (!files.length) return
  event.preventDefault()
  event.stopPropagation()
  event.currentTarget.classList.remove('drop-over')
  files.forEach((file, i) => {
    importFile(file, Math.min(63, index + i)).catch((error) => {
      model.browserNote = error.message || 'Could not drop that file'
      touch(false)
    })
  })
}

/** Play, hold-for-menu, right-click menu, and file drop for one pad button. */
export function padGesture(index, { play }) {
  return {
    onContextMenu(event) {
      event.preventDefault()
      event.stopPropagation()
      if (menu && menu.index === index && !menu.ready) return
      const fingerDown = !!(hold && hold.index === index)
      openPadMenu(index, event.clientX, event.clientY, !fingerDown)
    },
    onPointerDown(event) {
      if (event.button !== 0) return
      beginHold(index, event, play)
    },
    onPointerMove: moveHold,
    onPointerUp(event) {
      endHold(index, play, event.pointerId)
    },
    onPointerCancel(event) {
      endHold(index, play, event.pointerId)
    },
    onLostPointerCapture(event) {
      endHold(index, play, event.pointerId)
    },
    onDragOver: dragOverPad,
    onDragLeave: dragLeavePad,
    onDrop(event) {
      dropOnPad(index, event)
    },
  }
}
