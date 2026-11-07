import { useEffect, useRef } from 'react'
import styled from 'styled-components/macro'

import { type, typeWidth } from '@/components/AppBoot/scenes'

import { H, paint, W } from './Static'

const Button = styled.button`
  all: unset;
  position: absolute;
  inset: 0;
  z-index: 3;
  display: block;
  cursor: progress;
  pointer-events: auto;
  background: #000;
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }
`

const MS = 2200

/** The set's own colours, as the no-signal card has them. */
function card(g: CanvasRenderingContext2D) {
  const glow = g.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, W * 0.6)
  glow.addColorStop(0, '#4a2c14')
  glow.addColorStop(0.55, '#24130a')
  glow.addColorStop(1, '#0a0503')
  g.fillStyle = glow
  g.fillRect(0, 0, W, H)
  const x = Math.round((W - typeWidth('MIYATV', 3)) / 2)
  type(g, 'MIYATV', x + 2, 36, 3, '#8a4a14')
  type(g, 'MIYATV', x, 34, 3, '#ffffff')
  g.fillStyle = 'rgba(0, 0, 0, 0.18)'
  for (let y = 0; y < H; y += 2) g.fillRect(0, y, W, 1)
}

/** The tube warming up on the set's own glass: a dot, a line, the static of a channel change, then the set's card. */
export default function PowerOn({ onDone }: { onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const g = canvas.current?.getContext('2d')
    if (!g) {
      done.current()
      return undefined
    }
    const img = g.createImageData(W, H)
    let began = 0
    let frame = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      // The whole OS's own boot comes first.
      if (document.querySelector('[data-boot]')) return
      if (!began) began = now
      const t = (now - began) / 1000
      if (t < 0.35) {
        g.fillStyle = '#000'
        g.fillRect(0, 0, W, H)
        g.fillStyle = '#fff'
        const long = t < 0.1 ? 2 : 2 + ((t - 0.1) / 0.25) * W
        g.fillRect(Math.round((W - long) / 2), H / 2, Math.round(long), 1)
      } else if (t < 1.35) {
        paint(g, img, Math.floor(t * 180) % H)
        const shut = Math.round((H / 2) * Math.max(0, 1 - (t - 0.35) / 0.2))
        g.fillStyle = '#000'
        g.fillRect(0, 0, W, shut)
        g.fillRect(0, H - shut, W, shut)
      } else {
        card(g)
      }
      if (now - began >= MS) done.current()
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <Button type="button" aria-label="The set is warming up. Press to skip." data-testid="tv-power-on" onClick={onDone}>
      <canvas ref={canvas} width={W} height={H} />
    </Button>
  )
}
