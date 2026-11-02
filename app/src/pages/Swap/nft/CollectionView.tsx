import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { useAccount, useReadContract, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import NftImage from '@/components/NftImage'
import { Chip, Eyebrow, Skeleton, StatusBox } from '@/components/Retro'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, explorerUrl, mainnet } from '@/config/wagmi'
import { cleanText } from '@/desktop/files/sanitize'
import { txWords, useTx } from '@/miyamints/useTx'
import { bevel, color, space, text } from '@/theme/tokens'

import { erc721Abi, poolFactoryAbi } from './abi'
import type { OsOrder, Price } from './markets'
import { bestQuote, collectionUrl, formatPrice, venuesFor } from './markets'
import type { PoolMode } from './pool'
import { KIND, MODE, MODE_HINT, MODE_LABEL } from './pool'
import { Card, Chips, Field, Head, Hint, LinkButton, Mono, Prose, PushButton } from './ui'
import { useOpenSeaCollection, useOpenSeaListings, useOpenSeaNftImage } from './useMarkets'
import { poolFactoryFor, useNftMeta, usePoolsForCollection } from './usePools'
import { Best, OutLink, VenueList, VenueRow } from './venueUi'

const Hero = styled.div`
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: ${space[3]};
  align-items: center;
  .pic {
    width: 64px;
    box-shadow: ${bevel.sunken};
    padding: 2px;
    background: ${color.well};
  }
  .letter {
    display: grid;
    place-items: center;
    aspect-ratio: 1 / 1;
    background: ${color.light};
    font-size: ${text.xl};
    font-weight: 700;
    text-transform: uppercase;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: ${space[1]};
    min-width: 0;
  }
`

const Tiles = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: ${space[2]};
  .narrow & {
    grid-template-columns: repeat(3, 1fr);
  }
