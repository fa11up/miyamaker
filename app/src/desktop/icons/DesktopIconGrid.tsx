import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import DesktopIcon from '@/pages/OperatingSystem/DesktopIcon'
import { color, MOBILE_BREAKPOINT } from '@/theme/tokens'

import { DESKTOP_EVENTS, useReducedMotion } from '../prefs'
import type { Cell, IconLayout } from './layout'
import { cellToPx, GRID, gridDims, moveIcon, pxToCell, resolveLayout, sameAsDefault, stepCell } from './layout'
import { loadIconLayout, saveIconLayout } from './store'

/*
 * Desktop icons you can rearrange. Desktop: absolutely placed on a snap grid; drag with mouse,
 * pen or touch, or focus an icon and press Shift+arrow keys. Phones keep the home-screen grid
 * (no dragging: a long scroll list should not turn into a drag surface).
 */

export interface DesktopIconApp {
  id: string
  label: string
  src: string | undefined
}

const MobileGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  width: 100%;
  padding: 24px 16px;
  row-gap: 20px;
  gap: 8px;
  align-content: start;
`

const Free = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  pointer-events: none !important;
`

const Slot = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  width: ${GRID.cellW}px;
  height: ${GRID.cellH}px;
  touch-action: none;
  transition: transform 180ms ease-out;
  &.dragging {
    transition: none;
    z-index: 2;
    opacity: 0.85;
    cursor: grabbing;
  }
  &.still {
    transition: none;
  }
  > button {
    height: 100%;
  }
`

const DropTarget = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  width: ${GRID.cellW}px;
  height: ${GRID.cellH}px;
  outline: 1px dotted ${color.highlight};
  outline-offset: -2px;
  background: rgba(255, 255, 255, 0.08);
  pointer-events: none !important;
`

const SrOnly = styled.div`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
`

const DRAG_THRESHOLD = 6
const ARROWS: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

function announceMoved() {
  window.dispatchEvent(new CustomEvent(DESKTOP_EVENTS.iconsMoved))
  // once the slide transition has finished
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(DESKTOP_EVENTS.iconsMoved)), 220)
}

export default function DesktopIconGrid({
  icons,
  onOpen,
}: {
  icons: readonly DesktopIconApp[]
  onOpen: (id: string) => void
}) {
  const [mobile, setMobile] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT)
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth <= MOBILE_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (mobile) {
    return (
      <MobileGrid>
        {icons.map((icon) => (
          <DesktopIcon key={icon.id} normalState={icon.src} onClick={() => onOpen(icon.id)} perchId={icon.id}>
            {icon.label}
          </DesktopIcon>
        ))}
      </MobileGrid>
    )
  }

  return <FreeGrid icons={icons} onOpen={onOpen} />
}

function FreeGrid({ icons, onOpen }: { icons: readonly DesktopIconApp[]; onOpen: (id: string) => void }) {
  const reducedMotion = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const ids = useMemo(() => icons.map((i) => i.id), [icons])
  const [dims, setDims] = useState<{ cols: number; rows: number }>()
  const [saved, setSaved] = useState<unknown>(loadIconLayout)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; target: Cell }>()
  const [status, setStatus] = useState('')
  const suppressClick = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => {
      const next = gridDims(el.clientWidth, el.clientHeight)
      setDims((d) => (d && d.cols === next.cols && d.rows === next.rows ? d : next))
    }

    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const layout: IconLayout | undefined = useMemo(
    () => (dims ? resolveLayout(ids, saved, dims.cols, dims.rows) : undefined),
    [dims, ids, saved]
  )

  // icons moved by a resize (fewer rows) are new perches for the pet too
  useEffect(() => {
    if (layout) announceMoved()
  }, [layout])

  const commit = useCallback(
    (next: IconLayout) => {
      const value = dims && sameAsDefault(next, ids, dims.rows) ? undefined : next
      saveIconLayout(value)
      setSaved(value)
    },
    [dims, ids]
  )

  // Context menu: "Arrange icons"
  useEffect(() => {
    const onArrange = () => {
      saveIconLayout(undefined)
      setSaved(undefined)
      setStatus('Icons arranged')
    }

    window.addEventListener(DESKTOP_EVENTS.arrangeIcons, onArrange)
    return () => window.removeEventListener(DESKTOP_EVENTS.arrangeIcons, onArrange)
  }, [])

  const onPointerDown = (id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!layout || !dims || e.button !== 0 || !e.isPrimary) return
    const start = cellToPx(layout[id]!)
    const sx = e.clientX
    const sy = e.clientY
    let dragging = false
    let last = { x: start.x, y: start.y, target: layout[id]! }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        dragging = true
      }

      const el = ref.current
      const maxX = (el?.clientWidth ?? 0) - GRID.cellW
      const maxY = (el?.clientHeight ?? 0) - GRID.cellH
      const x = Math.min(Math.max(0, start.x + dx), Math.max(0, maxX))
      const y = Math.min(Math.max(0, start.y + dy), Math.max(0, maxY))
      last = { x, y, target: pxToCell(x, y, dims.cols, dims.rows) }
      setDrag({ id, ...last })
    }

    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      if (!dragging) return
      setDrag(undefined)
      if (ev.type === 'pointercancel') return
      // the click that follows this pointerup must not open the app
      suppressClick.current = true
      window.setTimeout(() => {
        suppressClick.current = false
      }, 0)
      commit(moveIcon(layout, id, last.target))
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const onKeyDown = (id: string, label: string) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    const dir = ARROWS[e.key]
    if (!dir || !e.shiftKey || !layout || !dims) return
    e.preventDefault()
    const to = stepCell(layout[id]!, dir, dims.cols, dims.rows)
    commit(moveIcon(layout, id, to))
    setStatus(`${label} moved to column ${to.col + 1}, row ${to.row + 1}`)
  }

  return (
    <Free ref={ref}>
      {layout &&
        icons.map((icon) => {
          const cell = layout[icon.id]!
          const dragging = drag?.id === icon.id
          const pos = dragging ? drag : cellToPx(cell)
          return (
            <Slot
              key={icon.id}
              className={`${dragging ? 'dragging' : ''} ${reducedMotion ? 'still' : ''}`}
              style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
              onPointerDown={onPointerDown(icon.id)}
              onKeyDown={onKeyDown(icon.id, icon.label)}
              onClickCapture={(e) => {
                if (!suppressClick.current) return
                e.preventDefault()
                e.stopPropagation()
              }}
              onDragStart={(e) => e.preventDefault()}
              data-icon-id={icon.id}
            >
              <DesktopIcon
                normalState={icon.src}
                onClick={() => onOpen(icon.id)}
                perchId={icon.id}
                aria-keyshortcuts="Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight"
                title={`${icon.label}. Drag to move, or Shift + arrow keys.`}
              >
                {icon.label}
              </DesktopIcon>
            </Slot>
          )
        })}
      {drag && (
        <DropTarget
          aria-hidden
          style={{ transform: `translate(${cellToPx(drag.target).x}px, ${cellToPx(drag.target).y}px)` }}
        />
      )}
      <SrOnly role="status" aria-live="polite">
        {status}
      </SrOnly>
    </Free>
  )
}
