/**
 * The rules of a miyamints auction lot and the words for them, checked against contracts/src/factories/erc721/
 * ERC721AuctionInstance.sol:
 * - createBid: the first bid must reach `minBid` (the artist's deposit); every later one `highBid + bidIncrement`.
 *   Bids close at `endTime` (a bid at or after it reverts AuctionExpired).
 * - Each house has one `currency` (address(0) = ETH). createBid(tokenId, amount, message): ETH sends msg.value ==
 *   amount; an ERC-20 is pulled (approve first). The bidder it beats: in ETH, refunded in the same transaction
 *   (forceSafeTransferETH); in an ERC-20, credited to `refundOf(bidder)` and taken with claimRefund(to).
 * - Anti-snipe: a bid with less than `timeBuffer` left moves the end to `timeBuffer` after that bid.
 * - settleAuction (anyone, once ended, with bids): mints the piece to the winner (or holds it for them to claim when
 *   their wallet can't take it), returns the artist's deposit, and splits the winning bid: protocol fee, alignment
 *   vault, the rest to the artist. ETH is sent to the artist; an ERC-20 waits in the artist's balance to withdraw.
 * - reclaimUnsold (ended, no bids): the owner only for UNSOLD_CLOSE_GRACE after the end, then anyone. The deposit goes
 *   to the protocol treasury whoever calls it, and the line's next piece starts.
 * - A queued piece has no start time until the piece before it on its line is closed.
 * Pure, so `node --test` can load it.
 */
import { formatUnits } from 'viem'

/** The house's currency, for the words: ETH unless the house says otherwise. */
export type MmUnit = { symbol: string; decimals: number; eth: boolean }
export const ETH_MM_UNIT: MmUnit = { symbol: 'ETH', decimals: 18, eth: true }

/** "0.1 ETH", "250 USDC": every decimal kept, as the contract counts it. */
export const unitAmount = (amount: bigint, unit: MmUnit = ETH_MM_UNIT) => `${formatUnits(amount, unit.decimals)} ${unit.symbol}`

export const UNSOLD_CLOSE_GRACE_S = 7 * 24 * 3600

const NO_BIDDER = /^0x0{40}$/i

export type MmLot = {
  tokenId: number
  tokenURI: string
  /** The artist's deposit, which is also the starting price. */
  minBid: bigint
  highBidder: string
  highBid: bigint
  startTime: number
  endTime: number
  settled: boolean
}

/** queued: waiting for its line. live: taking bids. ended: over, not closed yet. sold / unsold: closed. */
export type MmPhase = 'queued' | 'live' | 'ended' | 'sold' | 'unsold'

export const hasBids = (lot: Pick<MmLot, 'highBidder'>) => !!lot.highBidder && !NO_BIDDER.test(lot.highBidder)

export function mmPhase(lot: Pick<MmLot, 'startTime' | 'endTime' | 'settled' | 'highBidder'>, nowMs: number): MmPhase {
  if (lot.settled) return hasBids(lot) ? 'sold' : 'unsold'
  if (!lot.startTime) return 'queued'
  return nowMs < lot.endTime * 1000 ? 'live' : 'ended'
}

/** The lowest bid createBid accepts now. */
export function minimumNextBid(lot: Pick<MmLot, 'highBidder' | 'highBid' | 'minBid'>, bidIncrement: bigint): bigint {
  return hasBids(lot) ? lot.highBid + bidIncrement : lot.minBid
}

/** The end time a bid placed at `nowS` leaves, as createBid sets it. */
export function endAfterBid(endTime: number, timeBuffer: number, nowS: number): number {
  return endTime - nowS < timeBuffer ? nowS + timeBuffer : endTime
}

/** "15 minutes", "1 hour", "90 seconds": a span the contract counts in seconds, in words. */
export function spanWords(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (s % 86_400 === 0 && s >= 86_400) return plural(s / 86_400, 'day')
  if (s % 3600 === 0 && s >= 3600) return plural(s / 3600, 'hour')
  if (s % 60 === 0 && s >= 60) return plural(s / 60, 'minute')
  if (s > 120) return plural(Math.round(s / 60), 'minute')
  return plural(s, 'second')
}

/** The anti-snipe rule in one line, from the auction's own timeBuffer. */
export const antiSnipeWords = (timeBuffer: number) =>
  `A bid with less than ${spanWords(timeBuffer)} left moves the end to ${spanWords(timeBuffer)} after that bid.`

export const REFUND_WORDS = 'If someone outbids you, your ETH goes back to your wallet in the same transaction.'

