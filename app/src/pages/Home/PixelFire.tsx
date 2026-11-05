import styled, { keyframes } from 'styled-components/macro'

import { reducedMotion } from './y2k'

/**
 * A 12x14 pixel flame for wallets that have burned their MIYA or MXXN. Two frames (the second a mirror with the tips
 * moved) swap in steps, like a GIF. Under reduced motion it holds the first frame.
 */
const FRAME_A = [
  '.....y......',
  '....yy...y..',
  '....yo..yy..',
  '...yoo..yo..',
  '..yoor.yoo..',
  '..yorr.yor..',
  '.yorrryorr..',
  '.yorrrrrrro.',
  'yorrrrrrrroy',
  'yorrooorrroy',
  'yorowwworroy',
  'yrowwyywwory',
  '.rowyyyywor.',
  '..rrrrrrrr..',
]
const FRAME_B = [
  '......y.....',
  '..y...yy....',
  '..yy..oy....',
  '..oy.ooy....',
  '..ooy.rooy..',
  '..royrrroy..',
  '..rroyrrroy.',
  '.orrrrrrroy.',
  'yorrrrrrrroy',
  'yorrrooorroy',
  'yorrowwworoy',
  'yrowwyywwory',
  '.rowyyyywor.',
  '..rrrrrrrr..',
]
const INK: Record<string, string> = { y: '#ffd400', o: '#ff7a00', r: '#e0006b', w: '#fff6c2' }

function Frame({ rows, className }: { rows: string[]; className: string }) {
  return (
    <g className={className}>
      {rows.flatMap((row, y) =>
        [...row].map((c, x) =>
          INK[c] ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={INK[c]} /> : null
        )
      )}
    </g>
  )
}

const flicker = keyframes`
  50% { visibility: hidden; }
`

const Svg = styled.svg`
  display: block;
  image-rendering: pixelated;
  filter: drop-shadow(0 0 6px rgba(255, 122, 0, 0.55));
  .a {
    animation: ${flicker} 0.5s steps(1) infinite;
  }
  .b {
    animation: ${flicker} 0.5s steps(1) infinite;
    animation-delay: -0.25s;
  }
  ${reducedMotion} {
    .a {
      animation: none;
    }
    .b {
      display: none;
    }
  }
`

export default function PixelFire({ size = 72 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 12 14" width={size} height={(size * 14) / 12} shapeRendering="crispEdges" aria-hidden>
      <Frame rows={FRAME_A} className="a" />
      <Frame rows={FRAME_B} className="b" />
    </Svg>
  )
}
