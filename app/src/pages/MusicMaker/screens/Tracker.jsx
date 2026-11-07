import { Fragment, useEffect, useState } from 'react'
import { signed16 } from '../audio/grain.js'
import { noteName } from '../keys.js'
import {
  LANES,
  TRACK_VEL,
  clearTrackerGrain,
  clearTrackerLane,
  commitTrackerNote,
  currentPattern,
  formatLp,
  formatNudge,
  formatSl,
  hexByte,
  model,
  patchTrackerEvent,
  setGrainCols,
  stepCount,
  touch,
  trackerFields,
} from '../model.js'
import { useModel } from '../useModel.js'
import { PatternBar } from './PatternBar.jsx'

const HEADS = ['NOTE', 'INST', 'VEL', 'MOVE', 'SL', 'LP']

export function Tracker() {
  useModel()
  const [menu, setMenu] = useState(null)
  const seq = currentPattern()
  const rows = stepCount(seq)
  const t = model.tracker
  const fields = trackerFields()
  useEffect(() => {
    if (!menu) return undefined
    const down = (event) => {
      const path = event.composedPath?.() || []
      if (path.some((node) => node.classList?.contains?.('ctx-menu'))) return
      setMenu(null)
    }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [menu])
  useEffect(() => {
    if (!model.playing || !t.follow) return
    if (t.row === model.playhead) return
    t.row = model.playhead
    t.hex = ''
    touch(false)
  }, [model.playing, model.playhead, t.follow, t.row])
  useEffect(() => {
    if (!t.focus) return
    document.querySelector('.tracker td.cursor')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [t.focus, t.row, t.col, model.pattern])
  const focusLane = Math.floor((t.col || 0) / fields)
  const focusEv = seq.steps[t.row]?.[focusLane]
  return (
    <div className="screen tracker-screen">
      <div className="tracker-bar">
        <PatternBar />
        <div className="tracker-tools">
          <label className="slider">
            <span>Step</span>
            <input
              className="field num"
              aria-label="Edit step"
              type="number"
              min={0}
              max={16}
              value={t.step ?? 1}
              onChange={(e) => {
                t.step = Math.max(0, Math.min(16, Number(e.target.value) || 0))
                touch(true)
              }}
            />
          </label>
          <button
            type="button"
            className={`btn free-width ${t.follow ? 'on' : ''}`}
            onClick={() => {
              t.follow = !t.follow
              touch(false)
            }}
          >
            Follow
          </button>
        </div>
        <p className="track-status">
          {t.edit ? 'REC' : 'PLAY'} · Track {trackNo(focusLane)} · {laneInstrument(seq, focusLane)} · step {hexByte(t.row)}
          {focusEv
            ? ` · ${focusEv.off ? 'OFF' : noteName(focusEv.pitch)} · ${model.pads[focusEv.pad]?.name || 'Empty'} · vel ${hexByte(Math.round((focusEv.vel ?? 0) * 255))} · move ${formatNudge(focusEv.nudge)}${grainStatus(focusEv)}`
            : ' · empty'}
        </p>
      </div>
      <div
        className="tracker"
        onMouseDown={() => {
          t.focus = true
          touch(false)
        }}
      >
        <table>
          <thead onContextMenu={openCols}>
            <tr>
              <th className="st" rowSpan={2}>STEP</th>
              {Array.from({ length: LANES }, (_, lane) => (
                <th key={lane} colSpan={fields} className="track">
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
                  {HEADS.slice(0, fields).map((label, field) => (
                    <th
                      key={label}
                      className={`sub${field === 0 ? ' edge' : ''}${field === 4 ? ' sl' : ''}${field === 5 ? ' lp' : ''}`}
                      title={field === 4 ? 'Play offset. 0000 is the start, 8000 the middle, FFFF the last step.' : field === 5 ? 'Move then length. 00000100 holds a grain. 01000100 walks forward. FFFF0100 crawls backward.' : undefined}
                    >
                      {label}
                    </th>
                  ))}
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
                  {Array.from({ length: LANES * fields }, (_, col) => {
                    const lane = Math.floor(col / fields)
                    const field = col % fields
                    const ev = events[lane]
                    const active = t.focus && t.row === row && t.col === col
                    const cls = [
                      field === 0 ? 'note edge' : field === 1 ? 'inst' : field === 2 ? 'vel' : field === 3 ? 'move' : field === 4 ? 'sl' : 'lp',
                      active ? 'cursor' : '',
                      active && t.edit ? 'armed' : '',
                    ].filter(Boolean).join(' ')
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
                        {cellText(ev, field, active, t)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y, minWidth: 220 }} role="menu">
          <button
            type="button"
            onClick={() => {
              setMenu(null)
              setGrainCols(!model.tracker.grains)
            }}
          >
            Show/hide SL/LP columns
          </button>
        </div>
      )}
    </div>
  )

  function openCols(event) {
    event.preventDefault()
    const frame = event.currentTarget.closest('.mmm')
    const rect = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 }
    setMenu({ x: event.clientX - rect.left, y: event.clientY - rect.top })
  }
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
  if (at && !at.off) return model.pads[at.pad]?.name || 'Empty'
  for (let i = 0; i < seq.steps.length; i++) {
    const ev = seq.steps[i]?.[lane]
    if (ev && !ev.off) return model.pads[ev.pad]?.name || 'Empty'
  }
  return '—'
}

function grainStatus(ev) {
  if (!ev || ev.off || (ev.sl == null && ev.len == null)) return ''
  return ` · SL ${formatSl(ev.sl)} · LP ${formatLp(ev.move, ev.len)}`
}

function blankCell(field) {
  if (field === 0) return '---'
  if (field === 4) return '----'
  if (field === 5) return '--------'
  return '--'
}

function cellText(ev, field, active, t) {
  const width = field === 4 ? 4 : field === 5 ? 8 : 2
  if (active && t.hex && field !== 0) {
    if (field === 3) return `${(t.sign || 1) < 0 ? '-' : '+'}${t.hex}`
    if (field >= 4) return (t.hex.toUpperCase() + '-'.repeat(width)).slice(0, width)
    return t.hex.toUpperCase()
  }
  if (!ev) return blankCell(field)
  if (field === 0) return ev.off ? 'OFF' : noteName(ev.pitch)
  if (field === 1) return hexByte(ev.pad)
  if (field === 2) return hexByte(Math.round((ev.vel ?? 0) * 255))
  if (field === 3) return formatNudge(ev.nudge)
  if (field === 4) return formatSl(ev.sl)
  return formatLp(ev.move, ev.len)
}

export function handleTrackerKey(e) {
  const t = model.tracker
  if (t.col == null) t.col = 0
  const seq = currentPattern()
  const rows = stepCount(seq)
  const fields = trackerFields()
  const cols = LANES * fields
  const key = e.key
  if (key === 'Escape') {
    t.edit = !t.edit
    t.focus = true
    t.hex = ''
    touch(false)
    return true
  }
  if (key === 'Tab') {
    const lane = Math.floor(t.col / fields)
    const next = (lane + (e.shiftKey ? -1 : 1) + LANES) % LANES
    t.col = next * fields
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
  const lane = Math.floor(t.col / fields)
  const field = t.col % fields
  const cell = seq.steps[t.row]
  if (!cell) return false
  if (key === 'Delete' || key === 'Backspace') {
    if (field === 4 || field === 5) clearTrackerGrain(t.row, lane, field)
    else clearTrackerLane(t.row, lane)
    return true
  }
  if (field === 4 || field === 5) {
    const width = field === 4 ? 4 : 8
    if (/^[0-9a-fA-F]$/.test(key)) {
      t.hex = (t.hex + key).slice(-width)
      if (t.hex.length >= width && cell[lane] && !cell[lane].off) {
        if (field === 4) patchTrackerEvent(t.row, lane, { sl: parseInt(t.hex, 16) })
        else {
          patchTrackerEvent(t.row, lane, {
            move: signed16(parseInt(t.hex.slice(0, 4), 16)),
            len: parseInt(t.hex.slice(4), 16),
          })
        }
      } else touch(false)
      return true
    }
    if (key.length === 1) return true
    return false
  }
  if (field === 0) {
    if (key === ' ') return false
    if (key.length === 1) return true
    return false
  }
  if (field === 3) {
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
        patchTrackerEvent(t.row, lane, { nudge: (t.sign || 1) < 0 ? -mag : mag })
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
      if (field === 1 && value < 64) {
        const prev = cell[lane]
        commitTrackerNote({
          typed: true,
          pad: value,
          vel: prev?.vel ?? TRACK_VEL,
          pitch: prev?.pitch || 0,
          nudge: prev?.nudge || 0,
          row: t.row,
        })
      } else if (field === 2 && cell[lane]) {
        patchTrackerEvent(t.row, lane, { vel: value / 255 })
      } else {
        t.hex = ''
        touch(false)
      }
    } else {
      touch(false)
    }
    return true
  }
  return false
}
