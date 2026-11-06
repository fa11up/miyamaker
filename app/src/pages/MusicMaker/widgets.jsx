import { useRef } from 'react'

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
  const commit = (next) => onChange(hexValue(next, min, max, bits))
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
        ref={(node) => {
          if (!node) return
          node.onwheel = (e) => {
            e.preventDefault()
            commit(count + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 16 : 1))
          }
        }}
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, count, fine: e.shiftKey }
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* already released */ }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const travel = drag.current.fine ? 480 : 120
          const delta = ((drag.current.y - e.clientY) / travel) * hexTop(bits)
          commit(drag.current.count + Math.round(delta))
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onKeyDown={(e) => {
          const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0
          if (!dir) return
          e.preventDefault()
          e.stopPropagation()
          commit(count + dir * (e.shiftKey ? 16 : 1))
        }}
      >
        <svg viewBox="0 0 52 52" width="52" height="52" aria-hidden="true">
          <circle className="ring" cx="26" cy="26" r="23" />
          <polygon className="needle" points={`${tip[0]},${tip[1]} ${base[0] + px * 3.2},${base[1] + py * 3.2} ${base[0] - px * 3.2},${base[1] - py * 3.2}`} />
          <text className={`read d${width}`} x="26" y="26.5" textAnchor="middle" dominantBaseline="central">{hex}</text>
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

export function Dialog({ title, onClose, children }) {
  return (
    <div className="dialog-back" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()} role="dialog">
        <div className="title-bar-root">
          <div className="title-bar">{title}</div>
          <div className="title-buttons">
            <button type="button" className="chrome-btn close" aria-label="Close" onClick={onClose}>
              <ChromeGlyph kind="close" />
            </button>
          </div>
        </div>
        <div className="body">{children}</div>
      </div>
    </div>
  )
}
