import { useCallback, useEffect, useRef, useState } from 'react'
import styled, { keyframes } from 'styled-components/macro'

import { bevel, color, MOBILE_BREAKPOINT, text } from '@/theme/tokens'

import { useReducedMotion } from '../prefs'
import type { PetEnv, PetEvent, PetMode, PetState } from './machine'
import { initialPet, petEvent, stepPet } from './machine'
import type { PetDefinition } from './registry'
import { pickLine } from './registry'

/*
 * Layer sits between the desktop icons and the windows (see OperatingSystem). It never takes the
 * pointer itself; only the doll's sprite does.
 */
const Layer = styled.div`
  position: absolute;
  inset: 0;
  z-index: 999;
  overflow: hidden;
  pointer-events: none !important;
  * {
    pointer-events: none !important;
  }
  .pet-hit {
    pointer-events: auto !important;
  }
`

const breathe = keyframes`
  0%, 100% { transform: scale(1, 1); }
  50% { transform: scale(1.025, 0.975); }
`

const waddle = keyframes`
  0%, 100% { transform: rotate(-3deg) translateY(0); }
  25% { transform: rotate(0deg) translateY(-3px); }
  50% { transform: rotate(3deg) translateY(0); }
  75% { transform: rotate(0deg) translateY(-3px); }
`

const snooze = keyframes`
  0%, 100% { transform: scale(1.06, 0.86); }
  50% { transform: scale(1.08, 0.83); }
`

const wiggle = keyframes`
  0%, 100% { transform: rotate(-8deg); }
  50% { transform: rotate(8deg); }
`

const floatZ = keyframes`
  0% { opacity: 0; transform: translate(0, 0) scale(0.7); }
  30% { opacity: 1; }
  100% { opacity: 0; transform: translate(14px, -26px) scale(1.1); }
`

const Sprite = styled.div`
  position: absolute;
  left: 0;
  bottom: 0;
  will-change: transform;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: grab;
  outline: none;

  &.dragging {
    cursor: grabbing;
  }
  &:focus-visible .body {
    outline: 1px dotted ${color.dark};
    outline-offset: 2px;
  }

  /* flip wrapper + mode animation wrapper + image */
  .flip {
    width: 100%;
    height: 100%;
  }
  .flip.left {
    transform: scaleX(-1);
  }
  .body {
    width: 100%;
    height: 100%;
    transform-origin: 50% 100%;
  }
  img {
    border: none !important;
    margin: 0;
    display: block;
    width: 100%;
    height: 100%;
    -webkit-user-drag: none;
    filter: drop-shadow(0 2px 0 rgba(20, 16, 31, 0.25));
  }

  &.mode-idle .body {
    animation: ${breathe} 2.6s ease-in-out infinite;
  }
  &.mode-walk .body {
    animation: ${waddle} 0.7s linear infinite;
  }
  &.mode-sit .body {
    transform: scale(1.05, 0.9);
  }
  &.mode-sleep .body {
    animation: ${snooze} 3.2s ease-in-out infinite;
  }
  &.mode-drag .body {
    animation: ${wiggle} 0.35s ease-in-out infinite;
    transform-origin: 50% 10%;
  }
  &.mode-hop .body,
  &.mode-fall .body {
    transform: scale(0.95, 1.06);
  }

  @media (prefers-reduced-motion: reduce) {
    .body {
      animation: none !important;
    }
  }
`

const Shadow = styled.div`
  position: absolute;
  left: 15%;
  right: 15%;
  bottom: -3px;
  height: 6px;
  border-radius: 50%;
  background: rgba(20, 16, 31, 0.22);
`

const Bubble = styled.div`
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  max-width: 180px;
  width: max-content;
  padding: 3px 8px;
  background: ${color.well};
  color: ${color.ink};
  box-shadow: ${bevel.raised};
  outline: 1px solid ${color.dark};
  font-size: ${text.sm};
  line-height: 1.2;
  text-align: center;
  white-space: normal;

  &::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    margin-left: -5px;
    border: 5px solid transparent;
    border-top-color: ${color.dark};
  }

  /* near a screen edge the bubble hangs inwards instead of being clipped */
  &.edge-right {
    left: auto;
    right: 0;
    transform: none;
    &::after {
      left: auto;
      right: 12px;
    }
  }
  &.edge-left {
    left: 0;
    transform: none;
    &::after {
      left: 17px;
    }
  }

  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    font-size: ${text.xs};
    max-width: 140px;
  }
`

