import { useNavigate } from 'react-router-dom'
import styled from 'styled-components/macro'
import { useReadContracts } from 'wagmi'

import { dropAbi } from '@/pages/Mint/dropAbi'
import type { LiveMintStatus } from '@/pages/Mint/liveMints'
import { cardPrice, mintPath } from '@/pages/Mint/liveMints'
import { useLiveMints } from '@/pages/Mint/useLiveMints'

import { FEATURED_COLLECTIONS } from '../board'
import { color, space, text } from '../floor/tokens'
import { useCollectionFloor } from '../MarketBoard'

/**
 * The house collection on top of the NFT screen: Miyamaker's art, its floor and how much is minted, with the way to
 * view it and the way to mint one.
 */

const HOUSE = FEATURED_COLLECTIONS.find((c) => c.slug === 'miyamaker')!
const COVER = '/covers/miyamaker.webp'
const STATUS_WORDS: Record<LiveMintStatus, string> = {
  open: 'OPEN',
  closed: 'CLOSED',
  soldout: 'SOLD OUT',
  soon: 'SOON',
  unknown: 'n/a',
}

const Banner = styled.section`
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  gap: ${space[4]};
  padding: ${space[3]};
  border: 1px solid ${color.accent};
  background: linear-gradient(90deg, #1a1200, #000 70%);
  .narrow & {
    grid-template-columns: 96px minmax(0, 1fr);
    gap: ${space[3]};
  }
  .art {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border: 1px solid ${color.dark};
    cursor: pointer;
  }
  .tag {
    display: inline-block;
    padding: 1px 6px;
    background: ${color.accent};
    color: #000;
    font-size: ${text.xs};
    font-weight: 700;
    letter-spacing: 0.12em;
  }
  h2 {
    margin: ${space[1]} 0 ${space[2]};
    color: #fff;
    font-size: ${text.xl};
    letter-spacing: 0.04em;
  }
  dl {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, max-content));
    gap: ${space[1]} ${space[5]};
    margin: 0 0 ${space[3]};
    .narrow & {
      grid-template-columns: repeat(2, minmax(0, max-content));
      gap: ${space[1]} ${space[3]};
    }
  }
  dt {
    color: ${color.accent};
    font-size: ${text.xs};
    letter-spacing: 0.1em;
  }
  dd {
    margin: 0;
    color: #fff;
    font-size: ${text.lg};
    font-variant-numeric: tabular-nums;
  }
  .meter {
    height: 4px;
    margin: 4px 0 0;
    background: #1a1f25;
  }
  .meter > span {
    display: block;
    height: 100%;
    background: ${color.accent};
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: ${space[2]};
  }
  .acts button {
    min-height: 34px;
    padding: 0 ${space[3]};
    border: 1px solid ${color.accent};
    background: #000;
    color: ${color.accent};
    font: inherit;
    font-weight: 700;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .acts button.primary {
    background: ${color.accent};
    color: #000;
  }
`

export default function House({ onOpen }: { onOpen: (address: string) => void }) {
  const navigate = useNavigate()
  const floor = useCollectionFloor(HOUSE.slug)
  // The mint's price as the Mint app reads it from the drop's live phase.
  const reads = useReadContracts({
    contracts: [
      { address: HOUSE.address, abi: dropAbi, functionName: 'totalSupply', chainId: HOUSE.chainId },
      { address: HOUSE.address, abi: dropAbi, functionName: 'maxSupply', chainId: HOUSE.chainId },
    ],
    query: { refetchInterval: 60_000 },
  })
  const minted = reads.data?.[0]?.result as bigint | undefined
  const max = reads.data?.[1]?.result as number | undefined
  // A read that failed says so, instead of looking like one still loading.
  const readFailed = reads.isError || reads.data?.[0]?.status === 'failure'
  const lives = useLiveMints()
  const card = lives.cards.find((c) => c.slug === HOUSE.slug)
  const share = minted !== undefined && max ? Math.min(1, Number(minted) / max) : undefined

  return (
    <Banner aria-label="Miyamaker, the house collection" data-house>
      <img className="art" src={COVER} alt="Miyamaker" onClick={() => onOpen(HOUSE.address)} />
      <div>
        <span className="tag">★ HOUSE COLLECTION</span>
        <h2>MIYAMAKER</h2>
        <dl>
          <div>
            <dt>FLOOR</dt>
            <dd>{floor.floorWords}</dd>
          </div>
          <div>
            <dt>MINTED</dt>
            <dd>
              {minted !== undefined ? minted.toLocaleString() : readFailed ? 'n/a' : '…'}
              {max ? ` / ${max.toLocaleString()}` : ''}
            </dd>
            {share !== undefined && (
              <div className="meter" aria-hidden>
                <span style={{ width: `${Math.max(1, share * 100)}%` }} />
              </div>
            )}
          </div>
          <div>
            <dt>MINT</dt>
            <dd>
              {card
                ? card.status === 'open'
                  ? cardPrice(card)
                  : card.status === 'unknown' && lives.isLoading
                  ? '…'
                  : STATUS_WORDS[card.status]
                : lives.isLoading
                ? '…'
                : 'n/a'}
            </dd>
          </div>
        </dl>
        <div className="acts">
          <button className="primary" type="button" onClick={() => onOpen(HOUSE.address)}>
            VIEW · BUY
          </button>
          <button type="button" onClick={() => navigate(mintPath(HOUSE.slug))}>
            MINT ↗
          </button>
        </div>
      </div>
    </Banner>
  )
}
