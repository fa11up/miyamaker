/**
 * Numbers for Trade's market boards. Token prices come from DexScreener (free, open to browsers, no key). No runtime
 * imports, so `node --test` can load it (tests/board.test.mts).
 */

export type DexPair = {
  baseToken?: { address?: string }
  priceUsd?: string
  priceChange?: { h24?: number }
  liquidity?: { usd?: number }
  volume?: { h24?: number }
}

export type TokenQuote = { priceUsd: number; change24h?: number; liquidityUsd?: number; volume24h?: number }

/** The token's price from its deepest pair, only where the token is the pair's base (the price is then the token's). */
export function quoteFrom(pairs: readonly DexPair[] | null | undefined, address: string): TokenQuote | undefined {
  const a = address.toLowerCase()
  const best = (pairs ?? [])
    .filter((p) => p.baseToken?.address?.toLowerCase() === a && Number(p.priceUsd) > 0)
    .sort((x, y) => (y.liquidity?.usd ?? 0) - (x.liquidity?.usd ?? 0))[0]
  if (!best) return undefined
  return {
    priceUsd: Number(best.priceUsd),
    change24h: best.priceChange?.h24,
    liquidityUsd: best.liquidity?.usd,
    volume24h: best.volume?.h24,
  }
}

/** $3,412 · $0.99 · $0.000796: enough digits to read a small price, none wasted on a big one. */
export function formatUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '–'
  if (n >= 1000) return `$${Math.round(n).toLocaleString('en-US')}`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n <= 0) return '$0'
  const short = n.toPrecision(3)
  // Dollars and cents read as such ($0.99, $0.50); three digits only where the third says something ($0.123).
  return `$${n >= 0.1 && short.endsWith('0') ? n.toFixed(2) : short}`
}

