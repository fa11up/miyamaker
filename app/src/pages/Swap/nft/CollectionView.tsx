import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { parseAbi } from 'viem'
import { useAccount, useReadContract, useSwitchChain } from 'wagmi'

import NftImage from '@/components/NftImage'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, explorerUrl, mainnet } from '@/config/wagmi'
import { cleanText } from '@/desktop/files/sanitize'

import { ethInUsd, isFeatured } from '../board'
import { Chip, Eyebrow, Skeleton, StatusBox } from '../floor/retro'
import { bevel, color, space, text } from '../floor/tokens'
import { useEthUsd } from '../MarketBoard'
import { useTicket } from '../terminal/ticket'
import { erc721Abi } from './abi'
import BatchReview from './BatchReview'
import type { BatchPick, PoolOption } from './batchRoute'
import { batchSummary, ethValue, preTick, routeSells, sellPicks, togglePick } from './batchRoute'
import { CreatePool } from './CreatePool'
import type { OsOrder, Price } from './markets'
import { bestQuote, collectionUrl, formatAmount, formatPrice, lowerPrice, venuesFor } from './markets'
import { DEFAULT_PAIR_SYMBOL, pickPair } from './pairs'
import { buyNeedsFee, KIND, pickFeeAmounts, picksFreeOf, poolBuyQuote } from './pool'
import type { PoolRef } from './poolBatch'
import { MAX_SWEEP, pickCheapest, sessionStore, sumPrices, sweepable, unconfirmedHashes } from './sweep'
import SweepReview from './SweepReview'
import { Action, ActionDock, Card, Chips, Field, Head, Hint, LinkButton, Mono, Prose, PushButton } from './ui'
import {
  useCollectionGallery,
  useMarketListings,
  useMarketSales,
  useOpenSeaBids,
  useOpenSeaCollection,
  useOpenSeaItem,
  useOpenSeaNftImage,
  useOpenSeaOwned,
} from './useMarkets'
import type { PoolPrice } from './usePoolPrices'
import { pairsFor, poolSide, usePoolPrices } from './usePoolPrices'
import type { Pool } from './usePools'
import { HELD_PAGE, poolFactoryFor, useFeeRules, useHeldIds, useNftMeta, usePoolsForCollection } from './usePools'
import { Best, PairSwitch, VenueList, VenueRow } from './venueUi'
import type { ViewerItem } from './Viewer'
import Viewer from './Viewer'

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
  /* Three across on a phone: the odd last one takes the empty cell, so no slate block shows. */
  .narrow & div:last-child:nth-child(3n + 2) {
    grid-column: span 2;
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
  &:disabled {
    cursor: not-allowed;
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
const GALLERY_PAGE = 48
const SUPPLY_ABI = parseAbi(['function totalSupply() view returns (uint256)'])

/* The gallery: bigger tiles, art first, the number over the corner. */
const ArtGrid = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 6px;
  .narrow & {
    grid-template-columns: repeat(2, 1fr);
  }
  button {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    border: 1px solid ${color.dark};
    background: #000;
    cursor: zoom-in;
  }
  button:hover,
  button:focus-visible {
    border-color: ${color.accent};
    outline: none;
  }
  .num {
    position: absolute;
    left: 0;
    bottom: 0;
    padding: 1px 6px;
    background: rgba(0, 0, 0, 0.8);
    color: #fff;
    font-size: ${text.xs};
  }
`

const YoursList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 6px;
  li {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
`

/** The batch tick on a tile's corner: its own 32px press, apart from the tile's own (open / view). */
const Tick = styled.button`
  position: absolute;
  top: 3px;
  left: 3px;
  z-index: 1;
  width: 32px;
  height: 32px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid ${color.shadow};
  background: rgba(0, 0, 0, 0.8);
  color: ${color.accent};
  font-size: ${text.lg};
  font-weight: 700;
  cursor: pointer;
  &[aria-pressed='true'] {
    background: ${color.accent};
    border-color: ${color.accent};
    color: ${color.onAccent};
  }
  &:focus-visible {
    outline: 2px solid ${color.accent};
    outline-offset: 1px;
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
`

const Picked = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: ${text.xs};
  color: ${color.inkMuted};
  select {
    width: 100%;
    min-height: 32px;
    background: ${color.well};
    color: ${color.ink};
    border: 1px solid ${color.dark};
    font: inherit;
  }
  .narrow & select {
    min-height: 44px;
  }
  b {
    color: ${color.ink};
    font-weight: 400;
  }
`

const Bar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
  font-size: ${text.sm};
  strong {
    flex: 1 1 160px;
    min-width: 0;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .narrow & button {
    flex: 1 1 auto;
  }
`

function OwnedTile({ chainId, contract, id }: { chainId: SupportedChainId; contract: Address; id: string }) {
  const osImage = useOpenSeaNftImage(chainId, contract, id)
  const meta = useNftMeta(chainId, osImage ? undefined : contract, KIND.ERC721, BigInt(id))
  return (
    <div style={{ position: 'relative' }}>
      <NftImage src={osImage || meta.image} alt={`#${id}`} variant="thumb" />
      <span
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          padding: '1px 6px',
          background: 'rgba(0,0,0,.8)',
          fontSize: 12,
        }}
      >
        #{id}
      </span>
    </div>
  )
}

