import type { ReactNode, RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { DraggableData } from 'react-draggable'
import Draggable from 'react-draggable'
import { useWindowSize } from 'usehooks-ts'

import { useWindowPosition } from '@/store/windows/hooks'

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
      style={style}
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
    if (!initialized) return
    const raised = focused && !wasFocused.current
    wasFocused.current = !!focused
    const node = ref.current
    if (!raised || !node || node.contains(document.activeElement) || document.querySelector('[data-boot]')) return
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      returnTo.current = document.activeElement
    }

    node.focus({ preventScroll: true })
  }, [focused, initialized])
  useEffect(
    () => () => {
      const active = document.activeElement
      if (active && active !== document.body && document.body.contains(active)) return
      if (returnTo.current?.isConnected) returnTo.current.focus({ preventScroll: true })
    },
    []
  )

  // A window taller than the desktop shrinks to fit above the taskbar and scrolls inside.
  const available = Math.max(0, viewHeight - 34)
  const height = !shaped && available && baseSize.height > available ? available : baseSize.height

  const [dummyWindowsArray, setdummyWindowsArray] = useState<{ x: number; y: number; i: number }[]>([])

  const cleanUp = (length: number) => {
    if (dummyWindowsArray.length > length) {
      const reducedArr = dummyWindowsArray
      reducedArr.shift()
      setdummyWindowsArray([...reducedArr])
    }
  }

  const moveIt = (x: number, y: number) => {
    setDragPosition({ x, y })
    const lastWindow = dummyWindowsArray[dummyWindowsArray.length - 1]
    if (dummyWindowsArray.length < 100)
      setdummyWindowsArray((prev) => [...prev, { x: x + 5, y: y + 5, i: lastWindow ? lastWindow.i + 1 : 1 }])
    cleanUp(500)
  }

  const clearTrial = (timeout?: number) => {
    const timer = setInterval(() => {
      cleanUp(0)
      if (dummyWindowsArray.length === 0) {
        clearInterval(timer)
      }
    }, timeout || 10)
  }

  useEffect(() => {
    if (!initialized && position) {
      setInitialized(true)
      // Keep the bottom edge above the taskbar when the window first appears.
      const maxY = available ? Math.max(0, available - height) : position.y
      setDragPosition({ x: position.x, y: Math.min(position.y, maxY) })
    }
  }, [position])

  return position && dragPosition ? (
    <>
      <DraggableWrapper
        className={[mobile ? 'fullscreen' : '', minimized ? 'minimized' : '', focused ? 'is-focused' : '']
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
            width: mobile ? 'auto' : baseSize.width,
            position: 'absolute',
            pointerEvents: shaped ? 'none' : 'all',
            zIndex: baseDepth + 101,
            visibility: initialized ? 'visible' : 'hidden',
            overflow: shaped ? 'visible' : 'hidden',
          }}
        >
          {children}
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
                width: mobile ? 'auto' : baseSize.width,
                zIndex: baseDepth + i,
                transform: `translateX(${element.x}px) translateY(${element.y}px)`,
                userSelect: 'none',
                pointerEvents: 'none',
                visibility: initialized ? 'visible' : 'hidden',
                overflow: 'hidden',
              }}
            >
              {children}
            </DummyWindow>
          )
        })}
    </>
  ) : (
    <div style={{ visibility: 'hidden' }}>{children}</div>
  )
}