/** $64.1K · $1.2M, for liquidity and volume. */
export function formatCompactUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '–'
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n)}`
}

/** "≈ $1,557" for an ETH amount in wei, when the ETH price is known. */
export function ethInUsd(wei: bigint | undefined, ethUsd: number | undefined): string {
  if (wei === undefined || !ethUsd) return ''
  return `≈ ${formatUsd((Number(wei / 10n ** 12n) / 1e6) * ethUsd)}`
}

/**
 * ETH is priced from Ethereum everywhere, but its volume and liquidity there say nothing about another chain, so those
 * are dropped off Ethereum.
 */
export function quoteForChain<T extends { volume24h?: number; liquidityUsd?: number }>(
  quote: T | undefined,
  native: boolean,
  chainId: number,
): T | undefined {
  if (!quote || !native || chainId === 1) return quote
  return { ...quote, volume24h: undefined, liquidityUsd: undefined }
}

export type PriceStatus = 'live' | 'some' | 'off' | 'loading'

/** The header's lamp. "Live" only when every row has a price. */
export function priceStatus(rows: readonly { quote?: unknown }[], loading: boolean, failed: boolean): PriceStatus {
  const priced = rows.filter((r) => r.quote).length
  if (priced === rows.length && priced > 0) return 'live'
  if (loading) return 'loading'
  if (priced > 0) return 'some'
  return failed || rows.length > 0 ? 'off' : 'loading'
}

export const PRICE_STATUS_WORDS: Record<PriceStatus, string> = {
  live: '● PRICES LIVE',
  some: '● SOME PRICES',
  off: 'PRICES OFF',
  loading: '○ PRICES…',
}

export function formatChange(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '–'
  if (Math.abs(n) < 0.05) return '0.0%'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

/** Anything that rounds to 0.0% reads flat, neither red nor green. */
export const changeTone = (n: number | undefined): 'up' | 'down' | 'flat' =>
  n === undefined || Math.abs(n) < 0.05 ? 'flat' : n > 0 ? 'up' : 'down'

/**
 * Collections to start from, per chain. Slugs and contracts checked against OpenSea and the chain, 2026-11-06.
 * Robinhood Chain's list is hand-approved: most of what is there is unverified or copies of something else.
 */
export const FEATURED_COLLECTIONS = [
  { chainId: 1, slug: 'miyamaker', name: 'Miyamaker', address: '0xb86b68bca287afd48f81d1f792db69368664a120' },
  { chainId: 1, slug: 'miyamaker-mini', name: 'miyamaker mini', address: '0x375a1911c0c2982f59826c227b7830e5d5985d59' },
  { chainId: 1, slug: 'milady', name: 'Milady Maker', address: '0x5Af0D9827E0c53E4799BB226655A1de152A425a5' },
  { chainId: 1, slug: 'identitymd', name: 'Identity MD', address: '0x0000ec93127baa929e58e97dd0095a2bfb38ec1d' },
  { chainId: 1, slug: 'remilio-babies', name: 'Remilio Babies', address: '0xD3D9ddd0CF0A5F0BFB8f7fcEAe075DF687eAEBaB' },
  {
    chainId: 1,
    slug: 'sproto-gremlins',
    name: 'Sproto Gremlins',
    address: '0xeeca64ea9fcf99a22806cd99b3d29cf6e8d54925',
  },
  { chainId: 1, slug: 'schizoposters', name: 'SchizoPosters', address: '0xbfe47d6d4090940d1c7a0066b63d23875e3e2ac5' },
  {
    chainId: 1,
    slug: 'cigawrettepacks',
    name: 'Cigawrette Packs',
    address: '0xeed41d06ae195ca8f5cacace4cd691ee75f0683f',
  },
  { chainId: 4663, slug: 'quotrons404', name: 'Quotrons', address: '0x027aca2794e44f24950d81227dcd516ffbb49d6e' },
  {
    chainId: 4663,
    slug: 'chain-mancers',
    name: 'Chain Mancers',
    address: '0x797a2e030b7e49107c8f07bf0300ea9cae88ca57',
  },
] as const

export const featuredOn = (chainId: number) => FEATURED_COLLECTIONS.filter((c) => c.chainId === chainId)

/** Hand-checked collections carry no "not verified" warning, whatever OpenSea's badge says. */
export const isFeatured = (chainId: number, address: string | undefined) =>
  featuredOn(chainId).some((c) => c.address.toLowerCase() === address?.toLowerCase())

export const isFeaturedSlug = (chainId: number, slug: string | undefined) =>
  featuredOn(chainId).some((c) => c.slug === slug)

/** Rows known to have nothing for sale go last, otherwise in their own order. */
export const emptyLast = <T>(rows: readonly T[], isEmpty: (row: T) => boolean): T[] => [
  ...rows.filter((r) => !isEmpty(r)),
  ...rows.filter(isEmpty),
]

/** Verified and hand-checked first, then not yet known, then not verified; otherwise as found. */
export function verifiedFirst<T>(rows: readonly T[], verified: (row: T) => boolean | undefined): T[] {
  const rank = (r: T) => {
    const v = verified(r)
    return v === true ? 0 : v === undefined ? 1 : 2
  }
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.i - b.i)
    .map((x) => x.row)
}

/** "0x53d0…7921". */
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** "Last trade 5h ago" when the newest candle is older than two candles' length, else nothing. */
export function lastTradeWords(lastAt: number | undefined, candleSeconds: number, nowSeconds: number): string {
  if (!lastAt) return ''
  const age = nowSeconds - lastAt
  if (age < candleSeconds * 2) return ''
  if (age < 3600) return `Last trade ${Math.round(age / 60)}m ago`
  if (age < 2 * 86400) return `Last trade ${Math.round(age / 3600)}h ago`
  return `Last trade ${Math.round(age / 86400)}d ago`
}

export type DexMarket = {
  url?: string
  dexId?: string
  labels?: string[]
  pairAddress?: string
  chainId?: string
  baseToken?: { address?: string; name?: string; symbol?: string }
  quoteToken?: { address?: string; symbol?: string }
  priceUsd?: string
  priceNative?: string
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number }
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number }
  txns?: Record<string, { buys?: number; sells?: number } | undefined>
  liquidity?: { usd?: number }
  fdv?: number
  marketCap?: number
  pairCreatedAt?: number
  info?: { websites?: { url?: string; label?: string }[]; socials?: { url?: string; type?: string }[] }
}

/** A token's own markets, deepest first. A pair it is only the quote side of would chart some other token. */
export const marketsFor = (pairs: readonly DexMarket[] | null | undefined, address: string): DexMarket[] =>
  (pairs ?? [])
    .filter((p) => p.baseToken?.address?.toLowerCase() === address.toLowerCase() && !!p.pairAddress)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))

/** Buys as a whole percent of a window's trades, or undefined when nothing traded. */
export function buyShare(t: { buys?: number; sells?: number } | undefined): number | undefined {
  const buys = t?.buys ?? 0
  const total = buys + (t?.sells ?? 0)
  return total ? Math.round((buys / total) * 100) : undefined
}

/** "3d", "5mo", "2y": how long a pair has traded. */
export function formatAge(createdAt: number | undefined, now: number): string {
  if (!createdAt || createdAt > now) return '–'
  const days = (now - createdAt) / 86_400_000
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`
  if (days < 60) return `${Math.round(days)}d`
  if (days < 730) return `${Math.round(days / 30.44)}mo`
  return `${Math.round(days / 365.25)}y`
}

/** Http links only: this is what a token's creator typed into DexScreener. */
export function marketLinks(market: DexMarket | undefined): { label: string; url: string }[] {
  const https = (url?: string) => (url && /^https:\/\//i.test(url) ? url : undefined)
  const sites = (market?.info?.websites ?? []).flatMap((w) => {
    const url = https(w.url)
    return url ? [{ label: (w.label || 'Website').slice(0, 24), url }] : []
  })
  const socials = (market?.info?.socials ?? []).flatMap((s) => {
    const url = https(s.url)
    return url ? [{ label: (s.type || 'Link').slice(0, 24), url }] : []
  })
  return [...sites, ...socials]
}

export type SortDir = 'desc' | 'asc'
export type Sort<K extends string> = { key: K; dir: SortDir } | undefined

/** Pressing a column: biggest first, then smallest first, then back to the list's own order. */
export function nextSort<K extends string>(sort: Sort<K>, key: K): Sort<K> {
  if (sort?.key !== key) return { key, dir: 'desc' }
  return sort.dir === 'desc' ? { key, dir: 'asc' } : undefined
}

/** Sorted by a column, ties in their original order. Rows with no figure stay at the bottom whichever way it runs. */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: Sort<K>,
  value: (row: T, key: K) => number | undefined,
): T[] {
  if (!sort) return [...rows]
  const known = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n)
  const sign = sort.dir === 'desc' ? -1 : 1
  return rows
    .map((row, i) => ({ row, i, n: value(row, sort.key) }))
    .sort((a, b) => {
      if (!known(a.n) || !known(b.n)) return Number(known(b.n)) - Number(known(a.n)) || a.i - b.i
      return sign * (a.n - b.n) || a.i - b.i
    })
    .map((x) => x.row)
}
