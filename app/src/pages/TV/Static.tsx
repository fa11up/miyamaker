import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

/** prefers-reduced-motion, live. */
export function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return undefined
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return !!reduced
}

const Canvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  pointer-events: none;
  z-index: 3;
`

export const W = 160
export const H = 90

export function paint(ctx: CanvasRenderingContext2D, img: ImageData, roll: number) {
  const d = img.data
  for (let y = 0; y < H; y++) {
    // A brighter rolling band, like a detuned set.
    const band = Math.abs(((y + roll) % H) - H / 2) < 6 ? 60 : 0
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const v = Math.min(255, Math.floor(Math.random() * 255) + band)
      d[i] = v
      d[i + 1] = v
      d[i + 2] = v + (v > 200 ? 0 : 12)
      d[i + 3] = 255
    }
  }

  ctx.putImageData(img, 0, 0)
}

/**
 * CRT static shown while changing channels. With reduced motion it draws a single still frame
 * (no flicker, no rolling band) for the same short time, so the cut is still clearly a "channel change".
 */
export default function Static({ playing, reducedMotion }: { playing: boolean; reducedMotion: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!playing || !canvas || !ctx) return undefined
    const img = ctx.createImageData(W, H)
    if (reducedMotion) {
      paint(ctx, img, H / 2)
      return undefined
    }

    let raf = 0
    let roll = 0
    const tick = () => {
      roll = (roll + 3) % H
      paint(ctx, img, roll)
      raf = requestAnimationFrame(tick)
    }

    tick()
    return () => cancelAnimationFrame(raf)
  }, [playing, reducedMotion])

  if (!playing) return null
  return <Canvas ref={ref} width={W} height={H} aria-hidden data-testid="tv-static" />
}
