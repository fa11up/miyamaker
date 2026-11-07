import { Fragment, useEffect } from 'react'
import { noteName } from '../keys.js'
import {
  LANES,
  TRACK_FIELDS,
  TRACK_VEL,
  clearTrackerLane,
  commitTrackerNote,
  currentPattern,
  formatNudge,
  hexByte,
  model,
  patchTrackerEvent,
  stepCount,
  touch,
} from '../model.js'
import { useModel } from '../useModel.js'
import { PatternBar } from './PatternBar.jsx'

export function Tracker() {
  useModel()
  const seq = currentPattern()
  const rows = stepCount(seq)
  const t = model.tracker
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
  const focusLane = Math.floor((t.col || 0) / TRACK_FIELDS)
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
            ? ` · ${focusEv.off ? 'OFF' : noteName(focusEv.pitch)} · ${model.pads[focusEv.pad]?.name || 'Empty'} · vel ${hexByte(Math.round((focusEv.vel ?? 0) * 255))} · move ${formatNudge(focusEv.nudge)}`
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
          <thead>
            <tr>
              <th className="st" rowSpan={2}>STEP</th>
              {Array.from({ length: LANES }, (_, lane) => (
                <th key={lane} colSpan={TRACK_FIELDS} className="track">
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
                  <th className="sub">INST</th>
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
                  {Array.from({ length: LANES * TRACK_FIELDS }, (_, col) => {
                    const lane = Math.floor(col / TRACK_FIELDS)
                    const field = col % TRACK_FIELDS
                    const ev = events[lane]
                    const active = t.focus && t.row === row && t.col === col
                    const cls = [
                      field === 0 ? 'note edge' : field === 1 ? 'inst' : field === 2 ? 'vel' : 'move',
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
  if (at && !at.off) return model.pads[at.pad]?.name || 'Empty'
  for (let i = 0; i < seq.steps.length; i++) {
    const ev = seq.steps[i]?.[lane]
    if (ev && !ev.off) return model.pads[ev.pad]?.name || 'Empty'
  }
  return '—'
}

function cellText(ev, field, active, t) {
  if (active && t.hex && field !== 0) {
    if (field === 3) return `${(t.sign || 1) < 0 ? '-' : '+'}${t.hex}`
    return t.hex.toUpperCase()
  }
  if (!ev) return field === 0 ? '---' : '--'
  if (field === 0) return ev.off ? 'OFF' : noteName(ev.pitch)
  if (field === 1) return hexByte(ev.pad)
  if (field === 2) return hexByte(Math.round((ev.vel ?? 0) * 255))
  return formatNudge(ev.nudge)
}

export function handleTrackerKey(e) {
  const t = model.tracker
  if (t.col == null) t.col = 0
  const seq = currentPattern()
  const rows = stepCount(seq)
  const cols = LANES * TRACK_FIELDS
  const key = e.key
  if (key === 'Escape') {
    t.edit = !t.edit
    t.focus = true
    t.hex = ''
    touch(false)
    return true
  }
  if (key === 'Tab') {
    const lane = Math.floor(t.col / TRACK_FIELDS)
    const next = (lane + (e.shiftKey ? -1 : 1) + LANES) % LANES
    t.col = next * TRACK_FIELDS
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
  const lane = Math.floor(t.col / TRACK_FIELDS)
  const field = t.col % TRACK_FIELDS
  const cell = seq.steps[t.row]
  if (!cell) return false
  if (key === 'Delete' || key === 'Backspace') {
    clearTrackerLane(t.row, lane)
    return true
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
