import { useEffect, useRef, useState } from 'react'
import { paintWave, WAVE_VIEWS } from '../waveform.js'
import { model, touch } from '../model.js'

const ZOOM_MAX = 48

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value))
}

export function Waveform({ pcm, sr, trim = null, onTrim, marks = null, onMark, tall = false, playAt = null }) {
  const ref = useRef(null)
  const wrap = useRef(null)
  const heads = useRef(null)
  const viewRef = useRef({ zoom: 1, pan: 0 })
  const pointers = useRef(new Map())
  const dragRef = useRef(null)
  const pinchRef = useRef(null)
  const lockRef = useRef(false)
  const playAtRef = useRef(playAt)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState(0)
  const view = model.waveView === 0 || model.waveView === 1 || model.waveView === 2 ? model.waveView : 2
  viewRef.current = { zoom, pan }
  playAtRef.current = playAt

  function setView(nextZoom, nextPan) {
    const z = clamp(nextZoom, 1, ZOOM_MAX)
    const maxPan = Math.max(0, 1 - 1 / z)
    const p = clamp(nextPan, 0, maxPan)
    viewRef.current = { zoom: z, pan: p }
    setZoom(z)
    setPan(p)
  }

  function zoomAt(clientX, nextZoom, basePan, baseZoom) {
    const el = wrap.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = rect.width ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0.5
    const z = clamp(nextZoom, 1, ZOOM_MAX)
    const anchor = basePan + x / Math.max(0.0001, baseZoom)
    setView(z, anchor - x / z)
  }

  useEffect(() => {
    setZoom(1)
    setPan(0)
    viewRef.current = { zoom: 1, pan: 0 }
  }, [pcm])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return undefined
    let lastW = -1
    let lastH = -1
    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(1, Math.floor(rect.width))
      const height = Math.max(1, Math.floor(rect.height))
      if (width === lastW && height === lastH) return
      lastW = width
      lastH = height
      const ctx = canvas.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, width, height)
      if (!pcm) return
      const { zoom: z, pan: p } = viewRef.current
      paintWave(ctx, width, height, pcm, sr || 44100, view, { from: p, to: Math.min(1, p + 1 / z) })
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [pcm, sr, view, zoom, pan])

  useEffect(() => {
    const el = wrap.current
    if (!el) return undefined
    const onWheel = (event) => {
      event.preventDefault()
      const { zoom: z, pan: p } = viewRef.current
      const zooming = event.ctrlKey || event.metaKey || z <= 1.001
      if (!zooming) {
        const rect = el.getBoundingClientRect()
        const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
        const delta = raw / Math.max(1, rect.width) / z
        setView(z, p + delta)
        return
      }
      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const rect = el.getBoundingClientRect()
        const raw = event.deltaX + event.deltaY
        const delta = raw / Math.max(1, rect.width) / z
        setView(z, p + delta)
        return
      }
      const scale = event.deltaMode === 1 ? 0.05 : 0.006
      const factor = clamp(Math.exp(-event.deltaY * scale), 0.8, 1.25)
      zoomAt(event.clientX, z * factor, p, z)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const showHeads = typeof playAt === 'function'
  useEffect(() => {
    if (!showHeads) {
      if (heads.current) heads.current.replaceChildren()
      return undefined
    }
    let frame = 0
    const tick = () => {
      const box = heads.current
      const read = playAtRef.current
      if (box && read) {
        const spots = read() || []
        while (box.children.length < spots.length) box.appendChild(document.createElement('i'))
        while (box.children.length > spots.length) box.removeChild(box.lastChild)
        const { zoom: z, pan: p } = viewRef.current
        for (let i = 0; i < spots.length; i++) {
          const pct = (spots[i] - p) * z * 100
          const line = box.children[i]
          const visible = pct >= 0 && pct <= 100
          line.style.display = visible ? '' : 'none'
          line.style.left = `${pct}%`
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [showHeads])

  function toFraction(clientX) {
    const rect = wrap.current?.getBoundingClientRect()
    if (!rect?.width) return 0
    const { zoom: z, pan: p } = viewRef.current
    const x = (clientX - rect.left) / rect.width
    return clamp(p + x / z, 0, 1)
  }

  function pct(fraction) {
    return (fraction - pan) * zoom * 100
  }

  function slop() {
    const rect = wrap.current?.getBoundingClientRect()
    return (14 / Math.max(1, rect?.width || 1)) / viewRef.current.zoom
  }

  function gestureMode(f) {
    if (!trim) return 'draw'
    const edge = slop()
    const start = trim.start
    const end = trim.end
    const width = end - start
    if (width < 0.985) {
      if (Math.abs(f - start) <= edge && f <= (start + end) / 2) return 'start'
      if (Math.abs(f - end) <= edge && f >= (start + end) / 2) return 'end'
      if (f >= start && f <= end) return 'move'
    }
    return 'draw'
  }

  function movedSpan(drag, f) {
    let a = drag.start + (f - drag.anchor)
    let b = a + drag.width
    if (a < 0) {
      b -= a
      a = 0
    }
    if (b > 1) {
      a -= b - 1
      b = 1
    }
    if (a < 0) a = 0
    return { start: a, end: Math.min(1, b) }
  }

  function applyGesture(drag, clientX, done) {
    if (!onTrim) return
    const travel = Math.abs(clientX - drag.x)
    if (travel < 4) return
    drag.moved = true
    const f = toFraction(clientX)
    if (drag.mode === 'draw') {
      const a = Math.min(drag.anchor, f)
      const b = Math.max(a + 0.01, Math.max(drag.anchor, f))
      onTrim('span', { start: a, end: Math.min(1, b) }, done)
    } else if (drag.mode === 'start') onTrim('start', f, done)
    else if (drag.mode === 'end') onTrim('end', f, done)
    else onTrim('span', movedSpan(drag, f), done)
  }

  function hoverCursor(event) {
    const el = wrap.current
    if (!el || !trim || !onTrim || dragRef.current || pinchRef.current) return
    const mode = gestureMode(toFraction(event.clientX))
    el.style.cursor = mode === 'move' ? 'grab' : mode === 'draw' ? 'crosshair' : 'ew-resize'
  }

  function onSurfaceDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.target.closest('button, .trim-handle, .slice-line')) return
    const el = wrap.current
    if (!el) return
    try { el.setPointerCapture(event.pointerId) } catch { /* the pointer already ended */ }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size >= 2) {
      const drag = dragRef.current
      dragRef.current = null
      if (drag?.moved) applyGesture(drag, drag.lastX, true)
      const pts = [...pointers.current.values()]
      pinchRef.current = {
        dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
        zoom: viewRef.current.zoom,
        pan: viewRef.current.pan,
        midX: (pts[0].x + pts[1].x) / 2,
      }
      lockRef.current = true
      return
    }
    if (lockRef.current || !onTrim || !trim) return
    const f = toFraction(event.clientX)
    dragRef.current = {
      mode: gestureMode(f),
      anchor: f,
      start: trim.start,
      end: trim.end,
      width: Math.max(0.01, trim.end - trim.start),
      x: event.clientX,
      lastX: event.clientX,
      moved: false,
      pointerId: event.pointerId,
    }
    if (dragRef.current.mode === 'move') el.style.cursor = 'grabbing'
  }

  function onSurfaceMove(event) {
    const point = pointers.current.get(event.pointerId)
    if (point) {
      point.x = event.clientX
      point.y = event.clientY
    }
    if (pointers.current.size >= 2 && pinchRef.current) {
      const pts = [...pointers.current.values()]
      const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y))
      const midX = (pts[0].x + pts[1].x) / 2
      const pinch = pinchRef.current
      zoomAt(midX, pinch.zoom * (dist / pinch.dist), pinch.pan, pinch.zoom)
      return
    }
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      hoverCursor(event)
      return
    }
    drag.lastX = event.clientX
    applyGesture(drag, event.clientX, false)
  }

  function onSurfaceUp(event) {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinchRef.current = null
    const drag = dragRef.current
    if (drag && drag.pointerId === event.pointerId) {
      dragRef.current = null
      applyGesture(drag, event.clientX, true)
    }
    if (pointers.current.size === 0) lockRef.current = false
    hoverCursor(event)
  }

  function drag(which) {
    return (event) => {
      if (!onTrim || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const move = (ev) => onTrim(which, toFraction(ev.clientX), false)
      const up = (ev) => {
        onTrim(which, toFraction(ev.clientX), true)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      move(event)
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
  }

  function dragMark(index) {
    return (event) => {
      if (!onMark || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const move = (ev) => onMark(index, toFraction(ev.clientX), false)
      const up = (ev) => {
        onMark(index, toFraction(ev.clientX), true)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      move(event)
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
  }

  function nudge(which, current, event) {
    if (!onTrim || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    event.stopPropagation()
    const dir = event.key === 'ArrowRight' ? 1 : -1
    const step = event.shiftKey ? 0.01 : 0.001
    onTrim(which, current + dir * step, true)
  }

  const startPct = trim ? pct(trim.start) : 0
  const endPct = trim ? pct(trim.end) : 100

  return (
    <div
      className={`wave-wrap ${tall ? '' : 'wave-short'}`}
      ref={wrap}
      data-zoom={zoom.toFixed(3)}
      data-pan={pan.toFixed(3)}
      onPointerDown={onSurfaceDown}
      onPointerMove={onSurfaceMove}
      onPointerUp={onSurfaceUp}
      onPointerCancel={onSurfaceUp}
      onDoubleClick={(event) => {
        if (event.target.closest('button, .trim-handle, .slice-line')) return
        setView(1, 0)
      }}
    >
      <canvas ref={ref} />
      <div className="playheads" ref={heads} />
      {trim && onTrim && (
        <>
          <div className="trim-dim left" style={{ width: `${clamp(startPct, 0, 100)}%` }} />
          <div className="trim-dim right" style={{ width: `${clamp(100 - endPct, 0, 100)}%` }} />
          <div
            className={`trim-handle trim-start ${trim.start < 0.04 ? 'inside' : ''}`}
            style={{ left: `${startPct}%` }}
            role="slider"
            tabIndex={0}
            aria-label="Trim start"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={Number(trim.start.toFixed(3))}
            onPointerDown={drag('start')}
            onKeyDown={(event) => nudge('start', trim.start, event)}
          >
            <i />
            <b>S</b>
          </div>
          <div
            className={`trim-handle trim-end ${trim.end > 0.96 ? 'inside' : ''}`}
            style={{ left: `${endPct}%` }}
            role="slider"
            tabIndex={0}
            aria-label="Trim end"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={Number(trim.end.toFixed(3))}
            onPointerDown={drag('end')}
            onKeyDown={(event) => nudge('end', trim.end, event)}
          >
            <i />
            <b>E</b>
          </div>
          <div
            className="trim-handle trim-lp"
            style={{ left: `${pct(trim.loop)}%` }}
            role="slider"
            tabIndex={0}
            aria-label="Loop point"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={Number(trim.loop.toFixed(3))}
            onPointerDown={drag('loop')}
            onKeyDown={(event) => nudge('loop', trim.loop, event)}
          >
            <i />
            <b>LP</b>
          </div>
        </>
      )}
      {marks && onMark && marks.map((mark) => (
        <div
          key={mark.index}
          className={`slice-line ${mark.lock ? 'lock' : ''}`}
          style={{ left: `${pct(mark.at)}%` }}
          role="slider"
          tabIndex={mark.lock ? -1 : 0}
          aria-label={`Slice ${mark.index + 1}`}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={Number(mark.at.toFixed(3))}
          onPointerDown={mark.lock ? undefined : dragMark(mark.index)}
        >
          <i />
          <b>{mark.index + 1}</b>
        </div>
      ))}
      {zoom > 1.02 && (
        <button type="button" className="wave-fit" onClick={() => setView(1, 0)}>
          Fit
        </button>
      )}
      <button
        type="button"
        className="wave-view"
        onClick={() => {
          model.waveView = (view + 1) % WAVE_VIEWS.length
          touch(true)
        }}
      >
        {WAVE_VIEWS[view]}
      </button>
    </div>
  )
}
