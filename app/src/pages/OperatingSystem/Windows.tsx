import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DraggableData } from 'react-draggable'
import Draggable from 'react-draggable'

import Pages from '@/constants/pages'
import AppBoot from '@/components/AppBoot'
import { ACTIVITY_EVENT, pressedFrame } from '@/desktop/screensaver/activity'
import { useWindowSize } from 'usehooks-ts'

import { useWindowDimensions, useWindowPosition } from '@/store/windows/hooks'

const DummyWindow = ({
  innerRef,
  children,
  style,
  className,
  onClick,
  onMouseDown,
  onMouseUp,
  onTouchStart,
  onTouchEnd,
  onFocus,
  label,
}: {
  innerRef?: RefObject<HTMLDivElement>
  children: ReactNode
  style?: React.CSSProperties
  className?: string
  onClick?: () => void
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
  onMouseUp?: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
  onTouchStart?: (e: React.TouchEvent<HTMLDivElement>) => void
  onTouchEnd?: (e: React.TouchEvent<HTMLDivElement>) => void
  onFocus?: () => void
  label?: string
}) => {
  return (
    <div
      ref={innerRef}
      // Focus lands here only to follow the window; the title bar shows which is on top, and real controls keep their rings.
      style={label ? { ...style, outline: 'none' } : style}
      className={className}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onFocus={onFocus}
      role={label ? 'region' : undefined}
      aria-label={label}
      tabIndex={label ? -1 : undefined}
    >
      {children}
    </div>
  )
}

/**
 * Windows whose app changes layout at a width, so they never get narrower than it on a desktop. miyakeys's page
 * reloads into its phone layout at 768px (1024px with a touch pointer), losing its undo and builds in progress; a
 * window always above that never crosses it. On a phone the window is the whole screen from the start, and so it is
 * on a desktop narrower than this minimum (windowFit): there the frame is as wide as the screen and only crosses when
 * the screen itself does.
 */
const LAYOUT_MIN_WIDTH: Record<string, { fine: number; coarse: number }> = {
  miyakeys: { fine: 800, coarse: 1060 },
}

function layoutMinWidth(identifier: string): number {
  const min = LAYOUT_MIN_WIDTH[identifier]
  if (!min) return 0
  try {
    return window.matchMedia('(pointer: coarse)').matches ? min.coarse : min.fine
  } catch {
    return min.fine
  }
}

/**
 * How a window fits the desktop: full-screen on a phone (or when asked), or when the desktop is narrower than the
 * width its app's layout needs (layoutMin, LAYOUT_MIN_WIDTH), so it is never squeezed under that width; otherwise its
 * narrowest is the usual minimum (480 or less, its app's layout width if more), never wider than the desktop.
 * Self-contained: tests/miyakeys-bridge.test.mts runs it from this file's text.
 */
function windowFit(o: { mobile?: boolean; viewWidth: number; baseWidth: number; layoutMin: number }) {
  const fullScreen = !!o.mobile || (o.layoutMin > 0 && o.viewWidth > 0 && o.viewWidth < o.layoutMin)
  const wanted = Math.max(Math.min(o.baseWidth, 480), o.layoutMin)
  return { fullScreen, minWidth: o.viewWidth > 0 ? Math.min(o.viewWidth, wanted) : wanted }
}

/**
 * Where a window's left edge (or top) goes when its far edge stays put and it takes width `w`: never off the desktop's
 * left (top). A window held at its minimum against the edge grows the other way instead. Self-contained, as windowFit.
 */
function pinnedStart(start: number, size: number, w: number): number {
  return Math.max(0, start + size - w)
}

