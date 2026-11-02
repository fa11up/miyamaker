import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled, { createGlobalStyle, keyframes } from 'styled-components/macro'

import { waveBus, waveRideable } from '@/pages/OperatingSystem/wave/bus'
import { crestHeight, crestSlope } from '@/pages/OperatingSystem/wave/surface'
import { useWaves } from '@/store/experience/hooks'
import { bevel, color, MOBILE_BREAKPOINT, text } from '@/theme/tokens'

import { DESKTOP_EVENTS, useReducedMotion } from '../prefs'
import type { PetEnv, PetEvent, PetFx, PetMode, PetState, Poke, Step, Surface, WaveSurface } from './machine'
import { initialPet, petEvent, route, stepPet, worldOf } from './machine'
import type { PetDefinition } from './registry'
import { petSprite, pickLine, reactionLines } from './registry'

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

const climbing = keyframes`
  0%, 100% { transform: rotate(-6deg) translateY(0); }
  50% { transform: rotate(6deg) translateY(-2px); }
`

const pokeDown = keyframes`
  0%, 100% { transform: scale(1, 1); }
  30% { transform: scale(1.06, 0.84) translateY(2px); }
  45% { transform: scale(0.96, 1.05); }
`

const boardLost = keyframes`
  0% { opacity: 1; transform: translate(0, 0) rotate(0deg); }
  100% { opacity: 0; transform: translate(40px, 30px) rotate(200deg); }
`

/* the wave button looks pressed while the pet pokes it */
const PressedButtons = createGlobalStyle`
  [data-pet-poke][data-pet-pressed] {
    transform: translateY(1px);
    filter: brightness(0.92);
  }
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
  /* --tilt: board angle while surfing (set per frame), applied around the feet */
  .flip {
    position: relative;
    width: 100%;
    height: 100%;
    transform-origin: 50% 100%;
    transform: rotate(var(--tilt, 0deg));
  }
  .flip.left {
    transform: rotate(var(--tilt, 0deg)) scaleX(-1);
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
  &.mode-fall .body,
  &.mode-jump .body {
    transform: scale(0.95, 1.06);
  }
  &.mode-climb .body {
    animation: ${climbing} 0.5s ease-in-out infinite;
  }
  &.mode-poke .body {
    animation: ${pokeDown} 0.9s ease-in-out 1;
  }
  &.mode-surf .body {
    transform: scale(1.03, 0.94);
  }

  /* over an icon: clicks go to the icon, never the pet */
  &.passthrough {
    pointer-events: none !important;
  }

  &.pixel img {
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    filter: drop-shadow(0 2px 0 rgba(20, 16, 31, 0.3));
  }

  @media (prefers-reduced-motion: reduce) {
    .body {
      animation: none !important;
    }
  }
`

