import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useWindowSize } from 'usehooks-ts'

import { useWindows } from '@/store/windows/hooks'

import { shapeOf, tintOf, useLook } from './look'
import type { Body3D } from './nav'
import { Body3DContext } from './nav'
import type { DeviceScene, Layout, Part } from './scene'
import { deviceZoom } from './status'

const PERSPECTIVE = 1100
const MARGIN = 70
/** Tiny movements: how far it leans to the pointer, and how far it drifts on its own, in degrees. */
const LEAN = { x: 3, y: 4.5 }
const DRIFT = { x: 0.6, y: 0.9 }
/** How long a slow connection waits for the 3D body before getting the CSS device, which it then swaps out if the body comes. */
const BODY_WAIT_MS = 8000

const Holder = styled.div`
  position: relative;
  pointer-events: none;
  perspective: ${PERSPECTIVE}px;
  &.phone {
    margin: 0 auto;
  }
  /* Only its own canvas: the opening scene draws on another one, inside the screen. */
  > canvas {
    position: absolute;
    display: block;
    left: -${MARGIN}px;
    top: -${MARGIN}px;
    pointer-events: none;
  }
`

const Tilt = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  transform-style: preserve-3d;
  will-change: transform;
`

/** Its shadow on the desktop, which slides opposite to the lean. */
const Ground = styled.div`
  position: absolute;
  left: 8%;
  right: 8%;
  top: 10%;
  bottom: -4%;
  border-radius: 30%;
  background: rgba(10, 6, 30, 0.5);
  filter: blur(26px);
  transform: translate(calc(var(--gx, 0) * -14px + 12px), calc(var(--gy, 0) * 10px + 16px));
