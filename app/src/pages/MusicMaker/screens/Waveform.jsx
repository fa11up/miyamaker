import { useEffect, useRef } from 'react'
import { paintWave, WAVE_VIEWS } from '../waveform.js'
import { model, touch } from '../model.js'

export function Waveform({ pcm, sr, marks, tall = false }) {
  const ref = useRef(null)
  const view = model.waveView || 0
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
    ctx.fillStyle = view === 2 ? '#14101f' : '#f6f4ff'
    ctx.fillRect(0, 0, width, height)
    if (pcm) paintWave(ctx, width, height, pcm, sr || 44100, view)
    if (marks && pcm) {
      const x1 = marks.start * width
      const x2 = marks.end * width
      ctx.fillStyle = 'rgba(111, 104, 148, 0.35)'
      ctx.fillRect(0, 0, x1, height)
      ctx.fillRect(x2, 0, width - x2, height)
      ctx.strokeStyle = '#a2479f'
      ctx.beginPath()
      ctx.moveTo(x1, 0)
      ctx.lineTo(x1, height)
      ctx.moveTo(x2, 0)
      ctx.lineTo(x2, height)
      ctx.stroke()
    }
  }, [pcm, sr, view, marks, tall])
  return (
    <div className={`wave-wrap ${tall ? '' : 'wave-short'}`}>
      <canvas ref={ref} />
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