/** While a frame has focus, how often its window checks whether focus moved to another window's frame. */
const FRAME_FOCUS_POLL_MS = 250

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
const GRIP = 6 // px of edge that takes the pointer
const CORNER = 14
const CURSOR: Record<Edge, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
}
const gripStyle = (edge: Edge): React.CSSProperties => {
  const corner = edge.length === 2
  const style: React.CSSProperties = { position: 'absolute', zIndex: 3, cursor: CURSOR[edge], touchAction: 'none' }
  // Inside the frame (the window clips what hangs outside), over its bevel.
  if (edge.includes('n')) style.top = 0
  if (edge.includes('s')) style.bottom = 0
  if (edge.includes('w')) style.left = 0
  if (edge.includes('e')) style.right = 0
  if (corner) return { ...style, width: CORNER, height: CORNER }
  if (edge === 'n' || edge === 's') return { ...style, left: CORNER / 2, right: CORNER / 2, height: GRIP }
  return { ...style, top: CORNER / 2, bottom: CORNER / 2, width: GRIP }
}

const DraggableWrapper = ({
  className,
  dragPosition,
  onDragWindow,
  onStopDrag,
  disabled,
  children,
}: {
  disabled?: boolean
  className: string
  dragPosition: { x: number; y: number }
  onDragWindow: (x: number, y: number) => void
  onStopDrag: () => void
  children: ReactNode
}) => {
  const handleDrag = (ui: DraggableData) => {
    const { x, y } = dragPosition
    onDragWindow(x + ui.deltaX, y + ui.deltaY)
  }

  const activate = () => {}

  const deactivate = () => {
    onStopDrag()
  }

  return (
    <Draggable
      defaultClassName={`react-draggable ${className}`}
      axis="both"
      handle=".title-bar"
      disabled={disabled}
      defaultPosition={{ x: 0, y: 0 }}
      bounds=".bwindow"
      position={dragPosition}
      scale={1}
      onStart={() => activate()}
      onDrag={(_, ui) => handleDrag(ui)}
      onStop={() => deactivate()}
    >
      {children}
    </Draggable>
  )
}

/** At most this many canvases are copied as pictures, each scaled down to fit this box; the rest are left blank. */
const TRAIL_CANVASES = 4
const TRAIL_SNAPSHOT_PX = 360
/** A canvas whose backing store is bigger than this (about 1600 x 1000) isn't read at all: reading it stalls the drag. */
const TRAIL_CANVAS_MAX_AREA = 1_600_000
/** How many copies a trail can grow to, and fewer for a window with a lot inside it. */
const TRAIL_MAX = 30
const TRAIL_MAX_HEAVY = 8
const HEAVY_NODES = 1500

/** A small picture of a canvas, or '' when it is too big to read quickly or drawn from another site. */
function snapshot(canvas: HTMLCanvasElement): string {
  const { width, height } = canvas
  if (!width || !height || width * height > TRAIL_CANVAS_MAX_AREA) return ''
  const scale = Math.min(1, TRAIL_SNAPSHOT_PX / Math.max(width, height))
  try {
    if (scale === 1) return canvas.toDataURL()
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.round(width * scale))
    small.height = Math.max(1, Math.round(height * scale))
    small.getContext('2d')?.drawImage(canvas, 0, 0, small.width, small.height)
    return small.toDataURL()
  } catch {
    // Drawn from another site: stays blank for the moment of a drag.
    return ''
  }
}

/** A window's contents with nothing running: canvases as pictures, and players, which can't be cloned, left blank. */
function pictureOf(window: HTMLElement): HTMLElement[] {
  const live = Array.from(window.querySelectorAll('canvas'))
  const copy = window.cloneNode(true) as HTMLElement
  copy.querySelectorAll('[data-resize]').forEach((grip) => grip.remove())
  let read = 0
  copy.querySelectorAll('canvas').forEach((canvas, i) => {
    const from = live[i]
    const img = document.createElement('img')
    img.className = canvas.className
    img.alt = ''
    img.style.cssText = `${from?.style.cssText ?? ''};width:${from?.offsetWidth}px;height:${from?.offsetHeight}px`
    // Hidden canvases (a minimised panel, a closed tab) aren't worth a read.
    const src = from && from.offsetWidth && read < TRAIL_CANVASES ? snapshot(from) : ''
    if (src) {
      read += 1
      img.src = src
    }

    canvas.replaceWith(img)
  })
  copy.querySelectorAll('iframe, video, audio, script').forEach((player) => {
    const blank = document.createElement('div')
    blank.className = player.className
    blank.style.cssText = 'position:absolute;inset:0;background:#000'
    player.replaceWith(blank)
  })
  return Array.from(copy.children) as HTMLElement[]
}

