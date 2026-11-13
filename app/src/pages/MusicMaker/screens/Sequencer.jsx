import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BANKS, model, currentPattern, addBar, removeBar, doubleUp, noteRuns, normalizeEvent, stepCount, touch } from '../model.js'
import { syncMixer } from '../audio/engine.js'
import { chopParts, gridDiv, gridPlace, gridUnit } from '../audio/voices.js'
import { useModel } from '../useModel.js'
import { noteName } from '../keys.js'
import { HelpButton, Slider } from '../widgets.jsx'
import { PatternBar } from './PatternBar.jsx'
import { finger } from './Tracker.jsx'

const GRIP = 36
const GRIP_GAP = 4

const seqUi = {
  tool: 'draw',
  view: 'vel',
  cellW: 64,
  cellH: 40,
  add: false,
  picks: [],
  primaryId: null,
  clip: null,
  pasteAt: null,
  seenPattern: -1,
}
const CELL_MIN = 28
const CELL_MAX = 168
const ROW_MIN = 22
const ROW_MAX = 96
let pickSerial = 1

function nextPickId() {
  pickSerial += 1
  return pickSerial
}

function setSeqUi(patch) {
  Object.assign(seqUi, patch)
  touch(false)
}

function currentPicks() {
  if (seqUi.picks.length) return seqUi.picks
  const hit = model.seqHit
  if (!hit) return []
  return [{ id: seqUi.primaryId || 0, pad: hit.pad, start: hit.step, end: hit.end ?? hit.step, lane: hit.lane }]
}

function showPicks(picks, primaryId = seqUi.primaryId) {
  seqUi.picks = picks
  const primary = picks.find((p) => p.id === primaryId) || picks[picks.length - 1] || null
  seqUi.primaryId = primary ? primary.id : null
  model.seqHit = primary ? { step: primary.start, pad: primary.pad, end: primary.end, lane: primary.lane ?? null } : null
}

function hitOf(pick, run) {
  if (pick.lane != null && run.lane != null) return pick.pad === run.pad && pick.lane === run.lane && pick.start === run.start
  return pick.pad === run.pad && pick.start === run.start && pick.end === run.end
}

/** Copy the selected hits and drop a paste line on the next beat. */
export function copySeqSelection() {
  const picks = currentPicks()
  if (!picks.length) return false
  const seq = currentPattern()
  const anchor = Math.min(...picks.map((p) => p.start))
  const notes = []
  for (const p of picks) {
    const run = resolvePick(seq, p)
    if (!run) continue
    const evs = []
    for (const slot of run.slots) {
      const ev = seq.steps[slot.step]?.[slot.lane]
      if (ev && ev.pad === p.pad) evs.push({ rel: slot.step - anchor, ev: { ...ev } })
    }
    if (evs.length) notes.push({ pad: p.pad, evs })
  }
  if (!notes.length) return false
  seqUi.clip = { notes }
  const end = Math.max(...picks.map((p) => p.end))
  const n = stepCount(seq)
  let at = Math.ceil((end + 1) / 4) * 4
  if (at >= n) at = 0
  seqUi.pasteAt = at
  touch(false)
  return true
}

/** Paste the copied hits so the first one lands on the paste line. */
export function pasteSeqSelection() {
  const clip = seqUi.clip
  if (!clip?.notes?.length) return false
  const seq = currentPattern()
  const n = stepCount(seq)
  let span = 0
  for (const note of clip.notes) {
    for (const item of note.evs) span = Math.max(span, item.rel)
  }
  let at = seqUi.pasteAt
  if (at == null || at < 0) at = 0
  if (at + span >= n) at = Math.max(0, n - 1 - span)
  seqUi.pasteAt = at
  const picks = []
  for (const note of clip.notes) {
    let start = Infinity
    let end = -1
    let lane0 = null
    const firstRel = Math.min(...note.evs.map((item) => item.rel))
    for (const item of note.evs) {
      const s = at + item.rel
      const col = seq.steps[s]
      if (!col) continue
      const lane = col.findIndex((e) => !e)
      if (lane < 0) continue
      const ev = { ...item.ev, pad: note.pad }
      if (item.rel === firstRel) ev.cut = true
      else delete ev.cut
      col[lane] = normalizeEvent(ev)
      if (lane0 == null || s < start) lane0 = lane
      if (s < start) start = s
      if (s > end) end = s
    }
    if (end >= 0) picks.push({ id: nextPickId(), pad: note.pad, start, end, lane: lane0 })
  }
  showPicks(picks, picks[picks.length - 1]?.id)
  if (seqUi.tool === 'erase') seqUi.tool = 'select'
  touch(true)
  return picks.length > 0
}

/** Remove every selected hit. */
export function deleteSeqSelection() {
  const picks = currentPicks()
  if (!picks.length) return false
  const seq = currentPattern()
  for (const p of picks) {
    const run = resolvePick(seq, p)
    if (run) clearSlots(seq, run)
    else {
      for (let s = p.start; s <= p.end; s++) {
        const col = seq.steps[s]
        const hit = readHit(col, p.pad)
        if (hit) col[hit.lane] = null
      }
    }
  }
  showPicks([])
  touch(true)
  return true
}

const SNAP_LABELS = [
  [4, '1/4'],
  [8, '1/8'],
  [16, '1/16'],
  [32, '1/32'],
  [64, '1/64'],
  [128, '1/128'],
]

function SnapControl() {
  const anchor = useRef(null)
  const menu = useRef(null)
  const hold = useRef(0)
  const swallow = useRef(false)
  const host = useRef(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  useEffect(() => () => window.clearTimeout(hold.current), [])
  useEffect(() => {
    if (!open) swallow.current = false
  }, [open])
  useEffect(() => {
    if (!open) return undefined
    const down = (event) => {
      const path = event.composedPath?.() || []
      const inside = [anchor.current, menu.current].some((node) => node && (node.contains(event.target) || path.includes(node)))
      if (!inside) setOpen(false)
    }
    const key = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key, true)
    }
  }, [open])
  const shifted = (event) => event.shiftKey || finger.shift || finger.kbShift
  const openMenu = () => {
    const node = anchor.current
    const root = node?.getRootNode()
    const box = root?.querySelector?.('.mmm')
    const r = node?.getBoundingClientRect()
    const hb = box?.getBoundingClientRect()
    if (r && hb) {
      const menuH = 196
      const menuW = 110
      let top = r.top - hb.top
      let left = r.right - hb.left + 4
      if (top + menuH > hb.height) top = Math.max(4, hb.height - menuH - 4)
      if (left + menuW > hb.width) left = Math.max(4, r.left - hb.left - menuW)
      setPos({ left, top })
    }
    host.current = box || null
    swallow.current = true
    setOpen(true)
  }
  const pick = (div) => {
    model.seqDiv = div
    model.seqSnap = true
    setOpen(false)
    touch(true)
  }
  const on = model.seqSnap !== false
  const div = gridDiv(model.seqDiv)
  const label = SNAP_LABELS.find(([n]) => n === div)?.[1] || '1/16'
  return (
    <div className="seq-snap" ref={anchor}>
      <button
        type="button"
        className={`btn free-width ${on ? 'on' : ''}`}
        aria-pressed={on}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={on ? `Snap ${label}` : 'Snap off'}
        data-coach="snap"
        data-div={div}
        title="Snap to the grid. Click to turn it off. Hold, right-click, or Shift-click to pick the division, down to a 128th."
        onPointerDown={(event) => {
          if (event.button === 2) {
            event.preventDefault()
            openMenu()
            return
          }
          if (event.button !== 0) return
          if (shifted(event)) {
            event.preventDefault()
            openMenu()
            return
          }
          swallow.current = false
          window.clearTimeout(hold.current)
          // A finger that slides off the button is not a hold, so leaving clears this too.
          hold.current = window.setTimeout(openMenu, 420)
        }}
        onPointerUp={() => window.clearTimeout(hold.current)}
        onPointerCancel={() => window.clearTimeout(hold.current)}
        onPointerLeave={() => window.clearTimeout(hold.current)}
        onContextMenu={(event) => {
          event.preventDefault()
          openMenu()
        }}
        onClick={(event) => {
          window.clearTimeout(hold.current)
          if (swallow.current || shifted(event)) {
            swallow.current = false
            setOpen(true)
            return
          }
          setOpen(false)
          model.seqSnap = model.seqSnap === false
          touch(true)
        }}
      >
        Snap
      </button>
      {open && pos && host.current && createPortal(
        <div className="file-menu snap-menu" role="menu" data-snap-menu ref={menu} style={{ left: pos.left, top: pos.top }}>
          <p>Grid</p>
          {SNAP_LABELS.map(([n, name]) => (
            <button key={n} type="button" role="menuitem" className={div === n ? 'on' : ''} onClick={() => pick(n)}>
              {name}
            </button>
          ))}
        </div>,
        host.current,
      )}
    </div>
  )
}