const Board = styled.div`
  position: absolute;
  left: -22%;
  right: -22%;
  bottom: -5px;
  height: 7px;
  border-radius: 50%;
  background: linear-gradient(90deg, #ff9fd8, #fff3fb 45%, #9fe0ff);
  box-shadow: 0 0 0 1px rgba(20, 16, 31, 0.55), 0 2px 0 rgba(20, 16, 31, 0.25);
  &::after {
    content: '';
    position: absolute;
    left: 20%;
    right: 20%;
    top: 3px;
    height: 1px;
    background: #ff5fb4;
  }
  &.lost {
    animation: ${boardLost} 0.9s ease-in forwards;
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
/** re-read perch rects this often even when nothing announced a change (labels can grow, e.g. wallet connects) */
const REMEASURE_MS = 5000

interface Measured {
  surfaces: Surface[]
  pokes: Poke[]
  /** icon button rects (heights above ground) for click pass-through */
  icons: { x0: number; x1: number; y0: number; y1: number }[]
  left: number
  bottom: number
}

/** Read perch / poke rects relative to the layer. Only on mount, resize, icon moves and a slow timer. */
function measureWorld(layer: HTMLElement): Measured {
  const r = layer.getBoundingClientRect()
  const surfaces: Surface[] = []
  const icons: Measured['icons'] = []
  document.querySelectorAll<HTMLElement>('[data-pet-perch]').forEach((el, i) => {
    const b = el.getBoundingClientRect()
    if (b.width < 4 || b.height < 4 || b.bottom <= r.top || b.top >= r.bottom) return
    const kind = el.dataset.petPerch === 'icon' ? 'icon' : 'perch'
    surfaces.push({
      id: el.dataset.perchId || `perch-${i}`,
      kind,
      x0: b.left - r.left,
      x1: b.right - r.left,
      top: r.bottom - b.top,
      bottom: r.bottom - b.bottom,
    })
    if (kind !== 'icon') return
    // the whole icon button (art + label) is what a click should reach
    const bb = (el.closest('button') || el).getBoundingClientRect()
    icons.push({ x0: bb.left - r.left, x1: bb.right - r.left, y0: r.bottom - bb.bottom, y1: r.bottom - bb.top })
  })
  const pokes: Poke[] = []
  document.querySelectorAll<HTMLElement>('[data-pet-poke]').forEach((el) => {
    const b = el.getBoundingClientRect()
    if (b.width < 2) return
    pokes.push({ id: el.dataset.petPoke || 'button', cx: (b.left + b.right) / 2 - r.left })
  })
  return { surfaces, pokes, icons, left: r.left, bottom: r.bottom }
}

export default function DesktopPet({ pet, variant }: { pet: PetDefinition; variant?: string }) {
  const reducedMotion = useReducedMotion()
  const [waves] = useWaves()
  const layerRef = useRef<HTMLDivElement>(null)
  const spriteRef = useRef<HTMLDivElement>(null)
  const [mobile, setMobile] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT)
  // a random look per visit unless one was chosen; stable across re-renders
  const [seed] = useState(Math.random)
  const sprite = useMemo(() => petSprite(pet, variant, mobile, () => seed), [pet, variant, mobile, seed])
  const spriteH = sprite.h
  const spriteW = sprite.w

  const measured = useRef<Measured>({ surfaces: [], pokes: [], icons: [], left: 0, bottom: window.innerHeight })
  const envRef = useRef<PetEnv>({ width: window.innerWidth, spriteW, reducedMotion })
  envRef.current = { ...envRef.current, spriteW, spriteH, reducedMotion, waveOn: waves }
  const stateRef = useRef<PetState>(initialPet(envRef.current))
  const [view, setView] = useState<{ mode: PetMode; facing: 1 | -1; board: boolean; lost: number }>({
    mode: stateRef.current.mode,
    facing: stateRef.current.facing,
    board: false,
    lost: 0,
  })
  const [bubble, setBubble] = useState<string>()
  const bubbleTimer = useRef<number>()
  const passthrough = useRef(false)

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
    const el = spriteRef.current
    if (el) {
      let rot = s.tilt || 0
      if (s.mode === 'surf' && s.surf?.trick === 'spin') rot += Math.min(1, s.surf.trickT / 750) * 360 * -s.facing
      el.style.transform = `translate3d(${Math.round(s.x)}px, ${-Math.round(s.y)}px, 0)`
      const tilt = `${rot.toFixed(1)}deg`
      if (el.style.getPropertyValue('--tilt') !== tilt) el.style.setProperty('--tilt', tilt)
      // never sit on top of an icon's click target: let clicks fall through to the icon
      const w = envRef.current.spriteW
      const h = envRef.current.spriteH || 0
      const over = measured.current.icons.some(
        (r) => s.x + w * 0.2 < r.x1 && s.x + w * 0.8 > r.x0 && s.y + 2 < r.y1 && s.y + h > r.y0
      )
      if (over !== passthrough.current) {
        passthrough.current = over
        el.classList.toggle('passthrough', over)
      }
    }

    const board = s.mode === 'surf' || (s.mode === 'jump' && !!s.tween?.toWave)
    setView((v) =>
      v.mode === s.mode && v.facing === s.facing && v.board === board ? v : { ...v, mode: s.mode, facing: s.facing, board }
    )
  }, [])

  const runFx = useCallback(
    (fx: PetFx[] | undefined) => {
      if (!fx) return
      for (const f of fx) {
        if (f.type === 'say') {
          // not every step needs words: keep it light
          const always = f.kind === 'surfStart' || f.kind === 'wipeout' || f.kind === 'pokeOn' || f.kind === 'pokeOff'
          if (always || Math.random() < 0.45) say(pickLine(reactionLines(pet, f.kind)), 1800)
        } else if (f.type === 'press') {
          const el = document.querySelector<HTMLElement>(`[data-pet-poke="${f.id}"]`)
          if (el) {
            el.setAttribute('data-pet-pressed', '')
            window.setTimeout(() => el.removeAttribute('data-pet-pressed'), 260)
          }
        } else if (f.type === 'wipeout') {
          setView((v) => ({ ...v, lost: v.lost + 1 }))
        }
      }
    },
    [pet, say]
  )

  /** Fresh env for the machine: the crest comes from the same function and clock the shader uses. */
  const syncEnv = useCallback(() => {
    let wave: WaveSurface | undefined
    if (waveRideable() && waveBus.params) {
      const p = waveBus.params
      const t = waveBus.frameTime
      const { left, bottom } = measured.current
      const lift = waveBus.bottom - bottom // the canvas runs under the taskbar; the pet's ground is above it
      wave = {
        height: (x) => crestHeight(x + left, t, p) - lift,
        slope: (x) => crestSlope(x + left, t, p),
      }
    }

    envRef.current = { ...envRef.current, wave }
    return envRef.current
  }, [])

  const dispatch = useCallback(
    (ev: PetEvent) => {
      const next = petEvent(stateRef.current, ev, syncEnv())
      runFx(next.fx)
      stateRef.current = next.fx ? { ...next, fx: undefined } : next
      paint()
    },
    [paint, runFx, syncEnv]
  )

  // Measure the layer and the world (perches, buttons).
  useEffect(() => {
    const el = layerRef.current
    if (!el) return undefined
    const update = () => {
      measured.current = measureWorld(el)
      const { surfaces, pokes } = measured.current
      envRef.current = { ...envRef.current, width: el.clientWidth, height: el.clientHeight, surfaces, pokes }
      setMobile(window.innerWidth <= MOBILE_BREAKPOINT)
      const max = Math.max(0, el.clientWidth - envRef.current.spriteW)
      if (stateRef.current.x > max) stateRef.current = { ...stateRef.current, x: max }
      dispatch({ type: 'world' })
    }

    update()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : undefined
    ro?.observe(el)
    window.addEventListener('resize', update)
    window.addEventListener(DESKTOP_EVENTS.iconsMoved, update)
    const timer = window.setInterval(() => !document.hidden && update(), REMEASURE_MS)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener(DESKTOP_EVENTS.iconsMoved, update)
      window.clearInterval(timer)
    }
  }, [dispatch])

  // Dev-only handle for poking the pet from the console / browser tests: __pet.goTo('mint'), __pet.surf()
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    const w = window as unknown as { __pet?: unknown }
    const go = (extra: Step[], to?: string) => {
      const s = stateRef.current
      const env = syncEnv()
      const plan = route(worldOf(env), s.on || 'ground', s.x + env.spriteW / 2, to || 'ground', env.spriteW)
      if (!plan) return false
      stateRef.current = { ...s, mode: 'idle', t: 0, until: 0, plan: [...plan, ...extra], bored: 0 }
      return true
    }

    w.__pet = {
      state: () => stateRef.current,
      env: () => envRef.current,
      goTo: (id: string) => go([{ k: 'perch', ms: 60_000 }], id),
      poke: (id = 'wave') => {
        const p = envRef.current.pokes?.find((x) => x.id === id)
        return !!p && go([{ k: 'walk', x: p.cx - envRef.current.spriteW / 2 }, { k: 'poke', id }])
      },
      surf: (ms = 20_000) => go([{ k: 'surf', ms }]),
    }
    return () => {
      delete w.__pet
    }
  }, [syncEnv])

  // The wave button: when the user switches the wave on, the pet heads out to surf.
  const prevWaves = useRef(waves)
  useEffect(() => {
    const turnedOn = waves && !prevWaves.current
    prevWaves.current = waves
    if (!turnedOn || reducedMotion) return undefined
    // give the shader a frame to publish its crest
    const id = window.setTimeout(() => {
      say(pickLine(reactionLines(pet, 'waveOn')), 1800)
      dispatch({ type: 'surf' })
    }, 400)
    return () => window.clearTimeout(id)
  }, [waves, reducedMotion, dispatch, pet, say])

  // Animation loop. Paused while the tab is hidden.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      const before = stateRef.current
      const next = stepPet(before, dt, syncEnv())
      runFx(next.fx)
      stateRef.current = next.fx ? { ...next, fx: undefined } : next
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
  }, [paint, pet, say, runFx, syncEnv])

  // Notice the cursor (mouse only; touch has no hover).
  useEffect(() => {
    let lastCheck = 0
    let near = false
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const now = performance.now()
      if (now - lastCheck < 120) return
      lastCheck = now
      const s = stateRef.current
      const { left, bottom } = measured.current
      const cx = left + s.x + envRef.current.spriteW / 2
      const cy = bottom - s.y - spriteH / 2
      const isNear = Math.hypot(e.clientX - cx, e.clientY - cy) < NOTICE_RADIUS
      if (isNear) {
        const wasSleeping = s.mode === 'sleep'
        dispatch({ type: 'cursor', x: e.clientX - left })
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
    const el = spriteRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    press.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      offX: e.clientX - r.left,
      offY: e.clientY - r.top,
      dragging: false,
    }
    try {
      el.setPointerCapture(e.pointerId)
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

  const name = sprite.variant ? `${pet.name} (${sprite.variant.name})` : pet.name
  const grounded = ['idle', 'sit', 'walk', 'sleep', 'poke'].includes(view.mode)

  return (
    <Layer ref={layerRef} aria-hidden={false}>
      <PressedButtons />
      <Sprite
        ref={spriteRef}
        className={`pet-hit mode-${view.mode} ${view.mode === 'drag' ? 'dragging' : ''} ${sprite.pixelated ? 'pixel' : ''}`}
        style={{ width: spriteW, height: spriteH }}
        role="button"
        tabIndex={0}
        aria-label={`${name} (desktop pet). Press to poke, drag to move.`}
        title={name}
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
        data-pet-mode={view.mode}
        data-pet-variant={sprite.variant?.id}
      >
        {grounded && <Shadow />}
        {!view.board && view.lost > 0 && view.mode === 'fall' && <Board key={view.lost} className="lost" aria-hidden />}
        <div className={`flip ${view.facing < 0 ? 'left' : ''}`}>
          {view.board && <Board aria-hidden data-surfboard="" />}
          <div className="body">
            <img src={sprite.src} srcSet={sprite.srcSet} alt="" draggable={false} width={spriteW} height={spriteH} />
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