export default function Windows({
  children,
  baseSize,
  onClick,
  mobile: phoneOrFull,
  minimized,
  focused,
  identifier = 'program',
  label,
  baseDepth = 2000,
  shaped = false,
  noTrail = false,
  fixedSize = false,
  corner,
}: {
  children: ReactNode
  baseSize: { width: number; height: number }
  onClick: () => void
  mobile?: boolean
  minimized?: boolean
  focused?: boolean
  identifier?: string
  label?: string
  baseDepth?: number
  shaped?: boolean
  noTrail?: boolean
  fixedSize?: boolean
  corner?: number
}) {
  // in-component state
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | undefined>()
  const latestDrag = useRef(dragPosition)
  latestDrag.current = dragPosition
  const { height: viewHeight, width: viewWidth } = useWindowSize()
  const fit = windowFit({
    mobile: phoneOrFull,
    viewWidth,
    baseWidth: baseSize.width,
    layoutMin: layoutMinWidth(identifier),
  })
  // From here on "mobile" is "the whole screen": a phone, a window put full-screen, or a desktop too narrow for it.
  const mobile = fit.fullScreen

  useEffect(() => {
    if (dragPosition && (dragPosition.x < 0 || dragPosition.y < 0)) {
      setDragPosition({ x: 0, y: 0 })
    }
  }, [minimized])
  // global state (redux w/ localstorage)
  const [position, updatePosition] = useWindowPosition(identifier)

  // Save where a drag ends, so a reload right after it keeps the window there.
  const saveDrag = () => {
    if (latestDrag.current) updatePosition(latestDrag.current.x, latestDrag.current.y)
  }

  const ref = useRef<HTMLDivElement>(null)
  const [initialized, setInitialized] = useState(false)

  // Keyboard users follow the window: focus moves in when it comes to the front from outside (icon, taskbar,
  // Start menu) and goes back to where it came from when the window closes.
  const returnTo = useRef<HTMLElement | null>(null)
  const wasFocused = useRef(false)
  useEffect(() => {
    if (!initialized) return undefined
    const raised = focused && !wasFocused.current
    wasFocused.current = !!focused
    if (!raised) return undefined
    const moveIn = () => {
      const node = ref.current
      if (!node || node.contains(document.activeElement)) return
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        returnTo.current = document.activeElement
      }

      node.focus({ preventScroll: true })
    }

    if (!document.querySelector('[data-boot]')) {
      moveIn()
      return undefined
    }

    // The boot screen takes its keys for itself, so focus follows once it has gone.
    const waiting = setInterval(() => {
      if (document.querySelector('[data-boot]')) return
      clearInterval(waiting)
      moveIn()
    }, 100)
    return () => clearInterval(waiting)
  }, [focused, initialized])
  // A click into a frame (miyakeys's sandboxed page) sends this page no pointer event and no focus event, only a
  // window blur, with the frame as the active element, and the press the frame reports (activity.ts). Either is a
  // click in this window: it comes to the front. Focus going straight from one window's frame to another's fires no
  // blur here (this page is already blurred), so while a frame has focus the active element is looked at every
  // FRAME_FOCUS_POLL_MS, until focus comes back to this page (window focus) or the window goes.
  const raise = useRef(onClick)
  raise.current = onClick
  useEffect(() => {
    let poll: ReturnType<typeof setInterval> | undefined
    let last: Element | null = null
    const check = () => {
      const active = document.activeElement
      if (active === last) return
      last = active
      if (active instanceof HTMLIFrameElement && ref.current?.contains(active)) raise.current()
    }

    const stop = () => {
      clearInterval(poll)
      poll = undefined
    }

    const onBlur = () => {
      last = null
      check()
      if (!poll && document.activeElement instanceof HTMLIFrameElement) poll = setInterval(check, FRAME_FOCUS_POLL_MS)
    }

    const onFocus = () => {
      stop()
      last = null
    }

    const onPress = (e: Event) => {
      const frame = pressedFrame(e)
      if (frame && ref.current?.contains(frame)) raise.current()
    }

    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    window.addEventListener(ACTIVITY_EVENT, onPress)
    return () => {
      stop()
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(ACTIVITY_EVENT, onPress)
    }
  }, [])
  useEffect(
    () => () => {
      const active = document.activeElement
      if (active && active !== document.body && document.body.contains(active)) return
      if (returnTo.current?.isConnected) returnTo.current.focus({ preventScroll: true })
    },
    []
  )

  // Edges and corners resize the window (not on phones, maximized, or a shaped window like the radio). The size
  // people pick is kept, and the window never goes smaller than its own layout allows, nor past the desktop.
  const [savedSize, saveSize] = useWindowDimensions(identifier)
  const [liveSize, setLiveSize] = useState<{ width: number; height: number }>()
  const resizable = !mobile && !shaped && !fixedSize
  const minSize = { width: fit.minWidth, height: Math.min(baseSize.height, 360) }
  const picked = (resizable && (liveSize ?? savedSize)) || baseSize
  // A size saved before the window had its layout's minimum comes back at the minimum.
  const size = { width: Math.max(minSize.width, picked.width), height: picked.height }

  // A window taller than the desktop shrinks to fit above the taskbar and scrolls inside.
  const available = Math.max(0, viewHeight - 34)
  const height = !shaped && available && size.height > available ? available : size.height
  const width = !shaped && viewWidth && size.width > viewWidth ? viewWidth : size.width

  const startResize = (edge: Edge) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !dragPosition) return
    e.preventDefault()
    e.stopPropagation()
    onClick()
    const grip = e.currentTarget
    grip.setPointerCapture(e.pointerId)
    const start = { x: e.clientX, y: e.clientY, w: width, h: height, left: dragPosition.x, top: dragPosition.y }
    let last = { size: { width: start.w, height: start.h }, pos: { x: start.left, y: start.top } }
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      let { w } = start
      let { h } = start
      let { left, top } = start
      if (edge.includes('e')) w = Math.min(start.w + dx, viewWidth - start.left)
      if (edge.includes('s')) h = Math.min(start.h + dy, available - start.top)
      w = Math.max(minSize.width, Math.round(w))
      h = Math.max(minSize.height, Math.round(h))
      if (edge.includes('w')) {
        w = Math.max(minSize.width, Math.round(Math.min(start.w - dx, Math.max(0, start.left) + start.w)))
        left = pinnedStart(start.left, start.w, w)
      }

      if (edge.includes('n')) {
        h = Math.max(minSize.height, Math.round(Math.min(start.h - dy, Math.max(0, start.top) + start.h)))
        top = pinnedStart(start.top, start.h, h)
      }

      last = { size: { width: w, height: h }, pos: { x: Math.round(left), y: Math.round(top) } }
      setLiveSize(last.size)
      if (edge.includes('w') || edge.includes('n')) setDragPosition(last.pos)
    }

    const up = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
      grip.removeEventListener('pointercancel', up)
      saveSize(last.size.width, last.size.height)
      updatePosition(last.pos.x, last.pos.y)
      setLiveSize(undefined)
    }

    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up)
    grip.addEventListener('pointercancel', up)
  }

  const [dummyWindowsArray, setdummyWindowsArray] = useState<{ x: number; y: number; i: number }[]>([])
  const trailTimer = useRef<ReturnType<typeof setInterval>>()

  // The trail is a picture of the window, taken when the drag starts. Real copies would run the whole app again, up to a
  // hundred times over, with its effects, sockets and sound.
  const trailPicture = useRef<HTMLElement[]>()
  // Counted once per drag: a window with a lot inside it gets a short trail, as each copy is the whole of it.
  const trailMax = useRef(TRAIL_MAX)
  const fillTrailCopy = useCallback((slot: HTMLDivElement | null) => {
    if (!slot || !ref.current) return
    trailPicture.current ??= pictureOf(ref.current)
    slot.replaceChildren(...trailPicture.current.map((node) => node.cloneNode(true)))
  }, [])

  const moveIt = (x: number, y: number) => {
    setDragPosition({ x, y })
    if (noTrail) return
    // A new drag keeps what's left of the last trail and grows it, rather than racing the timer that was clearing it.
    clearInterval(trailTimer.current)
    if (!trailPicture.current && ref.current) {
      trailMax.current = ref.current.getElementsByTagName('*').length > HEAVY_NODES ? TRAIL_MAX_HEAVY : TRAIL_MAX
    }

    setdummyWindowsArray((prev) =>
      prev.length < trailMax.current
        ? [...prev, { x: x + 5, y: y + 5, i: (prev[prev.length - 1]?.i ?? 0) + 1 }]
        : prev
    )
  }

  const trailLeft = useRef(0)
  trailLeft.current = dummyWindowsArray.length
  const clearTrial = () => {
    clearInterval(trailTimer.current)
    trailTimer.current = setInterval(() => {
      if (trailLeft.current) {
        setdummyWindowsArray((prev) => prev.slice(1))
        return
      }

      clearInterval(trailTimer.current)
      trailPicture.current = undefined
    }, 10)
  }

  useEffect(() => () => clearInterval(trailTimer.current), [])

  useEffect(() => {
    if (!initialized && position) {
      setInitialized(true)
      // Keep the bottom edge above the taskbar when the window first appears.
      const maxY = available ? Math.max(0, available - height) : position.y
      // And its title bar on screen, wherever the window was left on a wider desktop.
      const maxX = Math.max(0, window.innerWidth - width)
      // Never off its left or top either (a position saved by an older build may be negative).
      setDragPosition({ x: Math.max(0, Math.min(position.x, maxX)), y: Math.max(0, Math.min(position.y, maxY)) })
    }
  }, [position])

  return position && dragPosition ? (
    <>
      <DraggableWrapper
        className={[
          mobile ? 'fullscreen' : '',
          mobile && Pages[identifier]?.phoneCard ? 'phone-card' : '',
          minimized ? 'minimized' : '',
          focused ? 'is-focused' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={mobile}
        dragPosition={mobile ? { x: 0, y: 0 } : dragPosition}
        onDragWindow={(x, y) => moveIt(x, y)}
        onStopDrag={() => {
          saveDrag()
          clearTrial()
        }}
      >
        <DummyWindow
          innerRef={ref}
          onClick={onClick}
          onFocus={onClick}
          label={label}
          style={{
            height: mobile ? 'auto' : height,
            width: mobile ? 'auto' : width,
            position: 'absolute',
            pointerEvents: shaped ? 'none' : 'all',
            zIndex: baseDepth + 101,
            visibility: initialized ? 'visible' : 'hidden',
            overflow: shaped ? 'visible' : 'hidden',
            borderRadius: mobile ? undefined : corner,
          }}
        >
          <AppBoot identifier={identifier}>{children}</AppBoot>
          {resizable &&
            EDGES.map((edge) => (
              <div
                key={edge}
                aria-hidden
                data-resize={edge}
                style={gripStyle(edge)}
                onPointerDown={startResize(edge)}
              />
            ))}
        </DummyWindow>
      </DraggableWrapper>
      {!mobile &&
        dummyWindowsArray.map((element, i) => {
          return (
            <DummyWindow
              key={`${identifier}-trail-${i}`}
              style={{
                position: 'absolute',
                height: mobile ? 'auto' : height,
                width: mobile ? 'auto' : width,
                zIndex: baseDepth + i,
                transform: `translateX(${element.x}px) translateY(${element.y}px)`,
                userSelect: 'none',
                pointerEvents: 'none',
                visibility: initialized ? 'visible' : 'hidden',
                overflow: 'hidden',
                borderRadius: corner,
              }}
            >
              <div aria-hidden style={{ display: 'contents' }} ref={fillTrailCopy} />
            </DummyWindow>
          )
        })}
    </>
  ) : null
}
