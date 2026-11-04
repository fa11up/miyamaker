import { useEffect, useRef } from 'react'
import styled from 'styled-components/macro'

import { formatDuration } from '@/music/audio'
import { color } from '@/theme/tokens'

const Track = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 36px;
  cursor: pointer;
  touch-action: none;
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }
  &:focus-visible {
    outline: 1px dotted ${color.accent};
    outline-offset: 2px;
  }
  &[aria-disabled='true'] {
    cursor: default;
  }
`

const PLACEHOLDER = Array.from({ length: 120 }, (_, i) => 0.18 + 0.1 * Math.abs(Math.sin(i * 0.37)))

/**
 * The track's waveform with a playhead: click or drag to seek, arrow keys skip 5 s.
 * Peaks come from decoding the file in the browser; linked tracks get a placeholder shape.
 */
export default function Waveform({
  peaks,
  duration,
  time,
  playing,
  getTime,
  onSeek,
}: {
  peaks?: number[]
  duration: number
  time: number
  playing: boolean
  getTime: () => number
  onSeek: (seconds: number) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef(false)

  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return undefined
    const data = peaks?.length ? peaks : PLACEHOLDER
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }

      g.clearRect(0, 0, w, h)
      const step = 3 * dpr
      const n = Math.max(1, Math.floor(w / step))
      const progress = duration > 0 ? Math.min(1, getTime() / duration) : 0
      for (let i = 0; i < n; i += 1) {
        const p = data[Math.floor((i / n) * data.length)] as number
        const bh = Math.max(2 * dpr, Math.round(p * (h - 2)))
        const x = i * step
        g.fillStyle = i / n <= progress ? '#2a6bff' : peaks?.length ? '#6c5f95' : '#3d3360'
        g.fillRect(x, Math.round((h - bh) / 2), step - dpr, bh)
      }

      if (duration > 0) {
        g.fillStyle = color.highlight
        g.fillRect(Math.round(progress * (w - dpr)), 0, Math.max(1, dpr), h)
      }
    }

    let raf = 0
    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }

    if (playing) loop()
    else draw()
    return () => cancelAnimationFrame(raf)
  }, [peaks, duration, time, playing, getTime])

  const seekAt = (clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (!r || duration <= 0) return
    onSeek(((clientX - r.left) / r.width) * duration)
  }

  return (
    <Track
      ref={box}
      role="slider"
      tabIndex={duration > 0 ? 0 : -1}
      aria-label="Track position"
      aria-disabled={duration <= 0}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${formatDuration(time)} of ${formatDuration(duration)}`}
      onPointerDown={(e) => {
        drag.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        seekAt(e.clientX)
      }}
      onPointerMove={(e) => drag.current && seekAt(e.clientX)}
      onPointerUp={() => {
        drag.current = false
      }}
      onKeyDown={(e) => {
        const jump = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[e.key]
        if (jump) onSeek(time + jump)
        else if (e.key === 'Home') onSeek(0)
        else if (e.key === 'End') onSeek(duration - 0.5)
        else return
        e.preventDefault()
      }}
    >
      <canvas ref={ref} aria-hidden="true" />
    </Track>
  )
}
