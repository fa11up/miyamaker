import { useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { MarketListing, MarketSale } from '../../../../api/_lib/market'
import { MARKET_PREFIX } from '../../../../api/_lib/market'
import type {
  GalleryItem,
  OsCollection,
  OsNft,
  OsOrder,
  OsSearchHit,
  OsStats,
  OwnedGroup,
  Price,
  TraitCounts,
} from './markets'
import {
  accountNftsPage,
  groupAccountNfts,
  OPENSEA_CHAIN,
  parseCollection,
  parseCollectionNfts,
  parseNft,
  parseOfferAggregate,
  parseOrder,
  parseSearch,
  parseStats,
  parseTraitCounts,
} from './markets'
import { goneHashes, sessionStore } from './sweep'

/** Same-origin proxy (Cloudflare Worker in prod, Vite middleware in dev). The OpenSea key stays server-side. */
const PROXY = '/api/opensea'

export class MarketError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message)
  }

  /** No key, or no /api route at all (static preview): show link-outs and a quiet note. */
  get needsKey() {
    return this.code === 'MARKET_NOT_CONFIGURED'
  }
}

async function call(init: { query: Record<string, string>; body?: unknown; signal?: AbortSignal }): Promise<unknown> {
  const qs = new URLSearchParams(init.query)
  let res: Response
  try {
    res = await fetch(`${PROXY}?${qs}`, {
      method: init.body ? 'POST' : 'GET',
      signal: init.signal,
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new MarketError('Could not reach the market service.', 'NETWORK', 0)
  }

  const text = await res.text()
  let body: any
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    // A static host with no /api route answers index.html: same as "not set up".
    throw new MarketError('The market is unavailable right now.', 'MARKET_NOT_CONFIGURED', res.status)
  }

  if (!res.ok)
    throw new MarketError(body?.message || 'The market request failed.', body?.name || `HTTP_${res.status}`, res.status)
  return body
}

const get = (query: Record<string, string>, signal?: AbortSignal) => call({ query, signal })

/** `undefined` for "OpenSea has no such thing" instead of an error. */
const orNone = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p
  } catch (e) {
    if (e instanceof MarketError && e.code === 'NOT_FOUND') return null
    throw e
  }
}

const retry = (count: number, e: unknown) =>
  count < 1 && !(e instanceof MarketError && (e.needsKey || e.status === 400 || e.status === 404 || e.status === 429))

const common = { staleTime: 30_000, retry, refetchOnWindowFocus: false } as const

const needsKey = (...errors: unknown[]) => errors.some((e) => e instanceof MarketError && e.needsKey)

/**
 * Whether the server has an OpenSea key. Asked once; keyed requests wait for it and are skipped without one, so a
 * keyless site makes no failing calls. A host with no /api route (static preview) counts as "no key".
 */
export function useOpenSeaConfigured() {
  const q = useQuery({
    queryKey: ['os-status'],
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      try {
        const j = (await get({ op: 'status' }, signal)) as { configured?: unknown }
        return j?.configured === true
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        return false
      }
    },
  })
  return { configured: q.data === true, known: q.data !== undefined }
}

