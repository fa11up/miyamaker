/* eslint-disable no-restricted-syntax -- the sums read clearer as loops */
/**
 * Sweep: buy several of a collection's cheapest listings. Pure logic, so `node --test` can load it
 * (tests/sweep.test.mts).
 *
 * Each NFT is its own Seaport call, exactly as OpenSea returned it and checked by planFill, sent one after another.
 * Listings are not merged into one fulfillAvailable call on purpose: OpenSea's calls come in several shapes and some
 * are bound to the buyer, and rewriting them is where money could go wrong. So one wallet confirmation per NFT, and a
 * listing that sells first costs nothing but the attempt.
 */

/** The fulfillment route allows a burst of 10 per visitor (api/worker.ts); leave room for a normal buy after. */
export const MAX_SWEEP = 8

type Listing = {
  hash: string
  tokenId?: string
  maker?: string
  remaining: number
  price: { amount: bigint; symbol: string }
}

/**
 * What can be swept, cheapest first: priced in ETH (a token price would need its own approval), a single known NFT,
 * not your own listing, and each NFT once.
 */
export function sweepable<T extends Listing>(listings: readonly T[], me?: string): T[] {
  const seen = new Set<string>()
  return listings
    .filter((l) => {
      if (!l.tokenId || l.remaining < 1 || l.price.symbol !== 'ETH' || seen.has(l.tokenId)) return false
      if (me && l.maker?.toLowerCase() === me.toLowerCase()) return false
      seen.add(l.tokenId)
      return true
    })
    .sort((a, b) => (a.price.amount < b.price.amount ? -1 : a.price.amount > b.price.amount ? 1 : 0))
}

export const pickCheapest = <T>(list: readonly T[], count: number): T[] =>
  list.slice(0, Math.max(0, Math.min(count, MAX_SWEEP)))

export const sumPrices = (list: readonly { price: { amount: bigint } }[]) =>
  list.reduce((sum, l) => sum + l.price.amount, 0n)

export type SweepLine = { label: string; amount: bigint }

/** The checked plans added up: the one total the person agrees to, and who gets it. */
export function sweepTotals(plans: readonly { total: bigint; lines: readonly SweepLine[] }[]) {
  const byLabel = new Map<string, bigint>()
  let total = 0n
  for (const p of plans) {
    total += p.total
    for (const l of p.lines) byLabel.set(l.label, (byLabel.get(l.label) ?? 0n) + l.amount)
  }

  return { total, lines: [...byLabel].map(([label, amount]) => ({ label, amount })) }
}

/** Refused in the wallet: stop the whole sweep. Anything else fails only that NFT, and the sweep moves on. */
export const isWalletRefusal = (message: string) =>
  /user rejected|user denied|rejected the request|denied transaction/i.test(message)

export type ItemState = 'ready' | 'wallet' | 'pending' | 'bought' | 'gone' | 'failed' | 'stopped'

export const SWEEP_STATE_WORDS: Record<ItemState, string> = {
  ready: 'Ready',
  wallet: 'Confirm in wallet',
  pending: 'Waiting for the network',
  bought: 'Bought',
  gone: 'No longer available, skipped',
  failed: 'Failed, not bought',
  stopped: 'Not bought',
}
