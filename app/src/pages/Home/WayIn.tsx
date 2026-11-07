import styled from 'styled-components/macro'

import ComputerIcon from '@/assets/computer.png'
import AuctionIcon from '@/assets/icon/auction.png'
import DropMusicIcon from '@/assets/icon/drop_music.png'
import NftImage from '@/components/NftImage'
import { Chip, ProgressMeter, Skeleton } from '@/components/Retro'
import { useLaunchChain } from '@/miyamints/useMiyamints'
import { StatusChip } from '@/pages/Mint/Home'
import type { LiveMintCard } from '@/pages/Mint/liveMints'
import { formatEthShort } from '@/pages/Mint/liveMints'
import { useContractImage, useLiveMints } from '@/pages/Mint/useLiveMints'
import { bevel, color, font, space, text } from '@/theme/tokens'

import { PortalBox } from './y2k'

/**
 * miyanet as the way in (user, 2026-11-05): what is minting right now, and how to launch your own. Both open the
 * Mint and Launch windows, which stay full apps; these boxes only point at them.
 */

const Feature = styled.div`
  display: grid;
  grid-template-columns: 148px minmax(0, 1fr);
  gap: ${space[3]};
  align-items: start;
  .narrow & {
    grid-template-columns: 96px minmax(0, 1fr);
  }
  .art {
    box-shadow: ${bevel.sunken};
    padding: 2px;
    background: #fff;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: ${space[2]};
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-family: ${font.display};
    font-weight: 400;
    font-size: ${text.lg};
    color: ${color.ink};
    overflow-wrap: anywhere;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px ${space[3]};
    margin: 0;
    font-size: ${text.sm};
  }
  dt {
    color: ${color.inkMuted};
  }
  dd {
    margin: 0;
    text-align: right;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
`

const Others = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
  align-items: center;
  font-size: ${text.sm};
  color: ${color.inkMuted};
`

const Kinds = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  .kind {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: ${space[2]};
    align-items: center;
    width: 100%;
    padding: ${space[2]};
    border: none;
    border-radius: 0;
    background: #fff;
    box-shadow: ${bevel.raised};
    color: ${color.ink};
    font-family: ${font.ui};
    text-align: left;
  }
  img {
    width: 32px;
    height: 32px;
    margin: 0;
    border: none;
    image-rendering: pixelated;
  }
  b {
    display: block;
    font-size: ${text.sm};
  }
  small {
    display: block;
    font-size: ${text.xs};
    line-height: 1.4;
    color: ${color.inkMuted};
  }
`


function Cover({ card }: { card: LiveMintCard }) {
  const fromContract = useContractImage(card.image ? undefined : card.contractURI)
  return <NftImage src={card.image || fromContract.data || undefined} alt={card.name} variant="thumb" />
}

export function NowMinting({ id }: { id?: string }) {
  const { cards, isLoading } = useLiveMints()
  const live = cards.filter((c) => c.clickable)
  const featured = live.find((c) => c.status === 'open') ?? live[0]
  const more = live.filter((c) => c !== featured).slice(0, 3)

  return (
    <PortalBox
      id={id}
      title="Now minting"
      label="Now minting"
      aside={featured && <StatusChip status={featured.status} loading={isLoading} />}
    >
      {!featured ? (
        <Skeleton h="148px" />
      ) : (
        <Feature>
          <div className="art">
            <Cover card={featured} />
          </div>
          <div className="meta">
            <h3>{featured.name}</h3>
            {featured.blurb && <span style={{ fontSize: text.sm }}>{featured.blurb}</span>}
            <dl>
              <dt>Price</dt>
              <dd>{isLoading ? '…' : formatEthShort(featured.price)}</dd>
              {featured.supply !== undefined && (
                <>
                  <dt>Minted</dt>
                  <dd>
                    {(featured.minted ?? 0).toLocaleString('en-US')} / {featured.supply.toLocaleString('en-US')}
                  </dd>
                </>
              )}
            </dl>
            {featured.supply !== undefined && (
              <ProgressMeter value={featured.minted ?? 0} max={featured.supply} label={`${featured.name} minted`} />
            )}
          </div>
        </Feature>
      )}
      <Others>
        {more.length > 0 && <span>Also live:</span>}
        {more.map((c) => (
          <span key={c.key}>{c.name}</span>
        ))}
      </Others>
    </PortalBox>
  )
}

const KINDS = [
  {
    type: 'drop',
    icon: ComputerIcon,
    title: 'Fixed-price drop',
    body: 'Many pieces, one price. Like 1,000 pictures at 0.01 ETH.',
  },
  {
    type: 'auction',
    icon: AuctionIcon,
    title: 'Auction',
    body: 'One piece. People bid for a set time; the highest bid wins.',
  },
  {
    type: 'editions',
    icon: DropMusicIcon,
    title: 'Editions',
    body: 'Copies of one artwork, anyone can buy one at your price.',
  },
] as const

export function LaunchYourOwn({ id }: { id?: string }) {
  const net = useLaunchChain()
  return (
    <PortalBox
      id={id}
      title="Launch your own"
      label="Launch your own"
      aside={net.deployed ? <Chip tone="ok">Open</Chip> : <Chip tone="warn">Opens soon</Chip>}
    >
      <span style={{ fontSize: text.sm, lineHeight: 1.5 }}>
        Sell your art as NFTs. Pick how, fill in five short steps, and see exactly what collectors will see.
        {net.deployed ? '' : ' You can try every step now; publishing opens soon.'}
      </span>
      <Kinds>
        {KINDS.map((k) => (
          <div key={k.type} className="kind">
            <img src={k.icon} alt="" />
            <span>
              <b>{k.title}</b>
              <small>{k.body}</small>
            </span>
          </div>
        ))}
        <div className="kind">
          <img src={DropMusicIcon} alt="" />
          <span>
            <b>A song</b>
            <small>Releasing music? Drop Music turns a track into editions people can collect and play.</small>
          </span>
        </div>
      </Kinds>
    </PortalBox>
  )
}