export function Sequencer() {
  useModel()
  const gridRef = useRef(null)
  const frameRef = useRef(null)
  const gesture = useRef(null)
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  const zoomAnchor = useRef(null)
  const [grip, setGrip] = useState(null)
  const [dock, setDock] = useState(false)
  const [slot, setSlot] = useState(null)
  const seq = currentPattern()
  const steps = stepCount(seq)
  if (seqUi.seenPattern !== model.pattern) {
    seqUi.seenPattern = model.pattern
    seqUi.picks = []
    seqUi.primaryId = null
    model.seqHit = null
    if (seqUi.pasteAt != null && (seqUi.pasteAt < 0 || seqUi.pasteAt >= steps)) seqUi.pasteAt = 0
  }
  const picks = reconcile(seq, seqUi.picks)
  if (picks !== seqUi.picks) seqUi.picks = picks
  if (seqUi.primaryId && !picks.some((p) => p.id === seqUi.primaryId)) {
    seqUi.primaryId = picks[picks.length - 1]?.id || null
  }
  const primary = picks.find((p) => p.id === seqUi.primaryId) || picks[picks.length - 1] || null
  if (primary) {
    const h = model.seqHit
    if (!h || h.pad !== primary.pad || h.step !== primary.start || (h.end ?? h.step) !== primary.end || h.lane !== primary.lane) {
      model.seqHit = { step: primary.start, pad: primary.pad, end: primary.end, lane: primary.lane ?? null }
    }
  } else if (model.seqHit) model.seqHit = null
  const hit = model.seqHit
  const primaryRun = hit ? resolveHit(seq, hit) : null
  const selected = primaryRun ? { lane: primaryRun.lane, ev: primaryRun.ev } : (hit ? readHit(seq.steps[hit.step], hit.pad) : null)
  const span = primaryRun ? visualSpan(primaryRun) : null
  const snapOn = model.seqSnap !== false
  const endUnit = snapOn ? gridUnit(model.seqDiv) : 0.01
  const endMax = primaryRun ? nextEdge(seq, primaryRun, steps) : steps
  const endMin = span ? span.start + endUnit : endUnit
  const endCeiling = Math.max(endMin, endMax)
  const endValue = span ? Math.max(endMin, Math.min(endCeiling, span.end)) : endMin
  const cellW = clamp(seqUi.cellW, CELL_MIN, CELL_MAX)
  const cellH = clamp(seqUi.cellH, ROW_MIN, ROW_MAX)
  const atMin = cellW <= CELL_MIN + 0.5 && cellH <= ROW_MIN + 0.5
  const atMax = cellW >= CELL_MAX - 0.5 && cellH >= ROW_MAX - 0.5
  const showY = picks.length > 0 && seqUi.tool !== 'erase'
  const showX = showY || seqUi.pasteAt != null
  const pickKey = picks.map((p) => {
    const run = resolvePick(seq, p)
    return `${p.id}:${p.pad}:${p.lane ?? ''}:${p.start}:${p.end}:${run?.tail ?? 100}:${run?.ev?.nudge || 0}`
  }).join(',')

  useLayoutEffect(() => {
    const root = frameRef.current?.getRootNode()
    const rail = root?.querySelector?.('.dock-rail')
    const slotEl = rail?.querySelector?.('.rail-slot') || null
    setSlot(slotEl)
    if (!rail) return undefined
    const apply = () => {
      // The desktop rail is an 18px strip for Browser, Arranger, and SHIFT.
      // Sequence tools stay above the grid there. They stack only in the wider phone rail.
      if (rail.clientWidth < 40) {
        setDock(false)
        return
      }
      let used = 0
      for (const child of rail.children) {
        if (child === slotEl) continue
        used += child.offsetHeight
      }
      const gap = parseFloat(getComputedStyle(rail).rowGap || getComputedStyle(rail).gap) || 0
      const free = rail.clientHeight - used - Math.max(0, rail.children.length - 1) * gap
      // The empty stretch between the tabs and SHIFT. Short windows keep the tools on top.
      setDock(free >= 240)
    }
    apply()
    const watch = new ResizeObserver(apply)
    watch.observe(rail)
    return () => watch.disconnect()
  }, [])

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return undefined
    const onWheel = (event) => {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (event.shiftKey || horizontal) return
      event.preventDefault()
      const scale = event.deltaMode === 1 ? 0.05 : 0.006
      const factor = clamp(Math.exp(-event.deltaY * scale), 0.8, 1.25)
      zoomAt(event.clientX, event.clientY, seqUi.cellW * factor, seqUi.cellH * factor)
    }
    grid.addEventListener('wheel', onWheel, { passive: false })
    return () => grid.removeEventListener('wheel', onWheel)
  }, [])

  useLayoutEffect(() => {
    const grid = gridRef.current
    const frame = frameRef.current
    if (!grid || !frame) return undefined
    const measure = () => {
      frame.style.setProperty('--sb-x', `${Math.max(0, grid.offsetHeight - grid.clientHeight)}px`)
      frame.style.setProperty('--sb-y', `${Math.max(0, grid.offsetWidth - grid.clientWidth)}px`)
      const next = layoutGrips(grid, frame)
      setGrip((prev) => (gripEqual(prev, next) ? prev : next))
    }
    measure()
    grid.addEventListener('scroll', measure, { passive: true })
    const watch = new ResizeObserver(measure)
    watch.observe(grid)
    return () => {
      grid.removeEventListener('scroll', measure)
      watch.disconnect()
    }
  }, [pickKey, seqUi.primaryId, seqUi.pasteAt, seqUi.tool, cellW, cellH, steps, model.bank])

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current
    const grid = gridRef.current
    if (!anchor || !grid) return
    zoomAnchor.current = null
    const cell = grid.querySelector('.part-cell')
    if (!cell) return
    const rect = cell.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return
    const step0 = Number(cell.dataset.step)
    const pad0 = Number(cell.dataset.pad)
    grid.scrollLeft += rect.left + (anchor.step - step0) * rect.width - anchor.x
    grid.scrollTop += rect.top + (anchor.pad - pad0) * rect.height - anchor.y
  }, [cellW, cellH])

  function zoomAt(clientX, clientY, nextW, nextH) {
    const grid = gridRef.current
    const w = clamp(nextW, CELL_MIN, CELL_MAX)
    const h = clamp(nextH, ROW_MIN, ROW_MAX)
    if (Math.abs(w - seqUi.cellW) < 0.15 && Math.abs(h - seqUi.cellH) < 0.15) return
    const origin = grid?.querySelector('.part-cell')
    if (origin) {
      const rect = origin.getBoundingClientRect()
      if (rect.width > 1 && rect.height > 1) {
        zoomAnchor.current = {
          step: Number(origin.dataset.step) + (clientX - rect.left) / rect.width,
          pad: Number(origin.dataset.pad) + (clientY - rect.top) / rect.height,
          x: clientX,
          y: clientY,
        }
      }
    }
    seqUi.cellW = w
    seqUi.cellH = h
    touch(false)
  }

  function stepZoom(dir) {
    const grid = gridRef.current
    const factor = dir > 0 ? 1.3 : 1 / 1.3
    const rect = grid?.getBoundingClientRect()
    const x = rect ? rect.left + rect.width / 2 : 0
    const y = rect ? rect.top + rect.height / 2 : 0
    zoomAt(x, y, seqUi.cellW * factor, seqUi.cellH * factor)
  }

  const tools = (
    <div className="seq-tools" role="toolbar" aria-label="Part tools">
      <button type="button" className="btn free-width" onClick={removeBar}>− bar</button>
      <button type="button" className="btn free-width" onClick={addBar}>+ bar</button>
      <button type="button" className="btn free-width" onClick={doubleUp}>Double</button>
      <SnapControl />
      <button type="button" className={`btn free-width ${seqUi.tool === 'draw' ? 'on' : ''}`} aria-pressed={seqUi.tool === 'draw'} data-coach="draw" onClick={() => setSeqUi({ tool: 'draw' })}>Draw</button>
      <button type="button" className={`btn free-width ${seqUi.tool === 'erase' ? 'on' : ''}`} aria-pressed={seqUi.tool === 'erase'} data-coach="erase" onClick={() => setSeqUi({ tool: 'erase' })}>Erase</button>
      <button type="button" className={`btn free-width ${seqUi.tool === 'select' ? 'on' : ''}`} aria-pressed={seqUi.tool === 'select'} data-coach="select" onClick={() => setSeqUi({ tool: 'select' })}>Select</button>
      <button type="button" className={`btn free-width ${seqUi.add ? 'on' : ''}`} aria-pressed={!!seqUi.add} aria-label="Add to selection" title="Add to selection" onClick={() => setSeqUi({ add: !seqUi.add, tool: seqUi.add ? seqUi.tool : 'select' })}>Add</button>
      <button type="button" className="btn free-width" disabled={!picks.length} onClick={copySeqSelection}>Copy</button>
      <button type="button" className="btn free-width" disabled={!seqUi.clip?.notes?.length} onClick={pasteSeqSelection}>Paste</button>
      <button type="button" className={`btn free-width ${seqUi.view === 'note' ? 'on' : ''}`} aria-pressed={seqUi.view === 'note'} data-coach="note" onClick={() => setSeqUi({ view: 'note' })}>Note</button>
      <button type="button" className={`btn free-width ${seqUi.view === 'vel' ? 'on' : ''}`} aria-pressed={seqUi.view === 'vel'} data-coach="vel" onClick={() => setSeqUi({ view: 'vel' })}>Vel</button>
      <button type="button" className={`btn free-width ${seqUi.view === 'fx' ? 'on' : ''}`} aria-pressed={seqUi.view === 'fx'} data-coach="busfx" onClick={() => setSeqUi({ view: 'fx' })}>Bus FX</button>
      <span className="zoom-ctl" data-coach="zoom">
        <span>Zoom</span>
        <button type="button" className="btn free-width" aria-label="Zoom out" disabled={atMin} onClick={() => stepZoom(-1)}>−</button>
        <button type="button" className="btn free-width" aria-label="Zoom in" disabled={atMax} onClick={() => stepZoom(1)}>+</button>
      </span>
    </div>
  )

  return (
    <div className="screen seq-screen">
      <div className="seq-top">
        <PatternBar />
        <span className="hint">{steps === 1 ? '1 step' : `${steps} steps`}</span>
        {dock && slot ? createPortal(tools, slot) : tools}
        <HelpButton title="Sequence" topic="sequence" />
        <Slider
          label="Swing"
          min={0}
          max={0.6}
          step={0.01}
          value={model.swing}
          onChange={(v) => {
            model.swing = v
            touch(true)
          }}
        />
      </div>
      <div
        className="part-frame"
        ref={frameRef}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        <div className={`part view-${seqUi.view}`} data-coach="seq" ref={gridRef}>
          <div
            className="part-sheet"
            style={{
              gridTemplateColumns: `88px repeat(${steps}, ${Math.round(cellW)}px)`,
              gridTemplateRows: `max(28px, var(--touch-sm)) repeat(16, ${Math.round(cellH)}px)`,
            }}
            data-steps={steps}
            data-pad0={model.bank * 16}
          >
            <div className="part-corner">{BANKS[model.bank]}</div>
            {Array.from({ length: steps }, (_, i) => (
              <div key={`b${i}`} className={`part-beat ${i % 4 === 0 ? 'bar' : ''} ${model.playing && model.playhead === i ? 'play' : ''} ${seqUi.pasteAt === i ? 'paste' : ''}`} style={{ gridColumn: i + 2, gridRow: 1 }}>
                {i % 4 === 0 ? i / 4 + 1 : ''}
              </div>
            ))}
            {Array.from({ length: 16 }, (_, local) => {
              const pad = model.bank * 16 + local
              const fx = leadFx(pad)
              const amount = fx && fx.slot.type !== 'none' ? fx.slot.amount : 0
              const runs = runsFor(seq, pad)
              return (
                <Fragment key={pad}>
                  <div className="part-name" style={{ gridRow: local + 2 }} title={model.pads[pad].name}>{model.pads[pad].name}</div>
                  {Array.from({ length: steps }, (_, step) => (
                    <div
                      key={step}
                      className={`part-cell ${step % 4 === 0 ? 'bar' : ''} ${model.playing && model.playhead === step ? 'play' : ''}`}
                      style={{ gridColumn: step + 2, gridRow: local + 2 }}
                      data-step={step}
                      data-pad={pad}
                    >
                      {seqUi.view === 'fx' && <span className="fx" style={{ height: `${Math.round(amount * 100)}%` }} />}
                    </div>
                  ))}
                  {runs.map((run) => {
                    const picked = picks.find((p) => hitOf(p, run))
                    const box = visualSpan(run)
                    const tail = run.tail ?? 100
                    const missing = tail < 100 ? ((100 - tail) / 100) * Math.round(cellW) : 0
                    const stacked = runs.some((other) => other !== run && spansOverlap(box, visualSpan(other)))
                    return (
                      <button
                        key={`${run.lane}-${run.start}-${run.pitch}-${run.ev.nudge || 0}`}
                        type="button"
                        tabIndex={-1}
                        className={`part-note${stacked ? ' stacked' : ''}${picked ? ' sel' : ''}${picked && picked.id === seqUi.primaryId ? ' primary' : ''}`}
                        style={{
                          gridColumn: `${run.start + 2} / ${run.end + 3}`,
                          gridRow: local + 2,
                          marginRight: missing ? `calc(2px + ${missing}px)` : undefined,
                          transform: run.ev.nudge ? `translateX(${(run.ev.nudge * cellW) / 100}px)` : undefined,
                        }}
                        data-pad={pad}
                        data-start={run.start}
                        data-end={run.end}
                        data-lane={run.lane}
                        data-pitch={run.pitch}
                        aria-label={`${model.pads[pad].name} ${noteName(run.ev.pitch)} steps ${run.start + 1} to ${run.end + 1}`}
                      >
                        <span className="nm">{noteName(run.ev.pitch)}</span>
                        {seqUi.view === 'vel' && <i className="vel" style={{ height: `${Math.round((run.ev.vel ?? 0) * 100)}%` }} />}
                        {seqUi.view === 'fx' && <i className="fx" style={{ height: `${Math.round(amount * 100)}%` }} />}
                      </button>
                    )
                  })}
                </Fragment>
              )
            })}
            {seqUi.pasteAt != null && (
              <div className="seq-paste" style={{ gridColumn: seqUi.pasteAt + 2, gridRow: '1 / -1' }} />
            )}
          </div>
        </div>
        {showX && (
          <div className="seq-edge seq-edge-x" role="group" aria-label="Time handles">
            {showY && grip?.move != null && (
              <button type="button" className="seq-grip" data-handle="move" style={{ left: grip.move }} aria-label="Move in time" title="Move in time">↔</button>
            )}
            {showY && grip?.len != null && (
              <button type="button" className="seq-grip" data-handle="len" style={{ left: grip.len }} aria-label="Length" title="Length. Snap off lets the end sit between steps.">⇥</button>
            )}
            {seqUi.pasteAt != null && grip?.paste != null && (
              <button type="button" className="seq-grip seq-grip-paste" data-handle="paste" style={{ left: grip.paste }} aria-label="Paste point" title="Paste point">▼</button>
            )}
            {seqUi.pasteAt != null && (
              <button type="button" className="seq-grip seq-grip-x" data-handle="paste-x" aria-label="Remove paste point" title="Remove paste point">×</button>
            )}
          </div>
        )}
        {showY && (
          <div className="seq-edge seq-edge-y" role="group" aria-label="Pad handle">
            {grip?.row != null && (
              <button type="button" className="seq-grip" data-handle="row" style={{ top: grip.row }} aria-label="Pad row" title="Pad row">↕</button>
            )}
          </div>
        )}
      </div>
      {selected && hit && (
        <div className="seq-edit">
          <Slider
            label="Note"
            min={-24}
            max={24}
            step={1}
            value={Math.max(-24, Math.min(24, selected.ev.pitch | 0))}
            text={noteName(selected.ev.pitch)}
            onChange={(v) => {
              if (primaryRun) patchSlots(seq, primaryRun, { pitch: v })
              touch(true)
            }}
          />
          <Slider
            label="Velocity"
            min={0.05}
            max={1}
            step={0.01}
            value={selected.ev.vel}
            text={String(Math.round(selected.ev.vel * 127))}
            onChange={(v) => {
              if (primaryRun) patchSlots(seq, primaryRun, { vel: v })
              touch(true)
            }}
          />
          <Slider
            label="Micro"
            min={-50}
            max={50}
            step={1}
            value={selected.ev.nudge || 0}
            text={`${selected.ev.nudge || 0}%`}
            onChange={(v) => {
              if (primaryRun) patchSlots(seq, primaryRun, { nudge: v })
              touch(true)
            }}
          />
          <div className="seq-end" data-edge={endValue} data-step={endUnit} style={{ display: 'contents' }}>
            <Slider
              label="End"
              min={endMin}
              max={endCeiling}
              step={endUnit}
              value={endValue}
              text={formatLen(span ? endValue - span.start : endValue)}
              onChange={(v) => primaryRun && commitRunEdge(hit.pad, primaryRun.lane, primaryRun.start, v)}
            />
          </div>
          <button type="button" className="btn free-width" onClick={deleteSeqSelection}>
            {picks.length > 1 ? 'Clear hits' : 'Clear hit'}
          </button>
        </div>
      )}
    </div>
  )

  function begin(e) {
    if (e.button !== 0) return
    const grid = gridRef.current
    if (!grid) return
    // A finger counts only once its gesture is armed (capture adds it). A press that armed nothing
    // stays out, or it would sit in the map and turn the next lone finger into a pinch.
    if (pointers.current.size >= 1 && !pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const g = gesture.current
      gesture.current = null
      if (g?.frame) cancelAnimationFrame(g.frame)
      if (g?.dirty) touch(true)
      const pts = [...pointers.current.values()]
      pinch.current = {
        dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
        cellW: seqUi.cellW,
        cellH: seqUi.cellH,
      }
      capture(e)
      return
    }
    const handle = e.target.closest?.('[data-handle]')
    if (handle) {
      e.preventDefault()
      const kind = handle.dataset.handle
      if (kind === 'paste-x') {
        seqUi.pasteAt = null
        touch(false)
        return
      }
      if (kind === 'paste') {
        armPaste(grid, e)
        return
      }
      if (!seqUi.picks.length) return
      armHandle(grid, e, kind)
      return
    }
    if (e.target.closest?.('.seq-edge')) return
    const scrollTarget = e.target.closest?.('.part-name, .part-beat, .part-corner')
    if (scrollTarget && grid.contains(scrollTarget)) {
      gesture.current = { kind: 'scroll', x: e.clientX, y: e.clientY, left: grid.scrollLeft, top: grid.scrollTop }
      capture(e)
      return
    }
    const at = cellFromPoint(grid, e.clientX, e.clientY)
    if (!at) return
    e.preventDefault()
    if (seqUi.tool === 'select') {
      const place = pointInCell(at, e.clientX, e.clientY)
      const run = runAtX(currentPattern(), at.pad, at.step + place.frac)
      if (!run) {
        if (!seqUi.add) showPicks([])
        if (!seqUi.add) touch(false)
        gesture.current = { kind: 'scroll', x: e.clientX, y: e.clientY, left: grid.scrollLeft, top: grid.scrollTop }
        capture(e)
        return
      }
      const item = { id: nextPickId(), pad: run.pad, start: run.start, end: run.end, lane: run.lane }
      if (seqUi.add) {
        const i = seqUi.picks.findIndex((p) => hitOf(p, item))
        if (i >= 0) showPicks(seqUi.picks.filter((_, n) => n !== i))
        else showPicks(seqUi.picks.concat(item), item.id)
        touch(false)
        capture(e)
        return
      }
      const existing = seqUi.picks.find((p) => hitOf(p, item))
      if (existing) showPicks(seqUi.picks, existing.id)
      else showPicks([item], item.id)
      touch(false)
      armHandle(grid, e, 'move')
      return
    }
    const mode = seqUi.tool === 'erase' ? 'erase' : (seqUi.view === 'fx' ? 'fx' : 'note')
    gesture.current = { kind: 'paint', pointer: e.pointerId, seq: currentPattern(), last: at, dirty: false, fx: false, frame: 0, mode, stroke: null }
    capture(e)
    if (mode === 'erase') eraseAt(at, e.clientX)
    else if (mode === 'fx') paintFx(at, e.clientY)
    else paintStroke(at, e.clientX, e.clientY, true)
  }

  function armHandle(grid, e, kind) {
    const live = currentPattern()
    const runs = seqUi.picks.map((p) => gestureRun(live, p)).filter(Boolean)
    if (!runs.length) return
    const cell = grid.querySelector('.part-cell')?.getBoundingClientRect()
    gesture.current = {
      kind,
      pointer: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      dx: 0,
      dy: 0,
      runs,
      primaryId: seqUi.primaryId,
      cellW: cell?.width || 48,
      cellH: cell?.height || 36,
      // Song playback can move on to another pattern mid-drag. The drag stays on the one it started in.
      seq: currentPattern(),
      snapOn: model.seqSnap !== false,
      div: gridDiv(model.seqDiv),
      snap: clonePattern(currentPattern()),
      dirty: false,
      frame: 0,
    }
    capture(e)
  }

  function armPaste(grid, e) {
    const cell = grid.querySelector('.part-cell')?.getBoundingClientRect()
    gesture.current = {
      kind: 'paste',
      pointer: e.pointerId,
      x: e.clientX,
      origin: seqUi.pasteAt ?? 0,
      cellW: cell?.width || 48,
      dx: 0,
    }
    capture(e)
  }

  function capture(e) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const node = frameRef.current
    try { node?.setPointerCapture(e.pointerId) } catch { /* already gone */ }
  }

  function move(e) {
    const point = pointers.current.get(e.pointerId)
    if (point) {
      point.x = e.clientX
      point.y = e.clientY
    }
    if (pointers.current.size >= 2 && pinch.current) {
      const pts = [...pointers.current.values()]
      const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y))
      const midX = (pts[0].x + pts[1].x) / 2
      const midY = (pts[0].y + pts[1].y) / 2
      const scale = dist / pinch.current.dist
      zoomAt(midX, midY, pinch.current.cellW * scale, pinch.current.cellH * scale)
      return
    }
    const g = gesture.current
    const grid = gridRef.current
    if (!g || !grid) return
    if (g.kind === 'scroll') {
      grid.scrollLeft = g.left - (e.clientX - g.x)
      grid.scrollTop = g.top - (e.clientY - g.y)
      return
    }
    if (g.kind === 'paint') {
      const cell = cellFromPoint(grid, e.clientX, e.clientY)
      if (!cell) return
      if (g.mode === 'fx') {
        const fromCell = g.last || cell
        walkCells(grid, fromCell, cell, (at) => paintFx(at, e.clientY))
        g.last = cell
        return
      }
      if (g.mode === 'erase') {
        eraseAt(cell, e.clientX)
        return
      }
      if (g.stroke && cell.pad !== g.stroke.pad) paintStroke(cell, e.clientX, e.clientY, true)
      else paintStroke(cell, e.clientX, e.clientY, false)
      return
    }
    if (g.kind === 'paste') {
      g.dx = e.clientX - g.x
      const n = stepCount(currentPattern())
      const d = Math.round(g.dx / Math.max(8, g.cellW))
      const at = Math.max(0, Math.min(n - 1, g.origin + d))
      if (seqUi.pasteAt !== at) {
        seqUi.pasteAt = at
        touch(false)
      }
      return
    }
    g.dx = e.clientX - g.x
    g.dy = e.clientY - g.y
    if (g.frame) return
    g.frame = requestAnimationFrame(() => {
      g.frame = 0
      const next = applyGesture(g.seq || currentPattern(), g, g.dx, g.dy)
      showPicks(next, g.primaryId)
      if (!samePlace(g.runs, next)) g.dirty = true
      touch(false)
    })
  }

  function end(e) {
    if (e?.pointerId != null) pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const g = gesture.current
    gesture.current = null
    if (!g) return
    if (g.frame) {
      cancelAnimationFrame(g.frame)
      g.frame = 0
      if (g.kind !== 'paint' && g.kind !== 'scroll' && g.kind !== 'paste' && (g.dx || g.dy)) {
        const next = applyGesture(g.seq || currentPattern(), g, g.dx, g.dy)
        showPicks(next, g.primaryId)
        if (!samePlace(g.runs, next)) g.dirty = true
      }
    }
    if (g.kind === 'paint') {
      if (g.fx) syncMixer()
      if (g.dirty) touch(true)
      return
    }
    if (g.kind === 'paste' || g.kind === 'scroll') return
    if (g.dirty) touch(true)
  }

  function paintFx(at, clientY) {
    const g = gesture.current
    const place = pointInCell(at, 0, clientY)
    const led = leadFx(at.pad)
    if (!led || !g) return
    const amount = Math.round(place.up * 100) / 100
    if (led.slot.type === 'none') led.slot.type = 'filter'
    if (Math.abs(led.slot.amount - amount) >= 0.01) led.slot.amount = amount
    g.fx = true
    mark(g)
  }

  function eraseAt(at, clientX) {
    const g = gesture.current
    const seq = g?.seq || currentPattern()
    const place = pointInCell(at, clientX, 0)
    const run = runAtX(seq, at.pad, at.step + place.frac)
    if (!run) return
    clearSlots(seq, run)
    seqUi.picks = seqUi.picks.filter((p) => !hitOf(p, run))
    if (!seqUi.picks.some((p) => p.id === seqUi.primaryId)) {
      seqUi.primaryId = seqUi.picks[seqUi.picks.length - 1]?.id || null
    }
    const p = seqUi.picks.find((x) => x.id === seqUi.primaryId) || null
    model.seqHit = p ? { step: p.start, pad: p.pad, end: p.end, lane: p.lane ?? null } : null
    mark(g)
  }

  function paintStroke(at, clientX, clientY, fresh) {
    const g = gesture.current
    if (!g) return
    const seq = g.seq || currentPattern()
    const place = pointInCell(at, clientX, clientY)
    const x = at.step + place.frac
    const snap = model.seqSnap !== false
    const div = gridDiv(model.seqDiv)
    const n = stepCount(seq)
    const unit = snap ? gridUnit(div) : 1
    const pitch = Math.max(-24, Math.min(24, Math.round(-24 + place.up * 48)))
    const vel = Math.max(0.05, Math.min(1, place.up))

    if (!fresh && g.stroke && at.pad === g.stroke.pad) {
      if (seqUi.view === 'note') g.stroke.pitch = pitch
      if (seqUi.view === 'vel') g.stroke.vel = vel
      const minLen = snap ? gridUnit(div) : 1
      let end = Math.max(g.stroke.visualStart + minLen, x)
      end = capEnd(seq, g.stroke.pad, g.stroke.pitch, g.stroke.visualStart, end, g.stroke)
      if (end < g.stroke.visualStart + 0.01) end = g.stroke.visualStart + minLen
      const parts = chopParts(g.stroke.visualStart, end, n, snap, div)
      const existing = runsFor(seq, g.stroke.pad).find((r) => r.lane === g.stroke.lane && r.start === g.stroke.step)
      if (existing) clearSlots(seq, existing)
      const run = writeChop(seq, g.stroke.pad, parts, g.stroke)
      if (!run) return
      g.stroke.lane = run.lane
      g.stroke.step = run.start
      showPicks([{ id: g.stroke.pickId, pad: run.pad, start: run.start, end: run.end, lane: run.lane }], g.stroke.pickId)
      mark(g)
      return
    }

    if (!fresh) return
    const under = runAtX(seq, at.pad, x)
    if (under) {
      const patch = seqUi.view === 'note' ? { pitch } : { vel }
      patchSlots(seq, under, patch)
      g.stroke = null
      const id = nextPickId()
      showPicks([{ id, pad: under.pad, start: under.start, end: under.end, lane: under.lane }], id)
      mark(g)
      return
    }
    const guess = chopParts(x, x + unit, n, snap, div)
    const visualStart = guess.step + guess.nudge / 100
    let visualEnd = guess.end + guess.tail / 100 + guess.nudge / 100
    const room = capEnd(seq, at.pad, seqUi.view === 'note' ? pitch : 0, visualStart, visualEnd, null)
    const parts = room < visualEnd - 0.001 && room > visualStart + 0.01
      ? chopParts(visualStart, room, n, snap, div)
      : guess
    const proto = {
      vel: seqUi.view === 'vel' ? vel : 0.9,
      pitch: seqUi.view === 'note' ? pitch : 0,
      cut: true,
      lane: -1,
    }
    const run = writeChop(seq, at.pad, parts, proto)
    if (!run) return
    const pickId = nextPickId()
    const drawn = visualSpan(run)
    g.stroke = {
      pad: run.pad,
      lane: run.lane,
      step: run.start,
      visualStart: drawn.start,
      pitch: proto.pitch,
      vel: proto.vel,
      cut: true,
      pickId,
    }
    showPicks([{ id: pickId, pad: run.pad, start: run.start, end: run.end, lane: run.lane }], pickId)
    mark(g)
  }
}

