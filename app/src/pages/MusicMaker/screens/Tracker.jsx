import { Fragment, useEffect, useRef, useState } from 'react'
import { LANES, currentPattern, formatNudge, hexByte, model, stepCount, touch, writeLane } from '../model.js'
import { useModel } from '../useModel.js'
import { PatternBar } from './PatternBar.jsx'

const FIELDS = 3
const COMPACT_ROW = 18

export function Tracker() {
  useModel()
  const seq = currentPattern()
  const rows = stepCount(seq)
  const t = model.tracker
  const gridRef = useRef(null)
  const [rowPx, setRowPx] = useState(COMPACT_ROW)
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const fit = () => {
      const head = el.querySelector('thead')?.offsetHeight || 36
      const room = el.clientHeight - head
      const next = Math.max(COMPACT_ROW, Math.min(42, Math.floor(room / Math.max(1, rows))))
      setRowPx((prev) => (prev === next ? prev : next))
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(el)
    return () => watch.disconnect()
  }, [rows])
  useEffect(() => {
    if (!t.focus) return
    document.querySelector('.tracker td.cursor')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [t.focus, t.row, t.col, model.pattern])
  const focusLane = Math.floor((t.col || 0) / FIELDS)
  const focusEv = seq.steps[t.row]?.[focusLane]
  return (
    <div className="screen tracker-screen">
      <div className="tracker-bar">
        <PatternBar />
        <p className="track-status">
          Track {trackNo(focusLane)} · {laneInstrument(seq, focusLane)} · step {hexByte(t.row)}
          {focusEv
            ? ` · ${model.pads[focusEv.pad]?.name || 'Empty'} · vel ${hexByte(Math.round((focusEv.vel ?? 0) * 255))} · move ${formatNudge(focusEv.nudge)}`
            : ' · empty'}
        </p>
      </div>
      <div
        ref={gridRef}
        className="tracker"
        style={{ '--row-h': `${rowPx}px` }}
        onMouseDown={() => {
          t.focus = true
          touch(false)
        }}
      >
        <table>
          <thead>
            <tr>
              <th className="st" rowSpan={2}>STEP</th>
              {Array.from({ length: LANES }, (_, lane) => (
                <th key={lane} colSpan={FIELDS} className="track">
                  <span className="track-title">
                    <b>{trackNo(lane)}</b>
                    <span>{laneInstrument(seq, lane)}</span>
                  </span>
                </th>
              ))}
            </tr>
            <tr>
              {Array.from({ length: LANES }, (_, lane) => (
                <Fragment key={lane}>
                  <th className="sub edge">NOTE</th>
                  <th className="sub">VEL</th>
                  <th className="sub">MOVE</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, row) => {
              const events = seq.steps[row] || []
              const play = model.playing && model.playhead === row
              return (
                <tr key={row} className={rowClass(row, play)}>
                  <td className="st">{hexByte(row)}</td>
                  {Array.from({ length: LANES * FIELDS }, (_, col) => {
                    const lane = Math.floor(col / FIELDS)
                    const field = col % FIELDS
                    const ev = events[lane]
                    const active = t.focus && t.row === row && t.col === col
                    const cls = [field === 0 ? 'note edge' : field === 1 ? 'vel' : 'move', active ? 'cursor' : '']
                      .filter(Boolean)
                      .join(' ')
                    return (
                      <td
                        key={col}
                        className={cls}
                        onClick={() => {
                          t.focus = true
                          t.row = row
                          t.col = col
                          t.hex = ''
                          t.sign = 1
                          touch(false)
                        }}
                      >
                        {field === 0 && ev && !(active && t.hex) ? (
                          <>
                            <span className="id">{hexByte(ev.pad)}</span>
                            <span className="nm">{model.pads[ev.pad]?.name || 'Empty'}</span>
                          </>
                        ) : (
                          cellText(ev, field, active, t)
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function trackNo(lane) {
  return String(lane + 1).padStart(2, '0')
}

function rowClass(row, play) {
  const band = row % 16 === 0 ? 'bar' : row % 4 === 0 ? 'beat' : ''
  return [band, play ? 'play' : ''].filter(Boolean).join(' ')
}

function laneInstrument(seq, lane) {
  const row = model.tracker.focus ? model.tracker.row : model.playhead
  const at = seq.steps[row]?.[lane]
  if (at) return model.pads[at.pad]?.name || 'Empty'
  for (let i = 0; i < seq.steps.length; i++) {
    const ev = seq.steps[i]?.[lane]
    if (ev) return model.pads[ev.pad]?.name || 'Empty'
  }
  return '—'
}

function cellText(ev, field, active, t) {
  if (active && t.hex) {
    if (field === 2) return `${(t.sign || 1) < 0 ? '-' : '+'}${t.hex}`
    return t.hex.toUpperCase()
  }
  if (!ev) return '--'
  if (field === 0) return hexByte(ev.pad)
  if (field === 1) return hexByte(Math.round((ev.vel ?? 0) * 255))
  return formatNudge(ev.nudge)
}

export function handleTrackerKey(e) {
  const t = model.tracker
  if (t.col == null) t.col = 0
  const seq = currentPattern()
  const rows = stepCount(seq)
  const cols = LANES * FIELDS
  const key = e.key
  if (key === 'Escape') {
    t.focus = false
    t.hex = ''
    touch(false)
    return true
  }
  if (key === 'ArrowUp') {
    t.row = (t.row - 1 + rows) % rows
    t.hex = ''
    touch(false)
    return true
  }
  if (key === 'ArrowDown') {
    t.row = (t.row + 1) % rows
    t.hex = ''
    touch(false)
    return true
  }
  if (key === 'ArrowLeft') {
    t.col = (t.col + cols - 1) % cols
    t.hex = ''
    touch(false)
    return true
  }
  if (key === 'ArrowRight') {
    t.col = (t.col + 1) % cols
    t.hex = ''
    touch(false)
    return true
  }
  const lane = Math.floor(t.col / FIELDS)
  const field = t.col % FIELDS
  const cell = seq.steps[t.row]
  if (!cell) return false
  if (key === 'Delete' || key === 'Backspace') {
    cell[lane] = null
    t.hex = ''
    touch(true)
    return true
  }
  if (field === 2) {
    if (key === '-' || key === '+') {
      t.sign = key === '-' ? -1 : 1
      t.hex = ''
      touch(false)
      return true
    }
    if (/^[0-9]$/.test(key)) {
      t.hex = (t.hex + key).slice(-2)
      if (t.hex.length >= 2 && cell[lane]) {
        const mag = Math.min(50, parseInt(t.hex, 10))
        cell[lane].nudge = (t.sign || 1) < 0 ? -mag : mag
        t.hex = ''
        touch(true)
      } else {
        touch(false)
      }
      return true
    }
    return false
  }
  if (/^[0-9a-fA-F]$/.test(key)) {
    t.hex = (t.hex + key).slice(-2)
    if (t.hex.length >= 2) {
      const value = parseInt(t.hex, 16)
      if (field === 0 && value < 64) {
        const ev = cell[lane] || { pad: value, vel: 0.9, pitch: 0, nudge: 0 }
        ev.pad = value
        writeLane(t.row, lane, ev)
      } else if (field === 1 && cell[lane]) {
        cell[lane].vel = value / 255
        touch(true)
      }
      t.hex = ''
    } else {
      touch(false)
    }
    return true
  }
  return false
}
