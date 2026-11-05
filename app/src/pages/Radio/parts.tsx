import WingHeartIcon from 'assets/miya_website_logo_2-removebg-preview.png?preset=icon&resize=true'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import styled, { keyframes } from 'styled-components/macro'

import { font } from '@/theme/tokens'

import { CELL_H, CELL_W, clockDigits, DIGIT_H, digitPath, textPath, textWidth } from './pixelFont'

export const wingHeart = WingHeartIcon[0]

/** The radio's parts, all sized in whole player pixels. Every colour comes from the skin's CSS variables. */

const raised = `inset 1px 1px 0 var(--rk-key-hi), inset -1px -1px 0 var(--rk-key-lo)`
const pressed = `inset 1px 1px 0 var(--rk-key-lo), inset -1px -1px 0 var(--rk-key-hi)`

export const well = `inset 1px 1px 0 var(--rk-frame-lo), inset -1px -1px 0 var(--rk-frame-hi)`

export const at = (left: number, top: number, width?: number, height?: number): CSSProperties => ({
  position: 'absolute',
  left,
  top,
  width,
  height,
})

export function PixelText({ text, style, className }: { text: string; style?: CSSProperties; className?: string }) {
  return (
    <svg
      className={className}
      style={{ display: 'block', flex: '0 0 auto', ...style }}
      width={textWidth(text)}
      height={CELL_H}
      viewBox={`0 0 ${textWidth(text)} ${CELL_H}`}
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path d={textPath(text)} />
    </svg>
  )
}

const marqueeSteps = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(var(--marquee-x)); }
`

const MarqueeBox = styled.div`
  overflow: hidden;
  > svg.run {
    animation: ${marqueeSteps} var(--marquee-s) steps(var(--marquee-n)) infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    > svg.run {
      animation: none;
    }
  }
`

/** One line of pixel text that scrolls a cell at a time when it doesn't fit. */
export function Marquee({ value, width, style }: { value: string; width: number; style?: CSSProperties }) {
  const fits = textWidth(value) <= width
  const shown = fits ? value : `${value}  ***  `
  const chars = textWidth(shown) / CELL_W
  return (
    <MarqueeBox
      className="marquee"
      title={value}
      style={{
        width,
        height: CELL_H,
        ...style,
        ['--marquee-x' as string]: `${-textWidth(shown)}px`,
        ['--marquee-n' as string]: chars,
        ['--marquee-s' as string]: `${chars * 0.2}s`,
      }}
    >
      <PixelText text={fits ? value : shown + shown} className={fits ? undefined : 'run'} />
    </MarqueeBox>
  )
}

const blink = keyframes`
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0.25; }
`

const Digits = styled.svg`
  display: block;
  &.blink {
    animation: ${blink} 1s steps(1) infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    &.blink {
      animation: none;
      opacity: 0.55;
    }
  }
`

const DIGIT_X = [9, 21, 39, 51]

/** The big clock, as mm:ss with a minus sign when counting down. Blank when nothing is loaded. */
export function Clock({
  seconds,
  negative,
  blank,
  paused,
}: {
  seconds: number
  negative?: boolean
  blank?: boolean
  paused?: boolean
}) {
  return (
    <Digits
      className={paused ? 'blink' : undefined}
      width="60"
      height={DIGIT_H}
      viewBox={`0 0 60 ${DIGIT_H}`}
      fill="var(--rk-lcd-ink)"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path fill="var(--rk-lcd-dim)" d={DIGIT_X.map((x) => digitPath(8, x)).join('')} />
      {!blank && (
        <path
          d={`${clockDigits(seconds)
            .map((d, i) => digitPath(d, DIGIT_X[i]))
            .join('')}M33 4h2v2h-2zM33 8h2v2h-2z${negative ? 'M1 6h5v1H1z' : ''}`}
        />
      )}
    </Digits>
  )
}

/** A silver key. Sized by the caller; holds a glyph or pixel text. */
export const Key = styled.button`
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--rk-btn-ink);
  background: linear-gradient(180deg, var(--rk-btn) 0%, var(--rk-btn-2) 100%);
  box-shadow: ${raised}, 0 0 0 1px var(--rk-seam);
  cursor: pointer;
  svg {
    filter: drop-shadow(1px 1px 0 var(--rk-key-hi));
  }
  &:active:not(:disabled),
  &[aria-pressed='true'] {
    background: linear-gradient(180deg, var(--rk-btn-2) 0%, var(--rk-btn) 100%);
    box-shadow: ${pressed}, 0 0 0 1px var(--rk-seam);
  }
  &:focus-visible {
    outline: 1px dotted var(--rk-frame-ink);
    outline-offset: 1px;
  }
  &:disabled {
    cursor: default;
    color: var(--rk-btn-off);
  }