`

/** How big the device is on this screen, shared so the view inside and the stage agree. */
export function useDeviceFit() {
  const look = useLook()
  const { width, height } = useWindowSize()
  const phone = width > 0 && width <= 480
  const shape = shapeOf(look.shape)
  // The desktop keeps its taskbar in view; a phone's is taller.
  const zoom = deviceZoom(width - (phone ? 18 : 0), height - (phone ? 90 : 34), shape.w, shape.h)
  return { phone, shape, zoom, tint: tintOf(look.tint) }
}

/**
 * Holds the 3D body for every view of the app, so changing view does not rebuild it. Without WebGL, or until the code has
 * loaded, the CSS device underneath shows instead.
 */
export default function Stage({ children }: { children: ReactNode }) {
  const { phone, shape, zoom, tint } = useDeviceFit()
  const canvas = useRef<HTMLCanvasElement>(null)
  const tiltEl = useRef<HTMLDivElement>(null)
  const holder = useRef<HTMLDivElement>(null)
  const scene = useRef<DeviceScene>()
  const layout = useRef<Layout>()
  const [ready, setReady] = useState(false)
  // Nothing shows until the body is built and has its controls, or there isn't going to be one, so it opens straight in 3D.
  const [waited, setWaited] = useState(false)
  const [laid, setLaid] = useState(false)
  const pointer = useRef({ x: 0, y: 0 })
  const [, , , minimized] = useWindows()
  const hold = useRef(false)
  const dragging = useRef(false)
  const paused = useRef(false)
  paused.current = minimized.includes('mint')
  const size = useRef(shape)
  size.current = shape

  useEffect(() => {
    let dead = false
    let stop = () => {}
    const noBody = () => {
      if (!dead) setWaited(true)
    }
    const backstop = setTimeout(noBody, BODY_WAIT_MS)
    const start = async () => {
      const el = canvas.current
      if (!el || !document.createElement('canvas').getContext('webgl2')) {
        noBody()
        return
      }
      const { createDeviceScene } = await import('./scene')
      if (dead) return
      const coarse = window.matchMedia('(pointer: coarse)').matches
      let s: DeviceScene
      try {
        s = createDeviceScene(el, coarse)
      } catch {
        noBody()
        return
      }
      scene.current = s
      let ratio = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2)
      s.resize(size.current.w, size.current.h, ratio)
      s.setLook({ path: size.current.path, tintHex: tint.hex, inkHex: tint.ink })
      if (layout.current) s.setLayout(layout.current)

      const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const onMove = (e: PointerEvent) => {
        pointer.current = {
          x: Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1)),
          y: Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1)),
        }
      }
      window.addEventListener('pointermove', onMove)
      // While it is being carried it holds its angle, or the shell would slide about under the pointer.
      const onDown = (e: PointerEvent) => {
        dragging.current = !!(e.target as HTMLElement).closest?.('.title-bar')
      }
      const onUp = () => {
        dragging.current = false
      }
      window.addEventListener('pointerdown', onDown)
      window.addEventListener('pointerup', onUp)

      let frame = 0
      let rx = 0
      let ry = 0
      let last = performance.now()
      let slow = 0
      const tick = (now: number) => {
        frame = requestAnimationFrame(tick)
        const gap = now - last
        last = now
        // Nothing to draw while put away.
        if (paused.current || document.hidden) return
        // A machine that cannot keep up loses sharpness of the plastic, never the movement.
        slow = gap > 34 ? slow + 1 : Math.max(0, slow - 1)
        if (slow > 40 && ratio > 1) {
          ratio = 1
          slow = 0
          s.resize(size.current.w, size.current.h, ratio)
        }
        const t = now / 1000
        const still = hold.current
        const goalY = still ? 0 : (quiet ? 0 : Math.sin(t * 0.5) * DRIFT.y) + pointer.current.x * LEAN.y
        const goalX = still ? 0 : (quiet ? 0 : Math.sin(t * 0.37 + 1) * DRIFT.x) - pointer.current.y * LEAN.x
        if (!dragging.current) {
          rx += (goalX - rx) * 0.07
          ry += (goalY - ry) * 0.07
        }
        const node = tiltEl.current
        if (node) node.style.transform = `rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)`
        holder.current?.style.setProperty('--gx', (ry / LEAN.y).toFixed(3))
        holder.current?.style.setProperty('--gy', (rx / LEAN.x).toFixed(3))
        s.render(rx, ry, pointer.current.x, -pointer.current.y)
      }
      frame = requestAnimationFrame(tick)
      setReady(true)
      stop = () => {
        cancelAnimationFrame(frame)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerdown', onDown)
        window.removeEventListener('pointerup', onUp)
        s.dispose()
        scene.current = undefined
      }
    }
    start().catch(noBody)
    return () => {
      dead = true
      clearTimeout(backstop)
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const s = scene.current
    if (!s) return
    s.resize(shape.w, shape.h, Math.min(window.devicePixelRatio || 1, 2))
    s.setLook({ path: shape.path, tintHex: tint.hex, inkHex: tint.ink })
  }, [shape.path, shape.w, shape.h, tint.hex, tint.ink])

  const report = useCallback((next: Layout) => {
    const same = JSON.stringify(layout.current) === JSON.stringify(next)
    layout.current = next
    if (!same) scene.current?.setLayout(next)
    setLaid(true)
  }, [])

  const body = useMemo<Body3D>(
    () => ({
      ready,
      report,
      press: (part: Part, down: boolean) => scene.current?.press(part, down),
      setSwitch: (off: boolean) => scene.current?.setSwitch(off),
      setSave: (inward: boolean) => scene.current?.setSave(inward),
      setHold: (still: boolean) => {
        hold.current = still
      },
    }),
    [ready, report],
  )

  const showBody = ready && laid

  return (
    <Body3DContext.Provider value={body}>
      <Holder
        ref={holder}
        className={phone ? 'phone' : undefined}
        style={{ width: shape.w, height: shape.h, ...(zoom < 1 ? { zoom } : {}) }}
      >
        {showBody && <Ground />}
        <canvas
          ref={canvas}
          aria-hidden
          style={{
            width: shape.w + MARGIN * 2,
            height: shape.h + MARGIN * 2,
            visibility: showBody ? 'visible' : 'hidden',
          }}
        />
        <Tilt
          ref={tiltEl}
          className={ready ? 'three' : undefined}
          style={ready && !laid ? { visibility: 'hidden' } : undefined}
        >
          {(ready || waited) && children}
        </Tilt>
      </Holder>
    </Body3DContext.Provider>
  )
}
