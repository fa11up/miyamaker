/* eslint-disable no-restricted-syntax, no-continue, no-await-in-loop, no-plusplus -- bounded, sequential RPC/parse loops read clearer as loops */
import Angel from 'assets/angel.jpg?preset=art&resize=true'
import Ghiblady from 'assets/ghiblady.jpg?preset=art&resize=true'
import Imd1616 from 'assets/imd-1616.png?preset=art&resize=true'
import Milady from 'assets/milady3.jpg?preset=art&resize=true'
import Fumo from 'assets/pet/fumo-320.webp'
import Pixelady from 'assets/pixelady.jpg?preset=art&resize=true'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import { color, font, text } from '@/theme/tokens'

import { PETS } from '../pet/registry'
import { useReducedMotion } from '../prefs'
import { ACTIVITY_EVENT } from './activity'
import { movedEnough } from './idle'

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  background: ${color.dark};
  cursor: none;
  opacity: 0;
  transition: opacity 900ms ease;
  touch-action: none;
  outline: none;
  &.shown {
    opacity: 1;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`

const Hint = styled.div`
  position: absolute;
  left: 16px;
  bottom: max(16px, env(safe-area-inset-bottom));
  font-family: ${font.ui};
  font-size: ${text.xs};
  letter-spacing: 0.08em;
  color: ${color.faceLight};
  opacity: 0.55;
  pointer-events: none;
`

type Sprite = {
  img: HTMLImageElement
  kind: 'doll' | 'art' | 'fren'
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  /** art only: the frame's area target; w/h are fitted to the image's own aspect once it loads */
  size?: number
  hue: number
}

type Star = { x: number; y: number; z: number; tw: number }

// IMD identity.md NFT #1616 leads so it is always in the mix, even on phones.
const ART = [Imd1616, Milady, Pixelady, Angel, Ghiblady].map((a) => a[a.length - 1]?.src).filter(Boolean) as string[]
const PALETTE = ['#ffffff', color.faceLight, color.accent, '#b9a7ff', color.light]

/** Size an art frame to its image's aspect ratio (same area as a size×size square), keeping it on screen. */
function fitArt(s: Sprite, W: number, H: number) {
  if (!s.size || !s.img.naturalWidth || !s.img.naturalHeight) return
  const ar = s.img.naturalWidth / s.img.naturalHeight
  s.w = Math.round(s.size * Math.sqrt(ar))
  s.h = Math.round(s.size / Math.sqrt(ar))
  s.size = undefined
  s.x = Math.min(Math.max(0, s.x), Math.max(0, W - s.w))
  s.y = Math.min(Math.max(0, s.y), Math.max(0, H - s.h))
}

function load(src: string) {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  return img
}

/**
 * Fumo dolls, fren pets and collection art bouncing DVD-logo style over a lilac starfield. Any key, click,
 * touch or real mouse movement dismisses it; the click that wakes it is swallowed so it never
 * lands on whatever is underneath.
 */
export default function Screensaver({ onDismiss }: { onDismiss: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Dismissal. Listens in the capture phase on window so nothing underneath sees the event.
  useEffect(() => {
    const startedAt = performance.now()
    let origin: { x: number; y: number } | undefined
    let done = false
    const swallow = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
    }

    const finish = () => {
      if (done) return
      done = true
      // Eat the trailing mouseup/click/touchend of the waking gesture, then come back.
      const eat = (e: Event) => swallow(e)
      const trailing = ['click', 'mouseup', 'pointerup', 'touchend', 'contextmenu'] as const
      trailing.forEach((t) => window.addEventListener(t, eat, { capture: true }))
      window.setTimeout(() => trailing.forEach((t) => window.removeEventListener(t, eat, { capture: true })), 450)
      onDismiss()
    }

    const onKey = (e: KeyboardEvent) => {
      swallow(e)
      finish()
    }

    const onDown = (e: Event) => {
      swallow(e)
      finish()
    }

    const onMove = (e: PointerEvent) => {
      // Ignore the first moments (the preview button's own click) and tiny jitters.
      if (performance.now() - startedAt < 600) return
      const p = { x: e.clientX, y: e.clientY }
      if (!origin) {
        origin = p
        return
      }

      if (movedEnough(origin, p, 24)) finish()
    }

    // Keys go to whatever has focus. Focus inside a framed app (miyakeys) would keep them from this window, and the
    // waking key would land in the app: it comes out here while the screensaver shows, and goes back after.
    const framed = document.activeElement instanceof HTMLIFrameElement ? document.activeElement : null
    const overlay = overlayRef.current
    if (framed) {
      framed.blur()
      overlay?.focus({ preventScroll: true })
    }

    // A framed app's own report of activity (activity.ts) wakes it too, in case focus went back in.
    const onActivity = () => {
      if (performance.now() - startedAt < 600) return
      finish()
    }

    window.addEventListener(ACTIVITY_EVENT, onActivity)
    window.addEventListener('keydown', onKey, { capture: true })
    window.addEventListener('pointerdown', onDown, { capture: true })
    window.addEventListener('mousedown', onDown, { capture: true })
    window.addEventListener('touchstart', onDown, { capture: true, passive: false })
    window.addEventListener('wheel', onDown, { capture: true, passive: false })
    window.addEventListener('pointermove', onMove, { capture: true })
    return () => {
      window.removeEventListener(ACTIVITY_EVENT, onActivity)
      const active = document.activeElement
      if (framed?.isConnected && (!active || active === document.body || active === overlay)) {
        framed.focus({ preventScroll: true })
      }

      window.removeEventListener('keydown', onKey, { capture: true })
      window.removeEventListener('pointerdown', onDown, { capture: true })
      window.removeEventListener('mousedown', onDown, { capture: true })
      window.removeEventListener('touchstart', onDown, { capture: true })
      window.removeEventListener('wheel', onDown, { capture: true })
      window.removeEventListener('pointermove', onMove, { capture: true })
    }
  }, [onDismiss])

  // Drawing.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return undefined

    let W = 0
    let H = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      W = window.innerWidth
      H = window.innerHeight
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()

    const small = W <= 768
    const scale = small ? 0.6 : 1
    const rand = (a: number, b: number) => a + Math.random() * (b - a)
    const speed = () => rand(55, 105) * scale * (Math.random() < 0.5 ? -1 : 1)

    const sprites: Sprite[] = []
    const dolls = small ? 2 : 3
    for (let i = 0; i < dolls; i++) {
      const h = rand(120, 170) * scale
      sprites.push({
        img: load(Fumo),
        kind: 'doll',
        x: 0,
        y: 0,
        vx: speed(),
        vy: speed(),
        w: h * (238 / 403),
        h,
        hue: 0,
      })
    }

    // A few fren pets, whole-pixel sizes so they stay crisp; shuffled so each run gets a different gang.
    const frens = [...(PETS.fren?.variants || [])].sort(() => Math.random() - 0.5).slice(0, small ? 3 : 5)
    frens.forEach((f) => {
      const zoom = small ? 2 : 3
      sprites.push({
        img: load(f.src),
        kind: 'fren',
        x: 0,
        y: 0,
        vx: speed(),
        vy: speed(),
        w: f.w * zoom,
        h: f.h * zoom,
        hue: 0,
      })
    })

    ART.slice(0, small ? 3 : ART.length).forEach((src) => {
      const s = rand(84, 118) * scale
      sprites.push({ img: load(src), kind: 'art', x: 0, y: 0, vx: speed(), vy: speed(), w: s, h: s, size: s, hue: 0 })
    })
    sprites.forEach((s) => {
      s.x = rand(0, Math.max(1, W - s.w))
      s.y = rand(0, Math.max(1, H - s.h))
      s.hue = Math.floor(rand(0, PALETTE.length))
    })

    const stars: Star[] = Array.from({ length: small ? 90 : 180 }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: rand(0.2, 1),
      tw: rand(0, Math.PI * 2),
    }))

    const drawBackground = () => {
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#0f0b1c')
      g.addColorStop(0.6, '#241c45')
      g.addColorStop(1, '#4a3a78')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }

    const drawStars = (t: number) => {
      for (const s of stars) {
        const alpha = reducedMotion ? 0.7 : 0.45 + 0.55 * Math.abs(Math.sin(s.tw + t * 0.0015 * s.z))
        ctx.globalAlpha = alpha
        ctx.fillStyle = s.z > 0.75 ? color.accent : s.z > 0.45 ? '#c9b8ff' : '#ffffff'
        const size = s.z > 0.8 ? 2 : 1
        ctx.fillRect(Math.round(s.x * W), Math.round(s.y * H), size, size)
      }

      ctx.globalAlpha = 1
    }

    const drawSprite = (s: Sprite) => {
      if (!s.img.complete || !s.img.naturalWidth) return
      if (s.kind === 'art') {
        fitArt(s, W, H)
        // Win9x picture frame in the bounce colour.
        ctx.fillStyle = PALETTE[s.hue]!
        ctx.fillRect(Math.round(s.x) - 4, Math.round(s.y) - 4, s.w + 8, s.h + 8)
        ctx.fillStyle = color.dark
        ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 1, s.w + 2, s.h + 2)
        ctx.drawImage(s.img, Math.round(s.x), Math.round(s.y), s.w, s.h)
      } else {
        ctx.save()
        ctx.imageSmoothingEnabled = s.kind !== 'fren'
        ctx.shadowColor = PALETTE[s.hue]!
        ctx.shadowBlur = 18
        ctx.drawImage(s.img, Math.round(s.x), Math.round(s.y), s.w, s.h)
        ctx.restore()
      }
    }

    const step = (dt: number) => {
      for (const s of stars) {
        s.x -= (dt / 1000) * 0.012 * s.z
        s.y += (dt / 1000) * 0.006 * s.z
        if (s.x < 0) s.x += 1
        if (s.y > 1) s.y -= 1
      }

      for (const s of sprites) {
        s.x += (s.vx * dt) / 1000
        s.y += (s.vy * dt) / 1000
        let hit = false
        if (s.x <= 0 || s.x + s.w >= W) {
          s.vx = -s.vx
          s.x = Math.min(Math.max(0, s.x), W - s.w)
          hit = true
        }

        if (s.y <= 0 || s.y + s.h >= H) {
          s.vy = -s.vy
          s.y = Math.min(Math.max(0, s.y), H - s.h)
          hit = true
        }

        if (hit) s.hue = (s.hue + 1) % PALETTE.length
      }
    }

    const frame = (t: number) => {
      drawBackground()
      drawStars(t)
      sprites.forEach(drawSprite)
    }

    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      step(Math.min(now - last, 64))
      last = now
      frame(now)
      raf = requestAnimationFrame(loop)
    }

    const onResize = () => {
      resize()
      if (reducedMotion) frame(0)
    }

    window.addEventListener('resize', onResize)

    let still: number | undefined
    if (reducedMotion) {
      // One still frame, redrawn as the images arrive; no motion.
      frame(0)
      let redraws = 0
      still = window.setInterval(() => {
        frame(0)
        if (++redraws > 6) window.clearInterval(still)
      }, 250)
    } else {
      raf = requestAnimationFrame(loop)
    }

    const onVisibility = () => {
      if (reducedMotion) return
      cancelAnimationFrame(raf)
      if (!document.hidden) {
        last = performance.now()
        raf = requestAnimationFrame(loop)
      }
    }

    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(still)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reducedMotion])

  return (
    <Overlay ref={overlayRef} tabIndex={-1} className={shown ? 'shown' : ''} role="presentation" data-screensaver="">
      <canvas ref={canvasRef} aria-hidden />
      <Hint>miyaOS · move the mouse, tap or press a key</Hint>
    </Overlay>
  )
}
