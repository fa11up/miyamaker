import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

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

const Splash = styled.button`
  all: unset;
  position: absolute;
  inset: 0;
  display: block;
  cursor: progress;
  pointer-events: auto;
  background: #000;
  &:focus-visible {
    outline: 2px dashed #fff35c;
    outline-offset: -4px;
  }
`

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
    let began = 0
    let frame = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      // The whole OS's own boot comes first.
      if (document.querySelector('[data-boot]')) return
      if (!began) began = now
      const fullW = el.offsetWidth
      const fullH = el.offsetHeight
      if (!fullW || !fullH) return
      // Whole screen pixels to each scene pixel, so every square is the same size.
      const chunk = scene.pixel ? Math.max(1, Math.round(fullW / PIXEL_WIDTH)) : 1 / ratio
      const w = scene.size ? scene.size[0] : Math.round(fullW / chunk)
      const h = scene.size ? scene.size[1] : Math.round(fullH / chunk)
      if (el.width !== w || el.height !== h) {
        el.width = w
        el.height = h
      }
      g.setTransform(1, 0, 0, 1, 0, 0)
      if (!scene.pixel) g.scale(ratio, ratio)
      const shown = now - began
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

  if (done || !scene) return <>{children}</>
  return (
    <Splash type="button" aria-label="Loading. Press to skip." data-testid="app-boot" onClick={() => setDone(true)}>
      <ScenePlayer scene={scene} onDone={() => setDone(true)} />
    </Splash>
  )
}
