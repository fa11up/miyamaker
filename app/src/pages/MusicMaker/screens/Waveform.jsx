import { useEffect, useRef } from 'react'
import { paintWave, WAVE_VIEWS } from '../waveform.js'
import { model, touch } from '../model.js'

export function Waveform({ pcm, sr, trim = null, onTrim, marks = null, onMark, tall = false }) {
  const ref = useRef(null)
  const wrap = useRef(null)
  const view = model.waveView === 0 || model.waveView === 1 || model.waveView === 2 ? model.waveView : 2
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(1, Math.floor(rect.width))
    const height = Math.max(1, Math.floor(rect.height))
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)
    if (pcm) paintWave(ctx, width, height, pcm, sr || 44100, view)
  }, [pcm, sr, view, tall])

  function fraction(event) {
    const rect = wrap.current.getBoundingClientRect()
    if (!rect.width) return 0
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  }

  function drag(which) {
    return (event) => {
      if (!onTrim || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const move = (ev) => onTrim(which, fraction(ev), false)
      const up = (ev) => {
        onTrim(which, fraction(ev), true)
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
      const move = (ev) => onMark(index, fraction(ev), false)
      const up = (ev) => {
        onMark(index, fraction(ev), true)
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

  return (
    <div className={`wave-wrap ${tall ? '' : 'wave-short'}`} ref={wrap}>
      <canvas ref={ref} />
      {trim && onTrim && (
        <>
          <div className="trim-dim left" style={{ width: `${trim.start * 100}%` }} />
          <div className="trim-dim right" style={{ width: `${(1 - trim.end) * 100}%` }} />
          <div
            className={`trim-handle trim-start ${trim.start < 0.04 ? 'inside' : ''}`}
            style={{ left: `${trim.start * 100}%` }}
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
            style={{ left: `${trim.end * 100}%` }}
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
            style={{ left: `${trim.loop * 100}%` }}
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
          style={{ left: `${mark.at * 100}%` }}
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
