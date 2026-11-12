/**
 * The terminal's activity feed: sales across the watchlist's collections and Miyamaker's mints, newest first.
 * No runtime imports, so `node --test` can load it (tests/terminal-activity.test.mts).
 */

export type ActivitySale = {
  tokenId: string
  /** Wei, as a string. */
  price: string
  currency: string
  /** Seconds. */
  at: number
  buyer: string
  seller: string
  tx: string
}

export type ActivityRow = {
  key: string
  kind: 'sale' | 'mint'
  /** Seconds; undefined for a mint seen before the page was open (its time is not known). */
  at?: number
  chainId: number
  address: string
  ticker: string
  tokenId: string
  price?: string
  currency?: string
  from?: string
  to?: string
  tx?: string
}

export function mergeActivity(
  sales: readonly {
    collection: { chainId: number; address: string; ticker: string }
    sales?: readonly ActivitySale[]
  }[],
  mints: readonly { chainId: number; address: string; ticker: string; tokenId: string; at?: number }[],
  max = 200
): ActivityRow[] {
  const saleRows: ActivityRow[] = sales.flatMap(({ collection, sales: list }) =>
    (list ?? [])
      .filter((s) => /^[0-9]{1,78}$/.test(s.tokenId) && Number.isFinite(s.at))
      .map((s) => ({
        key: `sale:${s.tx}:${collection.address.toLowerCase()}:${s.tokenId}`,
        kind: 'sale' as const,
        at: s.at,
        chainId: collection.chainId,
        address: collection.address,
        ticker: collection.ticker,
        tokenId: s.tokenId,
        price: s.price,
        currency: s.currency,
        from: s.seller,
        to: s.buyer,
        tx: s.tx,
      }))
  )
  const mintRows: ActivityRow[] = mints.map((m) => ({
    key: `mint:${m.address.toLowerCase()}:${m.tokenId}`,
    kind: 'mint' as const,
    ...m,
  }))
  // The same sale or mint twice (two reads, or two pages) appears once.
  const rows = [...saleRows, ...mintRows].filter((r, i, all) => all.findIndex((x) => x.key === r.key) === i)

  // Newest first; mints with no known time go after the timed rows, highest id first. The cap applies to sales and
  // mints separately, so a busy week of sales never pushes every mint off the list.
  const sorted = rows.sort((a, b) => {
    if (a.at !== undefined && b.at !== undefined) return b.at - a.at
    if (a.at !== undefined) return -1
    if (b.at !== undefined) return 1
    return Number(b.tokenId) - Number(a.tokenId)
  })
  const kept = { sale: 0, mint: 0 }
  return sorted.filter((r) => {
    kept[r.kind] += 1
    return kept[r.kind] <= max
  })
}

/** Decimals of a sale price in a currency the market service names: USDC and USDT have 6 decimals, the rest 18. */
export const saleDecimals = (currency: string | undefined) => (/^(usdc|usdt)$/i.test(currency ?? '') ? 6 : 18)

/** A transaction hash fit for an explorer link; anything else gets no link. */
export const isTxHash = (tx: string | undefined): tx is string => !!tx && /^0x[0-9a-fA-F]{64}$/.test(tx)

/** "18:02" today, "Nov 11 18:02" before today (UTC, like the clock). */
export function activityTime(at: number | undefined, nowSeconds: number): string {
  if (at === undefined) return 'earlier'
  const d = new Date(at * 1000)
  const hm = d.toISOString().slice(11, 16)
  const sameDay = new Date(nowSeconds * 1000).toISOString().slice(0, 10) === d.toISOString().slice(0, 10)
  if (sameDay) return hm
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  return `${month} ${d.getUTCDate()} ${hm}`
}

/** Ids minted between two reads of totalSupply (ids count up from 1), newest `cap` of them. Nothing when it went down
 *  or did not move. */
export function newlyMinted(before: number | undefined, after: number | undefined, cap = 200): string[] {
  if (before === undefined || after === undefined || after <= before) return []
  const from = Math.max(before + 1, after - cap + 1)
  return Array.from({ length: after - from + 1 }, (_, i) => String(from + i))
}
