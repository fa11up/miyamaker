import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'
import styled from 'styled-components/macro'

import type { VisualizerMode } from '@/context/RadioProvider'

const Canvas = styled.canvas`
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
`

const Hit = styled.button`
  all: unset;
  box-sizing: border-box;
  background: transparent;
  border: 0;
  padding: 0;
  color: inherit;
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  cursor: pointer;
  &:focus-visible {
    outline: 1px dotted var(--rk-lcd-ink);
    outline-offset: 1px;
  }
`

export type VizKind = 'bars' | 'wings' | 'scope'
export const VIZ_KINDS: VizKind[] = ['bars', 'wings', 'scope']
export const VIZ_LABEL: Record<VizKind, string> = { bars: 'spectrum', wings: 'angel wings', scope: 'oscilloscope' }

const PEAK_FALL = 0.01

/** Log-spaced average of `data` for band `i` of `n` (bins 2…~620, i.e. ~40 Hz…13 kHz at 44.1 kHz). */
function band(data: Uint8Array, i: number, n: number) {
  const lo = Math.floor(2 * 310 ** (i / n))
  const hi = Math.max(lo + 1, Math.floor(2 * 310 ** ((i + 1) / n)))
  let sum = 0
  for (let b = lo; b < hi && b < data.length; b += 1) sum += data[b] as number
  return sum / (hi - lo) / 255
}

/**
 * miya radio's visualizer, drawn from the radio's AnalyserNode: LED-segment spectrum, mirrored "angel wings"
 * spectrum, or a phosphor oscilloscope. Click (or Enter) cycles the mode. The loop only runs while audio is
 * playing, the tab is visible and motion is allowed; otherwise a still frame is drawn. Colours come from the
 * skin's CSS variables. Optionally writes the bass level (0…1) to `--lvl` on `levelTarget` for the mascot.
 */
