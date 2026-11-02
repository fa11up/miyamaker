import { useQueries } from '@tanstack/react-query'
import { useDebounce } from 'usehooks-ts'
import type { Address } from 'viem'

import { fetchPrice, SwapApiError } from '../api'
import type { SwapToken } from '../constants'
import { isSwapChain, PINNED_TOKENS } from '../constants'
import type { Price } from './markets'
import type { PairQuote } from './pairs'
import { PAIR_QUOTE_DEBOUNCE_MS, PAIR_QUOTE_STALE_MS, pairTokens, quotePoolInPair } from './pairs'

/** The pair tokens (ETH, imdUSD, IMD, INFER) on this chain, as swap tokens. Empty on Sepolia. */
export const pairsFor = (chainId: number): SwapToken[] =>
  isSwapChain(chainId) ? pairTokens(PINNED_TOKENS[chainId], chainId) : []

export type PoolPrice =
  | { state: 'loading' }
  | { state: 'unconfigured' }
  | { state: 'error' }
  | ({ state: 'done' } & PairQuote)

/** A done pool price's buy (ask) or sell (bid) side as a Price, for bestQuote and formatPrice. */
export function poolSide(p: PoolPrice | undefined, side: 'ask' | 'bid'): Price | undefined {
  if (!p || p.state !== 'done' || p.status !== 'ok') return undefined
  const amount = p[side]
  return amount && amount > 0n ? { amount, decimals: p.decimals, symbol: p.symbol } : undefined
}

/**
 * The price of one pool token in `pair` for each pool, via 0x (see pairs.ts). Cached per chain, pool and pair for
 * a minute and never polled; the first call waits a moment so flicking through collections does not fire calls.
 */
export function usePoolPrices(
  chainId: number,
  pools: readonly Address[],
  pair: SwapToken | undefined
): Record<string, PoolPrice> {
  const key = pair && pools.length ? `${chainId}:${pair.address}:${pools.join(',')}` : ''
  const settled = useDebounce(key, PAIR_QUOTE_DEBOUNCE_MS)
  const ready = !!key && settled === key

  const results = useQueries({
    queries: pools.map((pool) => ({
      queryKey: ['pool-pair-price', chainId, pool.toLowerCase(), pair?.address.toLowerCase()],
      enabled: ready && !!pair,
      staleTime: PAIR_QUOTE_STALE_MS,
      gcTime: 5 * PAIR_QUOTE_STALE_MS,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        quotePoolInPair(fetchPrice, { chainId, pool, pair: pair! }, signal),
    })),
  })

  const out: Record<string, PoolPrice> = {}
  pools.forEach((pool, i) => {
    const r = results[i]
    out[pool.toLowerCase()] = r?.data
      ? { state: 'done', ...r.data }
      : r?.error
      ? r.error instanceof SwapApiError && r.error.notConfigured
        ? { state: 'unconfigured' }
        : { state: 'error' }
      : { state: 'loading' }
  })
  return out
}