function mark(g) {
  if (!g) return
  g.dirty = true
  if (g.frame) return
  g.frame = requestAnimationFrame(() => {
    g.frame = 0
    touch(false)
  })
}

function leadFx(padIndex) {
  const pad = model.pads[padIndex]
  const bus = model.buses[pad?.bus | 0]
  if (!bus?.fx?.length) return null
  const slot = bus.fx.find((s) => s && s.type && s.type !== 'none') || bus.fx[0]
  return { pad, bus, slot }
}

function readHit(col, pad) {
  const lane = (col || []).findIndex((e) => e && !e.off && e.pad === pad)
  if (lane < 0) return null
  return { lane, ev: col[lane] }
}

function formatLen(steps) {
  const q = Math.round(Number(steps) * 100) / 100
  if (!Number.isFinite(q)) return '0'
  if (Math.abs(q - Math.round(q)) < 0.001) return String(Math.round(q))
  return String(q)
}

function pointInCell(cell, clientX, clientY) {
  const rect = cell?.el?.getBoundingClientRect()
  if (!rect || rect.width < 1 || rect.height < 1) return { frac: 0, up: 0.75 }
  const frac = Math.max(0, Math.min(0.999, (clientX - rect.left) / rect.width))
  const up = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
  return { frac, up }
}