export default function Visualizer({
  mode,
  playing,
  getAnalyser,
  skin,
  levelTarget,
  compact,
  kind,
  onCycle,
}: {
  mode: VisualizerMode
  playing: boolean
  getAnalyser: () => AnalyserNode | null
  skin: string
  levelTarget?: RefObject<HTMLElement>
  compact?: boolean
  kind: VizKind
  onCycle: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const peaks = useRef<number[]>([])

  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return undefined

    const css = getComputedStyle(canvas)
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
    const pal = {
      bg: v('--rk-lcd', '#0e0a18'),
      dim: v('--rk-lcd-dim', 'rgba(255,156,242,0.1)'),
      lo: v('--rk-viz-lo', '#7a3cc4'),
      mid: v('--rk-viz-mid', '#d97ada'),
      hi: v('--rk-viz-hi', '#ffe0fb'),
      peak: v('--rk-peak', '#ffffff'),
      ink: v('--rk-lcd-ink', '#ff9cf2'),
      glow: v('--rk-lcd-glow', 'rgba(255,120,238,0.55)'),
    }

    // One canvas pixel per logical player pixel: the browser scales it up square.
    const dpr = 1
    const fit = () => {
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
    const px = Math.max(1, Math.round(dpr))

    const clear = (w: number, h: number, alpha = 1) => {
      g.globalAlpha = alpha
      g.fillStyle = pal.bg
      g.fillRect(0, 0, w, h)
      g.globalAlpha = 1
    }

    const gradient = (fromY: number, toY: number) => {
      const grad = g.createLinearGradient(0, fromY, 0, toY)
      grad.addColorStop(0, pal.lo)
      grad.addColorStop(0.6, pal.mid)
      grad.addColorStop(1, pal.hi)
      return grad
    }

    const levels = (data: Uint8Array | null, n: number) =>
      Array.from({ length: n }, (_, i) =>
        data ? Math.min(1, band(data, i, n) * 1.08) : 0.06 + 0.05 * Math.abs(Math.sin(i * 1.7 + 0.4))
      )

    const drawBars = (w: number, h: number, data: Uint8Array | null) => {
      clear(w, h)
      const n = compact ? 19 : Math.max(14, Math.min(32, Math.floor(w / (7 * px))))
      const gap = px
      const bw = Math.max(px, Math.floor((w - gap * (n - 1)) / n))
      const seg = compact ? px : 2 * px
      const space = compact ? 0 : px
      const segs = Math.max(4, Math.floor(h / (seg + space)))
      const left = Math.floor((w - (n * bw + (n - 1) * gap)) / 2)
      const grad = gradient(h, 0)
      const vals = levels(data, n)
      if (peaks.current.length !== n) peaks.current = new Array(n).fill(0)
      if (compact) {
        g.fillStyle = pal.dim
        for (let y = 1; y < h; y += 2) for (let x = 1; x < w; x += 2) g.fillRect(x, y, 1, 1)
      }

      for (let i = 0; i < n; i += 1) {
        const x = left + i * (bw + gap)
        const lit = Math.round((vals[i] as number) * segs)
        for (let s = 0; s < segs; s += 1) {
          if (s < lit || !compact) {
            const y = h - (s + 1) * (seg + space) + space
            g.fillStyle = s < lit ? grad : pal.dim
            g.fillRect(x, y, bw, seg)
          }
        }

        const peak = Math.max(vals[i] as number, (peaks.current[i] || 0) - PEAK_FALL)
        peaks.current[i] = peak
        const ps = Math.min(segs - 1, Math.round(peak * segs))
        if (data && ps > 0) {
          g.fillStyle = pal.peak
          g.fillRect(x, h - (ps + 1) * (seg + space) + space, bw, px)
        }
      }

      return vals
    }

    const drawWings = (w: number, h: number, data: Uint8Array | null) => {
      clear(w, h)
      const half = compact ? 8 : Math.max(8, Math.min(18, Math.floor(w / 2 / (6 * px))))
      const gap = px
      const bw = Math.max(px, Math.floor((w / 2 - gap * half) / half))
      const mid = Math.round(h / 2)
      const vals = levels(data, half)
      const grad = g.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, pal.hi)
      grad.addColorStop(0.3, pal.mid)
      grad.addColorStop(0.5, pal.lo)
      grad.addColorStop(0.7, pal.mid)
      grad.addColorStop(1, pal.hi)
      g.fillStyle = pal.dim
      g.fillRect(0, mid, w, px)
      for (let i = 0; i < half; i += 1) {
        // Low frequencies at the heart (centre), highs out at the wing tips; tips sweep up a little.
        const lift = (i / half) * 0.18 * h
        const level = vals[i] as number
        const bh = Math.max(px, Math.round(level * (h / 2 - px) * (1 - i / (half * 2.4))))
        const xr = Math.round(w / 2 + gap / 2 + i * (bw + gap))
        const xl = Math.round(w / 2 - gap / 2 - (i + 1) * (bw + gap) + gap)
        g.fillStyle = grad
        ;[xl, xr].forEach((x) => {
          g.fillRect(x, mid - bh - lift * level, bw, bh + lift * level)
          g.fillRect(x, mid + px, bw, Math.round(bh * 0.6))
        })
      }

      return vals
    }

    const drawScope = (w: number, h: number, data: Uint8Array | null) => {
      // Phosphor persistence: fade the previous frame instead of clearing it.
      clear(w, h, data ? 0.38 : 1)
      g.fillStyle = pal.dim
      for (let x = 0; x < w; x += 6 * px) g.fillRect(x, Math.round(h / 2), px, px)
      g.strokeStyle = pal.ink
      g.lineWidth = Math.max(1, px * 1.2)
      g.shadowColor = pal.glow
      g.shadowBlur = compact ? 0 : 6 * px
      g.beginPath()
      const n = data ? 512 : 2
      for (let i = 0; i < n; i += 1) {
        const x = (i / (n - 1)) * w
        const y = data ? (((data[i * 2] as number) - 128) / 128) * (h / 2) * 0.92 + h / 2 : h / 2
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }

      g.stroke()
      g.shadowBlur = 0
      if (!data) return null
      let e = 0
      for (let i = 0; i < wave.length; i += 16) e += Math.abs((wave[i] as number) - 128)
      return [Math.min(1, (e / (wave.length / 16) / 128) * 3)]
    }

    const target = levelTarget?.current
    let raf = 0
    const frame = () => {
      const { w, h } = fit()
      const analyser = getAnalyser()
      let vals: number[] | null
      if (kind === 'scope') {
        if (analyser) analyser.getByteTimeDomainData(wave)
        vals = drawScope(w, h, analyser ? wave : null)
      } else {
        if (analyser) analyser.getByteFrequencyData(freq)
        vals = (kind === 'bars' ? drawBars : drawWings)(w, h, analyser ? freq : null)
      }

      if (target) {
        const lvl = analyser && vals ? vals.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, vals.length) : 0
        target.style.setProperty('--lvl', lvl.toFixed(3))
      }
    }

    const animate = mode === 'live' && playing
    const loop = () => {
      if (document.visibilityState === 'visible') frame()
      raf = requestAnimationFrame(loop)
    }

    if (animate) loop()
    else {
      peaks.current = []
      frame()
    }

    const ro = typeof ResizeObserver !== 'undefined' && !animate ? new ResizeObserver(() => frame()) : null
    ro?.observe(canvas)

    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      target?.style.setProperty('--lvl', '0')
    }
  }, [mode, playing, kind, getAnalyser, skin, compact, levelTarget])

  const label =
    mode === 'reduced'
      ? 'Visualizer paused (reduced motion)'
      : mode === 'unavailable'
      ? 'Visualizer unavailable for this source'
      : `Visualizer: ${VIZ_LABEL[kind]}. Click to switch.`

  return (
    <Hit type="button" title={label} aria-label={label} onClick={onCycle}>
      <Canvas ref={ref} aria-hidden="true" />
    </Hit>
  )
}
