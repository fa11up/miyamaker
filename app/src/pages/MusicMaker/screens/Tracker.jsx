import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { noteName } from '../keys.js'
import {
  LANES,
  TRACK_VEL,
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
  trackerLocked,
  writeTrackerField,
} from '../model.js'
import { useModel } from '../useModel.js'
import { cuePatternStep } from '../audio/engine.js'
import { PatternBar } from './PatternBar.jsx'
import { HelpButton } from '../widgets.jsx'
import {
  clampTrackZoom,
  freshPad,
  padPointerDown,
  padPointerMove,
  padPointerUp,
  padTick,
  stickRelease,
  zoomBy,
} from './trackerPad.js'

const HEADS = ['NOTE', 'INST', 'VEL', 'MOVE', 'SL', 'LP']
const STICK_DEAD = 16
const COPIES = [0, 1, 2]

/** Held by the lower-left SHIFT control. The trackpad edits instead of moving while this is set. */
export const finger = { shift: false, kbShift: false }

export function Tracker() {
  useModel()
  const [menu, setMenu] = useState(null)
  const [slots, setSlots] = useState(15)
  const gridRef = useRef(null)
  const fingers = useRef(new Map())
  const pinchRef = useRef(null)
  const stick = useRef({ on: false, id: 0, ox: 0, oy: 0, x: 0, y: 0, ax: 0, ay: 0, moved: false, ate: false, ateTimer: 0, raf: 0, then: 0 })
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
    // Capture phase, ahead of the tracker's own keys: Escape only closes the menu and never reaches Rec.
    const key = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setMenu(null)
    }
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key, true)
    }
  }, [menu])
  useEffect(() => {
    if (!model.playing) return
    // Record off: the play cursor is the only cursor, so it rides the playhead.
    // Record on: the edit cursor stays put and the play row moves on its own.
    if (!t.edit && t.row !== model.playhead) {
      t.row = model.playhead
      t.hex = ''
      touch(false)
    }
  }, [model.playing, model.playhead, t.follow, t.edit, t.row])
  const followPlay = !!(model.playing && t.follow)
  const anchor = followPlay ? (model.playhead | 0) : (t.row | 0)
  const midSlot = Math.floor(slots / 2)
  const cursorSlot = markedSlot(anchor, t.row | 0, midSlot, slots, rows, trackerLocked())
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid || grid.clientHeight < 20) return
    const head = grid.querySelector('thead')?.offsetHeight || 35
    const rowH = grid.querySelector('tbody tr')?.offsetHeight || 18
    const n = Math.max(3, Math.ceil(Math.max(rowH, grid.clientHeight - head) / rowH) + 2)
    const odd = n % 2 ? n : n + 1
    if (odd !== slots) {
      setSlots(odd)
      return
    }
    centerTracker(grid)
  }, [slots, anchor, t.col, t.row, rows, fields, model.pattern, model.playing, followPlay, t.zoom])
  useEffect(() => {
    const grid = gridRef.current
    if (!grid || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => {
      if (grid.clientHeight < 20) return
      const head = grid.querySelector('thead')?.offsetHeight || 35
      const rowH = grid.querySelector('tbody tr')?.offsetHeight || 18
      const n = Math.max(3, Math.ceil(Math.max(rowH, grid.clientHeight - head) / rowH) + 2)
      const odd = n % 2 ? n : n + 1
      setSlots((prev) => (prev === odd ? prev : odd))
      centerTracker(grid)
    })
    ro.observe(grid)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!t.focus || activeField()) return
    gridRef.current?.focus({ preventScroll: true })
  }, [t.focus, model.screen])
  useEffect(() => () => {
    cancelAnimationFrame(stick.current.raf)
    clearTimeout(stick.current.ateTimer)
  }, [])
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return undefined
    const onWheel = (event) => {
      if (event.shiftKey) return
      event.preventDefault()
      const scale = event.deltaMode === 1 ? 0.08 : event.ctrlKey ? 0.01 : 0.0015
      const factor = Math.min(1.25, Math.max(0.8, Math.exp(-event.deltaY * scale)))
      const next = zoomBy(model.tracker.zoom, factor)
      if (next === clampTrackZoom(model.tracker.zoom)) return
      model.tracker.zoom = next
      touch(false)
    }
    grid.addEventListener('wheel', onWheel, { passive: false })
    return () => grid.removeEventListener('wheel', onWheel)
  }, [])
  const zoom = clampTrackZoom(t.zoom)
  const focusLane = Math.floor((t.col || 0) / fields)
  const focusEv = seq.steps[t.row]?.[focusLane]
  return (
    <div className="screen tracker-screen">
      <div className="tracker-bar">
        <PatternBar />
        <HelpButton title="Tracker" topic="tracker" />
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
      <div className="tracker-fit" style={{ '--track-zoom': zoom }}>
      <div
        className="tracker"
        data-coach="tracker"
        ref={gridRef}
        tabIndex={0}
        onPointerDown={beginStick}
        onPointerMove={moveStick}
        onPointerUp={endStick}
        onPointerCancel={endStick}
      >
        <table>
          <thead onContextMenu={openCols}>
            <tr>
              <th className="st" rowSpan={2}>STEP</th>
              {COPIES.map((copy) => Array.from({ length: LANES }, (_, lane) => (
                <th key={`${copy}-${lane}`} colSpan={fields} className={`track${copy > 0 && lane === 0 ? ' wrap' : ''}`}>
                  <span className="track-title">
                    <b>{trackNo(lane)}</b>
                    <span>{laneInstrument(seq, lane)}</span>
                  </span>
                </th>
              )))}
            </tr>
            <tr>
              {COPIES.map((copy) => Array.from({ length: LANES }, (_, lane) => (
                <Fragment key={`${copy}-${lane}`}>
                  {HEADS.slice(0, fields).map((label, field) => (
                    <th
                      key={label}
                      className={`sub${field === 0 ? ' edge' : ''}${copy > 0 && lane === 0 && field === 0 ? ' wrap' : ''}${field === 4 ? ' sl' : ''}${field === 5 ? ' lp' : ''}`}
                      title={field === 4 ? 'Play offset. 0000 is the start, 8000 the middle, FFFF the last step.' : field === 5 ? 'Move then length. 00000100 holds a grain. 01000100 walks forward. FFFF0100 crawls backward.' : undefined}
                    >
                      {label}
                    </th>
                  ))}
                </Fragment>
              )))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: slots }, (_, slot) => {
              const row = mod(anchor - midSlot + slot, rows)
              const events = seq.steps[row] || []
              const isMid = slot === midSlot
              const play = model.playing && mod(model.playhead | 0, rows) === row && (followPlay ? isMid : true)
              const armed = !!t.edit
              return (
                <tr key={slot} data-mid={isMid ? '1' : '0'} className={rowClass(row, play)}>
                  <td className="st" data-step={row} title={`Play from step ${hexByte(row)}`}>{hexByte(row)}</td>
                  {COPIES.map((copy) => Array.from({ length: LANES * fields }, (_, col) => {
                    const lane = Math.floor(col / fields)
                    const field = col % fields
                    const seam = copy > 0 && lane === 0 && field === 0
                    const ev = events[lane]
                    const rect = blockOf(t)
                    const cursor = slot === cursorSlot && t.col === col && copy === 1
                    const blockAnchor = !!(rect && row === t.block.ar && col === t.block.ac)
                    const inside = !!(rect && row >= rect.r0 && row <= rect.r1 && col >= rect.c0 && col <= rect.c1)
                    // SL and LP are wider than two digits. The cursor sits on one pair, not the whole cell.
                    const pairCursor = cursor && (field === 4 || field === 5)
                    const cls = [
                      field === 0 ? 'note edge' : field === 1 ? 'inst' : field === 2 ? 'vel' : field === 3 ? 'move' : field === 4 ? 'sl' : 'lp',
                      seam ? 'wrap' : '',
                      (cursor || blockAnchor) && !pairCursor ? (armed ? 'edit' : 'mark') : '',
                      cursor && !pairCursor ? 'here' : '',
                      inside && !cursor && !blockAnchor ? 'block' : '',
                    ].filter(Boolean).join(' ')
                    return (
                      <td
                        key={`${copy}-${col}`}
                        data-row={row}
                        data-col={col}
                        data-copy={copy}
                        className={cls}
                        onClick={() => {
                          if (stick.current.ate) {
                            stick.current.ate = false
                            return
                          }
                          t.focus = true
                          if (trackerLocked()) {
                            touch(false)
                            return
                          }
                          t.row = row
                          t.col = col
                          t.pair = 0
                          t.hex = ''
                          t.block = null
                          t.sign = 1
                          touch(false)
                        }}
                      >
                        {renderCell(ev, field, cursor, armed, t)}
                      </td>
                    )
                  }))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <TrackerPad gridRef={gridRef} />
      </div>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y, minWidth: 220 }} role="menu">
          <button
            type="button"
            onClick={() => {
              setMenu(null)
              model.tracker.block = null
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

  function beginStick(event) {
    if (event.button !== 0) return
    const el = event.currentTarget
    if (event.target === el && (event.offsetX > el.clientWidth || event.offsetY > el.clientHeight)) return
    fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (fingers.current.size >= 2) {
      const s = stick.current
      s.on = false
      s.moved = true
      s.tapRow = -1
      s.tapCol = -1
      s.ax = 0
      s.ay = 0
      cancelAnimationFrame(s.raf)
      const pts = [...fingers.current.values()]
      pinchRef.current = {
        dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
        zoom: clampTrackZoom(model.tracker.zoom),
      }
      return
    }
    event.preventDefault()
    window.getSelection?.()?.removeAllRanges?.()
    const s = stick.current
    s.on = true
    s.id = event.pointerId
    s.ox = s.x = event.clientX
    s.oy = s.y = event.clientY
    s.ax = 0
    s.ay = 0
    s.moved = false
    s.ate = false
    s.tapRow = -1
    s.tapCol = -1
    s.tapStep = -1
    const cell = event.target?.closest?.('td')
    if (cell?.classList.contains('st') && el.contains(cell)) {
      const step = Number(cell.dataset.step)
      s.tapStep = Number.isInteger(step) ? step : -1
    } else if (cell && el.contains(cell)) {
      const row = Number(cell.dataset.row)
      const col = Number(cell.dataset.col)
      if (Number.isInteger(row) && Number.isInteger(col)) {
        s.tapRow = row
        s.tapCol = col
      }
    }
    s.then = performance.now()
    t.focus = true
    el.focus({ preventScroll: true })
    try { el.setPointerCapture(event.pointerId) } catch { /* already gone */ }
    cancelAnimationFrame(s.raf)
    s.raf = requestAnimationFrame(tickStick)
    touch(false)
  }

  function moveStick(event) {
    if (fingers.current.has(event.pointerId)) {
      fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
    if (fingers.current.size >= 2 && pinchRef.current) {
      const pts = [...fingers.current.values()]
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const next = zoomBy(pinchRef.current.zoom, dist / pinchRef.current.dist)
      if (next !== clampTrackZoom(model.tracker.zoom)) {
        model.tracker.zoom = next
        touch(false)
      }
      return
    }
    const s = stick.current
    if (!s.on || event.pointerId !== s.id) return
    s.x = event.clientX
    s.y = event.clientY
  }

  function endStick(event) {
    fingers.current.delete(event.pointerId)
    if (fingers.current.size < 2) pinchRef.current = null
    const s = stick.current
    if (s.on && event.pointerId != null && event.pointerId !== s.id) return
    if (!s.on && !s.moved) return
    s.on = false
    s.ax = 0
    s.ay = 0
    cancelAnimationFrame(s.raf)
    const release = stickRelease(s)
    s.ate = release.swallowClick
    clearTimeout(s.ateTimer)
    s.ateTimer = setTimeout(() => {
      s.ate = false
    }, 480)
    if (s.tapStep >= 0 && !s.moved) {
      cuePatternStep(s.tapStep)
      return
    }
    if (!release.place || trackerLocked()) return
    const tr = model.tracker
    tr.row = release.row
    tr.col = release.col
    tr.pair = 0
    tr.hex = ''
    tr.block = null
    tr.sign = 1
    tr.focus = true
    touch(false)
  }

  function tickStick(now) {
    const s = stick.current
    if (!s.on) return
    const dt = Math.min(0.05, (now - s.then) / 1000)
    s.then = now
    const dx = s.x - s.ox
    const dy = s.y - s.oy
    const dist = Math.hypot(dx, dy)
    if (dist > STICK_DEAD && !trackerLocked()) {
      s.moved = true
      const span = Math.min(1, (dist - STICK_DEAD) / 90)
      const rate = (finger.shift ? 2.5 : 4) + span * (finger.shift ? 6 : 14)
      s.ax += (dx / dist) * rate * dt
      s.ay += (dy / dist) * rate * dt
      let guard = 0
      while (guard++ < 4 && (Math.abs(s.ax) >= 1 || Math.abs(s.ay) >= 1)) {
        if (Math.abs(s.ax) >= Math.abs(s.ay)) {
          const key = s.ax > 0 ? 'ArrowRight' : 'ArrowLeft'
          s.ax += s.ax > 0 ? -1 : 1
          applyTrackerArrow(key, finger.shift)
        } else {
          const key = s.ay > 0 ? 'ArrowDown' : 'ArrowUp'
          s.ay += s.ay > 0 ? -1 : 1
          applyTrackerArrow(key, finger.shift)
        }
      }
    }
    if (s.on) s.raf = requestAnimationFrame(tickStick)
  }
}

function TrackerPad({ gridRef }) {
  const pad = useRef(freshPad())
  const [dir, setDir] = useState('')
  useEffect(() => () => cancelAnimationFrame(pad.current.raf), [])

  function nudge(key, count) {
    if (!key || trackerLocked()) return
    model.tracker.focus = true
    gridRef.current?.focus({ preventScroll: true })
    for (let i = 0; i < count; i++) applyTrackerArrow(key, false)
  }

  function down(event) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const step = padPointerDown(pad.current, {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rect,
      now: performance.now(),
    })
    pad.current = { ...step.pad, raf: pad.current.raf }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* already gone */ }
    setDir(step.pad.key)
    if (step.steps) nudge(step.pad.key, step.steps)
    cancelAnimationFrame(pad.current.raf)
    pad.current.raf = requestAnimationFrame(tick)
  }

  function move(event) {
    const next = padPointerMove(pad.current, { id: event.pointerId, x: event.clientX, y: event.clientY })
    if (next === pad.current) return
    const prev = pad.current.key
    next.raf = pad.current.raf
    pad.current = next
    if (next.key !== prev) setDir(next.key)
  }

  function up(event) {
    event.stopPropagation()
    const next = padPointerUp(pad.current, { id: event.pointerId })
    cancelAnimationFrame(pad.current.raf)
    pad.current = next
    setDir('')
  }

  function tick(now) {
    if (!pad.current.on) return
    const frame = padTick(pad.current, now)
    if (!pad.current.on) return
    frame.pad.raf = pad.current.raf
    pad.current = frame.pad
    if (!pad.current.on) return
    if (frame.steps) nudge(pad.current.key, frame.steps)
    if (pad.current.on) pad.current.raf = requestAnimationFrame(tick)
  }

  const held = dir === 'ArrowUp' ? 'up' : dir === 'ArrowDown' ? 'down' : dir === 'ArrowLeft' ? 'left' : dir === 'ArrowRight' ? 'right' : ''
  return (
    <div
      className={`track-pad${held ? ` held-${held}` : ''}`}
      data-coach="track-pad"
      role="group"
      aria-label="Move the cursor. Tap a direction for one step. Drag away from the center to go faster."
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <svg className="track-pad-cross" viewBox="0 0 100 100" aria-hidden="true">
        <path className="plus" d="M40 4H60Q68 4 68 12V32H88Q96 32 96 40V60Q96 68 88 68H68V88Q68 96 60 96H40Q32 96 32 88V68H12Q4 68 4 60V40Q4 32 12 32H32V12Q32 4 40 4Z" />
        <path className="tri up" d="M50 14L58 26H42Z" />
        <path className="tri down" d="M50 86L42 74H58Z" />
        <path className="tri left" d="M14 50L26 42V58Z" />
        <path className="tri right" d="M86 50L74 58V42Z" />
        <circle className="nub" cx="50" cy="50" r="10" />
      </svg>
    </div>
  )
}

function mod(n, m) {
  const size = Math.max(1, m | 0)
  return ((n % size) + size) % size
}

/** The visible slot of this pattern row that sits closest to the middle. */
function markedSlot(anchor, cursorRow, mid, slots, length, locked) {
  if (locked) return -1
  let best = -1
  let dist = Infinity
  for (let i = 0; i < slots; i++) {
    if (mod(anchor - mid + i, length) !== cursorRow) continue
    const d = Math.abs(i - mid)
    if (d < dist) {
      dist = d
      best = i
    }
  }
  return best
}

/** Pin the live row to the vertical middle and the edit cell to the horizontal middle.
 *  The pattern is drawn three times across, so a wrap from the last column to the first
 *  is the same picture as a one-cell slide. */
function centerTracker(grid) {
  const mid = grid.querySelector('tr[data-mid="1"]')
  if (!mid) return
  const gridRect = grid.getBoundingClientRect()
  const headH = grid.querySelector('thead')?.getBoundingClientRect().height || 0
  const rowRect = mid.getBoundingClientRect()
  const bodyMid = gridRect.top + headH + (gridRect.height - headH) / 2
  grid.scrollTop += (rowRect.top + rowRect.height / 2) - bodyMid

  const st = grid.querySelector('th.st')?.getBoundingClientRect()
  const noteLeft = st ? st.right : gridRect.left
  const noteMid = noteLeft + (gridRect.right - noteLeft) / 2
  const col = model.tracker.col | 0
  const cell = mid.querySelector(`td[data-col="${col}"][data-copy="1"]`)
  if (!cell) return
  const cellRect = cell.getBoundingClientRect()
  grid.scrollLeft += (cellRect.left + cellRect.width / 2) - noteMid
}

function trackNo(lane) {
  return String(lane + 1).padStart(2, '0')
}

function rowClass(row, play) {
  const band = row % 16 === 0 ? 'bar' : row % 4 === 0 ? 'beat' : ''
  return [band, row === 0 ? 'loop' : '', play ? 'play' : ''].filter(Boolean).join(' ')
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

function renderCell(ev, field, cursor, armed, t) {
  const text = cellText(ev, field, cursor && armed, t)
  const pairs = pairCount(field)
  if (!cursor || pairs < 2) return text
  const pair = Math.max(0, Math.min(pairs - 1, t.pair | 0))
  const at = pair * 2
  const mark = armed ? 'edit' : 'mark'
  return (
    <>
      {text.slice(0, at)}
      <span className={`pair here ${mark}`}>{text.slice(at, at + 2)}</span>
      {text.slice(at + 2)}
    </>
  )
}

export function handleTrackerKey(e) {
  const t = model.tracker
  if (t.col == null) t.col = 0
  const seq = currentPattern()
  const fields = trackerFields()
  const key = e.key
  if (isCopy(e)) {
    e.preventDefault()
    copyBlock()
    return true
  }
  if (isPaste(e)) {
    e.preventDefault()
    if (t.edit && !trackerLocked()) pasteBlock()
    return true
  }
  // Green playback: the pattern is locked. Note keys already auditioned. Space is play/pause.
  if (trackerLocked()) {
    if (key === ' ' || e.code === 'Space') return false
    if (key === 'Tab' || key.startsWith('Arrow') || key === 'Delete' || key === 'Backspace' || key.length === 1) return true
    return false
  }
  // Stopped with Rec off: the cursor can move. Notes, hex, delete, and paste do not.
  if (!t.edit) {
    if (key === ' ' || e.code === 'Space') return false
    if (key === 'Tab') {
      const lane = Math.floor(t.col / fields)
      const next = (lane + (e.shiftKey ? -1 : 1) + LANES) % LANES
      t.col = next * fields
      t.pair = 0
      t.hex = ''
      t.block = null
      touch(false)
      return true
    }
    if (blockArrows(e)) {
      growBlock(key)
      return true
    }
    if (key.startsWith('Arrow') && !(e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey)) {
      applyTrackerArrow(key, false)
      return true
    }
    if (key.startsWith('Arrow') || key === 'Delete' || key === 'Backspace' || key.length === 1) return true
    return false
  }
  if (key === 'Tab') {
    const lane = Math.floor(t.col / fields)
    const next = (lane + (e.shiftKey ? -1 : 1) + LANES) % LANES
    t.col = next * fields
    t.pair = 0
    t.hex = ''
    t.block = null
    touch(false)
    return true
  }
  if (key.startsWith('Arrow')) {
    if (blockArrows(e)) {
      growBlock(key)
      return true
    }
    const shifted = e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey
    applyTrackerArrow(key, shifted)
    return true
  }
  const lane = Math.floor(t.col / fields)
  const field = t.col % fields
  const cell = seq.steps[t.row]
  if (!cell) return false
  if (key === 'Delete' || key === 'Backspace') {
    deleteSelection(t, fields)
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

function applyTrackerArrow(key, shifted) {
  const t = model.tracker
  if (t.col == null) t.col = 0
  if (trackerLocked()) return
  const seq = currentPattern()
  const rows = stepCount(seq)
  const fields = trackerFields()
  const cols = LANES * fields
  if (shifted) {
    if (!model.tracker.edit) return
    if (finger.shift) nudgeCell(t, seq, key)
    else nudgeSelection(t, seq, key)
    return
  }
  if (t.block) t.block = null
  if (key === 'ArrowUp') {
    t.row = (t.row - 1 + rows) % rows
    t.hex = ''
    touch(false)
    return
  }
  if (key === 'ArrowDown') {
    t.row = (t.row + 1) % rows
    t.hex = ''
    touch(false)
    return
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
        return
      }
    }
    t.col = (t.col + (dir > 0 ? 1 : cols - 1)) % cols
    const landed = pairCount(t.col % fields)
    t.pair = dir > 0 ? 0 : landed - 1
    t.hex = ''
    touch(false)
  }
}

function blockArrows(e) {
  return e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey && e.key.startsWith('Arrow')
}

function isCopy(e) {
  const key = e.key
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (key === 'c' || key === 'C')
}

function isPaste(e) {
  const key = e.key
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (key === 'v' || key === 'V')
}

/** The rectangle from the anchor to the far corner. One cell is no block. */
function blockOf(t) {
  const b = t.block
  if (!b) return null
  const fields = trackerFields()
  const cols = LANES * fields
  const rows = Math.max(1, stepCount(currentPattern()))
  const ar = Math.max(0, Math.min(rows - 1, b.ar | 0))
  const ac = Math.max(0, Math.min(cols - 1, b.ac | 0))
  const r = Math.max(0, Math.min(rows - 1, b.r | 0))
  const c = Math.max(0, Math.min(cols - 1, b.c | 0))
  if (ar === r && ac === c) return null
  return { r0: Math.min(ar, r), r1: Math.max(ar, r), c0: Math.min(ac, c), c1: Math.max(ac, c) }
}

function growBlock(key) {
  const t = model.tracker
  const fields = trackerFields()
  const cols = LANES * fields
  const rows = Math.max(1, stepCount(currentPattern()))
  if (!t.block) t.block = { ar: t.row | 0, ac: t.col | 0, r: t.row | 0, c: t.col | 0 }
  const step = key === 'ArrowUp' ? [-1, 0] : key === 'ArrowDown' ? [1, 0] : key === 'ArrowLeft' ? [0, -1] : [0, 1]
  const r = Math.max(0, Math.min(rows - 1, (t.block.r | 0) + step[0]))
  const c = Math.max(0, Math.min(cols - 1, (t.block.c | 0) + step[1]))
  t.block.r = r
  t.block.c = c
  t.row = r
  t.col = c
  t.pair = 0
  t.hex = ''
  if (r === t.block.ar && c === t.block.ac) t.block = null
  touch(false)
}

/** The columns inside the block, or the one cell under the cursor. */
function selectionCells(t) {
  const fields = trackerFields()
  const rect = blockOf(t)
  const cells = []
  if (!rect) {
    cells.push({ row: t.row | 0, col: t.col | 0, field: (t.col | 0) % fields })
    return cells
  }
  for (let row = rect.r0; row <= rect.r1; row++) {
    for (let col = rect.c0; col <= rect.c1; col++) cells.push({ row, col, field: col % fields })
  }
  return cells
}

let clip = null

function snapField(ev, field) {
  if (!ev || ev.off) return null
  if (field === 0) {
    return {
      pad: ev.pad | 0,
      vel: ev.vel,
      pitch: ev.pitch | 0,
      nudge: ev.nudge || 0,
      sl: ev.sl == null ? null : ev.sl,
      len: ev.len == null ? null : ev.len,
      move: ev.move || 0,
    }
  }
  if (field === 1) return { pad: ev.pad | 0 }
  if (field === 2) return { vel: ev.vel }
  if (field === 3) return { nudge: ev.nudge || 0 }
  if (field === 4) return ev.sl == null ? null : { sl: ev.sl }
  if (field === 5) return ev.len == null ? null : { len: ev.len, move: ev.move || 0 }
  return null
}

function copyBlock() {
  const t = model.tracker
  const fields = trackerFields()
  const seq = currentPattern()
  const rect = blockOf(t)
  const originR = rect ? rect.r0 : (t.row | 0)
  const originC = rect ? rect.c0 : (t.col | 0)
  clip = selectionCells(t).map((cell) => ({
    dr: cell.row - originR,
    dc: cell.col - originC,
    field: cell.field,
    snap: snapField(seq.steps[cell.row]?.[Math.floor(cell.col / fields)], cell.field),
  }))
  touch(false)
}

function pasteBlock() {
  if (!clip || !model.tracker.edit) return
  const t = model.tracker
  const fields = trackerFields()
  const rows = stepCount(currentPattern())
  const cols = LANES * fields
  for (const cell of clip) {
    const row = (t.row | 0) + cell.dr
    const col = (t.col | 0) + cell.dc
    if (row < 0 || row >= rows || col < 0 || col >= cols) continue
    const field = col % fields
    if (field !== cell.field) continue
    writeTrackerField(row, Math.floor(col / fields), field, cell.snap)
  }
}

function deleteSelection(t, fields) {
  for (const cell of selectionCells(t)) {
    writeTrackerField(cell.row, Math.floor(cell.col / fields), cell.field, null)
  }
}

function nudgeSelection(t, seq, key) {
  const rect = blockOf(t)
  if (!rect) {
    nudgeCell(t, seq, key)
    return
  }
  const saved = { row: t.row, col: t.col, pair: t.pair }
  for (let row = rect.r0; row <= rect.r1; row++) {
    for (let col = rect.c0; col <= rect.c1; col++) {
      t.row = row
      t.col = col
      t.pair = 0
      nudgeCell(t, currentPattern(), key)
    }
  }
  t.row = saved.row
  t.col = saved.col
  t.pair = saved.pair
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