/** SELL NOW for one NFT you hold: its best bid (OpenSea's best offer for it, collection bids included), in the ticket. */
function SellNow({
  chainId,
  contract,
  slug,
  tokenId,
  title,
  label,
}: {
  chainId: SupportedChainId
  contract: Address
  slug?: string
  tokenId: string
  title: string
  label?: string
}) {
  const ticket = useTicket()
  const item = useOpenSeaItem(chainId, contract, slug, tokenId)
  if (!ticket) return null
  if (item.loading) return <Hint>Checking bids…</Hint>
  if (item.needsKey || item.error) return <Hint>Bids unavailable right now.</Hint>
  if (!item.offer) return <Hint>No bids right now.</Hint>
  return (
    <PushButton
      type="button"
      disabled={ticket.busy}
      data-sell-now
      onClick={() => ticket.open({ kind: 'fill', side: 'sell', order: item.offer!, chainId, contract, tokenId, title })}
    >
      {label ? `${label} · ${formatPrice(item.offer.price)}` : `Sell now · bid ${formatPrice(item.offer.price)}`}
    </PushButton>
  )
}

function GalleryTile({
  chainId,
  contract,
  item,
  onOpen,
}: {
  chainId: SupportedChainId
  contract: Address
  item: ViewerItem
  onOpen: () => void
}) {
  // OpenSea's gallery carries the picture; numbered tiles (OpenSea offline) read their own metadata.
  const meta = useNftMeta(chainId, item.image ? undefined : contract, KIND.ERC721, BigInt(item.tokenId))
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={`#${item.tokenId}. View full screen`}>
        <NftImage src={item.image || meta.image} alt="" variant="thumb" />
        <span className="num">#{item.tokenId}</span>
      </button>
    </li>
  )
}

const SweepBar = styled.div`
  display: grid;
  grid-template-columns: auto minmax(80px, 1fr) auto auto;
  align-items: center;
  gap: ${space[3]};
  padding: ${space[2]} ${space[3]};
  background: ${color.well};
  border: 1px solid ${color.dark};
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
    button {
      grid-column: 1 / -1;
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
  .narrow & a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
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
  disabled,
  onTick,
}: {
  chainId: SupportedChainId
  contract: Address
  listing: OsOrder
  onOpen: () => void
  /** Ticked for the batch. */
  picked?: boolean
  disabled?: boolean
  /** Ticks it for a batch buy; absent when it can't be batched (priced in a token, your own, still unconfirmed). */
  onTick?: () => void
}) {
  const id = listing.tokenId!
  const osImage = useOpenSeaNftImage(chainId, contract, id)
  const meta = useNftMeta(chainId, osImage ? undefined : contract, KIND.ERC721, BigInt(id))
  return (
    <li style={{ position: 'relative' }}>
      {onTick && (
        <Tick
          type="button"
          aria-pressed={!!picked}
          aria-label={picked ? `Take #${id} out of the batch` : `Add #${id} to the batch`}
          title={picked ? 'In the batch' : 'Add to the batch'}
          disabled={disabled}
          onClick={onTick}
          data-batch-tick
        >
          {picked ? '✓' : '+'}
        </Tick>
      )}
      <TileButton
        type="button"
        onClick={onOpen}
        disabled={disabled}
        data-picked={picked || undefined}
        aria-label={`#${id}, ${formatPrice(listing.price)}${
          listing.total ? ` each, ${listing.remaining} for ${formatPrice(listing.total)}` : ''
        } on OpenSea${picked ? ', in the batch' : ''}. Open`}
      >
        <NftImage src={osImage || meta.image} alt="" variant="thumb" />
        <span className="label">
          <span>#{id}</span>
          <b>
            {formatPrice(listing.price)}
            {listing.total ? ' each' : ''}
          </b>
          {listing.total && (
            <span>
              {listing.remaining} for {formatPrice(listing.total)}
            </span>
          )}
          <span className="buy">Buy →</span>
        </span>
      </TileButton>
    </li>
  )
}

/** NFTs the pool holds, to tick for a batch buy: 1 pool token each plus the pool's pick fee in IMD or INFER. */
function PoolHeldPicks({
  chainId,
  pool,
  ask,
  picked,
  disabled,
  onTick,
}: {
  chainId: SupportedChainId
  pool: Pool
  /** One pool token in ETH through 0x, when priced. */
  ask?: bigint
  picked: (id: string) => boolean
  disabled?: boolean
  onTick: (id: string) => void
}) {
  const count = pool.held === undefined ? undefined : Number(pool.held)
  const held = useHeldIds(chainId, pool, count, 1)
  const fee = pickFeeAmounts(pool)
  const pickWords =
    fee === undefined ? "the pool's pick fee" : fee === 'free' ? 'no pick fee' : `a pick fee of ${fee} each`
  if (!count) return null
  return (
    <Card aria-label="In the pool" data-pool-picks={pool.address}>
      <Eyebrow>In MiyaPool · {count}</Eyebrow>
      <Hint>
        1 {pool.symbol} each{ask !== undefined ? ` (about ${formatAmount(ask, 18, 4)} ETH)` : ''}, plus {pickWords}.
        Tick any to add them to the batch.
      </Hint>
      {held.failed && !held.loading ? (
        <Hint>
          Couldn&apos;t list what the pool holds.{' '}
          <LinkButton type="button" onClick={() => held.refetch()}>
            Try again
          </LinkButton>
        </Hint>
      ) : held.loading ? (
        <Tiles>
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <Skeleton h="120px" />
            </li>
          ))}
        </Tiles>
      ) : (
        <Tiles>
          {held.ids.slice(0, HELD_PAGE).map((idn, i) => {
            const id = idn.toString()
            const on = picked(id)
            // An open random draw could pick it: it can be taken out of the batch, never put in (as on the pool page).
            const locked = held.lockedAt(i) === true
            return (
              <li key={id} style={{ position: 'relative' }}>
                <Tick
                  type="button"
                  aria-pressed={on}
                  aria-label={
                    on
                      ? `Take #${id} out of the batch`
                      : locked
                      ? `#${id} is locked by an open random draw`
                      : `Add #${id} to the batch`
                  }
                  title={
                    on ? 'In the batch' : locked ? 'Locked: an open random draw could pick it' : 'Add to the batch'
                  }
                  disabled={disabled || (locked && !on)}
                  onClick={() => onTick(id)}
                  data-batch-tick
                >
                  {on ? '✓' : '+'}
                </Tick>
                <OwnedTile chainId={chainId} contract={pool.collection} id={id} />
              </li>
            )
          })}
        </Tiles>
      )}
      {count > HELD_PAGE && (
        <Hint>
          Showing {HELD_PAGE} of {count}. Open the pool to pick from the rest.
        </Hint>
      )}
    </Card>
  )
}

