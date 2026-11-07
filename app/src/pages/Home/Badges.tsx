import Miya from 'assets/miya.png?preset=avatar&resize=true'
import styled, { css, keyframes } from 'styled-components/macro'

import { LINKS } from '@/constants/miyanet'
import { color, font, space, text } from '@/theme/tokens'

import { reducedMotion, y2k } from './y2k'

/**
 * Hand-made 88x31 buttons, the badge wall of every 1999 homepage. Drawn with CSS (no image files) in Verdana at
 * pixel sizes, like the originals. Each one that goes somewhere is a real link.
 */
const shine = keyframes`
  0%, 70% { background-position: -60px 0; }
  100% { background-position: 120px 0; }
`

const badge = css`
  position: relative;
  box-sizing: border-box;
  width: 88px;
  height: 31px;
  flex: 0 0 88px;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 3px;
  padding: 2px 3px;
  overflow: hidden;
  border: 1px solid #000;
  box-shadow: inset 1px 1px rgba(255, 255, 255, 0.55), inset -1px -1px rgba(0, 0, 0, 0.45);
  font-family: Verdana, Tahoma, sans-serif;
  text-decoration: none;
  line-height: 1;
  image-rendering: pixelated;
  small {
    display: block;
    font-size: 9px;
    letter-spacing: 0.02em;
  }
  b {
    display: block;
    font-family: ${font.ui};
    font-size: 16px;
    font-weight: 400;
    line-height: 14px;
  }
  &.shiny::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(100deg, transparent 0 40%, rgba(255, 255, 255, 0.55) 50%, transparent 60% 100%)
      no-repeat;
    background-size: 60px 100%;
    animation: ${shine} 3.2s ease-in-out infinite;
    pointer-events: none;
  }
  ${reducedMotion} {
    &.shiny::after {
      animation: none;
      display: none;
    }
  }
  &:focus-visible {
    outline: 2px dotted #fff;
    outline-offset: 1px;
  }
`

const Badge = styled.a`
  ${badge}
`

const StaticBadge = styled.span`
  ${badge}
`

const Pix = styled.span`
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  font: bold 13px/1 Verdana, sans-serif;
  img {
    width: 22px;
    height: 22px;
    margin: 0;
    border: none;
  }
`

/**
 * The INFER / imdUSD mark: the favicon's 16x16 pixels (infer.imdusd.com, imdusd.com, the brand kit), drawn in
 * currentColor so each badge keeps its own colours.
 */
function Mark() {
  return (
    <svg viewBox="4 3 9 10" width="18" height="20" shapeRendering="crispEdges" aria-hidden focusable="false">
      <g fill="currentColor">
        <rect x="5" y="4" width="7" height="1" />
        <rect x="8" y="4" width="1" height="8" />
        <rect x="5" y="11" width="7" height="1" />
        <rect x="4" y="4" width="1" height="1" fillOpacity=".5" />
        <rect x="12" y="4" width="1" height="1" fillOpacity=".5" />
        <rect x="4" y="11" width="1" height="1" fillOpacity=".5" />
        <rect x="12" y="11" width="1" height="1" fillOpacity=".5" />
        <rect x="5" y="7" width="3" height="2" fillOpacity=".5" />
        <rect x="9" y="7" width="3" height="2" fillOpacity=".5" />
        <rect x="4" y="7" width="1" height="2" fillOpacity=".25" />
        <rect x="12" y="7" width="1" height="2" fillOpacity=".25" />
      </g>
    </svg>
  )
}

/** The imdUSD pixel wordmark from the brand kit (wordmark-ink.svg), in currentColor. */
const IMDUSD_WORDMARK =
  'M20 0h20v20h-20zM280 0h20v20h-20zM320 0h40v20h-40zM400 0h40v20h-40zM480 0h100v20h-100zM600 0h100v20h-100zM0 40h40v20h-40zM80 40h40v20h-40zM140 40h20v20h-20zM220 40h80v20h-80zM320 40h40v20h-40zM400 40h40v20h-40zM460 40h40v20h-40zM600 40h40v20h-40zM680 40h40v20h-40zM20 60h20v20h-20zM80 60h20v20h-20zM120 60h20v20h-20zM160 60h20v20h-20zM200 60h20v20h-20zM280 60h20v20h-20zM320 60h40v20h-40zM400 60h40v20h-40zM480 60h80v20h-80zM600 60h40v20h-40zM680 60h40v20h-40zM20 80h20v20h-20zM80 80h20v20h-20zM120 80h20v20h-20zM160 80h20v20h-20zM200 80h20v20h-20zM280 80h20v20h-20zM320 80h40v20h-40zM400 80h40v20h-40zM540 80h40v20h-40zM600 80h40v20h-40zM680 80h40v20h-40zM20 100h20v20h-20zM80 100h20v20h-20zM120 100h20v20h-20zM160 100h20v20h-20zM200 100h20v20h-20zM280 100h20v20h-20zM320 100h40v20h-40zM400 100h40v20h-40zM540 100h40v20h-40zM600 100h40v20h-40zM680 100h40v20h-40zM0 120h60v20h-60zM80 120h20v20h-20zM120 120h20v20h-20zM160 120h20v20h-20zM220 120h80v20h-80zM340 120h80v20h-80zM460 120h100v20h-100zM600 120h100v20h-100zM280 20h20v20h-20zM320 20h40v20h-40zM400 20h40v20h-40zM460 20h40v20h-40zM600 20h40v20h-40zM680 20h40v20h-40z'

