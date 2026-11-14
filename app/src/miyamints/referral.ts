// Ref links: miyamaker.com/…?ref=0x… remembers who sent the visitor, and a drop mint from that browser carries the
// referrer in its calldata. Nothing on chain reads it: the drop ignores bytes after its arguments, so the mint costs and
// does exactly the same. scripts/referrals.mts reads the tag back from each mint's transaction to credit referrers.
//
// THE TAG: the referrer's 20 bytes, then MAGIC (8 bytes, "miyaref1"), appended to the mint call's data. A plain wallet
// sends it as the last bytes of the transaction; a smart wallet wraps the call, so the tag sits inside the outer data,
// which is why the reader searches for MAGIC rather than only looking at the end.
//
// WHICH REFERRER: the one in the address bar when Mint is pressed. Moving between windows drops the query string, so a
// ref link opened earlier in this visit (this tab, sessionStorage) stands in when the address bar has none. Nothing
// outlives the tab. A wallet never refers itself (no tag is sent).
import type { Address, Hex } from 'viem'
import { getAddress, isAddress, zeroAddress } from 'viem'

/** "miyaref1" in ASCII. */
export const REF_MAGIC = '6d69796172656631'
const KEY = 'miya.ref'

// THE REWARD (owner's decision, 2026-11-14): a share of what each referred mint paid, in the token it paid in, sent by
// the owner from their share (scripts/referrals.mts works it out). Mints in blocks before REF_EARLY_UNTIL earn the early
// rate. Read by the share box's words and the payout script, so the two can't disagree.
export const REF_BPS = 1000
export const REF_EARLY_BPS = 2500
/** Unix seconds, exclusive: the end of 2026-11-21 UTC, seven days from launch. */
export const REF_EARLY_UNTIL = Date.UTC(2026, 10, 22) / 1000

/** The reward rate for a mint in a block with this timestamp (unix seconds). */
export const refBps = (timestamp: number) => (timestamp < REF_EARLY_UNTIL ? REF_EARLY_BPS : REF_BPS)

/** ownerMint's phase in the drop's Minted event: never credited. */
export const OWNER_PHASE = 2n ** 256n - 1n

/** One Minted event of a drop and its transaction, as read from the chain. */
export type MintFacts = {
  input: Hex
  txFrom: Address
  to: Address
  phaseId: bigint
  paid: bigint
  /** The block's timestamp, unix seconds. */
  timestamp: number
}

/**
 * Who a mint credits and what they are owed, or undefined: no tag, an owner mint, or a tag naming the sender or the
 * receiver. The ONE rule for the payout script (scripts/referrals.mts) and the share box's stats (api/_lib/referrals.ts).
 */
export function creditFor(m: MintFacts, flatBps?: bigint): { referrer: Address; bps: bigint; reward: bigint } | undefined {
  if (m.phaseId === OWNER_PHASE) return undefined
  const referrer = refFromInput(m.input)
  if (!referrer || referrer === getAddress(m.txFrom) || referrer === getAddress(m.to)) return undefined
  const bps = flatBps ?? BigInt(refBps(m.timestamp))
  return { referrer, bps, reward: (m.paid * bps) / 10_000n }
}

/** What the share box tells a referrer at `now` (unix seconds). Free mints pay nothing, so they earn nothing. */
export function refRewardWords(now: number) {
  const pct = (bps: number) => `${bps / 100}%`
  return now < REF_EARLY_UNTIL
    ? `Earn ${pct(REF_EARLY_BPS)} of what mints from your link pay, through Nov 21 (UTC), then ${pct(REF_BPS)}. Paid by the miyamaker team.`
    : `Earn ${pct(REF_BPS)} of what mints from your link pay. Paid by the miyamaker team.`
}

/** The referrer named by a ref link's query string, or undefined when it names none or not a real address. */
export function refFromSearch(search: string): Address | undefined {
  let raw: string | null
  try {
    raw = new URLSearchParams(search).get('ref')
  } catch {
    return undefined
  }
  if (!raw) return undefined
  const v = raw.trim()
  if (!isAddress(v, { strict: false })) return undefined
  const ref = getAddress(v)
  return ref === zeroAddress ? undefined : ref
}

/** The calldata tag for `ref`: its 20 bytes, then the magic. */
export function refSuffix(ref: Address): Hex {
  return `0x${getAddress(ref).slice(2).toLowerCase()}${REF_MAGIC}`
}

/** The referrer tagged in a transaction's input, or undefined. Takes the LAST tag at a byte boundary. */
export function refFromInput(input: Hex): Address | undefined {
  const hex = input.slice(2).toLowerCase()
  for (let at = hex.lastIndexOf(REF_MAGIC); at >= 40; at = hex.lastIndexOf(REF_MAGIC, at - 1)) {
    if (at % 2 !== 0) continue
    const ref = getAddress(`0x${hex.slice(at - 40, at)}`)
    if (ref !== zeroAddress) return ref
  }
  return undefined
}

/** On load: a ref link in the address bar is remembered for this tab (replacing an older one). Storage may be off. */
export function captureRef(search = window.location.search) {
  const ref = refFromSearch(search)
  if (!ref) return
  try {
    sessionStorage.setItem(KEY, ref)
  } catch {
    // No storage (private window, blocked): only a ref still in the address bar at Mint counts.
  }
}

/** The referrer for a mint pressed now: the address bar's ref link, else the one opened earlier in this tab. */
export function currentRef(search: string, stored: string | null): Address | undefined {
  return refFromSearch(search) ?? (stored ? refFromSearch(`?ref=${stored}`) : undefined)
}

/** The tag to append to a mint by `minter`, or undefined: no ref link, or the minter is the referrer. */
export function mintRefSuffix(minter: Address | undefined, search = window.location.search): Hex | undefined {
  let stored: string | null = null
  try {
    stored = sessionStorage.getItem(KEY)
  } catch {
    // Storage off: the address bar alone decides.
  }
  const ref = currentRef(search, stored)
  if (!ref || (minter && ref.toLowerCase() === minter.toLowerCase())) return undefined
  return refSuffix(ref)
}

/** The ref link for `page` (a path like /mint/miyamaker) that credits `wallet`. */
export const refLink = (origin: string, page: string, wallet: Address) =>
  `${origin}${page}?ref=${getAddress(wallet)}`

/** GET /api/referrals: a referrer's totals; paid and owed per token in base units. */
export type RefStats = {
  mints: number
  pieces: number
  paid: Record<string, string>
  owed: Record<string, string>
  pending: number
}

/** The share box's stats line. `amount` formats base units of a token. */
export function refStatsWords(s: RefStats, amount: (token: string, v: bigint) => string): string {
  const behind = s.pending > 0 ? ` Still reading ${s.pending} recent mint${s.pending === 1 ? '' : 's'}.` : ''
  if (s.mints === 0) return `No mints from your link yet.${behind}`
  const owed = Object.entries(s.owed)
    .filter(([, v]) => BigInt(v) > 0n)
    .map(([t, v]) => amount(t, BigInt(v)))
  const pieces = `${s.pieces} piece${s.pieces === 1 ? '' : 's'}`
  const mints = `${s.mints} mint${s.mints === 1 ? '' : 's'}`
  return `From your link: ${mints}, ${pieces}. Owed so far: ${owed.length ? owed.join(' + ') : 'nothing (free mints)'}.${behind}`
}
