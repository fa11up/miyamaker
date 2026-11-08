/**
 * The rules of a bid and the words for its outcomes, checked against the verified MiyaAuction source
 * (0x5892Cad52d9e6bDd757947B56E2760E0DcE21CE9, placeBid): a bid must reach both the lot's minimum price and the current
 * bid plus the increment, the bidder it beats is refunded in the same transaction, and a bid never moves the end time.
 * Pure, so `node --test` can load it.
 */
import { formatEther, parseEther } from 'viem'

export type LotPhase = 'loading' | 'failed' | 'missing' | 'upcoming' | 'live' | 'ended'

export type LotRead = {
  status: 'loading' | 'failed' | 'ready'
  startTime: number
  endTime: number
  settled: boolean
}

/** Only a real end time in the past means ended: a read that is pending or failed says nothing about the lot. */
export function lotPhase({ status, startTime, endTime, settled }: LotRead, nowMs: number): LotPhase {
  if (status !== 'ready') return status
  if (settled) return 'ended'
  if (!endTime) return 'missing'
  if (endTime * 1000 <= nowMs) return 'ended'
  return startTime * 1000 > nowMs ? 'upcoming' : 'live'
}

/**
 * What a read of the lot can say. A last good answer stands through a failed poll: it is still the best anyone knows,
 * the screen shows its age, and the contract refuses a bid that has gone stale. Only no answer at all counts as failed.
 */
export const lotReadStatus = (hasAnswer: boolean, failed: boolean): LotRead['status'] =>
  hasAnswer ? 'ready' : failed ? 'failed' : 'loading'

/** Parses a user-typed ETH amount; undefined for '' or anything parseEther rejects (never throws). */
export function parseBidAmount(bidAmount: string): bigint | undefined {
  if (!/^(\d+\.?\d*|\.\d+)$/.test(bidAmount)) return undefined
  try {
    const value = parseEther(bidAmount)
    return value > 0n ? value : undefined
  } catch {
    return undefined
  }
}

/** The lowest bid placeBid accepts: `msg.value` must reach `minPrice` and `amount + bidIncrement`. */
export function minimumBid({
  currentBid,
  minPrice,
  bidIncrement,
}: {
  currentBid: bigint
  minPrice: bigint
  bidIncrement: bigint
}): bigint {
  const next = currentBid + bidIncrement
  return next > minPrice ? next : minPrice
}

/** Whether this amount can be sent, and what the button says about it. A balance not read yet is not checked. */
export function checkBid(
  input: string,
  minimum: bigint,
  balance: bigint | undefined,
): { valid: boolean; value?: bigint; label: string } {
  const value = parseBidAmount(input)
  if (value === undefined || value < minimum) {
    return { valid: false, label: `Enter at least ${formatEther(minimum)} ETH` }
  }
  if (balance !== undefined && value > balance) return { valid: false, value, label: 'Not enough ETH' }
  return { valid: true, value, label: `Bid ${formatEther(value)} ETH` }
}

/** Rounded down to three places, so it never says more than the wallet holds. */
export function balanceWords(wei: bigint): string {
  const thousandths = wei / 10n ** 15n
  return `${thousandths / 1000n}.${(thousandths % 1000n).toString().padStart(3, '0')} ETH`
}

const NO_BIDDER = /^0x0{40}$/

/** The money row and the bidder row of a lot, in the words for its phase. `bidderValue` is '' when there is a real bidder. */
export function lotFacts({
  phase,
  bidder,
  currentBid,
  minPrice,
}: {
  phase: LotPhase
  bidder: string
  currentBid: bigint
  minPrice: bigint
}) {
  const ended = phase === 'ended'
  const bidderLabel = ended ? 'Winner' : 'Highest bidder'
  if (currentBid === 0n || NO_BIDDER.test(bidder)) {
    return {
      bidLabel: 'Starting price',
      bidValue: `${formatEther(minPrice)} ETH`,
      bidderLabel,
      bidderValue: ended ? 'No bids' : 'No bids yet',
    }
  }
  return {
    bidLabel: ended ? 'Winning bid' : 'Current bid',
    bidValue: `${formatEther(currentBid)} ETH`,
    bidderLabel,
    bidderValue: '',
  }
}

/** Where this wallet stands on the lot on show. `led` means it has been seen as the highest bidder on it. */
export function bidStanding(bidder: string, me: string | undefined, led: boolean): 'leading' | 'outbid' | 'none' {
  if (!me) return 'none'
  if (bidder.toLowerCase() === me.toLowerCase()) return 'leading'
  return led ? 'outbid' : 'none'
}

export function timeLeftWords(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days) return `${days}d ${hours}h ${minutes}m left`
  if (hours) return `${hours}h ${minutes}m ${seconds}s left`
  if (minutes) return `${minutes}m ${seconds}s left`
  return `${seconds}s left`
}

export const monthYear = (seconds: number, locale?: string) =>
  new Date(seconds * 1000).toLocaleDateString(locale, { month: 'short', year: 'numeric' })

