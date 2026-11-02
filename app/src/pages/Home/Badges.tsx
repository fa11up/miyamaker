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
        <Pix style={{ background: y2k.phosphor, color: '#000' }}>∞</Pix>
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
        <Pix style={{ background: '#fff', color: '#0b4d27' }}>$</Pix>
        <span>
          <b>imdUSD</b>
          <small>just a dollar</small>
        </span>
      </Badge>
      <Badge
        {...ext}
        href={LINKS.box}
        className="shiny"
        style={{ background: `linear-gradient(90deg, ${y2k.headFrom}, ${color.accentDark})`, color: '#fff' }}
        title="INFER BOX"
      >
        <Pix style={{ color: y2k.tape }}>✶</Pix>
        <span>
          <small>powered by</small>
          <b>swarm</b>
        </span>
      </Badge>
      <Badge {...ext} href={LINKS.whitepaper} style={{ background: '#c0c0c0', color: '#000' }} title="INFER whitepaper">
        <Pix style={{ background: '#fff', boxShadow: 'inset 1px 1px #808080' }}>¶</Pix>
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
  border: 2px inset #808080;
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