`

const TileButton = styled.button`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 3px;
  border: none;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  color: ${color.ink};
  text-align: left;
  cursor: pointer;
  &:active {
    box-shadow: ${bevel.pressed};
  }
  .label {
    display: flex;
    flex-direction: column;
    padding: 0 2px;
    font-size: ${text.xs};
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
  }
  .label b {
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const LookupRow = styled.form`
  display: flex;
  gap: ${space[2]};
`

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

function ListingTile({
  chainId,
  contract,
  listing,
  onOpen,
}: {
  chainId: SupportedChainId
  contract: Address
  listing: OsOrder
  onOpen: () => void
}) {
  const id = listing.tokenId!
  const osImage = useOpenSeaNftImage(chainId, contract, id)
  const meta = useNftMeta(chainId, osImage ? undefined : contract, KIND.ERC721, BigInt(id))
  return (
    <li>
      <TileButton type="button" onClick={onOpen} aria-label={`#${id}, ${formatPrice(listing.price)} on OpenSea. Open`}>
        <NftImage src={osImage || meta.image} alt="" variant="thumb" />
        <span className="label">
          <span>#{id}</span>
          <b>{formatPrice(listing.price)}</b>
        </span>
      </TileButton>
    </li>
  )
}

/**
 * One collection in Trade → NFTs: the best price, every venue it trades on (MiyaPool first, then OpenSea, Blur,
 * Magic Eden) with what each one's API can tell us, and the cheapest OpenSea listings. Venue links always work;
 * prices need the OpenSea key on the server (a quiet note says so).
 */
export default function CollectionView({
  chainId,
  address,
  onBack,
  onOpenItem,
  onOpenPool,
}: {
  chainId: SupportedChainId
  address: Address
  onBack: () => void
  onOpenItem: (tokenId: string) => void
  onOpenPool: (pool: Address) => void
}) {
  const chain = chains.find((c) => c.id === chainId) || mainnet
  const { isConnected, chainId: walletChain } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const { openConnectModal } = useConnectModal()
  const wrongChain = isConnected && walletChain !== chainId

  const os = useOpenSeaCollection(chainId, address)
  const listings = useOpenSeaListings(os.slug, 6)
  const factory = poolFactoryFor(chainId)
  const pools = usePoolsForCollection(chainId, factory, address)
  const onchainName = useReadContract({
    address,
    abi: erc721Abi,
    functionName: 'name',
    chainId,
    query: { staleTime: Infinity },
  })
  const [lookup, setLookup] = useState('')
  const create = useTx(() => pools.refetch())

  const knownName = os.info?.name || cleanText(onchainName.data as string | undefined, 80)
  const named = !!knownName
  const name = knownName || 'Unnamed collection'
  const venues = venuesFor(chainId)

  const floor: Price | undefined = os.stats?.floor || listings.listings?.[0]?.price
  const cheapest = bestQuote([{ venue: 'OpenSea', price: floor }])
  const topOffer = bestQuote([{ venue: 'OpenSea', price: os.bestOffer?.price }], 'highest')
  const poolsWithNfts = pools.pools.filter((p) => p.held > 0n)

  const createPool = (mode: PoolMode) =>
    factory &&
    create.run(`create-${mode}`, {
      address: factory,
      abi: poolFactoryAbi,
      functionName: 'createPool',
      args: [address, mode],
      chainId,
    })

  return (
    <>
      <LinkButton type="button" onClick={onBack}>
        ← All collections
      </LinkButton>

      <Card aria-label={`${name} collection`} data-collection-view>
        <Hero>
          <div className="pic" aria-hidden>
            {os.info?.image ? (
              <NftImage src={os.info.image} alt="" variant="thumb" />
            ) : (
              <span className="letter">{named ? name.slice(0, 1) : '?'}</span>
            )}
          </div>
          <div className="meta">
            <Head>
              <h2>{name}</h2>
            </Head>
            <Chips>
              <Chip>{chain.name}</Chip>
              {os.info?.verified && <Chip tone="ok">Verified on OpenSea</Chip>}
            </Chips>
            <Hint>
              <Mono>{shortAddress(address)}</Mono> ·{' '}
              <a href={`${explorerUrl(chainId)}/address/${address}`} target="_blank" rel="noreferrer">
                Explorer ↗
              </a>
            </Hint>
          </div>
        </Hero>

        {(cheapest || topOffer || poolsWithNfts.length > 0) && (
          <Best aria-label="Best prices">
            {cheapest && (
              <div className="line">
                <span>Cheapest</span>
                <strong>
                  {formatPrice(cheapest.price)} <span className="where">on {cheapest.venue}</span>
                </strong>
              </div>
            )}
            {topOffer && (
              <div className="line">
                <span>Best offer</span>
                <strong>
                  {formatPrice(topOffer.price)} <span className="where">on {topOffer.venue}</span>
                </strong>
              </div>
            )}
            {poolsWithNfts.length > 0 && (
              <div className="line">
                <span>In MiyaPool</span>
                <strong>
                  1 {poolsWithNfts[0]!.symbol} <span className="where">each, 0% fees</span>
                </strong>
              </div>
            )}
          </Best>
        )}
      </Card>

      <Card aria-label="Markets">
        <Eyebrow>Where it trades</Eyebrow>
        <VenueList>
          {venues.map((v) => {
            if (v.id === 'miyapool') {
              if (!factory)
                return (
                  <VenueRow key={v.id} venue={v} note={`MiyaPool is not live on ${chain.name} yet.`} />
                )
              if (pools.loading) return <VenueRow key={v.id} venue={v} note="Looking for a pool…" />
              return (
                <VenueRow
                  key={v.id}
                  venue={v}
                  note={
                    pools.pools.length
                      ? 'Swap an NFT for 1 pool token, or 1 pool token for an NFT.'
                      : 'No pool for this collection yet. Anyone can start one.'
                  }
                  facts={pools.pools.map((p) => ({
                    label: MODE_LABEL[p.mode],
                    value: `${p.held.toString()} NFT${p.held === 1n ? '' : 's'} · 1 ${p.symbol} each`,
                  }))}
                >
                  {pools.pools.map((p) => (
                    <PushButton key={p.address} type="button" onClick={() => onOpenPool(p.address)}>
                      Open {MODE_LABEL[p.mode]} pool
                    </PushButton>
                  ))}
                  {pools.freeModes.map((m) =>
                    !isConnected ? null : (
                      <PushButton
                        key={m}
                        type="button"
                        title={MODE_HINT[m]}
                        disabled={create.busy || wrongChain}
                        onClick={() => createPool(m)}
                      >
                        Start a {MODE_LABEL[m]} pool
                      </PushButton>
                    )
                  )}
                  {pools.freeModes.length > 0 && !isConnected && (
                    <PushButton type="button" onClick={() => openConnectModal?.()}>
                      Connect to start a pool
                    </PushButton>
                  )}
                  {pools.freeModes.length > 0 && wrongChain && (
                    <PushButton type="button" onClick={() => switchChain({ chainId })} disabled={switching}>
                      Switch to {chain.name}
                    </PushButton>
                  )}
                </VenueRow>
              )
            }

            const href = collectionUrl(v.id, chainId, address, os.slug)
            if (v.id === 'opensea') {
              const facts: { label: string; value: string }[] = []
              if (os.stats?.floor) facts.push({ label: 'Floor', value: formatPrice(os.stats.floor) })
              if (os.bestOffer) facts.push({ label: 'Best offer', value: formatPrice(os.bestOffer.price) })
              if (os.stats?.sales7d !== undefined) facts.push({ label: 'Sold this week', value: String(os.stats.sales7d) })
              return (
                <VenueRow
                  key={v.id}
                  venue={v}
                  facts={facts}
                  note={
                    os.loading && !os.needsKey
                      ? 'Getting prices…'
                      : os.missing
                      ? 'OpenSea does not list this contract (yet).'
                      : os.needsKey
                      ? 'Listings and offers need an API key. The link works.'
                      : listings.listings?.length
                      ? 'Buy listed NFTs right here, below.'
                      : undefined
                  }
                >
                  {href && (
                    <OutLink href={href} target="_blank" rel="noreferrer">
                      Open on OpenSea ↗
                    </OutLink>
                  )}
                </VenueRow>
              )
            }

            return (
              <VenueRow key={v.id} venue={v} note={`${v.name} has no public price feed. See prices there.`}>
                {href && (
                  <OutLink href={href} target="_blank" rel="noreferrer">
                    Open on {v.name} ↗
                  </OutLink>
                )}
              </VenueRow>
            )
          })}
        </VenueList>
        {!os.supported && (
          <Hint>OpenSea, Blur and Magic Eden do not trade on {chain.name}. Only MiyaPool does.</Hint>
        )}
        {os.error && <Hint>Could not get OpenSea prices right now. The links still work.</Hint>}
        {create.tx.phase !== 'idle' && (
          <StatusBox tone={create.tx.phase === 'error' ? 'error' : create.tx.phase === 'done' ? 'ok' : 'info'}>
            {create.busy && <img src={LoadingHourglass} alt="" />}
            <span>{create.tx.phase === 'done' ? 'Pool started. Open it above.' : txWords(create.tx)}</span>
          </StatusBox>
        )}
        {pools.freeModes.includes(MODE.RANDOM) && pools.freeModes.length > 0 && isConnected && (
          <Hint>Random pools work only for ERC-721.</Hint>
        )}
      </Card>

      {os.slug && (listings.loading || (listings.listings && listings.listings.length > 0)) && (
        <Card aria-label="Cheapest on OpenSea">
          <Eyebrow>Cheapest on OpenSea</Eyebrow>
          <Hint>Tap one to see it everywhere and buy it here.</Hint>
          {listings.loading ? (
            <Tiles>
              {[0, 1, 2].map((i) => (
                <li key={i}>
                  <Skeleton h="140px" />
                </li>
              ))}
            </Tiles>
          ) : (
            <Tiles>
              {listings.listings!
                .filter((l) => l.tokenId)
                .map((l) => (
                  <ListingTile
                    key={l.hash}
                    chainId={chainId}
                    contract={address}
                    listing={l}
                    onOpen={() => onOpenItem(l.tokenId!)}
                  />
                ))}
            </Tiles>
          )}
        </Card>
      )}

      <Card aria-label="Find one NFT">
        <Eyebrow>Find one NFT</Eyebrow>
        <LookupRow
          onSubmit={(e) => {
            e.preventDefault()
            const id = lookup.trim().replace(/^#/, '')
            if (/^[0-9]{1,78}$/.test(id)) onOpenItem(id)
          }}
        >
          <Field
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            placeholder="Token number, e.g. 42"
            aria-label="Token number"
            inputMode="numeric"
          />
          <PushButton type="submit" disabled={!/^#?[0-9]{1,78}$/.test(lookup.trim())}>
            Open
          </PushButton>
        </LookupRow>
        <Prose style={{ fontSize: text.xs, color: color.inkMuted }}>
          See where one NFT is listed, its best offer, and buy or sell it.
        </Prose>
      </Card>
      <div style={{ height: space[3] }} />
    </>
  )
}
