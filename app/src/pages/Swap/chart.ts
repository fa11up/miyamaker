/**
 * The sums behind Trade's price chart: GeckoTerminal's candles, cleaned up and fitted to a canvas. No imports, so
 * `node --test` can load it (tests/chart.test.mts).
 */
export type Candle = { at: number; open: number; high: number; low: number; close: number; volume: number }

export const TIMEFRAMES = [
  { id: '15m', span: 'minute', aggregate: 15, seconds: 900 },
  { id: '1h', span: 'hour', aggregate: 1, seconds: 3600 },
  { id: '4h', span: 'hour', aggregate: 4, seconds: 14_400 },
  { id: '1d', span: 'day', aggregate: 1, seconds: 86_400 },
] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

const NETWORKS: Record<string, string> = { ethereum: 'eth', robinhood: 'robinhood' }

/**
 * Asks for one token's price by address. Left to itself the API prices a pool's "base" as it sees it, which for WBTC's
 * deepest pool is crvUSD, at about a dollar.
 */
export function candlesUrl(chain: string, pool: string, token: string, tf: Timeframe): string | undefined {
  const network = NETWORKS[chain]
  if (!network || !/^0x[0-9a-fA-F]+$/.test(pool) || !/^0x[0-9a-fA-F]{40}$/.test(token)) return undefined
  return `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pool}/ohlcv/${tf.span}?aggregate=${tf.aggregate}&limit=180&currency=usd&token=${token}`
}

/** Oldest first, one per time, and nothing that can't be drawn. */
export function parseCandles(json: unknown): Candle[] {
  const list = (json as { data?: { attributes?: { ohlcv_list?: unknown } } })?.data?.attributes?.ohlcv_list
  if (!Array.isArray(list)) return []
  const byTime = new Map<number, Candle>()
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue
    const [at, open, high, low, close, volume] = row.map(Number) as [number, number, number, number, number, number]
    if (![at, open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) continue
    byTime.set(at, { at, open, high, low, close, volume: Number.isFinite(volume) && volume > 0 ? volume : 0 })
  }
  return [...byTime.values()].sort((a, b) => a.at - b.at)
}

/** The price range to draw, with a little air so the wicks don't touch the edges. A live price is kept in view. */
export function priceRange(candles: readonly Candle[], live?: number): { low: number; high: number } {
  if (!candles.length) return { low: 0, high: 1 }
  const extra = live !== undefined && Number.isFinite(live) && live > 0 ? [live] : []
  const low = Math.min(...candles.map((c) => c.low), ...extra)
  const high = Math.max(...candles.map((c) => c.high), ...extra)
  const air = (high - low || high * 0.02) * 0.06
  return { low: Math.max(0, low - air), high: high + air }
}

/**
 * The price to tag on the chart: the live one when it is in the same world as the candles, which a thin pool's old last
 * trade is. Twice or half away it is some other market's price, and drawing it would flatten the candles to a line.
 */
export function chartPrice(live: number | undefined, lastClose: number): number {
  if (live === undefined || !Number.isFinite(live) || live <= 0) return lastClose
  return live > lastClose * 2 || live < lastClose / 2 ? lastClose : live
}

/** Round price lines inside a range: 1, 2 or 5 times a power of ten. */
export function priceTicks(low: number, high: number, about = 5): number[] {
  const span = high - low
  if (!(span > 0)) return []
  const rough = span / about
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) as number
  const ticks: number[] = []
  // Counted in whole steps: adding a small step up over and over drifts.
  for (let i = Math.ceil(low / step); i * step <= high; i += 1) ticks.push(i * step)
  return ticks
}

/** Which candle an x position is over. */
export function candleAt(x: number, width: number, count: number): number | undefined {
  if (!count || width <= 0 || x < 0 || x >= width) return undefined
  return Math.min(count - 1, Math.floor((x / width) * count))
}
