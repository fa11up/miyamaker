import type { PointerEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components/macro'

import { font } from '@/theme/tokens'

import type { ZoomView } from './status'
import { MAX_ZOOM, panBy, zoomAt } from './status'

/**
 * The holographic viewer: the art rises out of the device's screen and its light fills the whole page, with the desktop and
 * the device still showing through the light. The picture itself is solid and holds still; all it does is zoom. It is laid
 * out at its zoomed size rather than scaled, so the browser always draws it from its full resolution.
 */
const SCREEN = '[data-testid=mint-device] [data-bezel]'
const FIT: ZoomView = { zoom: 1, x: 0, y: 0 }

const Room = styled.div`
  position: fixed;
  z-index: 200000;
  inset: 0;
  overflow: hidden;
  color: #e4f8ff;
  font-family: ${font.ui};
  /* The page seen through the light: tinted and lined, never hidden. Still, with nothing moving. */
  background:
    repeating-linear-gradient(0deg, rgba(190, 240, 255, 0.05) 0 1px, transparent 1px 4px),
    radial-gradient(ellipse at 50% 55%, rgba(70, 180, 255, 0.2), rgba(10, 50, 110, 0.42));
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  polygon {
    fill: rgba(170, 235, 255, 0.08);
    stroke: rgba(190, 240, 255, 0.3);
    stroke-width: 1;
  }
`

const Plate = styled.div`
  position: absolute;
  transform-origin: 0 0;
  transition:
    transform 0.42s cubic-bezier(0.2, 0.85, 0.25, 1),
    opacity 0.42s ease-out;
  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`

const View = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
  cursor: zoom-in;
  touch-action: none;
  box-shadow:
    0 0 0 1px rgba(190, 240, 255, 0.9),
    0 0 34px rgba(120, 215, 255, 0.5);
  &.zoomed {
    cursor: grab;
  }
  &:active.zoomed {
    cursor: grabbing;
  }
  .art {
    position: absolute;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    max-width: none;
    margin: 0;
    border: none;
    object-fit: cover;
  }
`

const Bar = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-top: 8px;
  button {
    min-width: 44px;
    min-height: 40px;
    padding: 0 10px;
    border: 1px solid rgba(190, 240, 255, 0.85);
    border-radius: 5px;
    cursor: pointer;
    font-size: 15px;
    color: #e4f8ff;
    background: rgba(8, 24, 52, 0.82);
  }
  button:hover:not(:disabled) {
    background: rgba(30, 80, 130, 0.92);
  }
  button:disabled {
    cursor: default;
    opacity: 0.5;
  }
  button:focus-visible {
    outline: 2px dashed #fff35c;
    outline-offset: 2px;
  }
  span {
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 14px;
    background: rgba(8, 24, 52, 0.82);
    white-space: nowrap;
  }
`

type Box = { x: number; y: number; w: number; h: number }

/** Where the picture hangs: in the middle of the page, as big as fits with room for its controls. */
function placeOnPage(): Box {
  const size = Math.max(200, Math.min(window.innerHeight - 76, window.innerWidth - 16))
  return {
    x: (window.innerWidth - size) / 2,
    y: Math.max(8, (window.innerHeight - size - 60) / 2),
    w: size,
    h: size,
  }
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

export default function Holo({
  art,
  name,
  detail,
  onStep,
  onClose,
}: {
  art: ReactNode
  name: string
  detail?: ReactNode
  /** Move to the piece before or after this one. Undefined with only one to show. */
  onStep?: (step: number) => void
  onClose: () => void
}) {
  const [target] = useState<Box>(placeOnPage)
  const start = useRef(document.querySelector(SCREEN)?.getBoundingClientRect())
  const [out, setOut] = useState(false)
  const [view, setView] = useState<ZoomView>(FIT)
  const viewEl = useRef<HTMLDivElement>(null)
  const beam = useRef<SVGSVGElement>(null)
  const closing = useRef(onClose)
  closing.current = onClose
  const stepping = useRef(onStep)
  stepping.current = onStep

  useEffect(() => {
    const raf = requestAnimationFrame(() => setOut(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // The light stays joined to the screen while the device leans or is carried. Putting the device away ends it.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const rect = document.querySelector(SCREEN)?.getBoundingClientRect()
      if (!rect || rect.width === 0) {
        closing.current()
        return
      }
      const from = [
        [rect.left, rect.top],
        [rect.right, rect.top],
        [rect.right, rect.bottom],
        [rect.left, rect.bottom],
      ]
      // Out to the corners of the page, not just the picture.
      const to = [
        [0, 0],
        [window.innerWidth, 0],
        [window.innerWidth, window.innerHeight],
        [0, window.innerHeight],
      ]
      beam.current?.querySelectorAll('polygon').forEach((face, i) => {
        const j = (i + 1) % 4
        face.setAttribute('points', [from[i], from[j], to[j], to[i]].map((p) => p!.join(',')).join(' '))
      })
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target])

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    viewEl.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      const zoomKey = e.key === '+' || e.key === '=' ? 1.4 : e.key === '-' ? 1 / 1.4 : 0
      if (e.key === 'Escape') closing.current()
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // The next piece starts whole, as the buttons do.
        if (stepping.current) setView(FIT)
        stepping.current?.(e.key === 'ArrowLeft' ? -1 : 1)
      }
      else if (zoomKey) setView((v) => zoomAt(v, zoomKey, target.w / 2, target.h / 2, target.w))
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      before?.focus({ preventScroll: true })
    }
  }, [target])

  // A wheel over the picture zooms it, rather than scrolling the page behind.
  useEffect(() => {
    const el = viewEl.current
    if (!el) return undefined
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = el.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * 0.002)
      setView((v) => zoomAt(v, factor, e.clientX - box.left, e.clientY - box.top, target.w))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [target])

  // One finger or the mouse pans; two fingers pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(e.pointerId)
    if (!last) return
    const now = { x: e.clientX, y: e.clientY }
    const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1]
    if (other) {
      const box = e.currentTarget.getBoundingClientRect()
      const factor = distance(now, other) / Math.max(1, distance(last, other))
      const cx = (now.x + other.x) / 2 - box.left
      const cy = (now.y + other.y) / 2 - box.top
      setView((v) => zoomAt(v, factor, cx, cy, target.w))
    } else {
      setView((v) => panBy(v, now.x - last.x, now.y - last.y, target.w))
    }
    pointers.current.set(e.pointerId, now)
  }
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
  }

  const zoomBy = (factor: number) => setView((v) => zoomAt(v, factor, target.w / 2, target.h / 2, target.w))
  const step = (by: number) => {
    setView(FIT)
    onStep?.(by)
  }

  const s = start.current
  const fromScreen =
    s && s.width > 0
      ? `translate(${s.left - target.x}px, ${s.top - target.y}px) scale(${s.width / target.w}, ${s.height / target.h})`
      : 'scale(0.4)'

  return createPortal(
    <Room
      role="dialog"
      aria-modal="true"
      aria-label={`Holographic view of ${name}`}
      data-testid="mint-holo"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <svg ref={beam} aria-hidden>
        <polygon />
        <polygon />
        <polygon />
        <polygon />
      </svg>
      <Plate
        style={{
          left: target.x,
          top: target.y,
          width: target.w,
          height: target.h,
          transform: out ? 'none' : fromScreen,
          opacity: out ? 1 : 0.2,
        }}
      >
        <View
          ref={viewEl}
          tabIndex={-1}
          className={view.zoom > 1 ? 'zoomed' : undefined}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            setView((v) => (v.zoom > 1 ? FIT : zoomAt(v, 2.5, e.clientX - box.left, e.clientY - box.top, target.w)))
          }}
        >
          <div
            className="art"
            style={{ left: view.x, top: view.y, width: target.w * view.zoom, height: target.h * view.zoom }}
          >
            {art}
          </div>
        </View>
        <Bar>
          {onStep && (
            <button type="button" aria-label="Previous piece" onClick={() => step(-1)}>
              ◀
            </button>
          )}
          <button type="button" aria-label="Zoom out" disabled={view.zoom <= 1} onClick={() => zoomBy(1 / 1.5)}>
            −
          </button>
          <span aria-live="polite">
            {name}
            {detail ? ` ${detail}` : ''} · {Math.round(view.zoom * 100)}%
          </span>
          <button type="button" aria-label="Zoom in" disabled={view.zoom >= MAX_ZOOM} onClick={() => zoomBy(1.5)}>
            +
          </button>
          {onStep && (
            <button type="button" aria-label="Next piece" onClick={() => step(1)}>
              ▶
            </button>
          )}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </Bar>
      </Plate>
    </Room>,
    document.body,
  )
}
