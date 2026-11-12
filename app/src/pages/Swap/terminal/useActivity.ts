import { useQueries } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useReadContract } from 'wagmi'

import { dropAbi } from '@/pages/Mint/dropAbi'

import { FEATURED_COLLECTIONS, featuredOn } from '../board'
import { marketSalesQuery } from '../nft/useMarkets'
import type { ActivityRow } from './activity'
import { mergeActivity, newlyMinted } from './activity'
import { tickerOf } from './command'

const HOUSE = FEATURED_COLLECTIONS.find((c) => c.slug === 'miyamaker')!
/** Mints shown from before the page opened (their time is unknown), newest ids. */
const RECENT_MINTS = 6
const POLL_SECONDS = 30
const MAX_SEEN = 400
/** The most sales the feed lists (newest first); the same cap holds for mints. */
export const ACTIVITY_MAX = 200

/**
 * The feed: the week's sales of every watchlist collection on this chain (the market service, refreshed with its own
 * cache), and Miyamaker's mints, read from its supply every 30 s. A mint seen grow while the page is open gets that
 * moment as its time; the last few before it are listed without one.
 */
export function useActivity(chainId: number) {
  const collections = featuredOn(chainId)
  const results = useQueries({
    queries: collections.map((c) => ({ ...marketSalesQuery(c.slug), refetchInterval: 60_000 })),
  })

  const supply = useReadContract({
    address: HOUSE.address,
    abi: dropAbi,
    functionName: 'totalSupply',
    chainId: HOUSE.chainId,
    query: { enabled: chainId === HOUSE.chainId, refetchInterval: POLL_SECONDS * 1000 },
  })
  const minted = typeof supply.data === 'bigint' ? Number(supply.data) : undefined
  // The supply when the page first read it: the mints before it are listed without a time.
  const [first, setFirst] = useState<number>()
  const last = useRef<{ supply: number; at: number }>()
  const [seen, setSeen] = useState<{ tokenId: string; at?: number }[]>([])
  // Mints that grew past the list's cap in one jump: counted, not listed.
  const [unlisted, setUnlisted] = useState(0)
  useEffect(() => {
    if (minted === undefined) return
    setFirst((f) => f ?? minted)
    const now = Math.floor(Date.now() / 1000)
    const prev = last.current
    const fresh = newlyMinted(prev?.supply, minted)
    last.current = { supply: minted, at: now }
    if (!fresh.length || !prev) return
    // Only a jump seen within one poll gets the moment it was seen as its time. After a gap (a hidden tab pauses the
    // reads) the time is not known: those mints are listed without one.
    const timed = now - prev.at <= POLL_SECONDS * 2.5
    setSeen((s) => [...s, ...fresh.map((tokenId) => ({ tokenId, at: timed ? now : undefined }))].slice(-MAX_SEEN))
    setUnlisted((n) => n + Math.max(0, minted - prev.supply - fresh.length))
  }, [minted])

  const rows: ActivityRow[] = useMemo(() => {
    const house = { chainId: HOUSE.chainId, address: HOUSE.address, ticker: tickerOf(HOUSE) }
    const before = first
    const earlier =
      chainId === HOUSE.chainId && before
        ? Array.from({ length: Math.min(RECENT_MINTS, before) }, (_, i) => ({ ...house, tokenId: String(before - i) }))
        : []
    const mints = chainId === HOUSE.chainId ? [...seen.map((m) => ({ ...house, ...m })), ...earlier] : []
    return mergeActivity(
      collections.map((c, i) => ({
        collection: { chainId: c.chainId, address: c.address, ticker: tickerOf(c) },
        sales: results[i]?.data?.sales,
      })),
      mints,
      ACTIVITY_MAX
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, seen, first, ...results.map((r) => r.dataUpdatedAt)])

  return {
    rows,
    loading: results.some((r) => r.isLoading),
    /** Collections whose sales could not be read: their rows are missing, not zero. */
    failed: collections.filter((_, i) => results[i]?.isError).map((c) => tickerOf(c)),
    /** Collections whose sales list was cut at the service's cap: older sales this week are missing. */
    partial: collections.filter((_, i) => results[i]?.data?.partial).map((c) => tickerOf(c)),
    /** More sales this week than the feed lists. */
    capped: results.reduce((n, r) => n + (r.data?.sales?.length ?? 0), 0) > ACTIVITY_MAX,
    /** Mints that landed in one jump bigger than the list keeps. */
    unlisted: chainId === HOUSE.chainId ? unlisted : 0,
  }
}
