import styled, { keyframes } from 'styled-components/macro'
import { formatUnits } from 'viem'

import { color, font, space, text } from '@/theme/tokens'

import { swarmSize, useSwarm } from './SwarmSearch'
import { useRedemptionState } from './useMiyanet'
import { reducedMotion, y2k } from './y2k'

const scroll = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
`

const Bar = styled.div`
  position: relative;
  overflow: hidden;
  background: #000;
  border-top: 1px solid #3a2a7a;
  border-bottom: 1px solid #3a2a7a;
  font-family: ${font.mono};
  font-size: ${text.sm};
  color: ${y2k.phosphor};
  &:hover .track {
    animation-play-state: paused;
  }
`

const Track = styled.div`
  display: flex;
  width: max-content;
  animation: ${scroll} 40s linear infinite;
  ul {
    display: flex;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    padding: 6px ${space[4]};
    white-space: nowrap;
  }
  li::before {
    content: '★ ';
    color: ${color.accent};
  }
  b {
    color: #fff;
    font-weight: 700;
  }
  ${reducedMotion} {
    animation: none;
    width: auto;
    ul {
      flex-wrap: wrap;
    }
    ul[aria-hidden] {
      display: none;
    }
  }
`

const fmt = (v: bigint | undefined, digits: number) =>
  v === undefined ? '…' : Number(formatUnits(v, 18)).toLocaleString('en-US', { maximumFractionDigits: digits })

/** Live stats crawling along like a 1999 news ticker. Pauses on hover; stands still under reduced motion. */
export default function Ticker() {
  const swarm = useSwarm()
  const state = useRedemptionState()
  const h = swarm.data?.health
  const closes = state.closesAt
    ? new Date(state.closesAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : '…'

  const items = [
    <>
      <b>{swarmSize(h) ?? '…'}</b>
    </>,
    <>
      1 MIYA = <b>{fmt(state.rate, 4)}</b> INFER
    </>,
    <>
      <b>{fmt(state.inferLeft, 0)}</b> INFER left for MIYA
    </>,
    <>
      claim closes <b>{closes}</b>
    </>,
    <>
      <b>{h ? h.jobsDoneLastDay.toLocaleString('en-US') : '…'}</b> swarm jobs in the last day
    </>,
    <>imdUSD is a dollar, not an investment</>,
  ]

  const list = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined}>
      {items.map((item, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <li key={i}>{item}</li>
      ))}
    </ul>
  )

  return (
    <Bar aria-label="Live miyanet stats">
      <Track className="track">
        {list(false)}
        {list(true)}
      </Track>
    </Bar>
  )
}