/**
 * One MiyaPool line in the best-price box: one pool token priced in the chosen pair. A random NFT costs 1 token; a
 * picked one costs 1 token plus the pick fee in IMD or INFER, said in words (no IMD/INFER price here).
 */
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
  const label = 'In MiyaPool'
  const fee = pickFeeAmounts(pool)
  const pickNote = fee === undefined ? 'a pick adds a fee' : fee === 'free' ? 'picks add no fee' : `a pick adds ${fee}`
  const each = (
    <>
      1 {pool.symbol}{' '}
      <span className="where">
        each{pool.randomEnabled ? ' at random' : ''}; {pickNote}
      </span>
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
    const firstWords = buyNeedsFee(pool) ? 'to buy one, plus the pick fee' : 'to buy one'
    return (
      <>
        {ask && pool.held !== undefined && pool.held > 0n ? (
          <>
            ≈ {formatPrice(ask)} <span className="where">{firstWords}</span>
            <span className="where sub">{pickNote}</span>
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

/** What a person set on a collection's page, kept by NftTrade so going to an NFT and back loses none of it. */
export type CollectionPlace = { tileLimit?: number; sweepCount?: number }

/**
 * One collection in Trade → NFTs: the best price, every venue it trades on (MiyaPool first, then OpenSea) with what each
 * one's API can tell us, and the cheapest OpenSea listings. Prices need the OpenSea key on the server: without it the page
 * says buying here is offline, and links to OpenSea for that reason only.
 */
export default function CollectionView({
  chainId,
  address,
  onBack,
  onOpenItem,
  onOpenPool,
  onBusy,
  place,
  onPlace,
  sweepAsk,
}: {
  /** BUY n from the command line: set the sweep to n (clamped to what a sweep can buy). Each new key asks again. */
  sweepAsk?: { key: number; count: number }
  chainId: SupportedChainId
  address: Address
  onBack: () => void
  /** The NFT's own page; `buy` opens its buy review there. */
  onOpenItem: (tokenId: string, buy?: boolean) => void
  onOpenPool: (pool: Address) => void
  /** Told while a trade is in flight, when the page must not change. */
  onBusy?: (busy: boolean) => void
  place?: CollectionPlace
  onPlace?: (place: CollectionPlace) => void
}) {
  const chain = chains.find((c) => c.id === chainId) || mainnet
  const { address: me, isConnected, chainId: walletChain } = useAccount()
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain()
  const { openConnectModal } = useConnectModal()
  const wrongChain = isConnected && walletChain !== chainId

  const os = useOpenSeaCollection(chainId, address)
  const listings = useMarketListings(os.slug)
  const sales = useMarketSales(os.slug)
  const factory = poolFactoryFor(chainId)
  const pools = usePoolsForCollection(chainId, factory, address)
  // The factory's IMD and INFER: a batch pick pays the pool's pick fee in one of them.
  const feeRules = useFeeRules(chainId, factory)
  const onchainName = useReadContract({
    address,
    abi: erc721Abi,
    functionName: 'name',
    chainId,
    query: { staleTime: Infinity },
  })
  const [lookup, setLookup] = useState('')
  const ethUsd = useEthUsd()
  // The set agreed to is frozen when Review is pressed. Picking it live let any list change remount the review, re-arming
  // a finished sweep for the next NFTs at higher prices, with the old run still opening wallet prompts behind it.
  const [sweepSet, setSweepSet] = useState<OsOrder[]>()
  const [sweepCount, setSweepCount] = useState(place?.sweepCount ?? 3)
  useEffect(() => {
    if (sweepAsk) setSweepCount(Math.max(2, Math.min(sweepAsk.count, MAX_SWEEP)))
  }, [sweepAsk?.key])
  // Each tile looks up its own image, so the grid grows on request rather than asking for every listing at once.
  const [tileLimit, setTileLimit] = useState(place?.tileLimit ?? TILE_PAGE)
  useEffect(() => onPlace?.({ tileLimit, sweepCount }), [tileLimit, sweepCount])
  const [sweepBusy, setSweepBusy] = useState(false)
  const listed = (listings.listings ?? []).filter((l) => l.tokenId)
  const shownListings = listed.slice(0, tileLimit)

  // The gallery: every piece, for sale or not (OpenSea), else by number from the contract (ids 1 up) when OpenSea is
  // offline. The viewer steps through whichever list it was opened from.
  // With pieces for sale, those tiles are the art: the gallery shows only once listings answer with none (or fail).
  const showGallery = !listings.loading && listed.length === 0
  const gallery = useCollectionGallery(showGallery ? os.slug : undefined)
  const supplyRead = useReadContract({
    address,
    abi: SUPPLY_ABI,
    functionName: 'totalSupply',
    chainId,
    query: { staleTime: 60_000, enabled: gallery.needsKey || !!gallery.error },
  })
  const onchainSupply = typeof supplyRead.data === 'bigint' ? Number(supplyRead.data) : undefined
  const [galleryLimit, setGalleryLimit] = useState(GALLERY_PAGE)
  const galleryItems: ViewerItem[] = gallery.items.length
    ? gallery.items
    : onchainSupply
    ? Array.from({ length: Math.min(onchainSupply, galleryLimit) }, (_, i) => ({ tokenId: String(i + 1) }))
    : []
  const listedItems: ViewerItem[] = listed.map((l) => ({ tokenId: l.tokenId!, price: l.price }))
  // The open NFT is kept by its id, not its place: a refetch that adds a cheaper listing on top must not move the
  // viewer (and its BUY) onto another NFT. If it leaves the list (sold), the viewer closes.
  const [viewing, setViewing] = useState<{ list: 'gallery' | 'listed'; tokenId: string }>()
  const viewerItems = viewing?.list === 'listed' ? listedItems : galleryItems
  const viewingIndex = viewing ? viewerItems.findIndex((v) => v.tokenId === viewing.tokenId) : -1
  // A buy of it still unconfirmed this session is not swept again: it may yet land.
  const stillUnconfirmed = unconfirmedHashes(sessionStore())
  const canSweep = sweepable(
    (listings.listings ?? []).filter((l) => !stillUnconfirmed.has(l.hash)),
    me
  )
  const pickedListings = pickCheapest(canSweep, Math.min(sweepCount, canSweep.length))
  const [creating, setCreating] = useState(false)
  const busy = sweepBusy || creating
  useEffect(() => onBusy?.(busy), [busy])
  useEffect(() => () => onBusy?.(false), [])

  const knownName = os.info?.name || cleanText(onchainName.data as string | undefined, 80)
  const named = !!knownName
  const name = knownName || 'Unnamed collection'
  const venues = venuesFor(chainId)
  const unverified = !isFeatured(chainId, address) && os.info?.verified !== true
  // BUY, SWEEP and SELL NOW open the terminal's ticket (straight to the wallet); outside it, the old reviews.
  const ticket = useTicket()
  const owned = useOpenSeaOwned(chainId, me)
  const mineHere = owned.groups?.find((g) => g.contract.toLowerCase() === address.toLowerCase())?.ids ?? []
  const openSeaHref = collectionUrl('opensea', chainId, address, os.slug)

  // MiyaPool prices: one pool token (= one NFT) through 0x, in ETH for the comparison and in the chosen pair to show.
  const pairs = pairsFor(chainId)
  const swap = pairs.length > 0
  const [pairSymbol, setPairSymbol] = useState<string>(DEFAULT_PAIR_SYMBOL)
  const ethPair = pickPair(pairs, 'ETH')
  const shownPair = pickPair(pairs, pairSymbol)
  const poolAddresses = pools.pools.map((p) => p.address)
  const ethPrices = usePoolPrices(chainId, poolAddresses, ethPair)
  const shownPrices = usePoolPrices(chainId, poolAddresses, shownPair)
  const poolsWithNfts = pools.pools.filter((p) => p.held !== undefined && p.held > 0n)
  // `where` reads after the price: an OpenSea listing or offer is "on OpenSea"; a pool's bid is a sale into it.
  // Buying from a pool, ranked against OpenSea only where 1 pool token is the whole cost (pool.ts poolBuyQuote).
  const poolBuy = (p: Pool) => poolBuyQuote(p, poolSide(ethPrices[p.address.toLowerCase()], 'ask'))

  // OpenSea's stat can be lower than anything its listings call returns: show the lowest known, and what can be bought.
  const floor: Price | undefined = lowerPrice(os.stats?.floor, listings.floor)
  // Compared as shown: raw amounts can differ below the rounding, and "0.687 ETH, cheapest here 0.687 ETH" says nothing.
  const buyHere =
    listings.floor && floor && formatPrice(listings.floor) !== formatPrice(floor) ? listings.floor : undefined
  const cheapest = bestQuote([{ where: 'on OpenSea', price: floor }, ...poolsWithNfts.flatMap((p) => poolBuy(p) ?? [])])
  const topOffer = bestQuote(
    [
      { where: 'on OpenSea', price: os.bestOffer?.price },
      ...pools.pools.map((p) => ({
        where: 'sell into MiyaPool',
        price: poolSide(ethPrices[p.address.toLowerCase()], 'bid'),
      })),
    ],
    'highest'
  )
  const poolLines = swap ? pools.pools : poolsWithNfts
  // The one Buy button goes wherever is cheapest right now.
  const cheapestPool = poolsWithNfts.find((p) => !!cheapest && poolBuy(p)?.where === cheapest.where)
  const cheapestListing = canSweep[0] ?? listed[0]
  // One pool per collection (v2): its bid is the only pool line.
  const offerPool = pools.pools.find(() => topOffer?.where === 'sell into MiyaPool')

  /* ---------- the batch: tick several, one transaction per venue ---------- */

  const [buyTicks, setBuyTicks] = useState<BatchPick<OsOrder>[]>([])
  const [sellTicks, setSellTicks] = useState<string[]>([])
  const [venueChoice, setVenueChoice] = useState<Record<string, string>>({})
  const [full, setFull] = useState<{ side: 'buy' | 'sell'; words: string }>()
  // Inline only (no terminal ticket): the set agreed to, frozen when Review is pressed, as the sweep's.
  const [batchSet, setBatchSet] = useState<{ side: 'buy' | 'sell'; picks: BatchPick<OsOrder>[] }>()
  // Another wallet's NFTs are not this one's to sell.
  useEffect(() => {
    setSellTicks([])
    setVenueChoice({})
  }, [me])
  const tickable = new Set(canSweep.map((l) => l.hash))
  // A listing that has gone (sold, cancelled) leaves the batch with its tile; so does an NFT that left the wallet.
  const buyPicks = listings.listings ? buyTicks.filter((p) => p.venue === 'pool' || tickable.has(p.key)) : buyTicks
  const sellIds = sellTicks.filter((id) => mineHere.includes(id))
  const poolAsk = (p: Pool) => ethValue(poolSide(ethPrices[p.address.toLowerCase()], 'ask'))
  const poolBid = (p: Pool) => ethValue(poolSide(ethPrices[p.address.toLowerCase()], 'bid'))
  const poolRefs: PoolRef[] = pools.pools.map((p) => ({
    address: p.address,
    collection: p.collection,
    kind: p.kind,
    symbol: p.symbol,
    randomEnabled: p.randomEnabled,
    imdFee: p.imdFee,
    inferFee: p.inferFee,
    imd: feeRules.imd,
    infer: feeRules.infer,
  }))
  const poolInfo = pools.pools.map((p) => ({
    address: p.address,
    symbol: p.symbol,
    ethAsk: poolAsk(p),
    ethBid: poolBid(p),
    // Unknown fees count as a fee: the bar never says a pick is fee-free before it knows.
    pickFee: !picksFreeOf(p),
  }))
  const sellBids = useOpenSeaBids(os.slug, sellIds)
  const poolOptions: PoolOption[] = pools.pools.map((p) => ({
    address: p.address,
    symbol: p.symbol,
    label: 'MiyaPool',
    ethBid: poolBid(p),
  }))
  const routes = routeSells(
    sellIds.map((id) => ({ tokenId: id, bid: sellBids.bids[id] })),
    poolOptions,
    venueChoice
  )
  const sellBatch = sellPicks(routes)
  const buySummary = batchSummary('buy', buyPicks, poolInfo)
  const sellSummary = batchSummary('sell', sellBatch, poolInfo)
  const routing = routes.some((r) => r.checking)
  const tickBuy = (pick: BatchPick<OsOrder>) => {
    const r = togglePick(buyPicks, pick)
    setBuyTicks(r.picks)
    setFull(r.full ? { side: 'buy', words: r.full } : undefined)
  }

  const tickSell = (id: string) => {
    const r = togglePick(
      sellIds.map((key) => ({ key })),
      { key: id }
    )
    setSellTicks(r.picks.map((p) => p.key))
    setFull(r.full ? { side: 'sell', words: r.full } : undefined)
  }

  const reviewBatch = (side: 'buy' | 'sell') => {
    const picks = side === 'buy' ? buyPicks : sellBatch
    if (!picks.length) return
    // The terminal's ticket keeps the pool details it opens with, so a buy waits until the pick fee and its tokens
    // are read (the inline review reads them live).
    const feeKnown = (r: PoolRef) =>
      r.imdFee !== undefined &&
      r.inferFee !== undefined &&
      (r.imdFee === 0n || !!r.imd) &&
      (r.inferFee === 0n || !!r.infer) &&
      r.randomEnabled !== undefined
    if (ticket && side === 'buy' && picks.some((p) => p.venue === 'pool') && !poolRefs.every(feeKnown)) {
      setFull({ side, words: "Still reading the pool's pick fee. Try again in a moment." })
      feeRules.refetch()
      pools.refetch()
      return
    }

    setFull(undefined)
    if (ticket)
      ticket.open({ kind: 'batch', side, picks, pools: poolRefs, chainId, contract: address, title: name, unverified })
    else setBatchSet({ side, picks })
  }

  // The Sweep ticks the N cheapest in place of the other OpenSea ticks; pool picks stay.
  const tickCheapest = () => {
    const r = preTick(
      buyPicks,
      pickedListings.map((l) => ({ key: l.hash, tokenId: l.tokenId!, venue: 'opensea' as const, order: l })),
      (p) => p.venue === 'opensea'
    )
    setBuyTicks(r.picks)
    setFull(r.full ? { side: 'buy', words: r.full } : undefined)
  }

  // Picks: any ERC-721 pool holding something (v2 pools take picks; the fee is paid at the review).
  const targetPools = pools.pools.filter((p) => p.kind === KIND.ERC721 && p.held !== undefined && p.held > 0n)

  const pickFact = (p: Pool) => {
    const fee = pickFeeAmounts(p)
    if (fee === undefined) return `1 ${p.symbol} + fee`
    return fee === 'free' ? `1 ${p.symbol}, no fee` : `1 ${p.symbol} + ${fee}`
  }

  const randomFact = (p: Pool) => {
    if (p.randomEnabled === undefined) return '–'
    return p.randomEnabled ? `1 ${p.symbol}` : 'not on this pool'
  }

  let poolNote = 'No pool for this collection yet. Start one above.'
  if (pools.checkFailed) poolNote = "Couldn't check for a pool."
  const thePool = pools.pools[0]
  if (thePool) {
    // Only the ways out this pool has: no random on ERC-1155 or Robinhood Chain pools, no fee where picks are free.
    const fee = pickFeeAmounts(thePool)
    const ways = [
      thePool.randomEnabled === true ? '1 token (random)' : '',
      fee === 'free' ? '1 token (pick)' : `1 token plus the pick fee${fee === undefined ? '' : ` of ${fee}`} (pick)`,
    ].filter(Boolean)
    poolNote = `Sell an NFT in for 1 pool token. Take one out for ${ways.join(' or ')}.`
  }

  // Only once the factory has said so: a failed lookup is not "no pool".
  const noPoolYet = !!factory && pools.free

  return (
    <>
      <LinkButton type="button" onClick={onBack} disabled={busy}>
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
              {os.info && unverified && <Chip tone="warn">Not verified: check the address</Chip>}
            </Chips>
            <Hint>
              <Mono data-collection-address>{os.info && unverified ? address : shortAddress(address)}</Mono> ·{' '}
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
                {/* No floor from a listings read that failed is unknown, not "none". */}
                {floor
                  ? formatPrice(floor)
                  : listings.loading
                  ? '…'
                  : listings.error && !listings.needsKey
                  ? 'Prices unavailable'
                  : 'None for sale'}
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

        {cheapest &&
          (cheapestPool ? (
            <Action type="button" data-best-buy disabled={busy} onClick={() => onOpenPool(cheapestPool.address)}>
              Buy for {formatPrice(cheapest.price)} {cheapest.where}
            </Action>
          ) : cheapestListing?.tokenId ? (
            <Action
              type="button"
              data-best-buy
              disabled={busy || !!ticket?.busy}
              onClick={() =>
                ticket
                  ? ticket.open({
                      kind: 'fill',
                      side: 'buy',
                      order: cheapestListing,
                      chainId,
                      contract: address,
                      tokenId: cheapestListing.tokenId!,
                      title: name,
                      unverified,
                    })
                  : onOpenItem(cheapestListing.tokenId!)
              }
            >
              {cheapestListing.total
                ? `Buy ${cheapestListing.remaining} of #${cheapestListing.tokenId} for ${formatPrice(
                    cheapestListing.total
                  )} on OpenSea`
                : `Buy #${cheapestListing.tokenId} for ${formatPrice(cheapestListing.price)} on OpenSea`}
            </Action>
          ) : null)}
      </Card>

      {/* What's for sale first, then what you hold, then every piece (only when none is for sale). Prices, pools and
          markets follow. */}
      {os.needsKey && !os.missing && (
        <StatusBox tone="error" role="status" data-market-offline>
          <span>
            Buying here is offline right now. Try again later, or buy it on OpenSea.{' '}
            {openSeaHref && (
              <a href={openSeaHref} target="_blank" rel="noreferrer">
                Open on OpenSea ↗
              </a>
            )}
          </span>
        </StatusBox>
      )}

      {os.slug && (
        <Card aria-label="Cheapest for sale">
          <Eyebrow>For sale{listed.length ? ` · ${listed.length}` : ''}</Eyebrow>
          {listed.length > 0 && (
            <Hint>
              Cheapest first. Press one to see it and buy it right here.
              {listings.stale ? ' These prices may be a few minutes old.' : ''}
            </Hint>
          )}
          {!listings.listings && !listings.loading ? (
            listings.needsKey ? (
              <Hint data-listings-offline>
                Buying here is offline right now. Try again later, or buy it on OpenSea.{' '}
                {openSeaHref && (
                  <a href={openSeaHref} target="_blank" rel="noreferrer">
                    Open on OpenSea ↗
                  </a>
                )}
              </Hint>
            ) : (
              <Hint data-listings-failed>
                Could not load listings.{' '}
                <LinkButton type="button" onClick={() => listings.refetch()}>
                  Try again
                </LinkButton>
              </Hint>
            )
          ) : !listings.loading && !listed.length ? (
            <Hint data-listings-empty>Nothing for sale right now. Hold one? Enter its number below to see offers.</Hint>
          ) : listings.loading ? (
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
                  picked={buyPicks.some((p) => p.key === l.hash)}
                  onTick={
                    tickable.has(l.hash)
                      ? () => tickBuy({ key: l.hash, tokenId: l.tokenId!, venue: 'opensea', order: l })
                      : undefined
                  }
                  disabled={busy || !!ticket?.busy}
                  key={l.hash}
                  chainId={chainId}
                  contract={address}
                  listing={l}
                  onOpen={() => setViewing({ list: 'listed', tokenId: l.tokenId! })}
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

      {sweepSet ? (
        <SweepReview
          key="sweep"
          listings={sweepSet}
          chainId={chainId}
          contract={address}
          title={name}
          unverified={unverified}
          onClose={() => setSweepSet(undefined)}
          onDone={() => listings.refetch()}
          onBusy={setSweepBusy}
        />
      ) : (
        canSweep.length >= 2 && (
          <SweepBar aria-label="Sweep the floor">
            <label htmlFor="sweep-count">
              <b>Sweep:</b> tick the {pickedListings.length} cheapest
              {sweepAsk && sweepAsk.count > pickedListings.length ? ` (asked ${sweepAsk.count})` : ''}
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
            <PushButton type="button" disabled={busy || !!ticket?.busy} onClick={tickCheapest} data-sweep-tick>
              Tick {pickedListings.length} cheapest
            </PushButton>
          </SweepBar>
        )
      )}

      {batchSet && (
        <BatchReview
          key={`batch-${batchSet.side}`}
          escapeCloses
          side={batchSet.side}
          picks={batchSet.picks}
          pools={poolRefs}
          chainId={chainId}
          contract={address}
          title={name}
          unverified={unverified}
          onClose={() => setBatchSet(undefined)}
          onDone={() => listings.refetch()}
          onBusy={setSweepBusy}
          onOneByOne={(list) => {
            if (batchSet.side !== 'buy') return
            setBatchSet(undefined)
            setSweepSet(list.map((p) => p.order))
          }}
        />
      )}

      {targetPools.map((p) => (
        <PoolHeldPicks
          key={p.address}
          chainId={chainId}
          pool={p}
          ask={poolAsk(p)}
          disabled={busy || !!ticket?.busy}
          picked={(id) => buyPicks.some((x) => x.key === `${p.address.toLowerCase()}:${id}`)}
          onTick={(id) =>
            tickBuy({ key: `${p.address.toLowerCase()}:${id}`, tokenId: id, venue: 'pool', pool: p.address })
          }
        />
      ))}

      {ticket && mineHere.length > 0 && (
        <Card aria-label="Yours" data-yours>
          <Eyebrow>
            Yours · {mineHere.length}
            {owned.partial ? '+' : ''}
          </Eyebrow>
          <Hint>
            Sell any of them into its best bid. The ticket shows what you receive after fees; you confirm once. Tick
            several to sell them together, each where it gets the most.
          </Hint>
          <YoursList>
            {mineHere.slice(0, 12).map((id) => {
              const route = routes.find((r) => r.tokenId === id)
              const open = route?.options.filter((o) => !o.blocked) ?? []
              const chosen = route?.options.find((o) => o.venue === route.venue)
              return (
                <li key={id} data-yours-item={id}>
                  <div style={{ position: 'relative' }}>
                    <Tick
                      type="button"
                      aria-pressed={!!route}
                      aria-label={route ? `Take #${id} out of the batch` : `Add #${id} to the batch`}
                      title={route ? 'In the batch' : 'Add to the batch'}
                      disabled={busy || !!ticket?.busy}
                      onClick={() => tickSell(id)}
                      data-batch-tick
                    >
                      {route ? '✓' : '+'}
                    </Tick>
                    <OwnedTile chainId={chainId} contract={address} id={id} />
                  </div>
                  {route ? (
                    <Picked data-batch-route>
                      {route.checking ? (
                        <span>Checking bids…</span>
                      ) : open.length > 1 ? (
                        <label>
                          Sell into
                          <select
                            value={route.venue ?? ''}
                            aria-label={`Where to sell #${id}`}
                            onChange={(e) => setVenueChoice((c) => ({ ...c, [id]: e.target.value }))}
                          >
                            {open.map((o) => (
                              <option key={o.venue} value={o.venue}>
                                {o.label}: {o.gets}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : chosen ? (
                        <span>
                          {chosen.label}: <b>{chosen.gets}</b>
                        </span>
                      ) : null}
                      {sellBids.failed.includes(id) && <span>Bids unavailable right now.</span>}
                      {route.note && <span>{route.note}</span>}
                    </Picked>
                  ) : (
                    <SellNow chainId={chainId} contract={address} slug={os.slug} tokenId={id} title={name} />
                  )}
                </li>
              )
            })}
          </YoursList>
          {mineHere.length > 12 && (
            <Hint>Showing 12 of {mineHere.length}. Open one by number below to sell another.</Hint>
          )}
        </Card>
      )}

      {showGallery && (
        <Card aria-label="Gallery" data-gallery>
          <Eyebrow>
            Gallery
            {gallery.items.length ? ` · ${gallery.items.length}${gallery.done ? '' : '+'}` : ''}
            {!gallery.items.length && onchainSupply ? ` · ${onchainSupply.toLocaleString()} minted` : ''}
          </Eyebrow>
          {galleryItems.length > 0 ? (
            <>
              <Hint>
                {gallery.items.length
                  ? 'Every piece, for sale or not. Press one to view it full screen.'
                  : `OpenSea is offline, so these are numbered #1 up to the minted count; a collection that starts at #0 or has burned pieces will differ. Press one to view it full screen.`}
              </Hint>
              <ArtGrid>
                {galleryItems.map((g) => (
                  <GalleryTile
                    key={g.tokenId}
                    chainId={chainId}
                    contract={address}
                    item={g}
                    onOpen={() => setViewing({ list: 'gallery', tokenId: g.tokenId })}
                  />
                ))}
              </ArtGrid>
              {gallery.items.length > 0 && !gallery.done && (
                <PushButton type="button" disabled={gallery.loading} onClick={() => gallery.more()}>
                  {gallery.loading ? 'Loading…' : 'Show more'}
                </PushButton>
              )}
              {!gallery.items.length && onchainSupply !== undefined && onchainSupply > galleryLimit && (
                <PushButton type="button" onClick={() => setGalleryLimit((n) => n + GALLERY_PAGE)}>
                  Show more ({(onchainSupply - galleryLimit).toLocaleString()} left)
                </PushButton>
              )}
            </>
          ) : gallery.loading || supplyRead.isLoading ? (
            <Tiles>
              {[0, 1, 2, 3].map((i) => (
                <li key={i}>
                  <Skeleton h="140px" />
                </li>
              ))}
            </Tiles>
          ) : (
            <Hint>Couldn&apos;t list its pieces right now. Enter a number below to see one.</Hint>
          )}
        </Card>
      )}

      {viewing && viewingIndex >= 0 && (
        <Viewer
          unverified={unverified}
          chainId={chainId}
          contract={address}
          slug={os.slug}
          collectionName={name}
          supply={os.info?.supply ?? onchainSupply}
          items={viewerItems}
          index={viewingIndex}
          onIndex={(index) => setViewing({ ...viewing, tokenId: viewerItems[index]!.tokenId })}
          onClose={() => setViewing(undefined)}
          onOpen={(tokenId, buy) => {
            setViewing(undefined)
            onOpenItem(tokenId, buy)
          }}
        />
      )}

      {poolLines.length > 0 && (
        <>
          <Card aria-label="Pool prices">
            <Eyebrow>Pools vs OpenSea</Eyebrow>
            {/* The figures above already give OpenSea's prices: the price lines are here only to compare them with our pools. */}
            {poolLines.length > 0 && (
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
                {offerPool && (
                  <PushButton type="button" disabled={busy} onClick={() => onOpenPool(offerPool.address)}>
                    Sell into the pool
                  </PushButton>
                )}
                {ticket && mineHere[0] && (
                  <SellNow
                    chainId={chainId}
                    contract={address}
                    slug={os.slug}
                    tokenId={mineHere[0]}
                    title={name}
                    label={`Sell #${mineHere[0]} into its best bid`}
                  />
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
                {swap && (
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
        </>
      )}

      {noPoolYet && factory && (
        <Card aria-label="Start the first pool" data-start-pool>
          <Eyebrow>Start the first pool</Eyebrow>
          <CreatePool
            key={`${chainId}-${address}`}
            chainId={chainId}
            factory={factory}
            collection={address}
            onCreated={() => pools.refetch()}
            onBusy={setCreating}
            doneWords="Pool started. Open it below."
            wallet={{
              isConnected,
              wrongChain,
              switching,
              switchChain,
              switchFailed: !!switchError,
              openConnectModal,
            }}
          />
          <Hint>It shows no price until someone adds liquidity for its token.</Hint>
        </Card>
      )}
      {pools.checkFailed && (
        <StatusBox tone="error" role="alert">
          <span>
            Couldn&apos;t check whether this collection has a pool.{' '}
            <LinkButton type="button" onClick={() => pools.refetch()}>
              Try again
            </LinkButton>
          </span>
        </StatusBox>
      )}

      {sales.sales && sales.sales.length > 0 && (
        <Card aria-label="Recent sales">
          <Eyebrow>Recent sales</Eyebrow>
          {sales.day && (
            <Hint>
              Last 24 hours: {sales.day.count} sold, {formatAmount(BigInt(sales.day.volume), 18, 2)} ETH
              {sales.day.other ? `, plus ${sales.day.other} in other tokens` : ''}.
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
                  note={poolNote}
                  facts={pools.pools.flatMap((p) => [
                    {
                      label: 'Holds',
                      value: `${p.held === undefined ? '–' : p.held.toString()} NFT${p.held === 1n ? '' : 's'}`,
                    },
                    { label: 'Random', value: randomFact(p) },
                    { label: 'Pick', value: pickFact(p) },
                  ])}
                >
                  {pools.pools.map((p) => (
                    <PushButton key={p.address} type="button" disabled={busy} onClick={() => onOpenPool(p.address)}>
                      Open the pool
                    </PushButton>
                  ))}
                </VenueRow>
              )
            }

            if (v.id === 'opensea') {
              return (
                <VenueRow
                  key={v.id}
                  venue={v}
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
      </Card>

      <Card aria-label="Find one NFT">
        <Eyebrow>Find one NFT</Eyebrow>
        <LookupRow
          onSubmit={(e) => {
            e.preventDefault()
            const id = lookup.trim().replace(/^#/, '')
            if (/^[0-9]{1,78}$/.test(id) && !busy) onOpenItem(id)
          }}
        >
          <Field
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            placeholder="Token number, e.g. 42"
            aria-label="Token number"
            inputMode="numeric"
          />
          <PushButton type="submit" disabled={busy || !/^#?[0-9]{1,78}$/.test(lookup.trim())}>
            Open
          </PushButton>
        </LookupRow>
        <Prose style={{ fontSize: text.xs, color: color.inkMuted }}>
          See where one NFT is listed, its best offer, and buy or sell it.
        </Prose>
      </Card>
      <div style={{ height: space[3] }} />

      {(buyPicks.length > 0 || sellIds.length > 0) && (
        <ActionDock aria-label="Batch" data-batch-bar>
          {(['buy', 'sell'] as const).map((side) => {
            const summary = side === 'buy' ? buySummary : sellSummary
            const count = side === 'buy' ? buyPicks.length : sellIds.length
            if (!count) return null
            const waiting = side === 'sell' && routing
            return (
              <Bar key={side} data-batch-side={side}>
                <strong aria-live="polite">
                  {summary.words || `${count} ticked, none can be sold right now`}
                  {side === 'sell' && summary.count > 0 && !waiting && count > summary.count
                    ? ` · ${count - summary.count} with no buyer, left out`
                    : ''}
                  {waiting ? ' · checking bids…' : ''}
                </strong>
                <LinkButton
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (side === 'buy') setBuyTicks([])
                    else {
                      setSellTicks([])
                      setVenueChoice({})
                    }

                    setFull(undefined)
                  }}
                >
                  Clear
                </LinkButton>
                <PushButton
                  type="button"
                  disabled={busy || !!ticket?.busy || waiting || !summary.count}
                  onClick={() => reviewBatch(side)}
                  data-batch-review-open
                >
                  Review {side === 'buy' ? 'buy' : 'sale'}
                </PushButton>
              </Bar>
            )
          })}
          {full && (
            <Hint role="status" data-batch-full>
              {full.words}
            </Hint>
          )}
          {sellIds.length > 0 && sellBatch.some((p) => p.venue === 'pool') && (
            <Hint>A pool pays in its own token, not ETH. Turning it into ETH is a separate swap.</Hint>
          )}
        </ActionDock>
      )}
    </>
  )
}
