import type { CSSProperties } from 'react'
import styled from 'styled-components/macro'

import { bevel, color, font, space, text } from '@/theme/tokens'

import { PortalBox, PushButton } from './y2k'

/**
 * The miya webring: the sites of the miyanet in a ring, miyamaker included. Prev/next step from miyamaker's place in
 * the ring; random picks any other site. Every URL here was checked to load (HTTP 200).
 */
export const RING = [
  { name: 'miyamaker', url: 'https://www.miyamaker.com/', blurb: 'This site. Make, align, trade.', here: true },
  { name: 'imdusd.com', url: 'https://imdusd.com/', blurb: 'imdUSD, the dollar of the miyanet.' },
  { name: 'infer.imdusd.com', url: 'https://infer.imdusd.com/', blurb: 'Trade and stake INFER.' },
  { name: 'box.imdusd.com', url: 'https://box.imdusd.com/', blurb: 'INFER BOX. Ask the swarm to build things.' },
  { name: 'shop.imdusd.com', url: 'https://shop.imdusd.com/', blurb: 'Merch made to order, paid in imdUSD.' },
  { name: 'whitepaper.imdusd.com', url: 'https://whitepaper.imdusd.com/', blurb: 'How INFER works, in full.' },
  { name: 'explorer.imd.fun', url: 'https://explorer.imd.fun/', blurb: 'Every job the swarm has run.' },
] as const

const here = RING.findIndex((s) => 'here' in s)
const prev = RING[(here - 1 + RING.length) % RING.length] ?? RING[5]
const next = RING[(here + 1) % RING.length] ?? RING[1]

const Nav = styled.div`
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: ${space[2]};
  a {
    color: ${color.link};
    font-family: ${font.ui};
  }
  a:last-child {
    text-align: right;
  }
`

const Ring = styled.ul`
  list-style: none;
  margin: 0;
  padding: ${space[2]};
  background: #fff;
  box-shadow: ${bevel.sunken};
  display: grid;
  gap: 2px;
  li {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    gap: ${space[2]};
    padding: 3px 0;
    font-size: ${text.sm};
    line-height: 1.4;
  }
  li::before {
    content: '';
    width: 8px;
    height: 8px;
    margin: 6px 0 0 4px;
    background: ${color.accent};
    box-shadow: 1px 1px 0 ${color.dark};
    transform: rotate(45deg);
  }
  li.here::before {
    background: ${color.dark};
  }
  a {
    color: ${color.link};
  }
  span {
    display: block;
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
`

const ext = { target: '_blank', rel: 'noreferrer noopener' } as const

export default function Webring({ id, style }: { id?: string; style?: CSSProperties }) {
  const random = () => {
    const others = RING.filter((s) => !('here' in s))
    const pick = others[Math.floor(Math.random() * others.length)] ?? next
    window.open(pick.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <PortalBox id={id} title="the miya webring" label="The miya webring" style={style}>
      <Nav>
        <a {...ext} href={prev.url}>
          « prev
        </a>
        <PushButton type="button" onClick={random}>
          random site
        </PushButton>
        <a {...ext} href={next.url}>
          next »
        </a>
      </Nav>
      <Ring>
        {RING.map((s) => (
          <li key={s.name} className={'here' in s ? 'here' : undefined}>
            <div>
              {'here' in s ? (
                <strong>{s.name} (you are here)</strong>
              ) : (
                <a {...ext} href={s.url}>
                  {s.name}
                </a>
              )}
              <span>{s.blurb}</span>
            </div>
          </li>
        ))}
      </Ring>
    </PortalBox>
  )
}