function runsFor(seq, pad) {
  const n = stepCount(seq)
  return noteRuns(seq.steps, pad).filter((run) => run.start < n).map((run) => {
    const end = Math.min(run.end, n - 1)
    const slots = run.slots.filter((slot) => slot.step <= end)
    const tail = end === run.end ? run.tail : 100
    return { ...run, pad, end, tail, slots }
  })
}

function visualSpan(run) {
  const nudge = (Number(run?.ev?.nudge) || 0) / 100
  const tail = (Number.isFinite(run?.tail) ? run.tail : 100) / 100
  return { start: run.start + nudge, end: run.end + tail + nudge }
}

function spansOverlap(a, b) {
  return a.start < b.end - 0.02 && b.start < a.end - 0.02
}

function resolvePick(seq, pick) {
  if (!pick) return null
  const runs = runsFor(seq, pick.pad)
  if (pick.lane != null) {
    const hit = runs.find((run) => run.lane === pick.lane && run.start === pick.start)
    if (hit) return hit
  }
  return runs.find((run) => run.start === pick.start && run.end === pick.end)
    || runs.find((run) => run.start === pick.start)
    || null
}

function resolveHit(seq, hit) {
  if (!hit) return null
  return resolvePick(seq, { pad: hit.pad, start: hit.step, end: hit.end ?? hit.step, lane: hit.lane })
}

