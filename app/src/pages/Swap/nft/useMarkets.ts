import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { OsCollection, OsNft, OsOrder, OsSearchHit, OsStats, OwnedGroup, Price } from './markets'
import {
  groupAccountNfts,
  OPENSEA_CHAIN,
  parseCollection,
  parseListings,
  parseNft,
  parseOfferAggregate,
  parseOrder,
  parseSearch,
  parseStats,
} from './markets'

/** Same-origin proxy (Vercel function in prod, Vite middleware in dev). The OpenSea key stays server-side. */
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
    throw new MarketError('Marketplace prices need an API key.', 'MARKET_NOT_CONFIGURED', res.status)
  }

  if (!res.ok) throw new MarketError(body?.message || 'The market request failed.', body?.name || `HTTP_${res.status}`, res.status)
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

/** A collection on OpenSea by contract: slug, details and stats. */
export function useOpenSeaCollection(chainId: number, address: string | undefined, slugHint?: string) {
  const chain = OPENSEA_CHAIN[chainId]
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
    queryFn: async ({ signal }): Promise<OsStats> => parseStats(await orNone(get({ op: 'stats', slug: slug! }, signal))),
  })
  const offer = useQuery({
    queryKey: ['os-offer', slug],
    enabled: !!slug,
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
    offerLoading: offer.isLoading,
    needsKey: needsKey(slugQ.error, stats.error),
    offersNeedKey: needsKey(offer.error),
    error: [slugQ.error, info.error, stats.error].find((e) => e && !needsKey(e)) as Error | undefined,
  }
}

/** The cheapest OpenSea listings of a collection (price ascending). */
export function useOpenSeaListings(slug: string | undefined, limit = 6) {
  const q = useQuery({
    queryKey: ['os-listings', slug, limit],
    enabled: !!slug,
    ...common,
    queryFn: async ({ signal }): Promise<OsOrder[]> =>
      parseListings(await orNone(get({ op: 'listings', slug: slug!, limit: String(limit) }, signal))),
  })
  return { listings: q.data, loading: q.isLoading && !!slug, needsKey: needsKey(q.error), error: q.error, refetch: q.refetch }
}

/** One NFT on OpenSea: details, its best listing and best offer. */
export function useOpenSeaItem(chainId: number, address: string | undefined, slug: string | undefined, id: string | undefined) {
  const chain = OPENSEA_CHAIN[chainId]
  const nft = useQuery({
    queryKey: ['os-nft', chain, address?.toLowerCase(), id],
    enabled: !!chain && !!address && !!id,
    ...common,
    queryFn: async ({ signal }): Promise<OsNft | null> =>
      parseNft(await orNone(get({ op: 'nft', chain: chain!, address: address!, id: id! }, signal))) || null,
  })
  const listing = useQuery({
    queryKey: ['os-nft-listing', slug, id],
    enabled: !!slug && !!id,
    ...common,
    queryFn: async ({ signal }): Promise<OsOrder | null> =>
      parseOrder(await orNone(get({ op: 'nft_listing', slug: slug!, id: id! }, signal))) || null,
  })
  const offer = useQuery({
    queryKey: ['os-nft-offer', slug, id],
    enabled: !!slug && !!id,
    ...common,
    queryFn: async ({ signal }): Promise<OsOrder | null> =>
      parseOrder(await orNone(get({ op: 'nft_offer', slug: slug!, id: id! }, signal))) || null,
  })
  return {
    nft: nft.data ?? undefined,
    listing: listing.data ?? undefined,
    offer: offer.data ?? undefined,
    loading: listing.isLoading || offer.isLoading,
    needsKey: needsKey(listing.error, offer.error),
    refetch: () => {
      listing.refetch()
      offer.refetch()
      nft.refetch()
    },
  }
}

/** Collection search by name on OpenSea (needs the key). Waits for typing to pause. */
export function useOpenSeaSearch(chainId: number, query: string) {
  const chain = OPENSEA_CHAIN[chainId]
  const [q, setQ] = useState(query)
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 350)
    return () => clearTimeout(t)
  }, [query])
  const enabled = !!chain && q.length >= 2 && !/^0x/i.test(q)
  const r = useQuery({
    queryKey: ['os-search', chain, q.toLowerCase()],
    enabled,
    ...common,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }): Promise<OsSearchHit[]> => parseSearch(await orNone(get({ op: 'search', query: q, chain: chain! }, signal))),
  })
  return { hits: enabled ? r.data || [] : [], loading: enabled && r.isLoading, needsKey: needsKey(r.error) }
}

/** The wallet's NFTs on this chain from OpenSea, grouped per collection (needs the key). */
export function useOpenSeaOwned(chainId: number, owner: string | undefined) {
  const chain = OPENSEA_CHAIN[chainId]
  const r = useQuery({
    queryKey: ['os-owned', chain, owner?.toLowerCase()],
    enabled: !!chain && !!owner,
    ...common,
    queryFn: async ({ signal }): Promise<OwnedGroup[]> =>
      groupAccountNfts(await orNone(get({ op: 'account_nfts', chain: chain!, address: owner! }, signal))),
  })
  return { groups: r.data, loading: r.isLoading && !!chain && !!owner, needsKey: needsKey(r.error) }
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
