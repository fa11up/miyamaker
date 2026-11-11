import { useEffect, useId, useRef, useState } from 'react'
import { model, touch } from './model.js'
import { useModel } from './useModel.js'

function hexTop(bits) {
  if (bits >= 16) return 65535
  if (bits >= 12) return 4095
  return 255
}

function hexDigits(bits) {
  if (bits >= 16) return 4
  if (bits >= 12) return 3
  return 2
}

function hexCount(value, min, max, bits) {
  const span = (max - min) || 1
  const t = Math.min(1, Math.max(0, ((Number.isFinite(value) ? value : min) - min) / span))
  return Math.round(t * hexTop(bits))
}

function hexValue(count, min, max, bits) {
  const top = hexTop(bits)
  const n = Math.min(top, Math.max(0, count))
  return Math.round((min + (n / top) * (max - min)) * 100000) / 100000
}

/** Dial with the hex byte inside and the needle on the rim. Drag up to raise. */
export function Knob({ label, value, min, max, bits = 8, onChange, text }) {
  const width = hexDigits(bits)
  const count = hexCount(value, min, max, bits)
  const hex = count.toString(16).toUpperCase().padStart(width, '0')
  const detail = text != null ? text : typeof value === 'number' ? trimNum(value) : value
  const t = count / hexTop(bits)
  const angle = Math.PI * (0.75 + t * 1.5)
  const ux = Math.cos(angle)
  const uy = Math.sin(angle)
  const px = -uy
  const py = ux
  const tip = [26 + ux * 22, 26 + uy * 22]
  const base = [26 + ux * 15.5, 26 + uy * 15.5]
  const drag = useRef(null)
  const dial = useRef(null)
  const live = useRef(null)
  const beginDrag = useRef(() => {})
  const glossId = `k${useId().replace(/:/g, '')}`
  const commit = (next) => onChange(hexValue(next, min, max, bits))
  live.current = { count, bits, commit }
  useEffect(() => {
    const node = dial.current
    if (!node) return undefined
    const onWheel = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const now = live.current
      now.commit(now.count + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 16 : 1))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  })
  // Leaving the dial is not a release. Keep editing until the button or finger comes up,
  // even if that release never reaches the dial itself.
  useEffect(() => {
    const finish = (e) => {
      const session = drag.current
      if (!session) return
      if (e && e.pointerId != null && e.pointerId !== session.id) return
      // Still holding: this is not the release, so the drag keeps going.
      if (e?.type === 'pointerup' && e.pointerType !== 'touch' && (e.buttons & 1) !== 0) return
      drag.current = null
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', finish, true)
      const node = dial.current
      if (node && session.id != null) {
        try {
          if (node.hasPointerCapture?.(session.id)) node.releasePointerCapture(session.id)
        } catch { /* the pointer is already gone */ }
      }
    }
    const move = (e) => {
      const session = drag.current
      if (!session || e.pointerId !== session.id) return
      // A finger often reports buttons as 0 while it is still down. A mouse with no button is a missed release.
      if (e.pointerType !== 'touch' && (e.buttons & 1) === 0) {
        finish(e)
        return
      }
      const travel = session.fine ? 280 : 72
      const delta = ((session.y - e.clientY) / travel) * hexTop(session.bits)
      live.current.commit(session.count + Math.round(delta))
    }
    beginDrag.current = (e) => {
      if (e.button != null && e.button !== 0) return
      const node = dial.current
      if (!node) return
      finish()
      const now = live.current
      drag.current = { y: e.clientY, count: now.count, bits: now.bits, fine: e.shiftKey, id: e.pointerId }
      try { node.setPointerCapture(e.pointerId) } catch { /* no live pointer */ }
      window.addEventListener('pointermove', move, true)
      window.addEventListener('pointerup', finish, true)
      window.addEventListener('pointercancel', finish, true)
    }
    return () => {
      drag.current = null
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', finish, true)
    }
  }, [])
  return (
    <div className="knob">
      <button
        type="button"
        className="dial"
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={hexTop(bits)}
        aria-valuenow={count}
        aria-valuetext={hex}
        title={`${label} ${hex} · ${detail}`}
        ref={dial}
        onPointerDown={(e) => beginDrag.current(e)}
        onKeyDown={(e) => {
          const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
          if (!dir) return
          e.preventDefault()
          e.stopPropagation()
          commit(count + dir * (e.shiftKey ? 16 : 1))
        }}
      >
        <svg viewBox="0 0 52 52" width="52" height="52" aria-hidden="true">
          <defs>
            <linearGradient id={`${glossId}d`} x1="0.12" y1="0" x2="0.88" y2="1">
              <stop offset="0%" stopColor="#fff6f2" />
              <stop offset="36%" stopColor="#fe9ca1" />
              <stop offset="70%" stopColor="#e78fb1" />
              <stop offset="100%" stopColor="#766eb8" />
            </linearGradient>
            <radialGradient id={`${glossId}g`} cx="32%" cy="24%" r="68%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="34%" stopColor="#ffffff" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle className="dome" cx="26" cy="26" r="23" fill="#fe9ca1" />
          <circle cx="26" cy="26" r="23" fill={`url(#${glossId}d)`} />
          <ellipse cx="19" cy="15" rx="11" ry="6.5" fill={`url(#${glossId}g)`} />
          <circle className="ring" cx="26" cy="26" r="22.15" />
          <polygon className="needle" points={`${tip[0]},${tip[1]} ${base[0] + px * 3.2},${base[1] + py * 3.2} ${base[0] - px * 3.2},${base[1] - py * 3.2}`} />
          <text className={`read d${width}`} x="26" y="27" textAnchor="middle" dominantBaseline="central">{hex}</text>
        </svg>
      </button>
      <span>{label}</span>
    </div>
  )
}