/** A collection's status line: how many lots, and whether any can be bid on now. */
export function collectionStatus(
  lots: { startTime: number; endTime: number; settled: boolean }[],
  nowMs: number,
  locale?: string,
): string {
  const count = `${lots.length} lot${lots.length === 1 ? '' : 's'}`
  const phases = lots.map((lot) => lotPhase({ ...lot, status: 'ready' }, nowMs))
  if (phases.includes('live')) return `${count} · Live now`
  const opening = lots.filter((_, i) => phases[i] === 'upcoming').map((lot) => lot.startTime)
  if (opening.length) return `${count} · Opens ${monthYear(Math.min(...opening), locale)}`
  const last = Math.max(0, ...lots.map((lot) => lot.endTime))
  return last ? `${count} · Ended ${monthYear(last, locale)}` : count
}

type ErrorLike = {
  name?: string
  shortMessage?: string
  message?: string
  details?: string
  code?: number
  cause?: unknown
  data?: { errorName?: string }
}

/** Everything an error and its causes say about themselves. viem keeps contract errors several causes down. */
function errorText(error: unknown): string {
  const parts: string[] = []
  let at = error as ErrorLike | undefined
  for (let depth = 0; at && depth < 8; depth += 1) {
    parts.push(at.name || '', at.shortMessage || '', at.message || '', at.details || '', at.data?.errorName || '')
    if (at.code === 4001) parts.push('user rejected')
    at = at.cause as ErrorLike | undefined
  }
  return parts.join('\n')
}

export const BID_REVERTED = 'Your bid failed and you paid only gas. Someone may have outbid you.'
export const BID_UNCONFIRMED = "We couldn't confirm your bid. Check your wallet before you bid again."
/** A wait that ran out of time (useTx's limit): the bid was sent and may still land. */
export const BID_SLOW = "Your bid isn't confirmed yet. Check your wallet's activity before you bid again."
/** The wallet's own cancel replaced the bid: a self-send landed in its place, so only its gas was spent. */
export const BID_CANCELLED = 'You cancelled in your wallet. No bid was placed. You only paid the network fee.'
const BID_REJECTED = 'You cancelled in your wallet. No bid was placed.'
/** For a failure that can't vouch nothing was sent: only the wallet's activity can say. */
const BID_CHECK_WALLET = "The bid didn't go through. Check your wallet's activity before you bid again."
/** For a failure in the dry run before the wallet opened: nothing was sent. */
const BID_NOTHING_SENT = "The bid didn't go through. No ETH left your wallet. Try again."

/**
 * Plain words for a bid that failed before it was sent. The raw error is for the console. "No ETH left your wallet" is
 * said only when the error vouches for it: the wallet refused, or `checked` (the dry run before the wallet opened failed).
 * Names from both contracts: MiyaAuction (InsufficientBid, EndedAuction, ...) and ERC721AuctionInstance (BidTooLow,
 * AuctionExpired, ...).
 */
export function bidErrorWords(
  error: unknown,
  { checked = false, chainName = 'Ethereum' }: { checked?: boolean; chainName?: string } = {},
): string {
  const text = errorText(error)
  if (/user rejected|user denied|rejected the request|denied transaction/i.test(text)) return BID_REJECTED
  if (/ChainMismatch|does not match the target chain/i.test(text)) {
    return `Your wallet is on another network. Switch to ${chainName} and try again.`
  }
  if (/InsufficientBid|BidTooLow/.test(text)) return 'Someone bid more. Your bid must beat the new price.'
  if (/BidBelowMinimum/.test(text)) return 'Your bid is under the starting price.'
  if (/EndedAuction|AuctionExpired/.test(text)) return 'This auction has just ended.'
  if (/InactiveAuction|AuctionNotStarted/.test(text)) return "Bidding on this lot hasn't opened yet."
  if (/InvalidAuction|AuctionAlreadySettled|AuctionDoesNotExist/.test(text)) {
    return 'This lot is no longer up for auction.'
  }
  if (/insufficient funds|exceeds the balance/i.test(text)) {
    return "This wallet doesn't have enough ETH for this bid and gas."
  }
  return checked ? BID_NOTHING_SENT : BID_CHECK_WALLET
}

export type BidEnding = {
  /**
   * placed: confirmed. unconfirmed: sent, ending unknown, so nothing is offered again until "Start over". cancelled /
   * reverted: sent and over, nothing moved but gas. refused: never sent, or not known to be.
   */
  kind: 'placed' | 'unconfirmed' | 'cancelled' | 'reverted' | 'refused'
  words: string
}

/** What a finished bid means, from useTx's state (TxEndError flags from txOutcome.ts). Undefined while it runs. */
export function bidEnding(
  tx: { phase: string; stage?: string; error?: unknown },
  chainName = 'Ethereum',
): BidEnding | undefined {
  if (tx.phase === 'done') return { kind: 'placed', words: 'Your bid went through.' }
  if (tx.phase !== 'error') return undefined
  const flags = (tx.error || {}) as { unconfirmed?: boolean; timedOut?: boolean; cancelled?: boolean; reverted?: boolean }
  if (flags.unconfirmed) return { kind: 'unconfirmed', words: flags.timedOut ? BID_SLOW : BID_UNCONFIRMED }
  if (flags.cancelled) return { kind: 'cancelled', words: BID_CANCELLED }
  if (flags.reverted) return { kind: 'reverted', words: BID_REVERTED }
  return { kind: 'refused', words: bidErrorWords(tx.error, { checked: tx.stage === 'check', chainName }) }
}