/** A collection on OpenSea by contract: slug, details and stats. */
export function useOpenSeaCollection(chainId: number, address: string | undefined, slugHint?: string) {
  const chain = OPENSEA_CHAIN[chainId]
  const { configured, known } = useOpenSeaConfigured()
  const slugQ = useQuery({
    queryKey: ['os-contract', chain, address?.toLowerCase()],
    enabled: !!chain && !!address && !slugHint,
    ...common,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const j = (await orNone(get({ op: 'contract', chain: chain!, address: address! }, signal))) as any
      return typeof j?.collection === 'string' && j.collection ? (j.collection as string) : null
    },
  })
  const slug = slugHint || slugQ.data || undefined
  const info = useQuery({
    queryKey: ['os-collection', slug],
    enabled: !!slug,
    ...common,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }): Promise<OsCollection | null> =>
      parseCollection(await orNone(get({ op: 'collection', slug: slug! }, signal))) || null,
  })
  const stats = useQuery({
    queryKey: ['os-stats', slug],
    enabled: !!slug,
    ...common,
    queryFn: async ({ signal }): Promise<OsStats> =>
      parseStats(await orNone(get({ op: 'stats', slug: slug! }, signal))),
  })
  const offer = useQuery({
    queryKey: ['os-offer', slug],
    enabled: !!slug && configured,
    ...common,
    queryFn: async ({ signal }): Promise<{ price: Price; count: number } | null> =>
      parseOfferAggregate(await orNone(get({ op: 'offers', slug: slug! }, signal))) || null,
  })
  return {
    supported: !!chain,
    slug,
    info: info.data ?? undefined,
    stats: stats.data,
    bestOffer: offer.data ?? undefined,
    /** OpenSea answered: this contract is not a collection there. */
    missing: slugQ.data === null,
    loading: slugQ.isLoading || info.isLoading || stats.isLoading,
    offerLoading: offer.isLoading && configured,
    /** The server has no key: show link-outs and the quiet note. */
    needsKey: (known && !configured) || needsKey(slugQ.error, stats.error, offer.error),
    error: [slugQ.error, info.error, stats.error].find((e) => e && !needsKey(e)) as Error | undefined,
    /** Ask again after a failure: only what failed is asked. */
    refetch: () => {
      ;[slugQ, info, stats, offer].filter((q) => q.isError).forEach((q) => q.refetch())
    },
  }
}

/** One row of the market table: details and stats by known slug, no contract lookup and no offers (fewer requests). */
export function useCollectionRow(slug: string | undefined) {
  const info = useQuery({
    queryKey: ['os-collection', slug],
    enabled: !!slug,
    ...common,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }): Promise<OsCollection | null> =>
      parseCollection(await orNone(get({ op: 'collection', slug: slug! }, signal))) || null,
  })
  const stats = useQuery({
    queryKey: ['os-stats', slug],
    enabled: !!slug,
    ...common,
    queryFn: async ({ signal }): Promise<OsStats> =>
      parseStats(await orNone(get({ op: 'stats', slug: slug! }, signal))),
  })
  return {
    info: info.data ?? undefined,
    stats: stats.data,
    loading: info.isLoading || stats.isLoading,
    /** The stats could not be read: its numbers are unknown, not zero. */
    error: (stats.error && !needsKey(stats.error) ? stats.error : undefined) as Error | undefined,
  }
}

/**
 * Whether each collection has OpenSea's badge, by slug: true, false, or undefined while unknown. The search results may
 * not say, so this reads each collection's details (the same cached query as everywhere else).
 */
export function useCollectionsVerified(slugs: readonly string[]) {
  const results = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: ['os-collection', slug],
      ...common,
      staleTime: 5 * 60_000,
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<OsCollection | null> =>
        parseCollection(await orNone(get({ op: 'collection', slug }, signal))) || null,
    })),
  })
  const verified: Record<string, boolean | undefined> = {}
  slugs.forEach((slug, i) => {
    const r = results[i]
    // OpenSea said there is no such collection: not verified. A failed lookup is unknown, so no badge either way.
    verified[slug] = r?.data ? r.data.verified : r?.data === null ? false : undefined
  })
  return verified
}

/** A row as the server sends it. Rows cached before ERC-1155 quantities were read have no `quantity` or `unitPrice`. */
type MarketRow = Omit<MarketListing, 'quantity' | 'unitPrice'> & Partial<Pick<MarketListing, 'quantity' | 'unitPrice'>>

type MarketListings = {
  at: number
  stale: boolean
  count: number
  sources: Record<string, number>
  /** `price` is the floor order's whole price; `unitPrice` (when it sells several) is the floor for one. */
  floor: { price: string; unitPrice?: string; quantity?: number; tokenId: string; source: string } | null
  listings: MarketRow[]
}
type MarketSales = {
  at: number
  stale: boolean
  day: { count: number; volume: string; other?: number }
  sales: MarketSale[]
}

