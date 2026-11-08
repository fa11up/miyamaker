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

export type ItemState = 'ready' | 'wallet' | 'pending' | 'bought' | 'gone' | 'failed' | 'stopped' | 'unconfirmed'

export const SWEEP_STATE_WORDS: Record<ItemState, string> = {
  ready: 'Ready',
  wallet: 'Confirm in wallet',
  pending: 'Waiting for the network',
  bought: 'Bought',
  gone: 'No longer available, skipped',
  failed: 'Failed, not bought',
  stopped: 'Not bought',
  unconfirmed: 'Not confirmed yet',
}

export type SweepRun = { state: ItemState; hash?: string; note?: string }

/**
 * One buy after another, strictly in order. The wallet and chain calls are passed in so `node --test` can run all of it.
 *
 * `isStopped` is asked before every wallet prompt: when the screen has gone, no new prompt may open with no screen to
 * explain it. A refusal in the wallet stops the rest; any other failure costs only that NFT. A receipt that cannot be
 * read is `unconfirmed`, not failed: that buy may yet land.
 */
export async function runSweep<T, R>(
  items: readonly T[],
  d: {
    simulate: (item: T) => Promise<R>
    send: (item: T, request: R) => Promise<string>
    /** The receipt, whatever its status, or status 'cancelled' for a wallet's cancel. Throws only when it can't be read. */
    wait: (hash: string) => Promise<{ status?: string }>
    isStopped: () => boolean
    isRefusal: (error: unknown) => boolean
    /** What a failed simulation means: this listing has gone, or something else went wrong. */
    simulationFailed: (item: T, error: unknown) => SweepRun
    /** Plain words for a failed send, and for a transaction that failed on the network. */
    sendFailedNote: (error: unknown) => string
    revertedNote: string
    unconfirmedNote: string
    onState: (item: T, run: SweepRun) => void
    onRefused?: () => void
  }
) {
  let stopped = false
  for (const item of items) {
    if (d.isStopped()) stopped = true
    if (stopped) {
      d.onState(item, { state: 'stopped' })
      // eslint-disable-next-line no-continue
      continue
    }

    d.onState(item, { state: 'wallet' })
    let request: R
    try {
      // eslint-disable-next-line no-await-in-loop
      request = await d.simulate(item)
    } catch (e) {
      // Sold, cancelled or expired while the sweep ran: no prompt, no transaction, on to the next.
      d.onState(item, d.simulationFailed(item, e))
      // eslint-disable-next-line no-continue
      continue
    }

    // The screen may have gone during that check.
    if (d.isStopped()) {
      stopped = true
      d.onState(item, { state: 'stopped' })
      // eslint-disable-next-line no-continue
      continue
    }

    let hash: string
    try {
      // eslint-disable-next-line no-await-in-loop
      hash = await d.send(item, request)
    } catch (e) {
      if (d.isRefusal(e)) {
        stopped = true
        d.onRefused?.()
        d.onState(item, { state: 'stopped' })
      } else d.onState(item, { state: 'failed', note: d.sendFailedNote(e) })
      // eslint-disable-next-line no-continue
      continue
    }

    d.onState(item, { state: 'pending', hash })
    try {
      // eslint-disable-next-line no-await-in-loop
      const receipt = await d.wait(hash)
      if (receipt.status === 'cancelled') {
        // Replaced by the wallet's cancel: as good as refusing the prompt.
        stopped = true
        d.onRefused?.()
        d.onState(item, { state: 'stopped', hash })
        // eslint-disable-next-line no-continue
        continue
      }

      d.onState(
        item,
        receipt.status === 'success' ? { state: 'bought', hash } : { state: 'failed', hash, note: d.revertedNote }
      )
    } catch {
      d.onState(item, { state: 'unconfirmed', hash, note: d.unconfirmedNote })
    }
  }
}

/**
 * The "gone" memory: a listing that failed to buy (sold, cancelled) is hidden on this visitor's screen for a while,
 * since the shared market list can lag it by a minute. A failed hash comes back on its own if it was a false alarm.
 */
export const GONE_MS = 15 * 60_000
const GONE_KEY = 'miya-market-gone'
type Store = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }

export const sessionStore = (): Store | undefined => {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

function readHashes(store: Store | undefined, key: string, ms: number, now: number): Record<string, number> {
  try {
    const all = JSON.parse(store?.getItem(key) ?? '{}') as Record<string, number>
    return Object.fromEntries(Object.entries(all).filter(([, at]) => now - at < ms))
  } catch {
    return {}
  }
}

function writeHashes(store: Store | undefined, key: string, all: Record<string, number>) {
  try {
    store?.setItem(key, JSON.stringify(all))
  } catch {
    // Private windows: nothing is remembered past this screen.
  }
}

const readGone = (store: Store | undefined, now: number) => readHashes(store, GONE_KEY, GONE_MS, now)

export const goneHashes = (store: Store | undefined, now = Date.now()) => new Set(Object.keys(readGone(store, now)))

export function markGone(store: Store | undefined, hash: string, now = Date.now()) {
  writeHashes(store, GONE_KEY, { ...readGone(store, now), [hash]: now })
}

/**
 * The "unconfirmed" memory: a buy sent for a listing whose outcome we couldn't see. An ERC-1155 listing can still look
 * open after it, so without this the same buy would be offered again and could be paid twice. Kept for the session,
 * until the outcome is known; after an hour a buy that never showed up is let go.
 */
export const UNCONFIRMED_MS = 60 * 60_000
const UNCONFIRMED_KEY = 'miya-market-unconfirmed'
export const UNCONFIRMED_BUY_WORDS =
  "A buy of this is still unconfirmed. Check your wallet's activity before buying it again."

const readUnconfirmed = (store: Store | undefined, now: number) =>
  readHashes(store, UNCONFIRMED_KEY, UNCONFIRMED_MS, now)

export const unconfirmedHashes = (store: Store | undefined, now = Date.now()) =>
  new Set(Object.keys(readUnconfirmed(store, now)))

export function markUnconfirmed(store: Store | undefined, hash: string, now = Date.now()) {
  if (!hash) return
  writeHashes(store, UNCONFIRMED_KEY, { ...readUnconfirmed(store, now), [hash]: now })
}

/** The buy's outcome is known (bought, failed on chain, or never sent). */
export function clearUnconfirmed(store: Store | undefined, hash: string, now = Date.now()) {
  const all = readUnconfirmed(store, now)
  if (!(hash in all)) return
  delete all[hash]
  writeHashes(store, UNCONFIRMED_KEY, all)
}

/** What a buy's state says about whether it may still land: kept while it might, let go once the outcome is known. */
export function noteBuyOutcome(store: Store | undefined, orderHash: string, state: ItemState, now = Date.now()) {
  if (state === 'pending' || state === 'unconfirmed') markUnconfirmed(store, orderHash, now)
  else if (state !== 'ready' && state !== 'wallet') clearUnconfirmed(store, orderHash, now)
}

/** How long one NFT of a sweep waits for the network before it is left as "not confirmed yet" and the sweep moves on. */
export const SWEEP_WAIT_MS = 5 * 60_000