`

/** A round chrome bead with a glyph on it. `$orb` is the big glass play button. */
export const Bead = styled.button.attrs({ type: 'button' })<{ $size: number; $lit?: boolean; $orb?: boolean }>`
  all: unset;
  position: relative;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  border-radius: 50%;
  cursor: pointer;
  color: ${({ $orb }) => ($orb ? '#fff' : 'var(--rk-btn-ink)')};
  background: ${({ $orb, $lit }) =>
    $orb
      ? `radial-gradient(circle at 36% 26%, #fff 0 5%, #ff9df0 16%, #c82bd0 42%, #57107f 72%, #1c0538 100%)`
      : $lit
      ? `radial-gradient(circle at 36% 28%, #fff 0 8%, #e2ffd2 22%, #7be05f 52%, #23762a 86%, #0e3d17 100%)`
      : `radial-gradient(circle at 36% 28%, #fff 0 8%, #e4e8f4 22%, #a2aac2 52%, #565d7c 84%, #2b2f48 100%)`};
  box-shadow: 0 0 0 1px #10101d, 0 2px 3px rgba(2, 1, 10, 0.75),
    ${({ $orb, $lit }) => ($orb && $lit ? '0 0 calc(8px + var(--lvl) * 16px) #ff5ce8' : '0 0 0 transparent')};
  svg {
    filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.5));
  }
  /* Small beads keep their look but take a 24px tap. */
  &::after {
    content: '';
    position: absolute;
    inset: ${({ $size }) => Math.min(0, ($size - 24) / 2)}px;
    border-radius: 50%;
  }
  &:active:not(:disabled) {
    transform: translateY(1px);
    filter: brightness(0.85);
  }
  &:focus-visible {
    outline: 1px dotted #fff;
    outline-offset: 2px;
  }
  &:disabled {
    cursor: default;
    color: var(--rk-btn-off);
    filter: saturate(0.5) brightness(0.8);
  }
`

const DialBox = styled.div`
  box-sizing: border-box;
  position: absolute;
  border-radius: 50%;
  cursor: ns-resize;
  touch-action: none;
  background: conic-gradient(
    from 200deg,
    #2b2f48,
    #e8ecf8 18%,
    #59607f 34%,
    #f3f5ff 52%,
    #4a506e 68%,
    #d3d9ea 84%,
    #2b2f48
  );
  box-shadow: 0 0 0 2px #10101d, 0 3px 5px rgba(2, 1, 10, 0.75), inset 0 0 6px rgba(0, 0, 0, 0.5);
  &:focus-visible {
    outline: 1px dotted #fff;
    outline-offset: 3px;
  }
  .notch {
    position: absolute;
    left: calc(50% - 2px);
    top: 3px;
    width: 4px;
    height: 9px;
    border-radius: 2px;
    background: #ff5ce8;
    box-shadow: 0 0 5px #ff5ce8;
  }
