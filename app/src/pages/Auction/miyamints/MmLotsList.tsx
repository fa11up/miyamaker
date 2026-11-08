import ChevronLeftIcon from 'assets/chevron-left-icon.svg'
import ChevronRightIcon from 'assets/chevron-right-icon.svg'
import { useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import { formatEther } from 'viem'

import { NormalButton } from '@/components/Button/NormalButton'
import NftImage from '@/components/NftImage'
import { Chip } from '@/components/Retro'
import ImageWrapper from '@/pages/Auction/ImageWrapper'
import { useToken } from '@/pages/Auction/useToken'

import { hasBids, mmPhase, phaseTag, sortLots } from './rules'
import type { MmLotRef } from './useMmAuctions'

/* One row of lots that fits the panel, paged with arrows (no scroll box). Phones: two columns at natural height. */
const Panel = styled.div`
  width: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`

const Row = styled.div<{ $columns: number }>`
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(${({ $columns }) => $columns}, minmax(0, 1fr));
  gap: 0.75rem;
  align-items: start;

  @media only screen and (max-width: 640px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`

const Card = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.25rem;
`

const Art = styled.div`
  width: 100%;

  @media only screen and (min-width: 641px) {
    max-width: 92px;
    margin: 0 auto;
  }
`

const Line = styled.div`
  max-width: 100%;
  font-size: 0.75rem;
  line-height: 1.2;
  text-align: center;
  overflow-wrap: anywhere;
`

const Name = styled(Line)`
  min-height: 2.4em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-weight: bolder;
`

const Pager = styled.div`
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
`

const Icon = styled.img`
  display: block;
  width: 1rem;
  height: 1rem;
`

const Message = styled.div`
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-height: 4rem;
  font-weight: bolder;
  text-align: center;
`

const Footnote = styled.p`
  margin: 0.4rem 0 0;
  font-size: 0.7rem;
  color: #5f4030;
  text-align: center;
`

const LOTS_PER_PAGE = 5

/** Time left on a card ("1h 54m"): to the minute, so the tag fits. The lot's own page counts the seconds. */
function shortLeft(ms: number) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes % 60}m`
  return minutes ? `${minutes}m` : 'ending'
}

function LotCard({ item, now, onOpen }: { item: MmLotRef; now: number; onOpen: (item: MmLotRef) => void }) {
  const { name, image } = useToken({ tokenURI: item.lot.tokenURI, isFetch: true })
  const phase = mmPhase(item.lot, now)
  const title = name || `${item.house.name} #${item.lot.tokenId}`
  const money = hasBids(item.lot)
    ? `${phase === 'live' ? 'Bid' : 'Top bid'} ${formatEther(item.lot.highBid)} ETH`
    : `From ${formatEther(item.lot.minBid)} ETH`
  return (
    <Card>
      <ImageWrapper style={{ padding: '0.5rem' }}>
        <Art>
          <NftImage src={image || undefined} alt={title} fit="contain" aspect="1 / 1" />
        </Art>
        <Name title={title}>{title}</Name>
        <Line title={item.house.name}>{item.house.name}</Line>
        <Line>{money}</Line>
        <Chip tone={phase === 'live' ? 'ok' : 'off'}>{phaseTag(item.lot, phase, now, shortLeft)}</Chip>
      </ImageWrapper>
      <NormalButton type="button" style={{ width: '100%' }} onClick={() => onOpen(item)}>
        {phase === 'live' ? 'Bid' : 'View'}
      </NormalButton>
    </Card>
  )
}

/**
 * The miyamints auction lots (artists' 1/1s from Launch), live first. Shows nothing at all where the contracts aren't
 * deployed: the caller doesn't render it.
 */
export default function MmLotsList({
  lots,
  loading,
  error,
  failed,
  onRetry,
  onOpen,
}: {
  lots: MmLotRef[]
  loading: boolean
  error: boolean
  failed: string[]
  onRetry: () => void
  onOpen: (item: MmLotRef) => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])
  const [page, setPage] = useState(0)

  if (loading) return <Message role="status">Loading artist auctions…</Message>
  if (error) {
    return (
      <Message role="alert">
        Couldn&apos;t load artist auctions.
        <NormalButton type="button" onClick={onRetry}>
          Try again
        </NormalButton>
      </Message>
    )
  }
  if (!lots.length) return <Message>No artist auctions yet.</Message>

  const sorted = sortLots(lots.map((item) => ({ ...item, phase: mmPhase(item.lot, now) })))
  const pages = Math.ceil(sorted.length / LOTS_PER_PAGE)
  const at = Math.min(page, pages - 1)
  const shown = sorted.slice(at * LOTS_PER_PAGE, (at + 1) * LOTS_PER_PAGE)
  const truncated = lots.some((item) => item.house.truncated)

  return (
    <div style={{ width: '100%' }}>
      <Panel>
        {pages > 1 && (
          <Pager>
            <NormalButton type="button" aria-label="Previous lots" disabled={at === 0} onClick={() => setPage(at - 1)}>
              <Icon src={ChevronLeftIcon} alt="" />
            </NormalButton>
          </Pager>
        )}
        <Row $columns={LOTS_PER_PAGE}>
          {shown.map((item) => (
            <LotCard key={item.key} item={item} now={now} onOpen={onOpen} />
          ))}
        </Row>
        {pages > 1 && (
          <Pager>
            <NormalButton
              type="button"
              aria-label="Next lots"
              disabled={at >= pages - 1}
              onClick={() => setPage(at + 1)}
            >
              <Icon src={ChevronRightIcon} alt="" />
            </NormalButton>
            <span>
              {at + 1} / {pages}
            </span>
          </Pager>
        )}
      </Panel>
      {failed.length > 0 && <Footnote role="status">Couldn&apos;t reach {failed.join(', ')} just now.</Footnote>}
      {truncated && <Footnote>Showing the newest 40 pieces of each auction house.</Footnote>}
    </div>
  )
}