function runAtX(seq, pad, x) {
  let found = null
  for (const run of runsFor(seq, pad)) {
    const span = visualSpan(run)
    if (x >= span.start - 0.001 && x < span.end - 0.001) found = run
  }
  return found
}

/** The next same-pitch note on this row. A held note stops there instead of swallowing it. */
function capEnd(seq, pad, pitch, visualStart, end, ignore) {
  let at = end
  for (const other of runsFor(seq, pad)) {
    if (ignore && other.lane === ignore.lane && other.start === ignore.step) continue
    if ((other.pitch | 0) !== (pitch | 0)) continue
    const start = visualSpan(other).start
    if (start > visualStart + 0.001 && start < at) at = start
  }
  return at
}

function nextEdge(seq, run, n) {
  return capEnd(seq, run.pad, run.pitch, visualSpan(run).start, n, { lane: run.lane, step: run.start })
}

function clearSlots(seq, run) {
  for (const slot of run.slots || []) {
    const col = seq.steps[slot.step]
    const ev = col?.[slot.lane]
    if (ev && ev.pad === run.pad) col[slot.lane] = null
  }
}

function patchSlots(seq, run, patch) {
  for (const slot of run.slots || []) {
    const ev = seq.steps[slot.step]?.[slot.lane]
    if (!ev || ev.pad !== run.pad) continue
    if (patch.vel != null) ev.vel = Math.max(0.05, Math.min(1, patch.vel))
    if (patch.pitch != null) ev.pitch = Math.max(-24, Math.min(24, patch.pitch | 0))
    if (patch.nudge != null) ev.nudge = Math.max(-50, Math.min(50, Math.round(patch.nudge)))
  }
}