export function Slider({ label, value, min, max, step = 0.01, onChange, text }) {
  const shown = text != null ? text : typeof value === 'number' ? trimNum(value) : value
  return (
    <label className="slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <em>{shown}</em>
    </label>
  )
}

export function trimNum(n) {
  if (Math.abs(n) >= 100) return String(Math.round(n))
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 100) / 100)
}

export function ChromeGlyph({ kind }) {
  return (
    <svg width="10" height="9" viewBox="0 0 10 9" shapeRendering="crispEdges" fill="currentColor" aria-hidden="true">
      {kind === 'min' && <rect x="1" y="7" width="7" height="2" />}
      {kind === 'max' && <path d="M0 0h10v2H0zM0 2h1v7H0zM9 2h1v7H9zM0 8h10v1H0z" />}
      {kind === 'restore' && <path d="M2 0h8v1H2zM2 1h1v1H2zM9 1h1v5H9zM8 5h1v1H8zM0 3h8v1H0zM0 4h1v5H0zM7 4h1v5H7zM0 8h8v1H0z" />}
      {kind === 'close' && (
        <path d="M1 1h2v1h1v1h2V2h1V1h2v1H8v1H7v1H6v1h1v1h1v1h1v1H7V7H6V6H4v1H3v1H1V7h1V6h1V5h1V4H3V3H2V2H1z" />
      )}
    </svg>
  )
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Dialogs open now, newest last: Escape closes only the top one. */
const openDialogs = []

/** Where focus really is: inside a shadow root, document.activeElement is only the host. */
function deepActive(root = document) {
  let el = root.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  return el
}

/**
 * A window of the app's own. Escape closes it (unless `busy`), focus moves in when it opens, Tab stays inside
 * while it is open, and focus goes back to where it was when it closes.
 */
export function Dialog({ title, onClose, busy = false, children }) {
  const box = useRef(null)
  const titleId = useId()
  const latest = useRef({ onClose, busy })
  latest.current = { onClose, busy }

  useEffect(() => {
    const node = box.current
    if (!node) return undefined
    const back = deepActive()
    openDialogs.push(node)
    const first = node.querySelector('.body ' + FOCUSABLE.split(', ').join(', .body '))
    ;(first || node).focus({ preventScroll: true })

    // Only while the music window is the one on top: another app's Escape is not ours.
    const frame = () => (node.getRootNode()?.host || node).closest?.('.react-draggable')
    const down = (event) => {
      if (openDialogs[openDialogs.length - 1] !== node) return
      const win = frame()
      if (win && !win.classList.contains('is-focused')) return
      if (event.key === 'Escape') {
        if (node.querySelector('.arrange-menu')) return
        if (event.defaultPrevented) return
        event.preventDefault()
        event.stopPropagation()
        if (!latest.current.busy) latest.current.onClose?.()
        return
      }
      if (event.key !== 'Tab') return
      const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === deepActive())
      if (!items.length) {
        event.preventDefault()
        node.focus({ preventScroll: true })
        return
      }
      const active = deepActive()
      const at = items.indexOf(active)
      const inside = node.contains(active)
      if (event.shiftKey && (at <= 0 || !inside)) {
        event.preventDefault()
        items[items.length - 1].focus()
      } else if (!event.shiftKey && (at === items.length - 1 || !inside)) {
        event.preventDefault()
        items[0].focus()
      }
    }
    window.addEventListener('keydown', down, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      const index = openDialogs.indexOf(node)
      if (index >= 0) openDialogs.splice(index, 1)
      if (back?.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true })
    }
  }, [])

  return (
    <div className="dialog-back" onMouseDown={() => { if (!busy) onClose() }}>
      <div
        ref={box}
        className="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <div className="title-bar-root">
          <div className="title-bar" id={titleId}>{title}</div>
          <div className="title-buttons">
            <button type="button" className="chrome-btn close" aria-label="Close" disabled={busy} onClick={onClose}>
              <ChromeGlyph kind="close" />
            </button>
          </div>
        </div>
        <div className="body">{children}</div>
      </div>
    </div>
  )
}

/** Opens the beginner card for this page. Escape closes it. */
export function HelpButton({ title, topic }) {
  useModel()
  const open = !!topic && model.coachTopic === topic
  return (
    <button
      type="button"
      className={`btn help-btn ${open ? 'on' : ''}`}
      aria-label={title || 'Help'}
      aria-expanded={open}
      onClick={() => {
        model.coachTopic = open ? '' : (topic || '')
        touch(false)
      }}
    >
      ?
    </button>
  )
}
