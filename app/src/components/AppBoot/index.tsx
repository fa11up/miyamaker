import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import { preloadApp } from '@/constants/appLoaders'

import type { Scene } from './scenes'
import { SCENES } from './scenes'

const Picture = styled.canvas`
  display: block;
  width: 100%;
  height: 100%;
  &.pixel {
    image-rendering: pixelated;
  }
`

/* No window yet: only the app's card, floating where the window will open. Any press in that space skips it. */
const Splash = styled.button`
  all: unset;
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  cursor: progress;
  pointer-events: auto;
  background: transparent;
  &:focus-visible > div {
    outline: 2px dashed #fff35c;
    outline-offset: 4px;
  }
`

/* The card itself: a whole multiple of the scene's pixels, with a shadow that follows its outline. */
const Card = styled.div`
  filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.45));
`

/** The largest whole scale, up to 3, that fits the card in the space and keeps it under 450px wide. */
export function cardScale(size: [number, number], room: { width: number; height: number }) {
  const fit = Math.min((room.width * 0.9) / size[0], (room.height * 0.9) / size[1], 450 / size[0])
  return Math.max(1, Math.min(3, Math.floor(fit)))
}

/** A pixel scene is about this many pixels wide, whatever the window. */
const PIXEL_WIDTH = 240

/** Plays one scene on a canvas filling its parent, then says so. */
export function ScenePlayer({ scene, onDone }: { scene: Scene; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const el = canvas.current
    const g = el?.getContext('2d')
    if (!el || !g) {
      done.current()
      return undefined
    }
    const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    // Time actually on screen: a minimized window's scene waits for it to come back.
    let shown = 0
    let last = 0
    let frame = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const fullW = el.offsetWidth
      const fullH = el.offsetHeight
      // The whole OS's own boot comes first.
      if (document.querySelector('[data-boot]') || !fullW || !fullH) {
        last = 0
        return
      }

      // A long gap between frames is a tab that was in the background.
      if (last) shown += Math.min(now - last, 100)
      last = now
      // Whole screen pixels to each scene pixel, so every square is the same size.
      const chunk = scene.pixel ? Math.max(1, Math.round(fullW / PIXEL_WIDTH)) : 1 / ratio
      const w = scene.size ? scene.size[0] : Math.round(fullW / chunk)
      const h = scene.size ? scene.size[1] : Math.round(fullH / chunk)
      if (el.width !== w || el.height !== h) {
        el.width = w
        el.height = h
      }
      g.setTransform(1, 0, 0, 1, 0, 0)
      // A card has a shaped outline: what is outside it stays see-through.
      if (scene.size) g.clearRect(0, 0, w, h)
      if (!scene.pixel) g.scale(ratio, ratio)
      const t = quiet ? scene.ms / 1000 : shown / 1000
      if (scene.pixel) scene.draw(g, t, w, h)
      else scene.draw(g, t, fullW, fullH)
      if (shown >= (quiet ? 500 : scene.ms)) done.current()
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [scene])

  return <Picture ref={canvas} className={scene.pixel ? 'pixel' : undefined} />
}

/** Plays the app's boot scene, then loads the app. Nothing behind it runs until then; any press skips it. */
export default function AppBoot({ identifier, children }: { identifier: string; children: ReactNode }) {
  const scene = SCENES[identifier]
  const [done, setDone] = useState(!scene)
  const room = useRef<HTMLButtonElement>(null)
  const [scale, setScale] = useState(0)

  // The scene is the wait, so the app downloads during it and is ready when it ends.
  useEffect(() => preloadApp(identifier), [identifier])

  useEffect(() => {
    const el = room.current
    if (!el || !scene?.size || done) return undefined
    const size = scene.size
    const measure = () => setScale(cardScale(size, { width: el.clientWidth, height: el.clientHeight }))
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [scene, done])

  if (done || !scene) return <>{children}</>
  const size = scene.size
  return (
    <Splash ref={room} type="button" aria-label="Loading. Press to skip." data-testid="app-boot" onClick={() => setDone(true)}>
      {size ? (
        scale > 0 && (
          <Card style={{ width: size[0] * scale, height: size[1] * scale }}>
            <ScenePlayer scene={scene} onDone={() => setDone(true)} />
          </Card>
        )
      ) : (
        <ScenePlayer scene={scene} onDone={() => setDone(true)} />
      )}
    </Splash>
  )
}
