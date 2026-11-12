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
    query: { enabled: chainId === HOUSE.chainId, refetchInterval: 30_000 },
  })
  const minted = typeof supply.data === 'bigint' ? Number(supply.data) : undefined
  // The supply when the page first read it: the mints before it are listed without a time.
  const [first, setFirst] = useState<number>()
  const last = useRef<number>()
  const [seen, setSeen] = useState<{ tokenId: string; at: number }[]>([])
  useEffect(() => {
    if (minted === undefined) return
    setFirst((f) => f ?? minted)
    const fresh = newlyMinted(last.current, minted)
    last.current = minted
    if (fresh.length) {
      const at = Math.floor(Date.now() / 1000)
      setSeen((s) => [...s, ...fresh.map((tokenId) => ({ tokenId, at }))])
    }
  }, [minted])

  const rows: ActivityRow[] = useMemo(() => {
    const house = { chainId: HOUSE.chainId, address: HOUSE.address, ticker: tickerOf(HOUSE) }
    const before = first
    const earlier =
      chainId === HOUSE.chainId && before
        ? Array.from({ length: Math.min(RECENT_MINTS, before) }, (_, i) => ({ ...house, tokenId: String(before - i) }))
        : []
    return mergeActivity(
      collections.map((c, i) => ({
        collection: { chainId: c.chainId, address: c.address, ticker: tickerOf(c) },
        sales: results[i]?.data?.sales,
      })),
      [...seen.map((m) => ({ ...house, ...m })), ...earlier]
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, seen, first, ...results.map((r) => r.dataUpdatedAt)])

  return {
    rows,
    loading: results.some((r) => r.isLoading),
    /** Collections whose sales could not be read: their rows are missing, not zero. */
    failed: collections.filter((_, i) => results[i]?.isError).map((c) => tickerOf(c)),
  }
}
