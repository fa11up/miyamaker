/**
 * Pair tokens for MiyaPool pool tokens, and the price of one pool token in each pair, through the same 0x price
 * path the Tokens tab uses (api.ts → /api/0x proxy). No imports, so `node --test` can load it (tests/pairs.test.mts).
 *
 * Pairs are ETH, imdUSD, IMD and INFER, where the curated token list has them on that chain (tokenList.ts): all four
 * on Ethereum, only ETH on Robinhood Chain. Sepolia has no swap (0x does not serve it), so no pairs there.
 *
 * One pool token backs one NFT, so its price is the price of an NFT from the pool:
 *   Sell (bid): 0x price for selling exactly 1 pool token for the pair. What one NFT sold into the pool is worth.
 *   Buy (ask):  0x price for selling that bid amount of the pair back for pool tokens; the rate gives the cost of
 *               one pool token at about that size. What it costs to take one NFT out.
 * A pair with no 0x route says so (no-route); it is not an error.
 */

/** 1 pool token = 1 NFT = 1e18 base units (POOL_UNIT in pool.ts; repeated so this file has no imports). */
const POOL_UNIT = 10n ** 18n

export const PAIR_SYMBOLS = ['ETH', 'imdUSD', 'IMD', 'INFER'] as const
export type PairSymbol = (typeof PAIR_SYMBOLS)[number]
export const DEFAULT_PAIR_SYMBOL: PairSymbol = 'ETH'

/** Chains with a swap (0x). Mirrors SWAP_CHAINS in constants.ts. */
export const PAIR_CHAINS: readonly number[] = [1, 4663]

type PairCandidate = { chainId: number; symbol: string; address: string; decimals: number; blocked?: string }

/** The pair tokens in `list` for `chainId`, in PAIR_SYMBOLS order. Empty where there is no swap. */
export function pairTokens<T extends PairCandidate>(
  list: readonly T[],
  chainId: number
): (T & { symbol: PairSymbol })[] {
  if (!PAIR_CHAINS.includes(chainId)) return []
  return PAIR_SYMBOLS.map((s) => list.find((t) => t.chainId === chainId && t.symbol === s && !t.blocked)).filter(
    (t): t is T & { symbol: PairSymbol } => !!t
  )
}

/** The chosen pair if it exists on this chain, else ETH (or the first there is). */
export function pickPair<T extends { symbol: string }>(pairs: readonly T[], wanted: string | undefined): T | undefined {
  return pairs.find((p) => p.symbol === wanted) || pairs.find((p) => p.symbol === DEFAULT_PAIR_SYMBOL) || pairs[0]
}

/** "ETH, imdUSD, IMD or INFER". */
export function pairWords(symbols: readonly string[]): string {
  if (symbols.length <= 1) return symbols[0] || ''
  return `${symbols.slice(0, -1).join(', ')} or ${symbols.at(-1)}`
}

/* ---------- pricing ---------- */

/** The bits of a 0x /price answer used here. */
export type PriceAnswer = { liquidityAvailable: boolean; buyAmount?: string; sellAmount?: string }

export type PriceRequest = {
  chainId: number
  sellToken: `0x${string}`
  buyToken: `0x${string}`
  sellAmount: bigint
  slippageBps: number
}

export type PairQuote =
  | { status: 'ok'; symbol: string; decimals: number; bid: bigint; ask?: bigint }
  | { status: 'no-route'; symbol: string }

const SLIPPAGE_BPS = 50

const big = (v: string | undefined) => (v && /^[0-9]+$/.test(v) ? BigInt(v) : undefined)

/** Pair base units per whole pool token from a probe that sold `paid` of the pair for `got` pool-token units. */
export function askFromProbe(paid: bigint, got: bigint): bigint | undefined {
  if (paid <= 0n || got <= 0n) return undefined
  return (paid * POOL_UNIT + got - 1n) / got // round up: never understate the cost
}

/**
 * Price one pool token in one pair: two 0x price calls at most (bid, then the ask probe). `fetchPrice` is api.ts's
 * fetchPrice in the app; tests pass a fake. Errors (service down, not configured) are thrown for the caller.
 */
export async function quotePoolInPair(
  fetchPrice: (req: PriceRequest, signal?: AbortSignal) => Promise<PriceAnswer>,
  p: { chainId: number; pool: `0x${string}`; pair: { address: `0x${string}`; symbol: string; decimals: number } },
  signal?: AbortSignal
): Promise<PairQuote> {
  const sell = await fetchPrice(
    {
      chainId: p.chainId,
      sellToken: p.pool,
      buyToken: p.pair.address,
      sellAmount: POOL_UNIT,
      slippageBps: SLIPPAGE_BPS,
    },
    signal
  )
  const bid = sell.liquidityAvailable ? big(sell.buyAmount) : undefined
  if (!bid) return { status: 'no-route', symbol: p.pair.symbol }

  let ask: bigint | undefined
  const back = await fetchPrice(
    { chainId: p.chainId, sellToken: p.pair.address, buyToken: p.pool, sellAmount: bid, slippageBps: SLIPPAGE_BPS },
    signal
  ).catch(() => undefined)
  if (back?.liquidityAvailable) ask = askFromProbe(big(back.sellAmount) ?? bid, big(back.buyAmount) ?? 0n)
  return { status: 'ok', symbol: p.pair.symbol, decimals: p.pair.decimals, bid, ask }
}

/** How long a pool price stays fresh in the cache, and the pause before the first call on a page. */
export const PAIR_QUOTE_STALE_MS = 60_000
export const PAIR_QUOTE_DEBOUNCE_MS = 600