function writeAt(seq, step, lane, ev, pad) {
  const col = seq.steps[step]
  if (!col) return -1
  let at = lane | 0
  if (at < 0 || at >= col.length || col[at]) {
    at = col.findIndex((e) => !e)
    if (at < 0) return -1
  }
  col[at] = normalizeEvent({ ...ev, pad })
  return at
}

/** Write one note. `cut` stays on the attack. Later steps join it. Tail sits on the last step only. */
function writeChop(seq, pad, parts, proto) {
  const base = {
    pad,
    vel: proto.vel ?? 0.9,
    pitch: proto.pitch | 0,
    nudge: parts.nudge | 0,
  }
  if (Number.isFinite(proto.sl)) base.sl = proto.sl
  if (Number.isFinite(proto.len) && Number.isFinite(proto.move)) {
    base.len = proto.len
    base.move = proto.move
  }
  const from = parts.step | 0
  const to = parts.end | 0
  if (to < from) return null
  let startLane = null
  for (let s = from; s <= to; s++) {
    const ev = { ...base }
    if (s === from && proto.cut) ev.cut = true
    if (s === to && parts.tail < 100) ev.tail = parts.tail
    const hint = s === from && proto.lane != null && proto.lane >= 0 ? proto.lane : (startLane != null ? startLane : -1)
    const lane = writeAt(seq, s, hint, ev, pad)
    if (lane < 0) {
      if (startLane == null) return null
      break
    }
    if (startLane == null) startLane = lane
  }
  if (startLane == null) return null
  return runsFor(seq, pad).find((run) => run.lane === startLane && run.start === from) || null
}

