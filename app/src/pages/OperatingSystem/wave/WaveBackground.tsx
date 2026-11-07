import { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import { useReducedMotion } from '@/desktop/prefs'

import { waveBus } from './bus'
import { createWaveRenderer } from './renderer'
import { crestHeight, crestParams, shaderTime } from './surface'

/*
 * The animated desktop wave. An opaque WebGL canvas composited additively over the purple
 * desktop (plus-lighter; `screen` where that is missing), or, when WebGL is unavailable or keeps
 * failing, a static SVG swell at the same height so the pet can still surf it.
 */

const Canvas = styled.canvas<{ blend: string }>`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  display: block;
  mix-blend-mode: ${({ blend }) => blend};
  pointer-events: none;
`

const Fallback = styled.svg`
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
`

const FPS_CAP = 30
/** New canvases to try after a lost context before settling for the still wave. */
const MAX_REMOUNTS = 2
/** This long without losing it and the last failures no longer count against it. */
const STEADY_MS = 60_000

function taskbarHeight(): number {
  try {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--taskbar-h')) || 34
  } catch {
    return 34
  }
}

/** plus-lighter = exactly the old look (page + glow). screen is close; gain makes up the difference. */
function pickBlend(): { mode: string; gain: number } | undefined {
  try {
    if (CSS.supports('mix-blend-mode', 'plus-lighter')) return { mode: 'plus-lighter', gain: 0.1 }
    if (CSS.supports('mix-blend-mode', 'screen')) return { mode: 'screen', gain: 0.16 }
  } catch {
    /* CSS.supports missing: no blend modes either */
  }

  return undefined
}

export default function WaveBackground() {
  const reducedMotion = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const blend = useMemo(pickBlend, [])
  /** bumps to remount a fresh <canvas> after a context loss that did not come back */
  const [generation, setGeneration] = useState(0)
  const remounts = useRef(0)
  const [failed, setFailed] = useState(() => !blend)
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))

  useEffect(() => {
    if (failed || !blend) return undefined
    const canvas = canvasRef.current
    if (!canvas) return undefined
    let renderer = createWaveRenderer(canvas)
    if (!renderer) {
      setFailed(true)
      return undefined
    }

    const epoch = performance.now()
    let raf = 0
    let last = 0
    let params = crestParams(window.innerWidth, window.innerHeight, taskbarHeight())

    const measure = () => {
      if (!renderer) return
      const rect = canvas.getBoundingClientRect()
      renderer.resize(rect.width, rect.height)
      params = crestParams(rect.width, rect.height, taskbarHeight())
      waveBus.params = params
      waveBus.bottom = rect.bottom
    }

    const frame = (now: number) => {
      if (!renderer) return
      const t = reducedMotion ? 0 : shaderTime((now - epoch) / 1000, renderer.highp)
      renderer.draw(t, blend.gain)
      waveBus.frameTime = t
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < 1000 / FPS_CAP - 2) return
      last = now
      frame(now)
    }

    const start = () => {
      cancelAnimationFrame(raf)
      if (reducedMotion) {
        frame(performance.now())
        return
      }

      raf = requestAnimationFrame(loop)
    }

    const onResize = () => {
      measure()
      if (reducedMotion) frame(performance.now())
    }

    const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) : start())

    let lossTimer = 0
    let steadyTimer = 0
    const onLost = (e: Event) => {
      e.preventDefault() // allow a restore
      cancelAnimationFrame(raf)
      window.clearTimeout(steadyTimer)
      // nothing is drawn until it comes back, so there is no water to ride
      waveBus.status = 'off'
      // some browsers never restore: give it a few seconds, then start over on a new canvas
      lossTimer = window.setTimeout(() => {
        if (remounts.current >= MAX_REMOUNTS) {
          setFailed(true)
          return
        }

        remounts.current += 1
        setGeneration((g) => g + 1)
      }, 4000)
    }

    const onRestored = () => {
      window.clearTimeout(lossTimer)
      renderer = createWaveRenderer(canvas)
      if (!renderer) {
        setFailed(true)
        return
      }

      remounts.current = 0
      waveBus.status = reducedMotion ? 'still' : 'webgl'
      measure()
      start()
    }

    measure()
    waveBus.status = reducedMotion ? 'still' : 'webgl'
    start()
    steadyTimer = window.setTimeout(() => {
      remounts.current = 0
    }, STEADY_MS)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : undefined
    ro?.observe(canvas)
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(lossTimer)
      window.clearTimeout(steadyTimer)
      ro?.disconnect()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      renderer?.dispose()
      renderer = null
      waveBus.status = 'off'
    }
  }, [blend, failed, generation, reducedMotion])

  // Fallback bookkeeping: static crest at t = 0.
  useEffect(() => {
    if (!failed) return undefined
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [failed])

  useEffect(() => {
    if (!failed) return undefined
    waveBus.params = crestParams(size.w, size.h, taskbarHeight())
    waveBus.frameTime = 0
    waveBus.bottom = size.h
    waveBus.status = 'fallback'
    return () => {
      waveBus.status = 'off'
    }
  }, [failed, size])

  if (failed) return <StaticWave w={size.w} h={size.h} />
  return (
    <Canvas
      key={`${generation}-${reducedMotion}`}
      ref={canvasRef}
      blend={blend?.mode || 'normal'}
      aria-hidden
      data-wave="webgl"
    />
  )
}

/** No-WebGL wave: the same crest, frozen, as an SVG (soft swell). */
function StaticWave({ w, h }: { w: number; h: number }) {
  const d = useMemo(() => {
    const p = crestParams(w, h, taskbarHeight())
    const pts: string[] = []
    for (let x = 0; x <= w + 8; x += 8) pts.push(`${x},${(h - crestHeight(x, 0, p)).toFixed(1)}`)
    return { fill: `M0,${h} L${pts.join(' L')} L${w + 8},${h} Z` }
  }, [w, h])
  return (
    <Fallback viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden data-wave-fallback="">
      <defs>
        <linearGradient id="miya-wave-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#bfe3f5" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#bfe3f5" stopOpacity="0.02" />
        </linearGradient>
        <pattern id="miya-wave-lines" width="8" height="5" patternUnits="userSpaceOnUse">
          <rect width="8" height="2" fill="#ffffff" fillOpacity="0.05" />
        </pattern>
      </defs>
      <path d={d.fill} fill="url(#miya-wave-fill)" />
      <path d={d.fill} fill="url(#miya-wave-lines)" />
    </Fallback>
  )
}