`

const SWEEP = 270

/** A rotary knob: drag up or down, scroll with the arrow keys, double-click to reset where that makes sense. */
export function Dial({
  label,
  style,
  min,
  max,
  step,
  value,
  text,
  onChange,
  onReset,
  center,
}: {
  label: string
  style: CSSProperties
  min: number
  max: number
  step: number
  value: number
  text: string
  onChange: (v: number) => void
  onReset?: () => void
  center?: boolean
}) {
  const drag = useRef<{ y: number; start: number } | null>(null)
  const clamp = (v: number) => Math.min(max, Math.max(min, Number((Math.round(v / step) * step).toFixed(4))))
  const angle = ((value - min) / (max - min) - 0.5) * SWEEP
  const big = Math.max(step, (max - min) / 10)

  // The wheel turns the knob. React's onWheel is passive, so the page would scroll too.
  const box = useRef<HTMLDivElement>(null)
  const latest = useRef({ value, onChange, clamp })
  latest.current = { value, onChange, clamp }
  useEffect(() => {
    const node = box.current
    if (!node) return undefined
    const turn = (e: WheelEvent) => {
      e.preventDefault()
      const { value: v, onChange: set, clamp: fit } = latest.current
      set(fit(v + (e.deltaY < 0 ? step : -step)))
    }

    node.addEventListener('wheel', turn, { passive: false })
    return () => node.removeEventListener('wheel', turn)
  }, [step])

  return (
    <DialBox
      ref={box}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={text}
      title={`${label} ${text}${center ? ' (double-click to centre)' : ''}`}
      style={{ ...style, transform: `rotate(${angle}deg)` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { y: e.clientY, start: value }
      }}
      onPointerMove={(e) => {
        if (drag.current) onChange(clamp(drag.current.start + ((drag.current.y - e.clientY) / 110) * (max - min)))
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const by = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: big, PageDown: -big }[
          e.key
        ]
        const to = { Home: min, End: max }[e.key]
        if (by || to !== undefined) {
          e.preventDefault()
          onChange(clamp(to ?? value + (by as number)))
        }
      }}
    >
      <span className="notch" />
    </DialBox>
  )
}

/** Horizontal slider. Set `--p` (0…1) for the lit part and `--fill` for its colour. */
export const Slider = styled.input.attrs({ type: 'range' })<{ $thumb?: number; $thumbH?: number; $center?: boolean }>`
  --p: 0;
  --fill: var(--rk-fill-b);
  all: unset;
  -webkit-appearance: none;
  appearance: none;
  display: block;
  box-sizing: border-box;
  cursor: pointer;
  background: var(--rk-groove);
  box-shadow: ${well};
  &::-webkit-slider-runnable-track {
    height: 100%;
    background: linear-gradient(var(--fill), var(--fill)) ${({ $center }) => ($center ? '50%' : '0')} 50% /
      calc(var(--p) * 100%) 3px no-repeat;
  }
  &::-moz-range-track {
    height: 100%;
    background: linear-gradient(var(--fill), var(--fill)) ${({ $center }) => ($center ? '50%' : '0')} 50% /
      calc(var(--p) * 100%) 3px no-repeat;
  }
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    box-sizing: border-box;
    width: ${({ $thumb = 14 }) => $thumb}px;
    height: ${({ $thumbH = 11 }) => $thumbH}px;
    margin-top: 1px;
    background: linear-gradient(180deg, var(--rk-btn) 0%, var(--rk-btn-2) 100%);
    box-shadow: ${raised}, 0 0 0 1px var(--rk-seam);
  }
  &::-moz-range-thumb {
    box-sizing: border-box;
    width: ${({ $thumb = 14 }) => $thumb}px;
    height: ${({ $thumbH = 11 }) => $thumbH}px;
    border: none;
    border-radius: 0;
    background: linear-gradient(180deg, var(--rk-btn) 0%, var(--rk-btn-2) 100%);
    box-shadow: ${raised}, 0 0 0 1px var(--rk-seam);
  }
  &:focus-visible {
    outline: 1px dotted var(--rk-frame-ink);
    outline-offset: 1px;
  }
  &:disabled {
    cursor: default;
  }
  &:disabled::-webkit-slider-thumb {
    visibility: hidden;
  }
  &:disabled::-moz-range-thumb {
    visibility: hidden;
  }
`

const MenuBox = styled.div`
  position: absolute;
  z-index: 5;
  min-width: 118px;
  max-width: 250px;
  padding: 2px;
  font-family: ${font.ui};
  font-size: 11px;
  line-height: 13px;
  color: var(--rk-frame-ink);
  background: var(--rk-frame-2);
  box-shadow: inset 1px 1px 0 var(--rk-frame-hi), inset -1px -1px 0 var(--rk-frame-lo), 0 0 0 1px var(--rk-seam),
    2px 2px 0 rgba(0, 0, 0, 0.5);
  button {
    all: unset;
    box-sizing: border-box;
    display: flex;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 1px 4px;
    white-space: nowrap;
    cursor: pointer;
  }
  button:hover:not(:disabled),
  button:focus-visible {
    color: var(--rk-pl-cur);
    background: var(--rk-pl-cur-bg);
  }
  button:disabled {
    cursor: default;
    opacity: 0.5;
  }
  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 1px 8px;
    margin: 0;
    padding: 2px 4px;
  }
  dt {
    color: var(--rk-lcd-soft);
  }
  dd {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

/** A small pop-up, shut by Escape or a click anywhere else. */
export function Menu({
  label,
  style,
  onClose,
  children,
}: {
  label: string
  style: CSSProperties
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current()
    }

    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <MenuBox ref={ref} role="group" aria-label={label} style={style}>
      {children}
    </MenuBox>
  )
}
