import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BANKS, model, currentPattern, addBar, removeBar, doubleUp, stepCount, touch } from '../model.js'
import { syncMixer } from '../audio/engine.js'
import { useModel } from '../useModel.js'
import { noteName } from '../keys.js'
import { HelpButton, Slider } from '../widgets.jsx'
import { PatternBar } from './PatternBar.jsx'

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
  return [{ id: seqUi.primaryId || 0, pad: hit.pad, start: hit.step, end: hit.end ?? hit.step }]
}

function showPicks(picks, primaryId = seqUi.primaryId) {
  seqUi.picks = picks
  const primary = picks.find((p) => p.id === primaryId) || picks[picks.length - 1] || null
  seqUi.primaryId = primary ? primary.id : null
  model.seqHit = primary ? { step: primary.start, pad: primary.pad, end: primary.end } : null
}

/** Copy the selected hits and drop a paste line on the next beat. */
export function copySeqSelection() {
  const picks = currentPicks()
  if (!picks.length) return false
  const seq = currentPattern()
  const anchor = Math.min(...picks.map((p) => p.start))
  const notes = []
  for (const p of picks) {
    const evs = []
    for (let s = p.start; s <= p.end; s++) {
      const hit = readHit(seq.steps[s], p.pad)
      if (hit) evs.push({ rel: s - anchor, ev: { ...hit.ev } })
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
  for (const note of clip.notes) {
    for (const item of note.evs) {
      const s = at + item.rel
      const col = seq.steps[s]
      if (!col) continue
      const pitch = item.ev.pitch | 0
      for (let i = 0; i < col.length; i++) {
        if (col[i] && col[i].pad === note.pad && (col[i].pitch | 0) === pitch) col[i] = null
      }
    }
  }
  const picks = []
  for (const note of clip.notes) {
    let start = Infinity
    let end = -1
    for (const item of note.evs) {
      const s = at + item.rel
      const col = seq.steps[s]
      if (!col) continue
      const lane = col.findIndex((e) => !e)
      if (lane < 0) continue
      col[lane] = { ...item.ev, pad: note.pad }
      if (s < start) start = s
      if (s > end) end = s
    }
    if (end >= 0) picks.push({ id: nextPickId(), pad: note.pad, start, end })
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
    for (let s = p.start; s <= p.end; s++) {
      const col = seq.steps[s]
      const hit = readHit(col, p.pad)
      if (hit) col[hit.lane] = null
    }
  }
  showPicks([])
  touch(true)
  return true
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
  const [narrow, setNarrow] = useState(false)
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
    if (!h || h.pad !== primary.pad || h.step !== primary.start || (h.end ?? h.step) !== primary.end) {
      model.seqHit = { step: primary.start, pad: primary.pad, end: primary.end }
    }
  } else if (model.seqHit) model.seqHit = null
  const hit = model.seqHit
  const selected = hit ? readHit(seq.steps[hit.step], hit.pad) : null
  const from = hit ? Math.min(hit.step, hit.end ?? hit.step) : 0
  const to = hit ? Math.max(hit.step, hit.end ?? hit.step) : 0
  const cellW = clamp(seqUi.cellW, CELL_MIN, CELL_MAX)
  const cellH = clamp(seqUi.cellH, ROW_MIN, ROW_MAX)
  const atMin = cellW <= CELL_MIN + 0.5 && cellH <= ROW_MIN + 0.5
  const atMax = cellW >= CELL_MAX - 0.5 && cellH >= ROW_MAX - 0.5
  const showY = picks.length > 0 && seqUi.tool !== 'erase'
  const showX = showY || seqUi.pasteAt != null
  const pickKey = picks.map((p) => `${p.id}:${p.pad}:${p.start}:${p.end}`).join(',')

  useEffect(() => {
    const root = frameRef.current?.getRootNode()
    const mmm = root?.querySelector?.('.mmm')
    setSlot(root?.querySelector?.('.rail-slot') || null)
    if (!mmm) return undefined
    const apply = () => setNarrow(mmm.clientWidth <= 600)
    apply()
    const watch = new ResizeObserver(apply)
    watch.observe(mmm)
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
        <button type="button" className="btn free-width" onClick={removeBar}>− bar</button>
        <button type="button" className="btn free-width" onClick={addBar}>+ bar</button>
        <button type="button" className="btn free-width" onClick={doubleUp}>Double</button>
        <span className="hint">{steps === 1 ? '1 step' : `${steps} steps`}</span>
        {narrow && slot ? createPortal(tools, slot) : tools}
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
                  {runsFor(seq, pad).map((run) => {
                    const picked = picks.find((p) => p.pad === pad && p.start === run.start && p.end === run.end)
                    return (
                      <button
                        key={`${run.start}-${run.pitch}`}
                        type="button"
                        tabIndex={-1}
                        className={`part-note${picked ? ' sel' : ''}${picked && picked.id === seqUi.primaryId ? ' primary' : ''}`}
                        style={{ gridColumn: `${run.start + 2} / ${run.end + 3}`, gridRow: local + 2 }}
                        data-pad={pad}
                        data-start={run.start}
                        data-end={run.end}
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
              <button type="button" className="seq-grip" data-handle="len" style={{ left: grip.len }} aria-label="Length" title="Length">⇥</button>
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
              for (let s = from; s <= to; s++) writeStep(s, hit.pad, { pitch: v })
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
              for (let s = from; s <= to; s++) writeStep(s, hit.pad, { vel: v })
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
              for (let s = from; s <= to; s++) writeStep(s, hit.pad, { nudge: v })
              touch(true)
            }}
          />
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
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2) {
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
      const run = runAt(currentPattern(), at.pad, at.step)
      if (!run) {
        if (!seqUi.add) showPicks([])
        if (!seqUi.add) touch(false)
        gesture.current = { kind: 'scroll', x: e.clientX, y: e.clientY, left: grid.scrollLeft, top: grid.scrollTop }
        capture(e)
        return
      }
      const item = { id: nextPickId(), pad: at.pad, start: run.start, end: run.end }
      if (seqUi.add) {
        const i = seqUi.picks.findIndex((p) => p.pad === item.pad && p.start === item.start && p.end === item.end)
        if (i >= 0) showPicks(seqUi.picks.filter((_, n) => n !== i))
        else showPicks(seqUi.picks.concat(item), item.id)
        touch(false)
        capture(e)
        return
      }
      const existing = seqUi.picks.find((p) => p.pad === item.pad && p.start === item.start && p.end === item.end)
      if (existing) showPicks(seqUi.picks, existing.id)
      else showPicks([item], item.id)
      touch(false)
      armHandle(grid, e, 'move')
      return
    }
    gesture.current = { kind: 'paint', pointer: e.pointerId, seq: currentPattern(), last: at, dirty: false, fx: false, frame: 0 }
    capture(e)
    paintAt(at, e.clientY)
  }

  function armHandle(grid, e, kind) {
    const runs = seqUi.picks.map((p) => ({ ...p }))
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
      const fromCell = g.last || cell
      walkCells(grid, fromCell, cell, (at) => paintAt(at, e.clientY))
      g.last = cell
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

  function paintAt(at, clientY) {
    const g = gesture.current
    const rect = at.el?.getBoundingClientRect()
    const up = rect ? 1 - Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))) : 0.75
    const column = (g?.seq || currentPattern()).steps[at.step]
    if (!column) return
    if (seqUi.tool === 'erase') {
      const lane = column.findIndex((ev) => ev && ev.pad === at.pad)
      if (lane < 0) return
      column[lane] = null
      seqUi.picks = seqUi.picks.filter((p) => !(p.pad === at.pad && at.step >= p.start && at.step <= p.end))
      if (!seqUi.picks.some((p) => p.id === seqUi.primaryId)) {
        seqUi.primaryId = seqUi.picks[seqUi.picks.length - 1]?.id || null
      }
      const p = seqUi.picks.find((x) => x.id === seqUi.primaryId) || null
      model.seqHit = p ? { step: p.start, pad: p.pad, end: p.end } : null
      mark(g)
      return
    }
    if (seqUi.view === 'fx') {
      const led = leadFx(at.pad)
      if (!led) return
      const amount = Math.round(up * 100) / 100
      if (led.slot.type === 'none') led.slot.type = 'filter'
      if (Math.abs(led.slot.amount - amount) >= 0.01) led.slot.amount = amount
      g.fx = true
      mark(g)
      return
    }
    let lane = column.findIndex((ev) => ev && ev.pad === at.pad)
    if (lane < 0) {
      lane = column.findIndex((ev) => !ev)
      if (lane < 0) return
      column[lane] = { pad: at.pad, vel: 0.9, pitch: 0, nudge: 0 }
    }
    const ev = column[lane]
    if (seqUi.view === 'note') {
      const pitch = Math.max(-24, Math.min(24, Math.round(-24 + up * 48)))
      if ((ev.pitch | 0) !== pitch) ev.pitch = pitch
    } else {
      const vel = Math.max(0.05, Math.min(1, up))
      if (Math.abs(ev.vel - vel) >= 0.01) ev.vel = vel
    }
    const run = runAt(currentPattern(), at.pad, at.step)
    const item = run
      ? { id: nextPickId(), pad: at.pad, start: run.start, end: run.end }
      : { id: nextPickId(), pad: at.pad, start: at.step, end: at.step }
    showPicks([item], item.id)
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

/** Consecutive steps of one pad with one pitch. The tracker stores each of those steps. */
function runsFor(seq, pad) {
  const n = stepCount(seq)
  const runs = []
  let cur = null
  for (let s = 0; s < n; s++) {
    const hit = readHit(seq.steps[s], pad)
    if (!hit) {
      cur = null
      continue
    }
    const pitch = hit.ev.pitch | 0
    if (cur && cur.pitch === pitch && cur.end === s - 1) cur.end = s
    else {
      cur = { start: s, end: s, pitch, ev: hit.ev }
      runs.push(cur)
    }
  }
  return runs
}

function runAt(seq, pad, step) {
  const n = stepCount(seq)
  if (step < 0 || step >= n) return null
  const here = readHit(seq.steps[step], pad)
  if (!here) return null
  const pitch = here.ev.pitch | 0
  let start = step
  let end = step
  while (start > 0) {
    const prev = readHit(seq.steps[start - 1], pad)
    if (!prev || (prev.ev.pitch | 0) !== pitch) break
    start -= 1
  }
  while (end + 1 < n) {
    const next = readHit(seq.steps[end + 1], pad)
    if (!next || (next.ev.pitch | 0) !== pitch) break
    end += 1
  }
  return { start, end, ev: here.ev }
}

function reconcile(seq, picks) {
  if (!picks.length) return picks
  let changed = false
  const out = []
  const seen = new Set()
  for (const p of picks) {
    const run = runAt(seq, p.pad, p.start)
    if (!run) {
      changed = true
      continue
    }
    const key = `${p.pad}:${run.start}:${run.end}`
    if (seen.has(key)) {
      changed = true
      continue
    }
    seen.add(key)
    if (run.start !== p.start || run.end !== p.end) {
      changed = true
      out.push({ id: p.id, pad: p.pad, start: run.start, end: run.end })
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
    for (let s = run.start; s <= run.end; s++) {
      const hit = readHit(snap[s], run.pad)
      if (!hit) continue
      events.push({ step: s, lane: hit.lane, ev: hit.ev, runId: run.id })
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

function writeAt(seq, step, lane, ev, pad) {
  const col = seq.steps[step]
  if (!col) return false
  const pitch = ev.pitch | 0
  for (let i = 0; i < col.length; i++) {
    if (i !== lane && col[i] && col[i].pad === pad && (col[i].pitch | 0) === pitch) col[i] = null
  }
  if (lane < 0 || lane >= col.length || (col[lane] && col[lane].pad !== pad)) {
    const empty = col.findIndex((e) => !e)
    if (empty >= 0) lane = empty
    else if (lane < 0 || lane >= col.length) return false
  }
  col[lane] = { ...ev, pad }
  return true
}

function writeStep(step, pad, patch) {
  const col = currentPattern().steps[step]
  if (!col) return
  const hit = readHit(col, pad)
  if (!hit) return
  const ev = col[hit.lane]
  if (patch.vel != null) ev.vel = Math.max(0.05, Math.min(1, patch.vel))
  if (patch.pitch != null) ev.pitch = Math.max(-24, Math.min(24, patch.pitch | 0))
  if (patch.nudge != null) ev.nudge = Math.max(-50, Math.min(50, Math.round(patch.nudge)))
}

function samePlace(before, after) {
  if (before.length !== after.length) return false
  for (const run of after) {
    const prev = before.find((p) => p.id === run.id)
    if (!prev || prev.pad !== run.pad || prev.start !== run.start || prev.end !== run.end) return false
  }
  return true
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
    clearEvents(seq, events)
    const foreign = new Set()
    for (let s = 0; s < n; s++) {
      const col = seq.steps[s] || []
      for (const ev of col) {
        if (ev && ev.pad != null) foreign.add(`${ev.pad}:${s}`)
      }
    }
    const planned = runs.map((run) => {
      let end = Math.max(run.start, Math.min(n - 1, run.end + dStep))
      if (end > run.end) {
        for (let s = run.end + 1; s <= end; s++) {
          const reserved = runs.some((other) => other !== run && other.pad === run.pad && s >= other.start && s <= other.end)
          if (reserved || foreign.has(`${run.pad}:${s}`)) {
            end = s - 1
            break
          }
        }
      }
      return { ...run, end }
    })
    const written = new Set()
    const ordered = planned.sort((a, b) => a.start - b.start || a.pad - b.pad)
    const next = []
    for (const run of ordered) {
      let end = run.end
      for (let s = run.start; s <= end; s++) {
        if (written.has(`${run.pad}:${s}`)) {
          end = s - 1
          break
        }
      }
      if (end < run.start) continue
      const sample = events.filter((e) => e.runId === run.id)
      const tail = sample[sample.length - 1]
      if (!tail) continue
      let placed = false
      for (let s = run.start; s <= end; s++) {
        const orig = sample.find((e) => e.step === s)
        const ev = orig ? orig.ev : tail.ev
        const lane = orig ? orig.lane : tail.lane
        if (!writeAt(seq, s, lane, ev, run.pad)) continue
        written.add(`${run.pad}:${s}`)
        placed = true
      }
      if (placed) next.push({ ...run, end })
    }
    return next
  }

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
    for (const item of sample) {
      const step = item.step + shift
      if (step < 0 || step >= n) continue
      if (!writeAt(seq, step, item.lane, item.ev, pad)) continue
      if (first == null || step < first) first = step
      if (last == null || step > last) last = step
    }
    if (first != null) next.push({ ...run, pad, start: first, end: last })
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
    const minStart = Math.min(...picks.map((p) => p.start))
    const maxEnd = Math.max(...picks.map((p) => p.end))
    const primary = picks.find((p) => p.id === seqUi.primaryId) || picks[picks.length - 1]
    const startX = o.left + (minStart - step0) * o.width - barLeft
    const endX = o.left + (maxEnd + 1 - step0) * o.width - barLeft
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
