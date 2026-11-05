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
  return `$${n.toPrecision(3)}`
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

export function formatChange(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '–'
  if (Math.abs(n) < 0.05) return '0.0%'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

/** Anything that rounds to 0.0% reads flat, neither red nor green. */
export const changeTone = (n: number | undefined): 'up' | 'down' | 'flat' =>
  n === undefined || Math.abs(n) < 0.05 ? 'flat' : n > 0 ? 'up' : 'down'

/** A few collections to start from. Slugs and contracts checked against OpenSea and the chain, 2026-11-05. */
export const FEATURED_COLLECTIONS = [
  { slug: 'miyamaker-mini', name: 'miyamaker mini', address: '0x375a1911c0c2982f59826c227b7830e5d5985d59' },
  { slug: 'milady', name: 'Milady Maker', address: '0x5Af0D9827E0c53E4799BB226655A1de152A425a5' },
  { slug: 'remilio-babies', name: 'Remilio Babies', address: '0xD3D9ddd0CF0A5F0BFB8f7fcEAe075DF687eAEBaB' },
  { slug: 'pixeladymaker', name: 'Pixelady Maker', address: '0x8Fc0D90f2C45a5e7f94904075c952e0943CFCCfd' },
] as const
