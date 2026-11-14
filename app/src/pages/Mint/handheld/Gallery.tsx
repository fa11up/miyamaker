import type { KeyboardEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import { PAINTED } from './Carousel'
import Device, { Lcd } from './Device'
import Holo from './Holo'
import { gridStep, wrapIndex } from './status'

/** How many pieces a row holds on the handheld's screen. */
const COLS = 3

const Grid = styled.div`
  position: absolute;
  inset: 0;
  /* Flex, not grid: Chrome sizes grid rows before the pieces' aspect ratio, and the rows collapse. */
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 8px;
  padding: 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: ${PAINTED};
`

const Piece = styled.button`
  all: unset;
  box-sizing: border-box;
  position: relative;
  flex: none;
  width: calc((100% - ${(COLS - 1) * 8}px) / ${COLS});
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: 6px;
  cursor: zoom-in;
  background: #1c1436;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.7), 0 4px 8px rgba(20, 6, 60, 0.5);
  &.here {
    box-shadow: 0 0 0 3px #fff35c, 0 4px 12px rgba(20, 6, 60, 0.6);
  }
  &:focus-visible {
    outline: 3px dashed #fff35c;
    outline-offset: 2px;
  }
  > div,
  img {
    display: block;
    width: 100%;
    height: 100%;
    max-width: none;
    margin: 0;
    border: none;
    object-fit: cover;
  }
  span {
    position: absolute;
    left: 4px;
    bottom: 4px;
    padding: 0 5px;
    border-radius: 3px;
    background: rgba(12, 10, 24, 0.8);
    color: #fff;
    font-size: 12px;
  }
`

const Empty = styled.p`
  width: 100%;
  margin: 40px 12px 0;
  text-align: center;
  color: #fff;
  font-size: 16px;
  text-shadow: 0 1px 3px rgba(20, 6, 60, 0.85);
`

/** Mounts its art once it scrolls near the screen, so a big collection loads only what is looked at. */
function Lazy({ children, root }: { children: ReactNode; root: React.RefObject<HTMLElement> }) {
  const el = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (seen || !el.current) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return undefined
    }

    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true)
      },
      { root: root.current, rootMargin: '200px 0px' }
    )
    watch.observe(el.current)
    return () => watch.disconnect()
  }, [seen, root])
  return <div ref={el}>{seen ? children : null}</div>
}

/**
 * Every piece minted so far, as a grid on the handheld's screen. The D-pad moves the cursor in all four directions and the
 * screen scrolls with it (a finger or wheel scrolls it too); A, or a tap, lifts the piece onto the hologram, where ◀▶ go
 * on through the rest.
 */
export default function Gallery({
  name,
  ids,
  art,
  loading,
  empty,
  onBack,
}: {
  name: string
  /** Token ids in the order shown. */
  ids: number[]
  art: (id: number) => ReactNode
  loading?: boolean
  /** Said when nothing has been minted. */
  empty: string
  onBack: () => void
}) {
  const [at, setAt] = useState(0)
  const [holo, setHolo] = useState<number>()
  const grid = useRef<HTMLDivElement>(null)
  const index = Math.min(at, Math.max(0, ids.length - 1))
  const here = ids[index]

  const move = (dx: number, dy: number) => {
    if (!ids.length) return
    const to = gridStep(ids.length, COLS, index, dx, dy)
    setAt(to)
    const piece = grid.current?.querySelector<HTMLElement>(`[data-at="${to}"]`)
    piece?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    // Keyboard focus follows the cursor when it was on a piece, so the arrows keep working there.
    if (grid.current?.contains(document.activeElement) && document.activeElement !== grid.current) {
      piece?.focus({ preventScroll: true })
    }
  }

  const dpad = {
    up: () => move(0, -1),
    down: () => move(0, 1),
    left: () => move(-1, 0),
    right: () => move(1, 0),
  }
  // The device skips keys pressed on a button, so a focused piece takes the arrows itself.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const go = { ArrowUp: dpad.up, ArrowDown: dpad.down, ArrowLeft: dpad.left, ArrowRight: dpad.right }[e.key]
    if (!go || !(e.target as HTMLElement).closest('[data-at]')) return
    e.preventDefault()
    go()
  }

  const open = {
    label: here !== undefined ? `View #${here} as hologram` : 'Nothing to view',
    disabled: here === undefined,
    onClick: () => setHolo(here),
  }
  const back = { label: 'Back', onClick: onBack }
  const holoAt = holo === undefined ? -1 : ids.indexOf(holo)

  return (
    <Device
      title={`${name} gallery`}
      lamp={{ color: '#9fe8ff', label: 'Gallery' }}
      screen={
        <>
          <Grid ref={grid} className="scroll" role="list" aria-label={`Minted pieces of ${name}`} onKeyDown={onKey}>
            {ids.length === 0 ? (
              <Empty>{loading ? 'Reading the chain…' : empty}</Empty>
            ) : (
              ids.map((id, i) => (
                <Piece
                  key={id}
                  type="button"
                  role="listitem"
                  data-at={i}
                  className={i === index ? 'here' : undefined}
                  aria-label={`View #${id} as a hologram`}
                  onClick={() => {
                    setAt(i)
                    setHolo(id)
                  }}
                >
                  <Lazy root={grid}>{art(id)}</Lazy>
                  <span>#{id}</span>
                </Piece>
              ))
            )}
          </Grid>
          {holo !== undefined && (
            <Holo
              art={art(holo)}
              name={name}
              detail={`#${holo}`}
              onStep={
                ids.length > 1
                  ? (step) => {
                      const to = wrapIndex(ids.length, holoAt, step)
                      setAt(to)
                      setHolo(ids[to])
                    }
                  : undefined
              }
              onClose={() => {
                setHolo(undefined)
                grid.current?.querySelector<HTMLElement>(`[data-at="${index}"]`)?.scrollIntoView({ block: 'nearest' })
              }}
            />
          )}
        </>
      }
      lcd={
        <Lcd>
          <div>
            <span>{name}</span>
            <span>{ids.length ? `${index + 1} / ${ids.length}` : ''}</span>
          </div>
          <div>
            <span>✚ Browse</span>
          </div>
          <div>
            <span>Ⓐ {open.label}</span>
          </div>
        </Lcd>
      }
      a={open}
      b={back}
      start={open}
      select={back}
      dpad={dpad}
    />
  )
}
