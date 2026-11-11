import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DraggableData } from 'react-draggable'
import Draggable from 'react-draggable'

import Pages from '@/constants/pages'
import AppBoot from '@/components/AppBoot'
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
  mobile,
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
  const { height: viewHeight } = useWindowSize()

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
  const size = (resizable && (liveSize ?? savedSize)) || baseSize
  const minSize = { width: Math.min(baseSize.width, 480), height: Math.min(baseSize.height, 360) }
  const { width: viewWidth } = useWindowSize()

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
      if (edge.includes('w')) {
        w = Math.min(start.w - dx, start.left + start.w)
        w = Math.max(minSize.width, w)
        left = start.left + start.w - w
      }

      if (edge.includes('n')) {
        h = Math.min(start.h - dy, start.top + start.h)
        h = Math.max(minSize.height, h)
        top = start.top + start.h - h
      }

      w = Math.max(minSize.width, Math.round(w))
      h = Math.max(minSize.height, Math.round(h))
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
      setDragPosition({ x: Math.min(position.x, maxX), y: Math.min(position.y, maxY) })
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
