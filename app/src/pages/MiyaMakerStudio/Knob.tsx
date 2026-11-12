import { useEffect, useRef } from 'react'
import styled from 'styled-components/macro'

import { font } from '@/theme/tokens'

import { pink } from './chrome'

/**
 * MusicMaker dial: hex count inside, needle on the rim.
 * Drag up to raise. The drag does not capture the pointer, so it ends when the
 * pointer leaves the dial. Wheel and arrows step one count. Shift jumps 16.
 */

function hexTop(bits: number): number {
  if (bits >= 16) return 65535
  if (bits >= 12) return 4095
  return 255
}

function hexDigits(bits: number): number {
  if (bits >= 16) return 4
  if (bits >= 12) return 3
  return 2
}

function hexCount(value: number, min: number, max: number, bits: number): number {
  const span = max - min || 1
  const t = Math.min(1, Math.max(0, ((Number.isFinite(value) ? value : min) - min) / span))
  return Math.round(t * hexTop(bits))
}

function hexValue(count: number, min: number, max: number, bits: number): number {
  const top = hexTop(bits)
  const n = Math.min(top, Math.max(0, count))
  return Math.round((min + (n / top) * (max - min)) * 100000) / 100000
}

function trimNum(n: number): string {
  if (Math.abs(n) >= 100) return String(Math.round(n))
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 100) / 100)
}

const Wrap = styled.div`
  width: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  flex: 0 0 auto;

  span {
    max-width: 64px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    font-size: 12px;
    line-height: 1.1;
    color: ${pink.ink};
  }
`

const Dial = styled.button`
  width: 52px;
  height: 52px;
  min-width: 0;
  min-height: 0;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: ${pink.mist};
  box-shadow:
    inset 0 2px 4px rgba(26, 18, 48, 0.35),
    inset 0 -1px 0 #fff,
    0 1px 0 ${pink.edge};
  cursor: ns-resize;
  touch-action: none;

  svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .ring {
    fill: ${pink.mist};
    stroke: ${pink.deep};
    stroke-width: 1.5;
  }

  .needle {
    fill: ${pink.hot};
  }

  .read {
    fill: ${pink.ink};
    font-family: ${font.mono};
    font-size: 16px;
    font-weight: 700;
  }

  &:active {
    box-shadow: inset 0 3px 6px rgba(26, 18, 48, 0.5), 0 1px 0 ${pink.edge};
  }

  &:focus-visible {
    outline: 1px dotted ${pink.ink};
    outline-offset: 2px;
  }

  @media (pointer: coarse) {
    width: 48px;
    height: 48px;
  }
`

type Props = {
  label: string
  value: number
  min: number
  max: number
  bits?: number
  /** Shown after the number in the hover title, for example "px". */
  unit?: string
  text?: string
  hint?: string
  onChange: (value: number) => void
}

export default function Knob({ label, value, min, max, bits = 8, unit, text, hint, onChange }: Props) {
  const width = hexDigits(bits)
  const count = hexCount(value, min, max, bits)
  const hex = count.toString(16).toUpperCase().padStart(width, '0')
  const detail = text != null ? text : unit ? `${trimNum(value)} ${unit}` : trimNum(value)
  const t = count / hexTop(bits)
  const angle = Math.PI * (0.75 + t * 1.5)
  const ux = Math.cos(angle)
  const uy = Math.sin(angle)
  const px = -uy
  const py = ux
  const tip: [number, number] = [26 + ux * 22, 26 + uy * 22]
  const base: [number, number] = [26 + ux * 15.5, 26 + uy * 15.5]
  const drag = useRef<{ y: number; count: number; fine: boolean; id: number } | null>(null)
  const dial = useRef<HTMLButtonElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const node = dial.current
    if (!node) return undefined
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const step = (event.deltaY < 0 ? 1 : -1) * (event.shiftKey ? 16 : 1)
      onChangeRef.current(hexValue(count + step, min, max, bits))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [bits, count, max, min])

  const endDrag = () => {
    drag.current = null
  }

  return (
    <Wrap className="trait-knob">
      <Dial
        type="button"
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={hexTop(bits)}
        aria-valuenow={count}
        aria-valuetext={hex}
        title={hint ? `${label} ${hex} · ${detail}. ${hint}` : `${label} ${hex} · ${detail}`}
        data-testid={`trait-knob-${label.toLowerCase()}`}
        ref={dial}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          drag.current = { y: event.clientY, count, fine: event.shiftKey, id: event.pointerId }
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start || event.pointerId !== start.id) return
          const travel = start.fine ? 280 : 72
          const delta = ((start.y - event.clientY) / travel) * hexTop(bits)
          onChangeRef.current(hexValue(start.count + Math.round(delta), min, max, bits))
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        onKeyDown={(event) => {
          const dir = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (!dir) return
          event.preventDefault()
          event.stopPropagation()
          onChangeRef.current(hexValue(count + dir * (event.shiftKey ? 16 : 1), min, max, bits))
        }}
      >
        <svg viewBox="0 0 52 52" aria-hidden="true">
          <circle className="ring" cx="26" cy="26" r="23" />
          <polygon
            className="needle"
            points={`${tip[0]},${tip[1]} ${base[0] + px * 3.2},${base[1] + py * 3.2} ${base[0] - px * 3.2},${base[1] - py * 3.2}`}
          />
          <text className="read" x="26" y="26.5" textAnchor="middle" dominantBaseline="central">
            {hex}
          </text>
        </svg>
      </Dial>
      <span>{label}</span>
    </Wrap>
  )
}
