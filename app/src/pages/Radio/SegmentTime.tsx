import styled, { keyframes } from 'styled-components/macro'

/**
 * Seven-segment LCD readout (original SVG, drawn per character). Unlit segments stay faintly visible like a
 * real LCD; lit ones glow in the skin's phosphor colour.
 */

const H = (cy: number) => `2.3,${cy} 3.3,${cy - 1} 8.7,${cy - 1} 9.7,${cy} 8.7,${cy + 1} 3.3,${cy + 1}`
const V = (cx: number, y0: number, y1: number) =>
  `${cx},${y0} ${cx + 1},${y0 + 1} ${cx + 1},${y1 - 1} ${cx},${y1} ${cx - 1},${y1 - 1} ${cx - 1},${y0 + 1}`

// a b c d e f g
const SEGMENTS = [H(1.5), V(10.6, 2.2, 9.8), V(10.6, 10.2, 17.8), H(18.5), V(1.4, 10.2, 17.8), V(1.4, 2.2, 9.8), H(10)]

const DIGITS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
}

const blink = keyframes`
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0.15; }
`

const Row = styled.span<{ $h: number }>`
  display: inline-flex;
  align-items: stretch;
  gap: ${({ $h }) => Math.max(1, Math.round($h / 12))}px;
  height: ${({ $h }) => $h}px;
  svg {
    height: 100%;
    width: auto;
    overflow: visible;
  }
  .off {
    fill: var(--rk-lcd-dim);
  }
  .on {
    fill: var(--rk-lcd-ink);
    filter: drop-shadow(0 0 2px var(--rk-lcd-glow));
  }
  &.blink .on {
    animation: ${blink} 1s steps(1) infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    &.blink .on {
      animation: none;
      opacity: 0.55;
    }
  }
`

function Char({ c }: { c: string }) {
  if (c === ':') {
    return (
      <svg viewBox="0 0 4 20" aria-hidden="true">
        <rect className="on" x="1" y="5" width="2" height="2" />
        <rect className="on" x="1" y="13" width="2" height="2" />
      </svg>
    )
  }

  const lit = DIGITS[c] ?? ''
  return (
    <svg viewBox="0 0 12 20" aria-hidden="true">
      {SEGMENTS.map((pts, i) => (
        <polygon key={i} points={pts} className={lit.includes('abcdefg'[i] as string) ? 'on' : 'off'} />
      ))}
    </svg>
  )
}

export default function SegmentTime({
  value,
  height = 28,
  blink,
}: {
  value: string
  height?: number
  blink?: boolean
}) {
  return (
    <Row $h={height} className={blink ? 'blink' : undefined} aria-hidden="true">
      {value.split('').map((c, i) => (
        <Char key={i} c={c} />
      ))}
    </Row>
  )
}
