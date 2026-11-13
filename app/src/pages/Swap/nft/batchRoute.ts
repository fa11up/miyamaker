/* eslint-disable no-restricted-syntax, no-continue -- routing reads clearer as loops with early skips */
/**
 * Batched NFT orders on the collection page: what is ticked, where each NFT goes, and what the bar says. Pure, with no
 * runtime imports, so `node --test` loads it directly (tests/batch-route.test.mts).
 *
 * A batch is one transaction per venue: one Seaport call for every OpenSea item (batch.ts), one call per MiyaPool
 * (poolBatch.ts). This file only decides which venue each ticked NFT goes to, and how the selection behaves:
 *
 * - Buys: the person ticks listings (OpenSea) and NFTs held by a pick-your-NFT pool. The venue is where it was ticked.
 * - Sells: each ticked NFT goes to its best ETH outcome: its best OpenSea bid (WETH, before fees) or a MiyaPool, which
 *   gives exactly 1 pool token, not ETH. A pool counts in ETH only through what 0x would pay for its token, and turning
 *   the token into ETH is a separate swap. The person can switch any NFT's venue.
 * - At most BATCH_MAX ticked per side: each OpenSea item needs its own fulfillment request, and the route allows a
 *   burst of 10 per visitor (batch.ts MAX_BATCH; tests check the two agree).
 */

/** Most NFTs ticked per side. Same as batch.ts MAX_BATCH (= sweep.ts MAX_SWEEP). */
export const BATCH_MAX = 8

export const FULL_WORDS = `A batch holds at most ${BATCH_MAX}. Untick one to add another.`

/** A price as markets.ts Price has it (only what routing needs). */
export type Amount = { amount: bigint; symbol: string; decimals?: number }

/** An OpenSea order as markets.ts OsOrder has it (only what routing needs). */
export type OrderLike = { hash: string; price: Amount; total?: Amount; tokenId?: string; remaining?: number }

/** One ticked NFT and the venue it goes through. `order` is the listing (buy) or the bid (sell). */
export type BatchPick<O extends OrderLike = OrderLike> =
  | { key: string; tokenId: string; venue: 'opensea'; order: O }
  | { key: string; tokenId: string; venue: 'pool'; pool: string }

/* ---------- selection ---------- */

/**
 * Ticks or unticks one. Ticking past `max` changes nothing and says why in `full`.
 */
export function togglePick<T extends { key: string }>(
  picks: readonly T[],
  pick: T,
  max = BATCH_MAX
): { picks: T[]; full?: string } {
  if (picks.some((p) => p.key === pick.key)) return { picks: picks.filter((p) => p.key !== pick.key) }
  if (picks.length >= max) return { picks: [...picks], full: FULL_WORDS }
  return { picks: [...picks, pick] }
}

/**
 * The Sweep: ticks `add` (the N cheapest) in place of whatever `replace` says to drop (the other OpenSea ticks),
 * keeping the rest (pool picks), never past `max`. Any of `add` already ticked counts once.
 */
export function preTick<T extends { key: string }>(
  picks: readonly T[],
  add: readonly T[],
  replace: (p: T) => boolean,
  max = BATCH_MAX
): { picks: T[]; full?: string } {
  const kept = picks.filter((p) => !replace(p))
  const out = [...kept]
  let full: string | undefined
  for (const p of add) {
    if (out.some((o) => o.key === p.key)) continue
    if (out.length >= max) {
      full = FULL_WORDS
      break
    }

    out.push(p)
  }

  return { picks: out, full }
}

/* ---------- amounts ---------- */

/** An amount that counts as ETH here: ETH or WETH, 18 decimals. Anything else is not compared with ETH. */
export const ethValue = (p: Amount | undefined): bigint | undefined =>
  p && (p.symbol === 'ETH' || p.symbol === 'WETH') && (p.decimals ?? 18) === 18 ? p.amount : undefined

/** What filling a listing costs: the whole order when it sells several (ERC-1155), else its price. */
export const orderCost = (o: OrderLike) => o.total ?? o.price

