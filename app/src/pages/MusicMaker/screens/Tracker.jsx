import { Fragment, useEffect, useRef, useState } from 'react'
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
import { HelpButton } from '../widgets.jsx'

const HEADS = ['NOTE', 'INST', 'VEL', 'MOVE', 'SL', 'LP']

export function Tracker() {
  useModel()
  const [menu, setMenu] = useState(null)
  const gridRef = useRef(null)
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
  useEffect(() => {
    if (!t.focus || activeField()) return
    gridRef.current?.focus({ preventScroll: true })
  }, [t.focus, model.screen])
  const focusLane = Math.floor((t.col || 0) / fields)
  const focusEv = seq.steps[t.row]?.[focusLane]
  return (
    <div className="screen tracker-screen">
      <div className="tracker-bar">
        <PatternBar />
        <HelpButton title="Tracker">
          Esc or Rec arms edit. Arrows move the cursor. Notes play once from the trim start to the trim end. The same lane chokes the previous note. SL and LP still loop a grain until the next note or OFF. Ctrl and an arrow, or R1 and the d-pad, change page. A plain arrow on any other page moves the highlighted setting.
        </HelpButton>
        <div className="tracker-tools">
          <label className="slider">
            <span title="Rows to skip after a note or a finished value. 0 stays on the row. Ctrl and 1–0 set this from the grid.">Step</span>
            <input
              className="field num"
              aria-label="Edit step"
              title="Rows to skip after a note or a finished value. 0 stays on the row."
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
        ref={gridRef}
        tabIndex={0}
        onMouseDown={(event) => {
          t.focus = true
          event.currentTarget.focus({ preventScroll: true })
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
                          t.pair = 0
                          t.hex = ''
                          t.sign = 1
                          touch(false)
                        }}
                      >
                        {renderCell(ev, field, active, t)}
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

function wideText(ev, field) {
  if (!ev || ev.off) return blankCell(field)
  if (field === 4) return formatSl(ev.sl)
  return formatLp(ev.move, ev.len)
}

function cellText(ev, field, active, t) {
  if (active && t.hex && field !== 0) {
    if (field === 3) return `${(t.sign || 1) < 0 ? '-' : '+'}${t.hex}`
    if (field >= 4) {
      const base = wideText(ev, field)
      const at = Math.max(0, t.pair | 0) * 2
      const typed = t.hex.toUpperCase()
      return base.slice(0, at) + typed + base.slice(at + typed.length)
    }
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

function renderCell(ev, field, active, t) {
  const text = cellText(ev, field, active, t)
  const pairs = pairCount(field)
  if (!active || pairs < 2) return text
  const pair = Math.max(0, Math.min(pairs - 1, t.pair | 0))
  const at = pair * 2
  return (
    <>
      {text.slice(0, at)}
      <span className="pair">{text.slice(at, at + 2)}</span>
      {text.slice(at + 2)}
    </>
  )
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
    t.pair = 0
    t.hex = ''
    touch(false)
    return true
  }
  if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && key.startsWith('Arrow')) {
    nudgeCell(t, seq, key)
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
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const dir = key === 'ArrowRight' ? 1 : -1
    const here = t.col % fields
    const pairs = pairCount(here)
    if (pairs > 1) {
      const next = (t.pair | 0) + dir
      if (next >= 0 && next < pairs) {
        t.pair = next
        t.hex = ''
        touch(false)
        return true
      }
    }
    t.col = (t.col + (dir > 0 ? 1 : cols - 1)) % cols
    const landed = pairCount(t.col % fields)
    t.pair = dir > 0 ? 0 : landed - 1
    t.hex = ''
    touch(false)
    return true
  }
  const lane = Math.floor(t.col / fields)
  const field = t.col % fields
  const cell = seq.steps[t.row]
  if (!cell) return false
  if (key === 'Delete' || key === 'Backspace') {
    if (field === 3) {
      if (cell[lane]) patchTrackerEvent(t.row, lane, { nudge: 0 }, { step: false })
      return true
    }
    if (field === 4 || field === 5) clearTrackerGrain(t.row, lane, field)
    else clearTrackerLane(t.row, lane)
    return true
  }
  if (field === 4 || field === 5) {
    const pairs = pairCount(field)
    const pair = Math.max(0, Math.min(pairs - 1, t.pair | 0))
    if (/^[0-9a-fA-F]$/.test(key)) {
      t.hex = (t.hex + key).slice(-2)
      const ev = cell[lane]
      if (t.hex.length >= 2 && ev && !ev.off) {
        const byte = parseInt(t.hex, 16) & 255
        const last = pair >= pairs - 1
        const willStep = last && (t.step | 0) !== 0
        if (!last) t.pair = pair + 1
        else if (willStep) t.pair = 0
        if (field === 4) {
          const base = ev.sl == null ? 0 : (ev.sl & 0xffff)
          patchTrackerEvent(t.row, lane, { sl: writeByte(base, pair, byte, pairs) }, { step: willStep })
        } else {
          const packed = writeByte(packLp(ev.move || 0, ev.len || 0), pair, byte, pairs)
          patchTrackerEvent(t.row, lane, unpackLp(packed), { step: willStep })
        }
      } else touch(false)
      return true
    }
    if (key === ' ') return false
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

function nudgeCell(t, seq, key) {
  const fields = trackerFields()
  const lane = Math.floor(t.col / fields)
  const field = t.col % fields
  const ev = seq.steps[t.row]?.[lane]
  t.hex = ''
  const up = key === 'ArrowUp' || key === 'ArrowRight'
  const vertical = key === 'ArrowUp' || key === 'ArrowDown'
  const dir = up ? 1 : -1
  if (field === 0) {
    if (ev?.off) {
      touch(false)
      return
    }
    const jump = vertical ? 12 : 1
    const base = ev ? (ev.pitch | 0) : 0
    const pitch = Math.max(-60, Math.min(67, base + dir * jump))
    if (!ev) {
      commitTrackerNote({
        typed: true,
        stay: true,
        pad: model.selected,
        vel: TRACK_VEL,
        pitch,
        row: t.row,
      })
      return
    }
    if (pitch === (ev.pitch | 0)) {
      touch(false)
      return
    }
    patchTrackerEvent(t.row, lane, { pitch }, { step: false })
    return
  }
  if (!ev || ev.off) {
    touch(false)
    return
  }
  if (field === 1) {
    patchTrackerEvent(t.row, lane, { pad: bumpPair(ev.pad, 4, vertical, up) }, { step: false })
    return
  }
  if (field === 2) {
    const byte = Math.round((ev.vel ?? 0) * 255) & 255
    patchTrackerEvent(t.row, lane, { vel: bumpPair(byte, 16, vertical, up) / 255 }, { step: false })
    return
  }
  if (field === 3) {
    const nudge = bumpMove(ev.nudge, vertical, up)
    const held = Math.max(-50, Math.min(50, Math.round(ev.nudge || 0)))
    if (nudge === held) {
      touch(false)
      return
    }
    patchTrackerEvent(t.row, lane, { nudge }, { step: false })
    return
  }
  const pairs = pairCount(field)
  const pair = Math.max(0, Math.min(pairs - 1, t.pair | 0))
  if (field === 4) {
    const base = ev.sl == null ? 0 : (ev.sl & 0xffff)
    patchTrackerEvent(t.row, lane, { sl: bumpByte(base, pair, pairs, vertical, up) }, { step: false })
    return
  }
  const packed = bumpByte(packLp(ev.move || 0, ev.len || 0), pair, pairs, vertical, up)
  patchTrackerEvent(t.row, lane, unpackLp(packed), { step: false })
}

/** Left digit is Shift+Up/Down. Right digit is Shift+Left/Right. Both wrap. */
function bumpPair(value, span, vertical, up) {
  const mask = span * 16 - 1
  let v = value & mask
  const shift = vertical ? 4 : 0
  const size = vertical ? span : 16
  let digit = (v >> shift) & 0xf
  digit = (digit + (up ? 1 : -1) + size) % size
  const nibble = 0xf << shift
  v = (v & ~nibble) | ((digit & 0xf) << shift)
  return v & mask
}

function bumpMove(nudge, vertical, up) {
  const sign = nudge < 0 ? -1 : 1
  let mag = Math.abs(Math.round(nudge || 0))
  let tens = Math.min(5, Math.floor(mag / 10))
  let ones = mag % 10
  if (vertical) tens = Math.max(0, Math.min(5, tens + (up ? 1 : -1)))
  else ones = Math.max(0, Math.min(9, ones + (up ? 1 : -1)))
  mag = Math.min(50, tens * 10 + ones)
  return sign < 0 ? -mag : mag
}

function pairCount(field) {
  if (field === 4) return 2
  if (field === 5) return 4
  return 1
}

function writeByte(value, pair, byte, pairs) {
  const shift = (pairs - 1 - pair) * 8
  const full = pairs >= 4 ? 0xffffffff : 0xffff
  const cur = (value >>> 0) & full
  const mask = (0xff << shift) >>> 0
  return (cur & (~mask >>> 0) & full) | (((byte & 0xff) << shift) >>> 0)
}

function bumpByte(value, pair, pairs, vertical, up) {
  const shift = (pairs - 1 - pair) * 8
  const byte = (value >>> shift) & 0xff
  return writeByte(value, pair, bumpPair(byte, 16, vertical, up), pairs)
}

function packLp(move, len) {
  return ((((move | 0) & 0xffff) << 16) | ((len | 0) & 0xffff)) >>> 0
}

function unpackLp(bits) {
  const moveBits = (bits >>> 16) & 0xffff
  return { move: moveBits >= 0x8000 ? moveBits - 0x10000 : moveBits, len: bits & 0xffff }
}

function activeField() {
  let node = document.activeElement
  if (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement
  const tag = node?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node?.isContentEditable) return node
  return null
}