function Wordmark() {
  return (
    <svg viewBox="0 0 720 140" width="54" height="11" shapeRendering="crispEdges" role="img" aria-label="imdUSD">
      <path fill="currentColor" d={IMDUSD_WORDMARK} />
    </svg>
  )
}

const Wall = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
  justify-content: center;
`

const ext = { target: '_blank', rel: 'noreferrer noopener' } as const

export function BadgeWall() {
  return (
    <Wall aria-label="Badges">
      <StaticBadge style={{ background: '#000080', color: '#fff' }} title="best viewed in miyaOS">
        <Pix>
          <img src={Miya[0]?.src} alt="" />
        </Pix>
        <span>
          <small>best viewed in</small>
          <b style={{ color: '#f5c6f6' }}>miyaOS</b>
        </span>
      </StaticBadge>
      <Badge
        {...ext}
        href={LINKS.infer}
        className="shiny"
        style={{ background: '#000', color: y2k.phosphor }}
        title="INFER: trade and stake"
      >
        <Pix style={{ background: y2k.phosphor, color: '#000' }}>
          <Mark />
        </Pix>
        <span>
          <b>INFER</b>
          <small style={{ color: '#fff' }}>get it here</small>
        </span>
      </Badge>
      <Badge
        {...ext}
        href={LINKS.imdusd}
        style={{ background: 'linear-gradient(#1e8a4c, #0b4d27)', color: '#fff' }}
        title="imdUSD"
      >
        <Pix style={{ background: '#fff', color: '#0b4d27' }}>
          <Mark />
        </Pix>
        <span>
          <b style={{ marginBottom: 3 }}>
            <Wordmark />
          </b>
          <small>just a dollar</small>
        </span>
      </Badge>
      <Badge {...ext} href={LINKS.whitepaper} style={{ background: '#fff6c2', color: '#000' }} title="INFER whitepaper">
        <Pix style={{ background: '#fff', boxShadow: 'inset 1px 1px #a2479f' }}>¶</Pix>
        <span>
          <small>read the</small>
          <b>paper</b>
        </span>
      </Badge>
    </Wall>
  )
}

const Counter = styled.figure`
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${space[1]};
  text-align: center;
  figcaption {
    font-size: ${text.xs};
    line-height: 1.4;
    color: ${color.inkMuted};
    max-width: 22ch;
  }
`

const Digits = styled.div`
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: #000;
  border: 2px inset ${y2k.headTo};
  span {
    display: grid;
    place-items: center;
    width: 13px;
    height: 20px;
    font: bold 15px/1 'Courier New', ui-monospace, monospace;
    color: ${y2k.lcd};
    text-shadow: 0 0 4px ${y2k.lcd};
    background: linear-gradient(#1a1a1a 0 50%, #0a0a0a 50% 100%);
  }
`

/**
 * The page's "hit counter". Honest version: it counts MIYA still in circulation (MIYA totalSupply), which drops
 * every time someone burns MIYA for INFER. Not a visitor count, and the caption says so.
 */
export function HitCounter({ miyaSupply }: { miyaSupply?: bigint }) {
  const whole = miyaSupply !== undefined ? (miyaSupply / 10n ** 18n).toString() : undefined
  const digits = (whole ?? '').padStart(9, whole === undefined ? '-' : '0')
  return (
    <Counter>
      <Digits role="img" aria-label={whole ? `${Number(whole).toLocaleString('en-US')} MIYA left` : 'Loading'}>
        {digits.split('').map((d, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <span key={i}>{d}</span>
        ))}
      </Digits>
      <figcaption>MIYA left in the wild. Not a visitor count: it drops each time someone burns MIYA.</figcaption>
    </Counter>
  )
}
