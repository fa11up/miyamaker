import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { useAccount, useReadContract, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import NftImage from '@/components/NftImage'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, explorerUrl, mainnet } from '@/config/wagmi'
import { cleanText } from '@/desktop/files/sanitize'
import { txWords, useTx } from '@/miyamints/useTx'

import { ethInUsd } from '../board'
import { Chip, Eyebrow, Skeleton, StatusBox } from '../floor/retro'
import { bevel, color, space, text } from '../floor/tokens'
import { useEthUsd } from '../MarketBoard'
import { erc721Abi, poolFactoryAbi } from './abi'
import type { OsOrder, Price } from './markets'
import { bestQuote, formatAmount, formatPrice, lowerPrice, venuesFor } from './markets'
import { DEFAULT_PAIR_SYMBOL, pickPair } from './pairs'
import type { PoolMode } from './pool'
import { KIND, MODE, MODE_HINT, MODE_LABEL } from './pool'
import { MAX_SWEEP, pickCheapest, sumPrices, sweepable } from './sweep'
import SweepReview from './SweepReview'
import { Card, Chips, Field, Head, Hint, LinkButton, Mono, Prose, PushButton } from './ui'
import { useMarketListings, useMarketSales, useOpenSeaCollection, useOpenSeaNftImage } from './useMarkets'
import type { PoolPrice } from './usePoolPrices'
import { pairsFor, poolSide, usePoolPrices } from './usePoolPrices'
import type { Pool } from './usePools'
import { poolFactoryFor, useNftMeta, usePoolsForCollection } from './usePools'
import { Best, OutLink, PairSwitch, VenueList, VenueRow } from './venueUi'

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

const Stats = styled.dl`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 1px;
  margin: 0;
  background: ${color.dark};
  border: 1px solid ${color.dark};
  div {
    padding: ${space[2]};
    background: ${color.well};
  }
  dt {
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
  dd {
    margin: 0;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  small {
    display: block;
    font-size: ${text.xs};
    font-weight: 400;
    color: ${color.inkMuted};
  }
`

const Tiles = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
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
  &:hover {
    background: ${color.hover};
  }
  &[data-picked] {
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
  .buy {
    color: ${color.accent};
    font-weight: 700;
  }
  .label b {
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const TILE_PAGE = 24

const SweepBar = styled.div`
  display: grid;
  grid-template-columns: auto minmax(80px, 1fr) auto auto;
  align-items: center;
  gap: ${space[3]};
  padding: ${space[2]} ${space[3]};
  background: ${color.well};
  border: 1px solid ${color.accent};
  font-size: ${text.sm};
  b {
    color: ${color.accent};
  }
  label {
    white-space: nowrap;
  }
  input {
    width: 100%;
    accent-color: ${color.accent};
  }
  strong {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .narrow & {
    grid-template-columns: 1fr auto;
    input {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
`

const Sales = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: ${text.sm};
  font-variant-numeric: tabular-nums;
  li {
    display: flex;
    justify-content: space-between;
    gap: ${space[3]};
    padding: ${space[1]} 0;
    border-bottom: 1px solid ${color.light};
  }
  li:last-child {
    border-bottom: none;
  }
  a {
    white-space: nowrap;
  }
`

const timeAgo = (seconds: number) => {
  const mins = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60))
  if (mins < 60) return `${mins}m ago`
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / 1440)}d ago`
}

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
  picked,
}: {
  chainId: SupportedChainId
  contract: Address
  listing: OsOrder
  onOpen: () => void
  /** In the sweep the bar would buy. */
  picked?: boolean
}) {
  const id = listing.tokenId!
  const osImage = useOpenSeaNftImage(chainId, contract, id)
  const meta = useNftMeta(chainId, osImage ? undefined : contract, KIND.ERC721, BigInt(id))
  return (
    <li>
      <TileButton
        type="button"
        onClick={onOpen}
        data-picked={picked || undefined}
        aria-label={`#${id}, ${formatPrice(listing.price)} on OpenSea${picked ? ', in the sweep' : ''}. Open`}
      >
        <NftImage src={osImage || meta.image} alt="" variant="thumb" />
        <span className="label">
          <span>#{id}</span>
          <b>{formatPrice(listing.price)}</b>
          <span className="buy">Buy →</span>
        </span>
      </TileButton>
    </li>
  )
}