/** What happens to an outbid bid in this house's currency. */
export const refundWords = (unit: MmUnit = ETH_MM_UNIT) =>
  unit.eth
    ? REFUND_WORDS
    : `If someone outbids you, your ${unit.symbol} is kept for you by this auction house. Claim it back here any time.`

/** The money row and the bidder row, in the words for the phase. `bidderValue` is '' when there is a real bidder. */
export function mmFacts(lot: MmLot, phase: MmPhase, unit: MmUnit = ETH_MM_UNIT) {
  const over = phase === 'ended' || phase === 'sold' || phase === 'unsold'
  if (!hasBids(lot)) {
    return {
      bidLabel: 'Starting price',
      bidValue: unitAmount(lot.minBid, unit),
      bidderLabel: over ? 'Winner' : 'Highest bidder',
      bidderValue: over ? 'No bids' : 'No bids yet',
    }
  }
  return {
    bidLabel: over ? 'Winning bid' : 'Current bid',
    bidValue: unitAmount(lot.highBid, unit),
    bidderLabel: over ? 'Winner' : 'Highest bidder',
    bidderValue: '',
  }
}

/** Percent from basis points, without trailing zeros: 100 → "1%", 1250 → "12.5%". */
export const bpsWords = (bps: number) => `${Number((bps / 100).toFixed(2))}%`

/** What settling does with the money, from the shares fixed at launch. */
export function settleWords(lot: MmLot, protocolFeeBps?: number, alignmentBps?: number, unit: MmUnit = ETH_MM_UNIT): string {
  const deposit = `The artist gets their ${unitAmount(lot.minBid, unit)} deposit back.`
  const split =
    protocolFeeBps !== undefined && alignmentBps !== undefined
      ? ` Of the ${unitAmount(lot.highBid, unit)} winning bid, ${bpsWords(protocolFeeBps)} is the miya fee, ${bpsWords(
          alignmentBps
        )} goes to the collection's alignment vault, and the rest goes to the artist.`
      : ''
  return `Settling sends the piece to the winner. ${deposit}${split} Anyone can settle. It costs only gas.`
}

/** Who may close an unsold lot now: its owner at once, anyone after the grace period. */
export function canCloseUnsold(
  lot: Pick<MmLot, 'endTime'>,
  { isOwner, nowMs }: { isOwner: boolean; nowMs: number }
): boolean {
  return isOwner || nowMs >= (lot.endTime + UNSOLD_CLOSE_GRACE_S) * 1000
}

export function unsoldWords(lot: MmLot, isOwner: boolean, unit: MmUnit = ETH_MM_UNIT): string {
  const deposit = unitAmount(lot.minBid, unit)
  return isOwner
    ? `No one bid. Closing it sends your ${deposit} deposit to the miya treasury. A piece queued behind it starts then.`
    : `No one bid. When this is closed, the artist's ${deposit} deposit goes to the miya treasury.`
}

/** The status tag on a lot card. */
export function phaseTag(lot: MmLot, phase: MmPhase, nowMs: number, timeLeft: (ms: number) => string): string {
  if (phase === 'live') return `Live · ${timeLeft(lot.endTime * 1000 - nowMs)}`
  if (phase === 'queued') return 'Up next'
  if (phase === 'ended') return hasBids(lot) ? 'Ended · to settle' : 'Ended · no bids'
  if (phase === 'sold') return 'Sold'
  return 'Unsold'
}

const PHASE_ORDER: Record<MmPhase, number> = { live: 0, ended: 1, queued: 2, sold: 3, unsold: 4 }

/** Live first (ending soonest first), then ended waiting to settle, then up next, then closed (newest first). */
export function sortLots<T extends { lot: MmLot; phase: MmPhase; key: string }>(lots: T[]): T[] {
  return [...lots].sort(
    (a, b) =>
      PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] ||
      (a.phase === 'live' ? a.lot.endTime - b.lot.endTime : b.lot.endTime - a.lot.endTime) ||
      a.key.localeCompare(b.key)
  )
}

/** Token ids to read for a house, newest first, at most `max`. `nextTokenId` is 1 before anything is queued. */
export function lotIds(nextTokenId: number, max: number): number[] {
  const out: number[] = []
  for (let id = nextTokenId - 1; id >= 1 && out.length < max; id -= 1) out.push(id)
  return out
}

/** A bid's optional message. The contract takes any length; every byte costs gas and stays on chain for good. */
export const MAX_BID_MESSAGE = 140

export const BID_MESSAGE_WORDS = 'Optional. It goes on chain with your bid: public, permanent, and shown to everyone.'

/** One plain line: no control or direction-changing characters, spaces collapsed, at most MAX_BID_MESSAGE characters. */
export function cleanBidMessage(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const plain = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return [...plain].slice(0, MAX_BID_MESSAGE).join('')
}