function commitRunEdge(pad, lane, start, edge) {
  const seq = currentPattern()
  const found = runsFor(seq, pad).find((run) => run.lane === lane && run.start === start)
    || runsFor(seq, pad).find((run) => run.start === start)
  if (!found) return
  const n = stepCount(seq)
  const snap = model.seqSnap !== false
  const div = gridDiv(model.seqDiv)
  const span = visualSpan(found)
  let end = Number(edge)
  const wall = nextEdge(seq, found, n)
  if (end > wall) end = wall
  const parts = chopParts(span.start, end, n, snap, div)
  const head = found.ev
  clearSlots(seq, found)
  const wrote = writeChop(seq, pad, parts, {
    vel: head.vel,
    pitch: head.pitch,
    cut: !!head.cut,
    lane: found.lane,
    sl: head.sl,
    len: head.len,
    move: head.move,
  })
  if (!wrote) return
  seqUi.picks = seqUi.picks.map((p) => (
    p.pad === pad && p.start === found.start && (p.lane == null || p.lane === found.lane)
      ? { ...p, start: wrote.start, end: wrote.end, lane: wrote.lane }
      : p
  ))
  const primary = seqUi.picks.find((p) => p.id === seqUi.primaryId) || seqUi.picks[seqUi.picks.length - 1] || null
  model.seqHit = primary ? { step: primary.start, pad: primary.pad, end: primary.end, lane: primary.lane ?? null } : null
  touch(true)
}

function gestureRun(seq, pick) {
  const run = resolvePick(seq, pick)
  if (!run) return null
  const span = visualSpan(run)
  return {
    id: pick.id,
    pad: run.pad,
    start: run.start,
    end: run.end,
    lane: run.lane,
    pitch: run.pitch,
    nudge: run.ev.nudge || 0,
    tail: run.tail,
    cut: !!run.ev.cut,
    slots: run.slots.map((slot) => ({ step: slot.step, lane: slot.lane })),
    visualStart: span.start,
    visualEnd: span.end,
    vel: run.ev.vel,
    sl: run.ev.sl,
    len: run.ev.len,
    move: run.ev.move,
  }
}

function drawnSpan(pick) {
  const run = resolvePick(currentPattern(), pick)
  if (!run) return { start: pick.start, end: (pick.end ?? pick.start) + 1 }
  return visualSpan(run)
}

function reconcile(seq, picks) {
  if (!picks.length) return picks
  let changed = false
  const out = []
  const seen = new Set()
  for (const p of picks) {
    const run = resolvePick(seq, p)
    if (!run) {
      changed = true
      continue
    }
    const key = `${p.pad}:${run.lane}:${run.start}`
    if (seen.has(key)) {
      changed = true
      continue
    }
    seen.add(key)
    if (run.start !== p.start || run.end !== p.end || run.lane !== p.lane) {
      changed = true
      out.push({ id: p.id, pad: p.pad, start: run.start, end: run.end, lane: run.lane })
    } else out.push(p)
  }
  if (!changed) return picks
  return out
}

function clonePattern(seq) {
  return seq.steps.map((col) => (col || []).map((e) => (e ? { ...e } : null)))
}

function restorePattern(seq, snap) {
  for (let s = 0; s < snap.length; s++) {
    const col = seq.steps[s]
    const src = snap[s]
    if (!col || !src) continue
    for (let i = 0; i < src.length; i++) col[i] = src[i] ? { ...src[i] } : null
  }
}

function eventsOf(snap, runs) {
  const events = []
  for (const run of runs) {
    for (const slot of run.slots || []) {
      const ev = snap[slot.step]?.[slot.lane]
      if (!ev || ev.pad !== run.pad) continue
      events.push({ step: slot.step, lane: slot.lane, ev, runId: run.id })
    }
  }
  return events
}

function clearEvents(seq, events) {
  for (const item of events) {
    const col = seq.steps[item.step]
    if (col && col[item.lane] && col[item.lane].pad === item.ev.pad) col[item.lane] = null
  }
}

function samePlace(before, after) {
  if (before.length !== after.length) return false
  for (const run of after) {
    const prev = before.find((p) => p.id === run.id)
    if (!prev || prev.pad !== run.pad || prev.start !== run.start || prev.end !== run.end) return false
    if ((prev.nudge || 0) !== (run.nudge || 0)) return false
    if ((prev.tail ?? 100) !== (run.tail ?? 100)) return false
  }
  return true
}

function slideNotes(seq, g, dx, events, runs, n) {
  const snap = g.snapOn !== false
  const div = g.div || 16
  const cell = Math.max(8, g.cellW)
  let delta = dx / cell
  const fromOf = (item) => item.step + (snap ? 0 : (item.ev.nudge || 0) / 100)
  const lo = Math.min(...events.map((item) => fromOf(item) + delta))
  if (lo < 0) delta -= lo
  const hi = Math.max(...events.map((item) => fromOf(item) + delta))
  if (hi > n - 1) delta -= hi - (n - 1)

  if (snap) {
    // One shift for the whole selection, so a long note does not collapse onto one grid line.
    const origin = Math.min(...runs.map((r) => r.start))
    const place = gridPlace(origin, 0, delta, true, n, div)
    let shift = place.step - origin
    let nudge = place.nudge
    const maxEnd = Math.max(...runs.map((r) => r.end))
    if (origin + shift < 0) shift = -origin
    if (maxEnd + shift > n - 1) {
      shift = n - 1 - maxEnd
      nudge = 0
    }
    clearEvents(seq, events)
    const next = []
    const ordered = [...runs].sort((a, b) => a.start - b.start)
    for (const run of ordered) {
      const sample = events.filter((item) => item.runId === run.id)
      let first = null
      let last = null
      let lane = run.lane
      for (const item of sample) {
        const step = item.step + shift
        if (step < 0 || step >= n) continue
        const wrote = writeAt(seq, step, item.lane, { ...item.ev, nudge }, run.pad)
        if (wrote < 0) continue
        if (first == null || step < first) {
          first = step
          lane = wrote
        }
        if (last == null || step > last) last = step
      }
      if (first != null) next.push({ ...run, start: first, end: last, lane, nudge })
    }
    return next
  }

  clearEvents(seq, events)
  const next = []
  const ordered = [...runs].sort((a, b) => a.start - b.start)
  for (const run of ordered) {
    const sample = events.filter((item) => item.runId === run.id)
    let first = null
    let last = null
    let shown = 0
    let lane = run.lane
    for (const item of sample) {
      const place = gridPlace(item.step, item.ev.nudge, delta, false, n, div)
      const wrote = writeAt(seq, place.step, item.lane, { ...item.ev, nudge: place.nudge }, run.pad)
      if (wrote < 0) continue
      if (first == null || place.step < first) {
        first = place.step
        shown = place.nudge
        lane = wrote
      }
      if (last == null || place.step > last) last = place.step
    }
    if (first != null) next.push({ ...run, start: first, end: last, lane, nudge: shown })
  }
  return next
}