/** One MiyaPool line in the best-price box: one pool token (= one NFT) priced in the chosen pair. */
function PoolPriceLine({
  pool,
  price,
  symbol,
  swap,
}: {
  pool: Pool
  price: PoolPrice | undefined
  symbol?: string
  swap: boolean
}) {
  const label = `In MiyaPool · ${MODE_LABEL[pool.mode]}`
  const each = (
    <>
      1 {pool.symbol} <span className="where">each, 0% fees</span>
    </>
  )
  const body = (() => {
    // No swap on this chain (Sepolia): a pool token is the only price there is.
    if (!swap || !price) return each
    if (price.state === 'loading') return <span className="where">Pricing in {symbol}…</span>
    if (price.state === 'unconfigured')
      return (
        <>
          1 {pool.symbol} <span className="where">each; no {symbol} price (swap service off)</span>
        </>
      )
    if (price.state === 'error')
      return (
        <>
          1 {pool.symbol} <span className="where">each; no {symbol} price right now</span>
        </>
      )
    if (price.status === 'no-route')
      return (
        <span className="where">
          No {symbol} market for {pool.symbol} yet
        </span>
      )
    const ask = poolSide(price, 'ask')
    const bid = poolSide(price, 'bid')
    return (
      <>
        {ask && pool.held > 0n ? (
          <>
            ≈ {formatPrice(ask)} <span className="where">to buy one</span>
            {bid && <span className="where sub">sell one in ≈ {formatPrice(bid)}</span>}
          </>
        ) : (
          bid && (
            <>
              ≈ {formatPrice(bid)} <span className="where">to sell one in</span>
            </>
          )
        )}
      </>
    )
  })()
  return (
    <div className="line pool" data-pool-price={pool.address}>
      <span>{label}</span>
      <strong aria-live="polite">{body}</strong>
    </div>
  )
}