const Zz = styled.div`
  position: absolute;
  top: -6px;
  right: -8px;
  font-size: ${text.sm};
  font-weight: 700;
  color: ${color.highlight};
  text-shadow: 1px 1px 0 ${color.dark};
  span {
    position: absolute;
    animation: ${floatZ} 2.4s ease-out infinite;
  }
  span:nth-child(2) {
    animation-delay: 0.8s;
    left: 8px;
    font-size: ${text.xs};
  }
  span:nth-child(3) {
    animation-delay: 1.6s;
    left: -4px;
  }
  @media (prefers-reduced-motion: reduce) {
    span {
      animation: none;
      position: static;
    }
  }
`

const NOTICE_RADIUS = 200
const DRAG_THRESHOLD = 5

export default function DesktopPet({ pet }: { pet: PetDefinition }) {
  const reducedMotion = useReducedMotion()
  const layerRef = useRef<HTMLDivElement>(null)
  const spriteRef = useRef<HTMLDivElement>(null)
  const [mobile, setMobile] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT)
  const spriteH = mobile ? pet.height.mobile : pet.height.desktop
  const spriteW = Math.round(spriteH * pet.aspect)

  const envRef = useRef<PetEnv>({ width: window.innerWidth, spriteW, reducedMotion })
  envRef.current = { ...envRef.current, spriteW, reducedMotion }
  const stateRef = useRef<PetState>(initialPet(envRef.current))
  const [view, setView] = useState<{ mode: PetMode; facing: 1 | -1 }>({
    mode: stateRef.current.mode,
    facing: stateRef.current.facing,
  })
  const [bubble, setBubble] = useState<string>()
  const bubbleTimer = useRef<number>()

  const say = useCallback((line: string, ms = 2600) => {
    if (!line) return
    setBubble(line)
    window.clearTimeout(bubbleTimer.current)
    bubbleTimer.current = window.setTimeout(() => setBubble(undefined), ms)
  }, [])

  useEffect(() => () => window.clearTimeout(bubbleTimer.current), [])

  const bubbleEdge = () => {
    const centre = stateRef.current.x + envRef.current.spriteW / 2
    if (centre + 95 > envRef.current.width) return 'edge-right'
    if (centre < 95) return 'edge-left'
    return ''
  }

  const paint = useCallback(() => {
    const s = stateRef.current
    if (spriteRef.current) {
      spriteRef.current.style.transform = `translate3d(${Math.round(s.x)}px, ${-Math.round(s.y)}px, 0)`
    }

    setView((v) => (v.mode === s.mode && v.facing === s.facing ? v : { mode: s.mode, facing: s.facing }))
  }, [])

  const dispatch = useCallback(
    (ev: PetEvent) => {
      stateRef.current = petEvent(stateRef.current, ev, envRef.current)
      paint()
    },
    [paint]
  )

  // Track the walkable width.
  useEffect(() => {
    const el = layerRef.current
    if (!el) return undefined
    const update = () => {
      envRef.current = { ...envRef.current, width: el.clientWidth }
      setMobile(window.innerWidth <= MOBILE_BREAKPOINT)
      const max = Math.max(0, el.clientWidth - envRef.current.spriteW)
      if (stateRef.current.x > max) stateRef.current = { ...stateRef.current, x: max }
      paint()
    }

    update()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : undefined
    ro?.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [paint])

  // Animation loop. Paused while the tab is hidden.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      const before = stateRef.current
      stateRef.current = stepPet(before, dt, envRef.current)
      if (before.mode === 'sleep' && stateRef.current.mode !== 'sleep') say(pickLine(pet.wakeLines))
      paint()
      raf = requestAnimationFrame(tick)
    }

    const start = () => {
      cancelAnimationFrame(raf)
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }

    const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) : start())
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [paint, pet, say])

  // Notice the cursor (mouse only; touch has no hover).
  useEffect(() => {
    let lastCheck = 0
    let near = false
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const now = performance.now()
      if (now - lastCheck < 120) return
      lastCheck = now
      const layer = layerRef.current
      if (!layer) return
      const rect = layer.getBoundingClientRect()
      const s = stateRef.current
      const cx = rect.left + s.x + envRef.current.spriteW / 2
      const cy = rect.bottom - s.y - spriteH / 2
      const isNear = Math.hypot(e.clientX - cx, e.clientY - cy) < NOTICE_RADIUS
      if (isNear) {
        const wasSleeping = s.mode === 'sleep'
        dispatch({ type: 'cursor', x: e.clientX - rect.left })
        if (wasSleeping) say(pickLine(pet.wakeLines))
        else if (!near && Math.random() < 0.35) say(pickLine(pet.noticeLines), 1400)
      }

      near = isNear
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [dispatch, pet, say, spriteH])

  /* ---------- drag / click ---------- */
  const press = useRef<{ id: number; x: number; y: number; offX: number; offY: number; dragging: boolean }>()

  const poke = () => {
    const wasSleeping = stateRef.current.mode === 'sleep'
    dispatch({ type: 'click' })
    say(pickLine(wasSleeping ? pet.wakeLines : pet.lines, bubble))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const sprite = spriteRef.current
    if (!sprite) return
    const r = sprite.getBoundingClientRect()
    press.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      offX: e.clientX - r.left,
      offY: e.clientY - r.top,
      dragging: false,
    }
    try {
      sprite.setPointerCapture(e.pointerId)
    } catch {
      /* capture is best effort */
    }

    e.preventDefault()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current
    const layer = layerRef.current
    if (!p || p.id !== e.pointerId || !layer) return
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return
      p.dragging = true
      setBubble(undefined)
      dispatch({ type: 'dragStart' })
    }

    const rect = layer.getBoundingClientRect()
    const x = e.clientX - rect.left - p.offX
    const bottom = e.clientY - p.offY + spriteH
    dispatch({ type: 'dragMove', x, y: Math.min(rect.height - spriteH, rect.bottom - bottom) })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    press.current = undefined
    if (p.dragging) {
      dispatch({ type: 'dragEnd' })
      if (Math.random() < 0.5) say(pickLine(['wheee', 'oof', 'again!', 'put me down >_<']), 1600)
      return
    }

    poke()
  }

  const onPointerCancel = () => {
    if (press.current?.dragging) dispatch({ type: 'dragEnd' })
    press.current = undefined
  }

  return (
    <Layer ref={layerRef} aria-hidden={false}>
      <Sprite
        ref={spriteRef}
        className={`pet-hit mode-${view.mode} ${view.mode === 'drag' ? 'dragging' : ''}`}
        style={{ width: spriteW, height: spriteH }}
        role="button"
        tabIndex={0}
        aria-label={`${pet.name} (desktop pet). Press to poke, drag to move.`}
        title={pet.name}
        onPointerDown={onPointerDown}
        // no focus ring on mouse/touch pokes; keyboard focus still works
        onMouseDown={(e) => e.preventDefault()}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            poke()
          }
        }}
        data-desktop-pet=""
      >
        {(view.mode === 'idle' || view.mode === 'sit' || view.mode === 'walk' || view.mode === 'sleep') && <Shadow />}
        <div className={`flip ${view.facing < 0 ? 'left' : ''}`}>
          <div className="body">
            <img src={pet.src} srcSet={pet.srcSet} alt="" draggable={false} width={spriteW} height={spriteH} />
          </div>
        </div>
        {view.mode === 'sleep' && (
          <Zz aria-hidden>
            <span>Z</span>
            <span>z</span>
            <span>z</span>
          </Zz>
        )}
        {bubble && (
          <Bubble role="status" aria-live="polite" className={bubbleEdge()}>
            {bubble}
          </Bubble>
        )}
      </Sprite>
    </Layer>
  )
}
