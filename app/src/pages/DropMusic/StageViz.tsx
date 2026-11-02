import { useEffect, useRef } from 'react'
import styled from 'styled-components/macro'

import { color } from '@/theme/tokens'

const Canvas = styled.canvas`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 62%;
  display: block;
  image-rendering: pixelated;
  pointer-events: none;
`

const BARS = 32
const BLOCK = 4

export type VizMood = 'idle' | 'live' | 'synth' | 'still'

/**
 * The stage's light show: mirrored LED-block spectrum bars rising from the floor, with a faint reflection.
 * It also writes the bass level to `--lvl` (0..1) on `levelTarget`, so CSS can pump the speakers, lights and disc.
 *
 * mood: 'live' reads the analyser, 'synth' fakes energetic bars (linked audio has no analyser), 'idle' breathes
 * gently while nothing plays, 'still' draws one frame and stops (reduced motion).
 */
export default function StageViz({
  mood,
  getAnalyser,
  levelTarget,
}: {
  mood: VizMood
  getAnalyser: () => AnalyserNode | null
  levelTarget: React.RefObject<HTMLElement>
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const peaks = useRef<number[]>(new Array(BARS).fill(0))

  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return undefined
    const freq = new Uint8Array(512)
    let level = 0
    let raf = 0
    let last = 0

    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }

      return { w, h, dpr }
    }

    const values = (t: number): number[] => {
      const out: number[] = []
      const analyser = mood === 'live' ? getAnalyser() : null
      if (analyser) analyser.getByteFrequencyData(freq)
      for (let i = 0; i < BARS; i += 1) {
        let v: number
        if (analyser) {
          const lo = Math.floor(1.5 * 1.16 ** i)
          const hi = Math.max(lo + 1, Math.floor(1.5 * 1.16 ** (i + 1)))
          let sum = 0
          for (let b = lo; b < hi && b < freq.length; b += 1) sum += freq[b] as number
          v = Math.min(1, (sum / (hi - lo) / 255) ** 1.25 * (1.15 + i / BARS / 2))
        } else if (mood === 'synth' || (mood === 'live' && !analyser)) {
          const beat = Math.max(0, Math.sin(t * 7.8)) ** 6
          v = 0.25 + 0.3 * Math.abs(Math.sin(t * 3.1 + i * 0.7)) * (1 - i / BARS / 1.5) + beat * 0.35 * (1 - i / BARS)
        } else {
          v = 0.1 + 0.07 * Math.sin(t * 1.3 + i * 0.45) + 0.05 * Math.sin(t * 2.1 - i * 0.9)
        }

        out.push(Math.max(0.02, Math.min(1, v)))
      }

      return out
    }

    const draw = (t: number) => {
      const { w, h, dpr } = fit()
      g.clearRect(0, 0, w, h)
      const v = values(t)
      const block = BLOCK * dpr
      const floor = Math.round(h * 0.78)
      const half = BARS / 2
      const colW = w / BARS
      const barW = Math.max(block, Math.floor(colW - block / 2))
      const grad = g.createLinearGradient(0, floor, 0, 0)
      grad.addColorStop(0, color.accentDark)
      grad.addColorStop(0.5, color.accent)
      grad.addColorStop(0.85, '#f5c6f6')
      grad.addColorStop(1, color.highlight)
      for (let c = 0; c < BARS; c += 1) {
        // Mirror: low frequencies in the middle, highs to the edges.
        const idx = c < half ? half - 1 - c : c - half
        const val = v[idx * 2 > BARS - 1 ? BARS - 1 : idx * 2] as number
        const x = Math.round(c * colW + (colW - barW) / 2)
        const blocks = Math.max(1, Math.round((val * floor * 0.95) / block))
        g.fillStyle = grad
        for (let b = 0; b < blocks; b += 1) {
          g.fillRect(x, floor - (b + 1) * block, barW, block - Math.max(1, dpr))
        }

        // Reflection on the floor.
        g.globalAlpha = 0.18
        const refl = Math.min(blocks, Math.floor((h - floor) / block))
        for (let b = 0; b < refl; b += 1) g.fillRect(x, floor + b * block + 1, barW, block - Math.max(1, dpr))
        g.globalAlpha = 1
        // Falling peak caps.
        const peak = Math.max(val, (peaks.current[c] || 0) - 0.01)
        peaks.current[c] = peak
        g.fillStyle = color.highlight
        g.fillRect(x, floor - Math.round(peak * floor * 0.95) - block, barW, Math.max(1, dpr * 2))
      }

      // Bass drives the lights.
      const bass = ((v[0] as number) + (v[1] as number) + (v[2] as number)) / 3
      level += (bass - level) * 0.35
      levelTarget.current?.style.setProperty('--lvl', level.toFixed(3))
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      // ~40 fps is plenty for chunky pixels.
      if (now - last < 24 || document.visibilityState !== 'visible') return
      last = now
      draw(now / 1000)
    }

    if (mood === 'still') {
      peaks.current = new Array(BARS).fill(0)
      draw(1.7)
      levelTarget.current?.style.setProperty('--lvl', '0')
    } else raf = requestAnimationFrame(loop)

    return () => cancelAnimationFrame(raf)
  }, [mood, getAnalyser, levelTarget])

  return <Canvas ref={ref} aria-hidden="true" />
}