/** 1.5 ETH style, at most 4 decimals, trailing zeros dropped; tiny amounts say so rather than show 0. */
export function ethText(wei: bigint, max = 4): string {
  const neg = wei < 0n
  const v = neg ? -wei : wei
  const unit = 10n ** 18n
  const scale = 10n ** BigInt(max)
  const scaled = (v * scale + unit / 2n) / unit
  if (v > 0n && scaled === 0n) return `${neg ? '−' : ''}<0.${'0'.repeat(max - 1)}1`
  const whole = scaled / scale
  const frac = (scaled % scale).toString().padStart(max, '0').replace(/0+$/, '')
  return `${neg ? '−' : ''}${whole}${frac ? `.${frac}` : ''}`
}

/* ---------- sells: where each NFT goes ---------- */

/** A pool this collection's NFTs can be sold into. `ethBid`: what 0x pays in ETH for one of its tokens, if priced. */
export type PoolOption = { address: string; symbol: string; label: string; ethBid?: bigint }

export type SellOption<O extends OrderLike = OrderLike> = {
  /** 'opensea' or the pool's address. */
  venue: string
  /** Short name: "OpenSea bid", "MiyaPool (Pick)". */
  label: string
  /** What the person gets, in plain words. */
  gets: string
  /** The ETH outcome used to compare venues; undefined when it can't be compared (a pool token with no price). */
  eth?: bigint
  /** True for a pool: what arrives is a pool token, not ETH. */
  token: boolean
  /** Set when this venue can't take this NFT in this batch; the words say why. */
  blocked?: string
  /** OpenSea only: the bid. */
  bid?: O
}

export type SellRoute<O extends OrderLike = OrderLike> = {
  tokenId: string
  /** The venue it goes to; undefined when none can take it. */
  venue?: string
  options: SellOption<O>[]
  /** Its OpenSea bid is still being looked up: the route may change. */
  checking: boolean
  /** Why it has no venue, or a note on the one it has. */
  note?: string
}

/** One ticked NFT to sell, with its best OpenSea bid: an order, null for none (or none readable), undefined while asked. */
export type SellItem<O extends OrderLike = OrderLike> = { tokenId: string; bid: O | null | undefined }

export const POOL_TOKEN_NOTE = 'A pool gives 1 pool token, not ETH. Turning it into ETH is a separate swap.'

/**
 * Where each NFT goes. The default is the best ETH outcome among the venues that can take it; with no ETH figure to
 * compare, an OpenSea bid wins over a pool token, since a bid is money now. A venue the person picked (`choices`, by
 * token id) wins when that venue can take the NFT. One OpenSea bid fills one NFT per batch: a later NFT whose best bid is
 * the same order (a collection offer) can't use it here.
 */
export function routeSells<O extends OrderLike>(
  items: readonly SellItem<O>[],
  pools: readonly PoolOption[],
  choices: Readonly<Record<string, string>> = {}
): SellRoute<O>[] {
  const usedBid = new Map<string, string>()
  const out: SellRoute<O>[] = []
  for (const item of items) {
    const options: SellOption<O>[] = []
    if (item.bid) {
      const eth = ethValue(item.bid.price)
      const taken = usedBid.get(item.bid.hash.toLowerCase())
      options.push({
        venue: 'opensea',
        label: 'OpenSea bid',
        gets: `${eth !== undefined ? ethText(eth) : ethText(item.bid.price.amount)} ${
          item.bid.price.symbol
        } before fees`,
        eth,
        token: false,
        bid: item.bid,
        ...(taken
          ? { blocked: `Its best bid is already used by #${taken} in this batch. Sell it on its own after.` }
          : {}),
      })
    }

    for (const p of pools)
      options.push({
        venue: p.address.toLowerCase(),
        label: p.label,
        gets: p.ethBid !== undefined ? `1 ${p.symbol} (≈ ${ethText(p.ethBid)} ETH if swapped)` : `1 ${p.symbol}`,
        eth: p.ethBid,
        token: true,
      })

    const open = options.filter((o) => !o.blocked)
    const chosen = choices[item.tokenId]?.toLowerCase()
    let pick = chosen ? open.find((o) => o.venue === chosen) : undefined
    if (!pick) {
      const priced = open.filter((o) => o.eth !== undefined)
      // Highest ETH first; a tie goes to OpenSea (money now, not a token).
      priced.sort((a, b) => (a.eth! === b.eth! ? Number(a.token) - Number(b.token) : a.eth! > b.eth! ? -1 : 1))
      pick = priced[0] ?? open.find((o) => !o.token) ?? open[0]
    }

    if (pick?.venue === 'opensea' && item.bid) usedBid.set(item.bid.hash.toLowerCase(), item.tokenId)
    const blockedBid = options.find((o) => o.venue === 'opensea')?.blocked
    out.push({
      tokenId: item.tokenId,
      venue: pick?.venue,
      options,
      checking: item.bid === undefined,
      note: !pick
        ? blockedBid ?? (item.bid === undefined ? 'Checking bids…' : 'No bid and no pool for it right now.')
        : pick.token
        ? POOL_TOKEN_NOTE
        : undefined,
    })
  }

  return out
}