async function market<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${MARKET_PREFIX}/${path}`, { signal }).catch((e) => {
    if ((e as Error).name === 'AbortError') throw e
    throw new MarketError('Could not reach the market service.', 'NETWORK', 0)
  })
  const text = await res.text().catch(() => '')
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : undefined
  } catch {
    parsed = undefined
  }
  const body = (parsed && typeof parsed === 'object' ? parsed : undefined) as
    | (T & { name?: unknown; message?: unknown })
    | undefined
  if (!res.ok) {
    const message = typeof body?.message === 'string' ? body.message : 'The market request failed.'
    const name = typeof body?.name === 'string' ? body.name : `HTTP_${res.status}`
    throw new MarketError(message, name, res.status)
  }
  // A host with no /api/market route answers index.html; a cut-off reply is not JSON either.
  if (!body) throw new MarketError('The market is unavailable right now.', 'BAD_RESPONSE', res.status)
  return body
}

/**
 * A market row as the buy flow's order. Prices are wei; only ETH and WETH have 18 decimals we can be sure of here.
 * `price` is per item (an ERC-1155 order selling five at 5 ETH is 1 ETH each); `total` is what filling it costs.
 */
const toOrder = (l: MarketRow): OsOrder => {
  const quantity = typeof l.quantity === 'number' && l.quantity > 1 ? l.quantity : 1
  const whole = { amount: BigInt(l.price), decimals: 18, symbol: l.currency }
  return {
    hash: l.hash ?? '',
    chain: 'ethereum',
    protocolAddress: l.protocol ?? '',
    price: { ...whole, amount: BigInt(l.unitPrice ?? l.price) },
    ...(quantity > 1 ? { total: whole } : {}),
    tokenId: l.tokenId,
    maker: l.seller ?? undefined,
    remaining: quantity,
  }
}

/**
 * One collection's merged market from our server (api/_lib/market.ts): each NFT once at its cheapest, cheapest first,
 * shared by every visitor. Rows that failed to buy here in the last while are left out (sweep.ts `goneHashes`).
 */
export function useMarketListings(slug: string | undefined) {
  const q = useQuery({
    queryKey: ['market-listings', slug],
    enabled: !!slug,
    ...common,
    queryFn: ({ signal }) => market<MarketListings>(`listings?slug=${encodeURIComponent(slug!)}`, signal),
  })
  const gone = goneHashes(sessionStore())
  const rows = q.data ? (Array.isArray(q.data.listings) ? q.data.listings : []) : undefined
  const listings = rows
    ?.filter((l) => l.hash && !gone.has(l.hash) && ['ETH', 'WETH'].includes(l.currency))
    .map(toOrder)
  return {
    listings,
    /** The cheapest one in ETH across every source, per item (the server sorts by `unitPrice ?? price`). */
    floor: listings?.find((l) => l.price.symbol === 'ETH')?.price,
    stale: !!q.data?.stale,
    loading: !!slug && q.isLoading,
    needsKey: needsKey(q.error),
    error: q.error,
    refetch: q.refetch,
  }
}

/** The week's sales, newest first, each with its transaction. */
export function useMarketSales(slug: string | undefined) {
  const q = useQuery({
    queryKey: ['market-sales', slug],
    enabled: !!slug,
    ...common,
    queryFn: ({ signal }) => market<MarketSales>(`sales?slug=${encodeURIComponent(slug!)}`, signal),
  })
  const sales = q.data ? (Array.isArray(q.data.sales) ? q.data.sales : []) : undefined
  return { sales, day: q.data?.day, loading: !!slug && q.isLoading, error: q.error }
}

/** One NFT on OpenSea: details, its best listing and best offer. */
export function useOpenSeaItem(
  chainId: number,
  address: string | undefined,
  slug: string | undefined,
  id: string | undefined
) {
  const chain = OPENSEA_CHAIN[chainId]
  const { configured, known } = useOpenSeaConfigured()
  const nft = useQuery({
    queryKey: ['os-nft', chain, address?.toLowerCase(), id],
    enabled: !!chain && !!address && !!id && configured,
    ...common,
    queryFn: async ({ signal }): Promise<OsNft | null> =>
      parseNft(await orNone(get({ op: 'nft', chain: chain!, address: address!, id: id! }, signal))) || null,
  })
  const listing = useQuery({
    queryKey: ['os-nft-listing', slug, id],
    enabled: !!slug && !!id && configured,
    ...common,
    queryFn: async ({ signal }): Promise<OsOrder | null> =>
      parseOrder(await orNone(get({ op: 'nft_listing', slug: slug!, id: id! }, signal))) || null,
  })
  const offer = useQuery({
    queryKey: ['os-nft-offer', slug, id],
    enabled: !!slug && !!id && configured,
    ...common,
    queryFn: async ({ signal }): Promise<OsOrder | null> =>
      parseOrder(await orNone(get({ op: 'nft_offer', slug: slug!, id: id! }, signal))) || null,
  })
  return {
    nft: nft.data ?? undefined,
    listing: listing.data ?? undefined,
    offer: offer.data ?? undefined,
    loading: !known || (configured && (listing.isLoading || offer.isLoading)),
    needsKey: (known && !configured) || needsKey(listing.error, offer.error),
    /** OpenSea could not be asked: "not listed" or "no offers" would be a guess. */
    error: [listing.error, offer.error].find((e) => e && !needsKey(e)) as Error | undefined,
    refetch: () => {
      listing.refetch()
      offer.refetch()
      nft.refetch()
    },
  }
}

/** One NFT's picture from OpenSea (its cached copy works where the metadata host blocks browsers). */
export function useOpenSeaNftImage(chainId: number, address: string | undefined, id: string | undefined) {
  const chain = OPENSEA_CHAIN[chainId]
  const { configured } = useOpenSeaConfigured()
  const q = useQuery({
    queryKey: ['os-nft', chain, address?.toLowerCase(), id],
    enabled: !!chain && !!address && !!id && configured,
    ...common,
    queryFn: async ({ signal }): Promise<OsNft | null> =>
      parseNft(await orNone(get({ op: 'nft', chain: chain!, address: address!, id: id! }, signal))) || null,
  })
  return q.data?.image
}

/** Collection search by name on OpenSea (needs the key). Waits for typing to pause. */
export function useOpenSeaSearch(chainId: number, query: string) {
  const chain = OPENSEA_CHAIN[chainId]
  const { configured, known } = useOpenSeaConfigured()
  const [q, setQ] = useState(query)
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 350)
    return () => clearTimeout(t)
  }, [query])
  const wanted = !!chain && q.length >= 2 && !/^0x/i.test(q)
  const enabled = wanted && configured
  const r = useQuery({
    queryKey: ['os-search', chain, q.toLowerCase()],
    enabled,
    ...common,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }): Promise<OsSearchHit[]> =>
      parseSearch(await orNone(get({ op: 'search', query: q, chain: chain! }, signal))),
  })
  return {
    hits: enabled ? r.data || [] : [],
    // Still waiting for typing to pause counts as loading, so "no results" can't flash up first.
    loading: q !== query.trim() || (enabled && r.isLoading),
    needsKey: wanted && ((known && !configured) || needsKey(r.error)),
    failed: enabled && r.isError && !needsKey(r.error),
    /** The search has answered, and found nothing. */
    empty: q === query.trim() && enabled && r.isSuccess && !r.data?.length,
  }
}

/** Pages of 100 read from OpenSea before the list is called partial. */
const OWNED_MAX_PAGES = 5

/**
 * The wallet's NFTs on this chain from OpenSea, grouped per collection (needs the key). Follows OpenSea's `next`
 * cursor; a server that refuses `next` (older deploy) or a cut-off read gives the pages so far with `partial`.
 */
export function useOpenSeaOwned(chainId: number, owner: string | undefined) {
  const chain = OPENSEA_CHAIN[chainId]
  const { configured, known } = useOpenSeaConfigured()
  const r = useQuery({
    queryKey: ['os-owned', chain, owner?.toLowerCase()],
    enabled: !!chain && !!owner && configured,
    ...common,
    queryFn: async ({ signal }): Promise<{ groups: OwnedGroup[]; partial: boolean }> => {
      const nfts: unknown[] = []
      let next: string | undefined
      for (let page = 0; page < OWNED_MAX_PAGES; page += 1) {
        const query: Record<string, string> = { op: 'account_nfts', chain: chain!, address: owner! }
        if (next) query.next = next
        let body: unknown
        try {
          // eslint-disable-next-line no-await-in-loop -- each page needs the previous page's cursor
          body = await orNone(get(query, signal))
        } catch (e) {
          // The first page failing is an error; a later page failing leaves what was read, marked partial.
          if (page === 0 || (e as Error).name === 'AbortError') throw e
          return { groups: groupAccountNfts({ nfts }), partial: true }
        }
        const p = accountNftsPage(body)
        nfts.push(...p.nfts)
        next = p.next
        if (!next) return { groups: groupAccountNfts({ nfts }), partial: false }
      }
      return { groups: groupAccountNfts({ nfts }), partial: true }
    },
  })
  return {
    groups: r.data?.groups,
    /** OpenSea has more of this wallet's NFTs than were read. */
    partial: !!r.data?.partial,
    loading: r.isLoading && !!chain && !!owner && configured,
    needsKey: (known && !configured) || needsKey(r.error),
    /** OpenSea could not be asked: an empty list would be a guess. */
    error: (r.error && !needsKey(r.error) ? r.error : undefined) as Error | undefined,
  }
}

/** Resolve a slug (from search) to the contract on this chain. */
export async function contractForSlug(slug: string, chainId: number): Promise<string | undefined> {
  const info = parseCollection(await get({ op: 'collection', slug }))
  const chain = OPENSEA_CHAIN[chainId]
  return info?.contracts.find((c) => c.chain === chain)?.address
}

/** OpenSea's fulfillment data for one order. POST, never cached. */
export function fetchFulfillment(
  op: 'fulfill_listing' | 'fulfill_offer',
  body: Record<string, string | boolean>,
  signal?: AbortSignal
): Promise<unknown> {
  return call({ query: { op }, body, signal })
}

/** How many NFTs hold each trait value in a collection (OpenSea /traits), for rarity in the viewer. */
export function useCollectionTraits(slug: string | undefined) {
  const { configured } = useOpenSeaConfigured()
  const q = useQuery({
    queryKey: ['os-traits', slug],
    enabled: !!slug && configured,
    ...common,
    staleTime: 10 * 60_000,
    queryFn: async ({ signal }): Promise<TraitCounts> =>
      parseTraitCounts(await orNone(get({ op: 'traits', slug: slug! }, signal))),
  })
  return q.data
}

/**
 * The collection's NFTs, all of them, a page of 50 at a time (OpenSea /collection/<slug>/nfts). `more` loads the next
 * page; `done` says there is none. Pages are kept in order; a failed page can be asked again.
 */
export function useCollectionGallery(slug: string | undefined) {
  const { configured, known } = useOpenSeaConfigured()
  const [pages, setPages] = useState<{ items: GalleryItem[]; next?: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>()
  const load = async (cursor?: string, reset = false) => {
    if (!slug || !configured) return
    setLoading(true)
    setError(undefined)
    try {
      const page = parseCollectionNfts(
        await get({ op: 'collection_nfts', slug, ...(cursor ? { next: cursor } : {}) })
      )
      setPages((all) => (reset ? [page] : [...all, page]))
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    setPages([])
    if (slug && configured) load(undefined, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, configured])
  const last = pages[pages.length - 1]
  return {
    items: pages.flatMap((p) => p.items),
    loading: !known || loading,
    needsKey: (known && !configured) || needsKey(error),
    error: error && !needsKey(error) ? (error as Error) : undefined,
    done: pages.length > 0 && !last?.next,
    more: () => (last?.next && !loading ? load(last.next) : undefined),
  }
}

/** One NFT's sales in the last week (from the collection's sales feed), newest first. */
export function useItemSales(slug: string | undefined, tokenId: string | undefined) {
  const { sales, loading, error } = useMarketSales(slug)
  return {
    sales: tokenId && sales ? sales.filter((s) => s.tokenId === tokenId) : undefined,
    loading,
    error,
  }
}
