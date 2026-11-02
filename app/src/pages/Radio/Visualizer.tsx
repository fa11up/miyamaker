import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import type { VisualizerMode } from '@/context/RadioProvider'
import { color } from '@/theme/tokens'

const Canvas = styled.canvas`
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  cursor: pointer;
`

const Hit = styled.button`
  all: unset;
  display: block;
  width: 100%;
  height: 100%;
  cursor: pointer;
  &:focus-visible {
    outline: 1px dotted ${color.accent};
    outline-offset: -2px;
  }
`

const BARS = 24
const PEAK_FALL = 0.012

type Kind = 'spectrum' | 'scope'

/**
 * Winamp-style spectrum / oscilloscope drawn from the radio's AnalyserNode. Click to switch modes.
 * The animation loop only runs while audio is playing, the tab is visible and motion is allowed;
 * otherwise a still frame is drawn.
 */
export default function Visualizer({
  mode,
  playing,
  getAnalyser,
}: {
  mode: VisualizerMode
  playing: boolean
  getAnalyser: () => AnalyserNode | null
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [kind, setKind] = useState<Kind>('spectrum')
  const peaks = useRef<number[]>(new Array(BARS).fill(0))

  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return undefined

    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }

      return { w, h }
    }

    const freq = new Uint8Array(1024)
    const wave = new Uint8Array(2048)

    const drawGrid = (w: number, h: number) => {
      g.fillStyle = color.dark
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#251d3a'
      for (let y = h - 2; y > 0; y -= 4) g.fillRect(0, y, w, 1)
    }

    const drawSpectrum = (w: number, h: number, data: Uint8Array | null) => {
      drawGrid(w, h)
      const gap = Math.max(1, Math.floor(w / BARS / 5))
      const bw = (w - gap * (BARS - 1)) / BARS
      const grad = g.createLinearGradient(0, h, 0, 0)
      grad.addColorStop(0, color.accentDark)
      grad.addColorStop(0.55, color.accent)
      grad.addColorStop(1, '#f5c6f6')
      for (let i = 0; i < BARS; i += 1) {
        let v = 0
        if (data) {
          // Log-spaced bins so the low end does not hog the display.
          const lo = Math.floor(2 * 1.24 ** i)
          const hi = Math.max(lo + 1, Math.floor(2 * 1.24 ** (i + 1)))
          let sum = 0
          for (let b = lo; b < hi && b < data.length; b += 1) sum += data[b] as number
          v = sum / (hi - lo) / 255
        } else {
          v = 0.08 + 0.06 * Math.abs(Math.sin(i * 1.7))
        }

        const bh = Math.max(1, Math.round(v * (h - 3)))
        const x = Math.round(i * (bw + gap))
        g.fillStyle = grad
        g.fillRect(x, h - bh, Math.ceil(bw), bh)
        const peak = Math.max(v, (peaks.current[i] || 0) - PEAK_FALL)
        peaks.current[i] = peak
        g.fillStyle = color.highlight
        g.fillRect(x, h - Math.max(2, Math.round(peak * (h - 3))) - 2, Math.ceil(bw), Math.max(1, Math.round(h / 40)))
      }
    }

    const drawScope = (w: number, h: number, data: Uint8Array | null) => {
      drawGrid(w, h)
      g.strokeStyle = color.accent
      g.lineWidth = Math.max(1, h / 30)
      g.beginPath()
      const n = data ? data.length : 2
      for (let i = 0; i < n; i += 1) {
        const x = (i / (n - 1)) * w
        const y = data ? ((data[i] as number) / 255) * h : h / 2
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }

      g.stroke()
    }

    let raf = 0
    const frame = () => {
      const { w, h } = fit()
      const analyser = getAnalyser()
      if (kind === 'spectrum') {
        if (analyser) analyser.getByteFrequencyData(freq)
        drawSpectrum(w, h, analyser ? freq : null)
      } else {
        if (analyser) analyser.getByteTimeDomainData(wave)
        drawScope(w, h, analyser ? wave : null)
      }
    }

    const animate = mode === 'live' && playing
    const loop = () => {
      if (document.visibilityState === 'visible') frame()
      raf = requestAnimationFrame(loop)
    }

    if (animate) loop()
    else {
      peaks.current = new Array(BARS).fill(0)
      frame()
    }

    return () => cancelAnimationFrame(raf)
  }, [mode, playing, kind, getAnalyser])

  const label =
    mode === 'reduced'
      ? 'Visualizer paused (reduced motion)'
      : mode === 'unavailable'
      ? 'Visualizer unavailable for this source'
      : `Visualizer: ${kind === 'spectrum' ? 'spectrum' : 'oscilloscope'}. Click to switch.`

  return (
    <Hit
      type="button"
      title={label}
      aria-label={label}
      onClick={() => setKind((k) => (k === 'spectrum' ? 'scope' : 'spectrum'))}
    >
      <Canvas ref={ref} aria-hidden="true" />
    </Hit>
  )
}