/**
 * One collection in Trade → NFTs: the best price, every venue it trades on (MiyaPool first, then OpenSea and Blur) with what each one's API can tell us, and the cheapest OpenSea listings. Venue links always work;
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
  const { address: me, isConnected, chainId: walletChain } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const { openConnectModal } = useConnectModal()
  const wrongChain = isConnected && walletChain !== chainId

  const os = useOpenSeaCollection(chainId, address)
  const listings = useMarketListings(os.slug)
  const sales = useMarketSales(os.slug)
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
  const ethUsd = useEthUsd()
  const [sweeping, setSweeping] = useState(false)
  const [sweepCount, setSweepCount] = useState(3)
  // Each tile looks up its own image, so the grid grows on request rather than asking for every listing at once.
  const [tileLimit, setTileLimit] = useState(TILE_PAGE)
  const listed = (listings.listings ?? []).filter((l) => l.tokenId)
  const shownListings = listed.slice(0, tileLimit)
  const canSweep = sweepable(listings.listings ?? [], me)
  const pickedListings = pickCheapest(canSweep, Math.min(sweepCount, canSweep.length))
  const create = useTx(() => pools.refetch())

  const knownName = os.info?.name || cleanText(onchainName.data as string | undefined, 80)
  const named = !!knownName
  const name = knownName || 'Unnamed collection'
  const venues = venuesFor(chainId)

  // MiyaPool prices: one pool token (= one NFT) through 0x, in ETH for the comparison and in the chosen pair to show.
  const pairs = pairsFor(chainId)
  const swap = pairs.length > 0
  const [pairSymbol, setPairSymbol] = useState<string>(DEFAULT_PAIR_SYMBOL)
  const ethPair = pickPair(pairs, 'ETH')
  const shownPair = pickPair(pairs, pairSymbol)
  const poolAddresses = pools.pools.map((p) => p.address)
  const ethPrices = usePoolPrices(chainId, poolAddresses, ethPair)
  const shownPrices = usePoolPrices(chainId, poolAddresses, shownPair)
  const poolsWithNfts = pools.pools.filter((p) => p.held > 0n)
  const poolVenue = (p: Pool) => `MiyaPool (${MODE_LABEL[p.mode]})`
  // `where` reads after the price: an OpenSea listing or offer is "on OpenSea"; a pool's bid is a sale into it.

  // OpenSea's stat can be lower than anything its listings call returns: show the lowest known, and what can be bought.
  const floor: Price | undefined = lowerPrice(os.stats?.floor, listings.floor)
  const buyHere = listings.floor && floor && listings.floor.amount !== floor.amount ? listings.floor : undefined
  const cheapest = bestQuote([
    { where: 'on OpenSea', price: floor },
    ...poolsWithNfts.map((p) => ({
      where: `on ${poolVenue(p)}`,
      price: poolSide(ethPrices[p.address.toLowerCase()], 'ask'),
    })),
  ])
  const topOffer = bestQuote(
    [
      { where: 'on OpenSea', price: os.bestOffer?.price },
      ...pools.pools.map((p) => ({
        where: `sell into ${poolVenue(p)}`,
        price: poolSide(ethPrices[p.address.toLowerCase()], 'bid'),
      })),
    ],
    'highest',
  )
  const poolLines = swap ? pools.pools : poolsWithNfts
  // The one Buy button goes wherever is cheapest right now.
  const cheapestPool = poolsWithNfts.find((p) => `on ${poolVenue(p)}` === cheapest?.where)
  const cheapestListing = canSweep[0] ?? listed[0]
  const offerPool = pools.pools.find((p) => `sell into ${poolVenue(p)}` === topOffer?.where)

  const createPool = (mode: PoolMode) =>
    factory &&
    create.run(`create-${mode}`, {
      address: factory,
      abi: poolFactoryAbi,
      functionName: 'createPool',
      args: [address, mode],
      chainId,
    })

  const startButtons = (
    <>
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
        ),
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
    </>
  )
  const createStatus = create.tx.phase !== 'idle' && (
    <StatusBox tone={create.tx.phase === 'error' ? 'error' : create.tx.phase === 'done' ? 'ok' : 'info'}>
      {create.busy && <img src={LoadingHourglass} alt="" />}
      <span>{create.tx.phase === 'done' ? 'Pool started. Open it above.' : txWords(create.tx)}</span>
    </StatusBox>
  )
  const noPoolYet = !!factory && !pools.loading && pools.pools.length === 0

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

        {os.stats && (
          <Stats aria-label="Collection figures">
            <div>
              <dt title="The cheapest one for sale right now">Floor</dt>
              <dd>
                {floor ? formatPrice(floor) : 'None for sale'}
                {floor?.symbol === 'ETH' && <small>{ethInUsd(floor.amount, ethUsd)}</small>}
                {buyHere && <small>Cheapest to buy here: {formatPrice(buyHere)}</small>}
              </dd>
            </div>
            <div>
              <dt>Best offer</dt>
              <dd>{os.bestOffer ? formatPrice(os.bestOffer.price) : '–'}</dd>
            </div>
            <div>
              <dt>Sales 7d</dt>
              <dd>{os.stats.sales7d ?? '–'}</dd>
            </div>
            <div>
              <dt>Volume 7d</dt>
              <dd>{os.stats.volume7d !== undefined ? `${os.stats.volume7d.toFixed(1)} ETH` : '–'}</dd>
            </div>
            <div>
              <dt>Owners</dt>
              <dd>{os.stats.owners?.toLocaleString('en-US') ?? '–'}</dd>
            </div>
          </Stats>
        )}

        {/* The figures above already give OpenSea's prices; this is for comparing them against our pools. */}
        {(poolLines.length > 0 || cheapest) && (
          <Best aria-label="Best prices">
            {cheapest && (
              <div className="line">
                <span>Cheapest</span>
                <strong>
                  {formatPrice(cheapest.price)} <span className="where">{cheapest.where}</span>
                </strong>
              </div>
            )}
            {topOffer && (
              <div className="line">
                <span>Best offer</span>
                <strong>
                  {formatPrice(topOffer.price)} <span className="where">{topOffer.where}</span>
                </strong>
              </div>
            )}
            {cheapest &&
              (cheapestPool ? (
                <PushButton type="button" data-best-buy onClick={() => onOpenPool(cheapestPool.address)}>
                  Buy for {formatPrice(cheapest.price)} {cheapest.where}
                </PushButton>
              ) : cheapestListing?.tokenId ? (
                <PushButton type="button" data-best-buy onClick={() => onOpenItem(cheapestListing.tokenId!)}>
                  Buy #{cheapestListing.tokenId} for {formatPrice(cheapestListing.price)} on OpenSea
                </PushButton>
              ) : null)}
            {offerPool && (
              <PushButton type="button" onClick={() => onOpenPool(offerPool.address)}>
                Sell into the pool
              </PushButton>
            )}
            {poolLines.map((p) => (
              <PoolPriceLine
                key={p.address}
                pool={p}
                swap={swap}
                symbol={shownPair?.symbol}
                price={shownPrices[p.address.toLowerCase()]}
              />
            ))}
            {swap && poolLines.length > 0 && (
              <PairSwitch
                label="Pool price in"
                options={pairs.map((t) => t.symbol)}
                value={shownPair?.symbol}
                onChange={setPairSymbol}
              />
            )}
          </Best>
        )}
      </Card>

      {noPoolYet && (
        <Card aria-label="Start the first pool" data-start-pool>
          <Eyebrow>Start the first pool</Eyebrow>
          <Prose>
            A pool lets anyone swap one of these NFTs for a token and back, with no fees. Anyone can start it. It shows
            no price until someone adds liquidity for its token.
          </Prose>
          <Chips>{startButtons}</Chips>
          {createStatus}
          {pools.freeModes.includes(MODE.RANDOM) && isConnected && <Hint>Random pools work only for ERC-721.</Hint>}
        </Card>
      )}

      {sweeping && pickedListings.length > 0 ? (
        <SweepReview
          key={pickedListings.map((l) => l.hash).join()}
          listings={pickedListings}
          chainId={chainId}
          contract={address}
          title={name}
          onClose={() => setSweeping(false)}
          onDone={() => listings.refetch()}
        />
      ) : (
        canSweep.length >= 2 && (
          <SweepBar aria-label="Sweep the floor">
            <label htmlFor="sweep-count">
              <b>Sweep:</b> buy the {sweepCount} cheapest
            </label>
            <input
              id="sweep-count"
              type="range"
              min={2}
              max={Math.min(MAX_SWEEP, canSweep.length)}
              value={sweepCount}
              onChange={(e) => setSweepCount(Number(e.target.value))}
            />
            <strong title={ethInUsd(sumPrices(pickedListings), ethUsd)}>
              {formatAmount(sumPrices(pickedListings), 18, 4)} ETH
            </strong>
            <PushButton type="button" onClick={() => setSweeping(true)}>
              Review sweep
            </PushButton>
          </SweepBar>
        )
      )}

      {os.slug && (listings.loading || (listings.listings && listings.listings.length > 0)) && (
        <Card aria-label="Cheapest for sale">
          <Eyebrow>For sale{listed.length ? ` · ${listed.length}` : ''}</Eyebrow>
          <Hint>
            Cheapest first. Press one to see it and buy it right here.
            {listings.stale ? ' These prices may be a few minutes old.' : ''}
          </Hint>
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
              {shownListings.map((l) => (
                <ListingTile
                  picked={!sweeping && pickedListings.some((p) => p.hash === l.hash)}
                  key={l.hash}
                  chainId={chainId}
                  contract={address}
                  listing={l}
                  onOpen={() => onOpenItem(l.tokenId!)}
                />
              ))}
            </Tiles>
          )}
          {!listings.loading && listed.length > shownListings.length && (
            <PushButton type="button" onClick={() => setTileLimit((n) => n + TILE_PAGE)}>
              Show more ({listed.length - shownListings.length} left)
            </PushButton>
          )}
        </Card>
      )}

      {sales.sales && sales.sales.length > 0 && (
        <Card aria-label="Recent sales">
          <Eyebrow>Recent sales</Eyebrow>
          {sales.day && (
            <Hint>
              Last 24 hours: {sales.day.count} sold, {formatAmount(BigInt(sales.day.volume), 18, 2)} ETH.
            </Hint>
          )}
          <Sales>
            {sales.sales.slice(0, 8).map((s) => (
              <li key={`${s.tx}-${s.tokenId}`}>
                <span>
                  #{s.tokenId} sold for {formatAmount(BigInt(s.price), 18, 3)} {s.currency}
                </span>
                <a href={`${explorerUrl(chainId)}/tx/${s.tx}`} target="_blank" rel="noreferrer">
                  {timeAgo(s.at)}
                </a>
              </li>
            ))}
          </Sales>
        </Card>
      )}

      <Card aria-label="Markets">
        <Eyebrow>Where it trades</Eyebrow>
        <VenueList>
          {venues.map((v) => {
            if (v.id === 'miyapool') {
              if (!factory) return <VenueRow key={v.id} venue={v} note={'MiyaPool opens soon.'} />
              if (pools.loading) return <VenueRow key={v.id} venue={v} note="Looking for a pool…" />
              return (
                <VenueRow
                  key={v.id}
                  venue={v}
                  note={
                    pools.pools.length
                      ? 'Swap an NFT for 1 pool token, or 1 pool token for an NFT.'
                      : 'No pool for this collection yet. Start one above.'
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
                  {pools.pools.length > 0 && startButtons}
                </VenueRow>
              )
            }

            if (v.id === 'opensea') {
              const facts: { label: string; value: string }[] = []
              if (os.stats?.floor) facts.push({ label: 'Floor', value: formatPrice(os.stats.floor) })
              if (os.bestOffer) facts.push({ label: 'Best offer', value: formatPrice(os.bestOffer.price) })
              if (os.stats?.sales7d !== undefined)
                facts.push({ label: 'Sold this week', value: String(os.stats.sales7d) })
              return (
                <VenueRow
                  key={v.id}
                  venue={v}
                  facts={facts}
                  note={
                    os.loading && !os.needsKey
                      ? 'Getting prices…'
                      : os.missing
                        ? 'Not on OpenSea yet.'
                        : os.needsKey
                          ? 'Listings are unavailable right now.'
                          : listings.listings?.length
                            ? 'Buy listed NFTs right here, above.'
                            : undefined
                  }
                ></VenueRow>
              )
            }

            return null
          })}
        </VenueList>
        {os.error && <Hint>Could not get OpenSea prices right now.</Hint>}
        {!noPoolYet && createStatus}
        {pools.freeModes.includes(MODE.RANDOM) && pools.freeModes.length > 0 && isConnected && (
          <Hint>Random pools work only for ERC-721.</Hint>
        )}
      </Card>

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