/** The picks a set of routes stands for, in order; NFTs with no venue are left out. */
export function sellPicks<O extends OrderLike>(routes: readonly SellRoute<O>[]): BatchPick<O>[] {
  const out: BatchPick<O>[] = []
  for (const r of routes) {
    const o = r.options.find((x) => x.venue === r.venue)
    if (!o) continue
    if (o.venue === 'opensea') out.push({ key: r.tokenId, tokenId: r.tokenId, venue: 'opensea', order: o.bid! })
    else out.push({ key: r.tokenId, tokenId: r.tokenId, venue: 'pool', pool: o.venue })
  }

  return out
}

/* ---------- what the bar says ---------- */

export type PoolTotal = { pool: string; symbol: string; count: number; eth?: bigint }

export type BatchSummary = {
  count: number
  /** OpenSea: ETH paid (buys) or bids before fees (sells), counting only ETH and WETH. */
  eth: bigint
  /** OpenSea items priced in another token, not in `eth`. */
  other: number
  /** Per pool: tokens paid (buys) or received (sells). */
  pools: PoolTotal[]
  /** Pools' token amounts in ETH where 0x prices them, else undefined. */
  poolEth?: bigint
  /** The one line for the bar. */
  words: string
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/**
 * The bar's words. Buys: "Buy 3 · 0.45 ETH + 1 MIYAP". Sells: "Sell 3 · ~0.42 WETH before fees + 1 MIYAP". Pool tokens
 * are named as tokens, never added into the ETH figure.
 */
export function batchSummary(
  side: 'buy' | 'sell',
  picks: readonly BatchPick[],
  pools: readonly { address: string; symbol: string; ethAsk?: bigint; ethBid?: bigint; pickFee?: boolean }[]
): BatchSummary {
  let eth = 0n
  let other = 0
  const byPool = new Map<string, PoolTotal>()
  for (const p of picks) {
    if (p.venue === 'opensea') {
      const v = ethValue(side === 'buy' ? orderCost(p.order) : p.order.price)
      if (v === undefined) other += 1
      else eth += v
    } else {
      const key = p.pool.toLowerCase()
      const info = pools.find((x) => x.address.toLowerCase() === key)
      const t = byPool.get(key) ?? { pool: key, symbol: info?.symbol ?? 'pool tokens', count: 0 }
      t.count += 1
      byPool.set(key, t)
    }
  }

  let poolEth: bigint | undefined = 0n
  for (const t of byPool.values()) {
    const info = pools.find((x) => x.address.toLowerCase() === t.pool)
    const each = side === 'buy' ? info?.ethAsk : info?.ethBid
    t.eth = each === undefined ? undefined : each * BigInt(t.count)
    poolEth = poolEth === undefined || t.eth === undefined ? undefined : poolEth + t.eth
  }

  const osCount = picks.filter((p) => p.venue === 'opensea').length
  const parts: string[] = []
  if (osCount - other > 0) parts.push(side === 'buy' ? `${ethText(eth)} ETH` : `~${ethText(eth)} WETH before fees`)
  if (other) parts.push(`${plural(other, 'order')} in another token`)
  for (const t of byPool.values()) {
    // Picks from a pool with a fee also pay it in IMD or INFER; it isn't priced in ETH here, so it is named.
    const fee = side === 'buy' && pools.find((x) => x.address.toLowerCase() === t.pool)?.pickFee
    parts.push(`${t.count} ${t.symbol}${fee ? ' + pick fee' : ''}`)
  }

  const verb = side === 'buy' ? 'Buy' : 'Sell'
  return {
    count: picks.length,
    eth,
    other,
    pools: [...byPool.values()],
    poolEth: byPool.size ? poolEth : undefined,
    words: picks.length ? `${verb} ${picks.length}${parts.length ? ` · ${parts.join(' + ')}` : ''}` : '',
  }
}

/* ---------- the review ---------- */

/** The venues of a batch in the order they run: OpenSea first, then each pool in the order first ticked. */
export function venuesOf(picks: readonly BatchPick[]): { venue: string; picks: BatchPick[] }[] {
  const out: { venue: string; picks: BatchPick[] }[] = []
  const at = (venue: string) => {
    let v = out.find((x) => x.venue === venue)
    if (!v) {
      v = { venue, picks: [] }
      if (venue === 'opensea') out.unshift(v)
      else out.push(v)
    }

    return v
  }

  for (const p of picks) at(p.venue === 'opensea' ? 'opensea' : p.pool.toLowerCase()).picks.push(p)
  return out
}

/**
 * Seconds before OpenSea's zone permission runs out at which the fulfillment data is fetched again before the wallet
 * opens: twice batch.ts EXPIRY_MARGIN_S (30), so the wallet has time to be signed in after the refresh.
 */
export const REFRESH_BEFORE_S = 60

export const needsRefresh = (expiresAt: number | undefined, now: number) =>
  expiresAt !== undefined && expiresAt - now < REFRESH_BEFORE_S

/**
 * Whether a fresh plan still says what the person agreed to: the same orders, paying no more (buys) or getting no less
 * (sells). Anything else is shown again rather than sent.
 */
export function sameDeal(
  side: 'buy' | 'sell',
  agreed: { keys: readonly string[]; total: bigint },
  fresh: { keys: readonly string[]; total: bigint }
): boolean {
  const a = [...agreed.keys].sort().join()
  const f = [...fresh.keys].sort().join()
  if (a !== f) return false
  return side === 'buy' ? fresh.total <= agreed.total : fresh.total >= agreed.total
}

/** batch.ts reasons, said for this screen. A shared collection bid reads "Already in this batch" there. */
export function excludedWords(reason: string, side: 'buy' | 'sell'): string {
  if (side === 'sell' && reason === 'Already in this batch.')
    return 'Its bid is already used by another NFT here. Sell it on its own after.'
  return reason
}

/**
 * What changed under an open review, or undefined. The review is made for one wallet: another account cancels it.
 * Moving off the right network once the wallet was on it cancels it too; arriving on it does not.
 */
export function reviewChange(
  start: { account?: string; onChain: boolean },
  now: { account?: string; chainId?: number },
  chainId: number
): string | undefined {
  if (start.account && now.account?.toLowerCase() !== start.account.toLowerCase())
    return 'Account changed. Review again.'
  if (start.onChain && now.chainId !== chainId) return 'Network changed. Review again.'
  return undefined
}

/** Item states shown on a row, after its venue's transaction. */
export type ItemResult = 'bought' | 'sold' | 'skipped' | 'failed' | 'unconfirmed' | 'missing' | 'stopped'

export const ITEM_RESULT_WORDS: Record<ItemResult, string> = {
  bought: 'Bought',
  sold: 'Sold',
  skipped: 'No longer available, skipped. Nothing paid for it.',
  failed: 'Not filled: the transaction failed. Only the network fee was paid.',
  unconfirmed: 'Not confirmed yet',
  missing: "This transaction doesn't show it moving.",
  stopped: 'Not sent',
}

/**
 * A pool's receipt reading (poolBatch.ts readPoolReceipt) as row states: 'sold' / 'bought' only when the receipt shows
 * it, a failed transaction 'failed', anything else 'missing'. No receipt at all: 'unconfirmed'.
 */
export function poolItemResults(
  reading: { ok: boolean; items: readonly { id: bigint; status: 'sold' | 'bought' | 'missing' }[] } | undefined,
  ids: readonly string[]
): Record<string, ItemResult> {
  const out: Record<string, ItemResult> = {}
  for (const id of ids) {
    if (!reading) out[id] = 'unconfirmed'
    else if (!reading.ok) out[id] = 'failed'
    else out[id] = reading.items.find((i) => i.id.toString() === id)?.status ?? 'missing'
  }

  return out
}