function applyGesture(seq, g, dx, dy) {
  restorePattern(seq, g.snap)
  const n = stepCount(seq)
  const runs = g.runs
  if (!runs.length) return []
  const dStep = Math.round(dx / Math.max(8, g.cellW))
  const dRow = Math.round(dy / Math.max(8, g.cellH))
  const events = eventsOf(g.snap, runs)
  if (!events.length) return runs.map((run) => ({ ...run }))

  if (g.kind === 'len') {
    const delta = dx / Math.max(8, g.cellW)
    const snap = g.snapOn !== false
    const div = g.div || 16
    const planned = runs.map((run) => {
      const start = run.visualStart ?? (run.start + (run.nudge || 0) / 100)
      let end = (run.visualEnd ?? (run.end + 1)) + delta
      const minLen = snap ? gridUnit(div) : 0.01
      if (end < start + minLen) end = start + minLen
      for (const other of runs) {
        if (other === run || other.pad !== run.pad || (other.pitch | 0) !== (run.pitch | 0)) continue
        const o = other.visualStart ?? other.start
        if (o > start + 0.001 && o < end) end = o
      }
      for (const other of runsFor(seq, run.pad)) {
        if (other.lane === run.lane && other.start === run.start) continue
        if ((other.pitch | 0) !== (run.pitch | 0)) continue
        const o = visualSpan(other).start
        if (o > start + 0.001 && o < end) end = o
      }
      return { run, parts: chopParts(start, end, n, snap, div) }
    })
    clearEvents(seq, events)
    const ordered = [...planned].sort((a, b) => a.run.start - b.run.start || a.run.pad - b.run.pad)
    const next = []
    for (const item of ordered) {
      const head = events.find((ev) => ev.runId === item.run.id && ev.step === item.run.start) || events.find((ev) => ev.runId === item.run.id)
      if (!head) continue
      const wrote = writeChop(seq, item.run.pad, item.parts, {
        vel: head.ev.vel,
        pitch: head.ev.pitch,
        cut: !!head.ev.cut,
        lane: item.run.lane,
        sl: head.ev.sl,
        len: head.ev.len,
        move: head.ev.move,
      })
      if (wrote) next.push({ ...item.run, start: wrote.start, end: wrote.end, lane: wrote.lane, tail: wrote.tail, nudge: wrote.ev?.nudge || 0 })
    }
    return next
  }

  if (g.kind === 'move') return slideNotes(seq, g, dx, events, runs, n)

  let shift = g.kind === 'row' ? 0 : dStep
  let rowDelta = g.kind === 'row' ? dRow : 0
  const minStart = Math.min(...runs.map((r) => r.start))
  const maxEnd = Math.max(...runs.map((r) => r.end))
  if (minStart + shift < 0) shift = -minStart
  if (maxEnd + shift > n - 1) shift = n - 1 - maxEnd
  if (rowDelta) {
    for (const run of runs) {
      const local = run.pad - Math.floor(run.pad / 16) * 16
      if (local + rowDelta < 0) rowDelta = -local
      if (local + rowDelta > 15) rowDelta = 15 - local
    }
  }
  clearEvents(seq, events)
  const next = []
  const ordered = [...runs].sort((a, b) => a.start + shift - (b.start + shift))
  for (const run of ordered) {
    const pad = run.pad + rowDelta
    const sample = events.filter((e) => e.runId === run.id)
    let first = null
    let last = null
    let lane = run.lane
    for (const item of sample) {
      const step = item.step + shift
      if (step < 0 || step >= n) continue
      const wrote = writeAt(seq, step, item.lane, item.ev, pad)
      if (wrote < 0) continue
      if (first == null || step < first) {
        first = step
        lane = wrote
      }
      if (last == null || step > last) last = step
    }
    if (first != null) next.push({ ...run, pad, start: first, end: last, lane })
  }
  return next
}

function clamp(v, lo, hi) {
  if (hi < lo) return lo
  return Math.max(lo, Math.min(hi, v))
}

function layoutGrips(grid, frame) {
  const picks = seqUi.picks
  const pasteAt = seqUi.pasteAt
  const showNotes = picks.length > 0 && seqUi.tool !== 'erase'
  if (!showNotes && pasteAt == null) return null
  const origin = grid.querySelector('.part-cell')
  if (!origin) return null
  const o = origin.getBoundingClientRect()
  if (o.width < 1 || o.height < 1) return null
  const bar = frame.querySelector('.seq-edge-x')
  const side = frame.querySelector('.seq-edge-y')
  const gridBox = grid.getBoundingClientRect()
  const br = bar?.getBoundingClientRect()
  const sr = side?.getBoundingClientRect()
  const width = br?.width || gridBox.width
  const height = sr?.height || gridBox.height
  const barLeft = br?.left ?? gridBox.left
  const sideTop = sr?.top ?? gridBox.top
  const step0 = Number(origin.dataset.step)
  const pad0 = Number(origin.dataset.pad)
  const reserve = pasteAt != null ? 44 : 0
  const maxX = Math.max(0, width - reserve - GRIP)
  let move = null
  let len = null
  let row = null
  let paste = null
  if (showNotes) {
    let minAt = Infinity
    let maxAt = -Infinity
    for (const p of picks) {
      const box = drawnSpan(p)
      if (box.start < minAt) minAt = box.start
      if (box.end > maxAt) maxAt = box.end
    }
    const primary = picks.find((p) => p.id === seqUi.primaryId) || picks[picks.length - 1]
    const startX = o.left + (minAt - step0) * o.width - barLeft
    const endX = o.left + (maxAt - step0) * o.width - barLeft
    const rowCenter = o.top + (primary.pad - pad0) * o.height + o.height / 2 - sideTop
    move = Math.round(clamp(startX - GRIP / 2, 0, maxX))
    len = Math.round(clamp(endX - GRIP / 2, 0, maxX))
    if (len < move + GRIP + GRIP_GAP) {
      if (move + GRIP + GRIP_GAP <= maxX) len = move + GRIP + GRIP_GAP
      else move = Math.max(0, len - GRIP - GRIP_GAP)
    }
    row = Math.round(clamp(rowCenter - GRIP / 2, 0, Math.max(0, height - GRIP)))
  }
  if (pasteAt != null) {
    const pasteX = o.left + (pasteAt - step0) * o.width - barLeft
    paste = Math.round(clamp(pasteX - GRIP / 2, 0, maxX))
    for (const u of [move, len]) {
      if (u == null || Math.abs(paste - u) >= GRIP + GRIP_GAP) continue
      const right = u + GRIP + GRIP_GAP
      const left = u - GRIP - GRIP_GAP
      paste = right <= maxX ? right : Math.max(0, left)
    }
  }
  return { move, len, row, paste }
}

function gripEqual(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  return a.move === b.move && a.len === b.len && a.row === b.row && a.paste === b.paste
}

function cellFromPoint(grid, x, y) {
  const root = grid.getRootNode()
  const list = root.elementsFromPoint?.(x, y) || []
  for (const node of list) {
    if (!grid.contains(node)) continue
    const cell = node.classList?.contains('part-cell') ? node : node.closest?.('.part-cell')
    if (cell && grid.contains(cell)) {
      return { step: Number(cell.dataset.step), pad: Number(cell.dataset.pad), el: cell }
    }
  }
  const origin = grid.querySelector('.part-cell')
  const sheet = grid.querySelector('.part-sheet')
  if (!origin || !sheet) return null
  const o = origin.getBoundingClientRect()
  if (o.width < 1 || o.height < 1) return null
  const step = Math.floor((x - o.left) / o.width)
  const row = Math.floor((y - o.top) / o.height)
  const steps = Number(sheet.dataset.steps)
  const pad0 = Number(sheet.dataset.pad0)
  if (step < 0 || step >= steps || row < 0 || row > 15) return null
  const el = grid.querySelector(`.part-cell[data-step="${step}"][data-pad="${pad0 + row}"]`)
  return { step, pad: pad0 + row, el }
}

function walkCells(grid, from, to, fn) {
  let step = from.step
  let pad = from.pad
  const ds = Math.sign(to.step - step)
  const dp = Math.sign(to.pad - pad)
  fn(from)
  let guard = 0
  while ((step !== to.step || pad !== to.pad) && guard++ < 512) {
    if (Math.abs(to.step - step) >= Math.abs(to.pad - pad) && step !== to.step) step += ds
    else pad += dp
    const el = grid.querySelector(`.part-cell[data-step="${step}"][data-pad="${pad}"]`)
    fn({ step, pad, el: el || from.el })
  }
}
