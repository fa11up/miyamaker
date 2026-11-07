import paint from 'assets/explorer/background/background.png'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import styled, { keyframes } from 'styled-components/macro'

import type { DeviceAction } from './Device'
import Device, { Lcd } from './Device'
import { wrapIndex } from './status'

/** The old painted canvas, for the menus: art, not a dark app. */
export const PAINTED = `url(${paint}) center / cover`

export type CarouselItem = {
  key: string
  name: string
  line: string
  /** What A says here, and what pressing it does. No `open` means it can't be opened yet. */
  action: string
  open?: () => void
  pic: ReactNode
}

/* The menu settles onto the painting a piece at a time: the card first, then its neighbours, its name and the dots. */
const settle = keyframes`
  from { opacity: 0; transform: translateY(14px) scale(0.94); }
  to { opacity: 1; transform: none; }
`
const SETTLE = '0.75s cubic-bezier(0.2, 0.8, 0.25, 1)'

const Stage = styled.div`
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: pan-y;
  background: ${PAINTED};
  > [role='listitem'] {
    position: absolute;
    inset: 0;
    animation: ${settle} ${SETTLE} 0.1s backwards;
  }
  > [role='listitem'].beside {
    animation-delay: 0.3s;
  }
  @media (prefers-reduced-motion: reduce) {
    > [role='listitem'] {
      animation: none;
    }
  }
`

const Card = styled.button`
  all: unset;
  box-sizing: border-box;
  position: absolute;
  left: 50%;
  top: 34px;
  width: 196px;
  height: 196px;
  margin-left: -98px;
  overflow: hidden;
  border-radius: 14px;
  cursor: pointer;
  background: #1c1436;
  box-shadow:
    0 0 0 3px #fff,
    0 12px 22px rgba(20, 6, 60, 0.55);
  transition:
    transform 0.26s cubic-bezier(0.2, 0.9, 0.3, 1),
    opacity 0.26s ease-out;
  &:focus-visible {
    outline: 3px dashed #fff35c;
    outline-offset: 4px;
  }
  &.dim {
    opacity: 0.62;
  }
  &.gone {
    opacity: 0;
    pointer-events: none;
  }
  &:disabled {
    cursor: default;
  }
  > div {
    width: 100%;
    height: 100%;
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
  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`

const Words = styled.div`
  position: absolute;
  left: 12px;
  right: 12px;
  top: 248px;
  text-align: center;
  color: #fff;
  text-shadow: 0 1px 3px rgba(20, 6, 60, 0.85);
  animation: ${settle} ${SETTLE} 0.4s backwards;
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
  b {
    display: block;
    font-size: 26px;
    font-weight: 400;
    line-height: 1.15;
  }
  span {
    display: block;
    margin-top: 2px;
    font-size: 15px;
    line-height: 1.25;
  }
`

const Dots = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 12px;
  display: flex;
  justify-content: center;
  gap: 7px;
  animation: ${settle} ${SETTLE} 0.55s backwards;
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
  i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.45);
  }
  i.on {
    background: #fff;
  }
`

/** The picture on a card with no art of its own. */
export const Glyph = styled.div<{ $bg?: string }>`
  display: grid;
  place-items: center;
  font-size: 92px;
  line-height: 1;
  color: #fff;
  background: ${({ $bg }) => $bg ?? 'linear-gradient(160deg, #6a3fc0, #2c1458)'};
`

/** A menu of big cards, one at a time: ◀▶ or Select move, A or Start opens. */
export default function Carousel({
  title,
  lampLabel,
  items,
  back,
  ariaLabel,
}: {
  title: string
  lampLabel: string
  items: CarouselItem[]
  back: DeviceAction
  ariaLabel: string
}) {
  const [at, setAt] = useState(0)
  const index = Math.min(at, items.length - 1)
  const here = items[index]!
  const move = (step: number) => setAt(wrapIndex(items.length, index, step))
  // On a phone the cards follow a finger: a sideways swipe moves one card, and the tap that ends it opens nothing.
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)
  const open = { label: here.action, disabled: !here.open, onClick: () => here.open?.() }

  // Shortest way round, so the neighbours sit either side however many there are.
  const offset = (i: number) => {
    const raw = wrapIndex(items.length, i, -index)
    return raw > items.length / 2 ? raw - items.length : raw
  }

  return (
    <Device
      title={title}
      lamp={{ color: '#3dff7a', label: lampLabel }}
      screen={
        <Stage
          role="list"
          aria-label={ariaLabel}
          onTouchStart={(e) => {
            const t = e.touches[0]
            swipe.current = t ? { x: t.clientX, y: t.clientY } : null
            swiped.current = false
          }}
          onTouchEnd={(e) => {
            const from = swipe.current
            const t = e.changedTouches[0]
            swipe.current = null
            if (!from || !t) return
            const dx = t.clientX - from.x
            if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(t.clientY - from.y)) return
            swiped.current = true
            move(dx < 0 ? 1 : -1)
          }}
          onClickCapture={(e) => {
            if (!swiped.current) return
            swiped.current = false
            e.stopPropagation()
            e.preventDefault()
          }}
        >
          {items.map((item, i) => {
            const o = offset(i)
            return (
              <div
                key={item.key}
                role="listitem"
                className={o === 0 ? undefined : 'beside'}
                style={{ zIndex: o === 0 ? 2 : 1 }}
              >
                <Card
                  type="button"
                  className={o === 0 ? undefined : Math.abs(o) === 1 ? 'dim' : 'gone'}
                  style={{
                    transform: `translateX(${o * 162}px) scale(${o === 0 ? 1 : 0.5})`,
                  }}
                  disabled={o === 0 && !item.open}
                  tabIndex={o === 0 ? 0 : -1}
                  aria-label={item.action}
                  onClick={() => (o === 0 ? item.open?.() : setAt(i))}
                >
                  {item.pic}
                </Card>
              </div>
            )
          })}
          <Words>
            <b>{here.name}</b>
            <span>{here.line}</span>
          </Words>
          <Dots aria-hidden>
            {items.map((item, i) => (
              <i key={item.key} className={i === index ? 'on' : undefined} />
            ))}
          </Dots>
        </Stage>
      }
      lcd={
        <Lcd>
          <div>
            <span>{here.name}</span>
          </div>
          <div>
            <span>◀▶ Choose</span>
          </div>
          <div>
            <span>Ⓐ {here.action}</span>
          </div>
        </Lcd>
      }
      a={open}
      b={back}
      select={{ label: 'Next choice', onClick: () => move(1) }}
      start={open}
      dpad={{ left: () => move(-1), right: () => move(1) }}
    />
  )
}
