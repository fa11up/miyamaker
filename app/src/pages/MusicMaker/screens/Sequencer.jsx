import { Fragment, useRef } from 'react'
import { BANKS, model, currentPattern, setHit, clearHit, addBar, removeBar, doubleUp, stepCount, touch, busLabel } from '../model.js'
import { syncMixer } from '../audio/engine.js'
import { useModel } from '../useModel.js'
import { noteName } from '../keys.js'
import { HelpButton, Slider } from '../widgets.jsx'
import { PatternBar } from './PatternBar.jsx'

const seqUi = { tool: 'draw', view: 'vel', zoom: 1 }
const ZOOMS = [44, 64, 88, 120]
const ROW_H = [32, 40, 52, 64]

function setSeqUi(patch) {
  Object.assign(seqUi, patch)
  touch(false)
}

export function Sequencer() {
  useModel()
  const gridRef = useRef(null)
  const gesture = useRef(null)
  const seq = currentPattern()
  const start = model.bank * 16
  const steps = stepCount(seq)
  const hit = model.seqHit
  const selected = hit ? readHit(seq.steps[hit.step], hit.pad) : null
  const from = hit ? Math.min(hit.step, hit.end ?? hit.step) : 0
  const to = hit ? Math.max(hit.step, hit.end ?? hit.step) : 0
  const zoom = Math.max(0, Math.min(ZOOMS.length - 1, seqUi.zoom | 0))
  return (
    <div className="screen seq-screen">
      <div className="seq-top">
        <PatternBar />
        <button type="button" className="btn free-width" onClick={removeBar}>− bar</button>
        <button type="button" className="btn free-width" onClick={addBar}>+ bar</button>
        <button type="button" className="btn free-width" onClick={doubleUp}>Double</button>
        <span className="hint">{steps === 1 ? '1 step' : `${steps} steps`}</span>
        <div className="seq-tools" role="toolbar" aria-label="Part tools">
          <button type="button" className={`btn free-width ${seqUi.tool === 'draw' ? 'on' : ''}`} aria-pressed={seqUi.tool === 'draw'} data-coach="draw" onClick={() => setSeqUi({ tool: 'draw' })}>Draw</button>
          <button type="button" className={`btn free-width ${seqUi.tool === 'erase' ? 'on' : ''}`} aria-pressed={seqUi.tool === 'erase'} data-coach="erase" onClick={() => setSeqUi({ tool: 'erase' })}>Erase</button>
          <button type="button" className={`btn free-width ${seqUi.tool === 'select' ? 'on' : ''}`} aria-pressed={seqUi.tool === 'select'} data-coach="select" onClick={() => setSeqUi({ tool: 'select' })}>Select</button>
          <button type="button" className={`btn free-width ${seqUi.view === 'note' ? 'on' : ''}`} aria-pressed={seqUi.view === 'note'} data-coach="note" onClick={() => setSeqUi({ view: 'note' })}>Note</button>
          <button type="button" className={`btn free-width ${seqUi.view === 'vel' ? 'on' : ''}`} aria-pressed={seqUi.view === 'vel'} data-coach="vel" onClick={() => setSeqUi({ view: 'vel' })}>Vel</button>
          <button type="button" className={`btn free-width ${seqUi.view === 'fx' ? 'on' : ''}`} aria-pressed={seqUi.view === 'fx'} data-coach="busfx" onClick={() => setSeqUi({ view: 'fx' })}>Bus FX</button>
          <span className="zoom-ctl" data-coach="zoom">
            <span>Zoom</span>
            <button type="button" className="btn free-width" aria-label="Zoom out" disabled={zoom === 0} onClick={() => setSeqUi({ zoom: zoom - 1 })}>−</button>
            <button type="button" className="btn free-width" aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setSeqUi({ zoom: zoom + 1 })}>+</button>
          </span>
        </div>
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
        className={`part view-${seqUi.view}`}
        data-coach="seq"
        ref={gridRef}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div
          className="part-sheet"
          style={{
            gridTemplateColumns: `88px repeat(${steps}, ${ZOOMS[zoom]}px)`,
            gridTemplateRows: `max(28px, var(--touch-sm)) repeat(16, ${ROW_H[zoom]}px)`,
          }}
          data-steps={steps}
          data-pad0={start}
        >
          <div className="part-corner">{BANKS[model.bank]}</div>
          {Array.from({ length: steps }, (_, i) => (
            <div key={`b${i}`} className={`part-beat ${i % 4 === 0 ? 'bar' : ''} ${model.playing && model.playhead === i ? 'play' : ''}`} style={{ gridColumn: i + 2, gridRow: 1 }}>
              {i % 4 === 0 ? i / 4 + 1 : ''}
            </div>
          ))}
          {Array.from({ length: 16 }, (_, local) => {
            const pad = start + local
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
                  const on = !!(hit && hit.pad === pad && hit.step === run.start && (hit.end ?? hit.step) === run.end)
                  return (
                    <button
                      key={`${run.start}-${run.pitch}`}
                      type="button"
                      tabIndex={-1}
                      className={`part-note ${on ? 'sel' : ''}`}
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
                      {on && seqUi.tool !== 'erase' && (
                        <>
                          <span className="h-move" data-handle="move" title="Move in time">↔</span>
                          <span className="h-len" data-handle="len" title="Length">⇥</span>
                          <span className="h-row" data-handle="row" title="Pad row">↕</span>
                        </>
                      )}
                    </button>
                  )
                })}
              </Fragment>
            )
          })}
        </div>
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
              for (let s = from; s <= to; s++) setHit(s, hit.pad, { pitch: v })
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
              for (let s = from; s <= to; s++) setHit(s, hit.pad, { vel: v })
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
              for (let s = from; s <= to; s++) setHit(s, hit.pad, { nudge: v })
            }}
          />
          <button
            type="button"
            className="btn free-width"
            onClick={() => {
              for (let s = from; s <= to; s++) clearHit(s, hit.pad)
              model.seqHit = null
              touch(false)
            }}
          >
            Clear hit
          </button>
        </div>
      )}
    </div>
  )

  function begin(e) {
    if (e.button !== 0) return
    const grid = gridRef.current
    if (!grid) return
    const handle = e.target.closest?.('[data-handle]')
    if (handle && grid.contains(handle)) {
      const note = handle.closest('.part-note')
      if (!note) return
      e.preventDefault()
      armHandle(grid, e, handle.dataset.handle, note)
      return
    }
    const scrollTarget = e.target.closest?.('.part-name, .part-beat, .part-corner')
    if (scrollTarget && grid.contains(scrollTarget)) {
      gesture.current = { kind: 'scroll', x: e.clientX, y: e.clientY, left: grid.scrollLeft, top: grid.scrollTop }
      try { grid.setPointerCapture(e.pointerId) } catch { /* already gone */ }
      return
    }
    const at = cellFromPoint(grid, e.clientX, e.clientY)
    if (!at) return
    e.preventDefault()
    if (seqUi.tool === 'select') {
      const run = runAt(currentPattern(), at.pad, at.step)
      if (!run) {
        model.seqHit = null
        touch(false)
        gesture.current = { kind: 'scroll', x: e.clientX, y: e.clientY, left: grid.scrollLeft, top: grid.scrollTop }
      } else {
        model.seqHit = { step: run.start, pad: at.pad, end: run.end }
        touch(false)
        armHandle(grid, e, 'move', null, { pad: at.pad, start: run.start, end: run.end })
      }
      try { grid.setPointerCapture(e.pointerId) } catch { /* already gone */ }
      return
    }
    gesture.current = { kind: 'paint', pointer: e.pointerId, last: at, dirty: false, fx: false, frame: 0 }
    try { grid.setPointerCapture(e.pointerId) } catch { /* already gone */ }
    paintAt(at, e.clientY)
  }

  function armHandle(grid, e, kind, note, range) {
    const pad = range ? range.pad : Number(note.dataset.pad)
    const noteStart = range ? range.start : Number(note.dataset.start)
    const noteEnd = range ? range.end : Number(note.dataset.end)
    const cell = grid.querySelector('.part-cell')?.getBoundingClientRect()
    gesture.current = {
      kind,
      pointer: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      dx: 0,
      dy: 0,
      pad,
      start: noteStart,
      end: noteEnd,
      cellW: cell?.width || 48,
      cellH: cell?.height || 36,
      snap: clonePattern(currentPattern()),
      dirty: false,
      frame: 0,
    }
    try { grid.setPointerCapture(e.pointerId) } catch { /* already gone */ }
  }

  function move(e) {
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
    g.dx = e.clientX - g.x
    g.dy = e.clientY - g.y
    if (g.frame) return
    g.frame = requestAnimationFrame(() => {
      g.frame = 0
      const next = applyGesture(currentPattern(), g, g.dx, g.dy)
      model.seqHit = { step: next.start, pad: next.pad, end: next.end }
      if (next.start !== g.start || next.end !== g.end || next.pad !== g.pad) g.dirty = true
      touch(false)
    })
  }

  function end() {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    if (g.frame) {
      cancelAnimationFrame(g.frame)
      g.frame = 0
      if (g.kind !== 'paint' && g.kind !== 'scroll' && (g.dx || g.dy)) {
        const next = applyGesture(currentPattern(), g, g.dx, g.dy)
        model.seqHit = { step: next.start, pad: next.pad, end: next.end }
        if (next.start !== g.start || next.end !== g.end || next.pad !== g.pad) g.dirty = true
      }
    }
    if (g.kind === 'paint') {
      if (g.fx) syncMixer()
      if (g.dirty) touch(true)
      return
    }
    if (g.dirty) touch(true)
  }

  function paintAt(at, clientY) {
    const g = gesture.current
    const rect = at.el?.getBoundingClientRect()
    const up = rect ? 1 - Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))) : 0.75
    const column = currentPattern().steps[at.step]
    if (!column) return
    if (seqUi.tool === 'erase') {
      const lane = column.findIndex((ev) => ev && ev.pad === at.pad)
      if (lane < 0) return
      column[lane] = null
      if (model.seqHit && model.seqHit.pad === at.pad && at.step >= model.seqHit.step && at.step <= (model.seqHit.end ?? model.seqHit.step)) {
        model.seqHit = null
      }
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
    model.seqHit = run ? { step: run.start, pad: at.pad, end: run.end } : { step: at.step, pad: at.pad, end: at.step }
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

function applyGesture(seq, g, dx, dy) {
  restorePattern(seq, g.snap)
  const n = stepCount(seq)
  const events = []
  for (let s = g.start; s <= g.end; s++) {
    const hit = readHit(g.snap[s], g.pad)
    if (hit) events.push({ step: s, lane: hit.lane, ev: hit.ev })
  }
  if (!events.length) return { start: g.start, end: g.end, pad: g.pad }
  const dStep = Math.round(dx / Math.max(8, g.cellW))
  const dRow = Math.round(dy / Math.max(8, g.cellH))

  if (g.kind === 'len') {
    const tail = events[events.length - 1]
    const pitch = tail.ev.pitch | 0
    const newEnd = Math.max(g.start, Math.min(n - 1, g.end + dStep))
    if (newEnd < g.end) {
      for (let s = newEnd + 1; s <= g.end; s++) {
        const hit = readHit(seq.steps[s], g.pad)
        if (hit && (hit.ev.pitch | 0) === pitch) seq.steps[s][hit.lane] = null
      }
    } else if (newEnd > g.end) {
      for (let s = g.end + 1; s <= newEnd; s++) {
        const col = seq.steps[s]
        if (!col) continue
        for (let i = 0; i < col.length; i++) {
          if (col[i] && col[i].pad === g.pad) col[i] = null
        }
        const lane = Math.min(tail.lane, col.length - 1)
        col[lane] = { ...tail.ev, pad: g.pad }
      }
    }
    return { start: g.start, end: newEnd, pad: g.pad }
  }

  const bank = Math.floor(g.pad / 16) * 16
  const pad = g.kind === 'row' ? Math.max(bank, Math.min(bank + 15, g.pad + dRow)) : g.pad
  const shift = g.kind === 'row' ? 0 : dStep
  let start = g.start + shift
  let end = g.end + shift
  if (start < 0) {
    end -= start
    start = 0
  }
  if (end > n - 1) {
    start -= end - (n - 1)
    end = n - 1
  }
  if (start < 0) start = 0
  const applied = start - g.start
  for (const item of events) {
    const col = seq.steps[item.step]
    if (col && col[item.lane] && col[item.lane].pad === g.pad) col[item.lane] = null
  }
  for (const item of events) {
    const step = item.step + applied
    const col = seq.steps[step]
    if (!col) continue
    for (let i = 0; i < col.length; i++) {
      if (i !== item.lane && col[i] && col[i].pad === pad) col[i] = null
    }
    col[item.lane] = { ...item.ev, pad }
  }
  return { start, end, pad }
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
