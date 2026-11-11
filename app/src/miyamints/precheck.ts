/**
 * The cheap checks read again right before a payment's approval: is the sale still on, does the collection still take
 * the token, does the registry still allow it, what does it cost now. An approval for a payment that can't work spends
 * gas and leaves an allowance behind for nothing, so a failed check stops before the wallet opens and says why.
 *
 * Pure (only viem types), so node:test can load it. The reads themselves are in usePay.ts.
 */
import { isEth, sameToken } from './tokens'

/** Read again, but the read failed: nothing is approved on a guess. */
export const COULDNT_CHECK_WORDS = "Couldn't check the sale just now. Nothing was sent. Try again."

/**
 * The token can pay here: the collection still lists it (`accepted`, from acceptedTokens()) and the registry still
 * allows it (`allowed`, isPaymentToken; ETH always is). Undefined = fine; else the reason. A read that failed
 * (undefined) is a reason too.
 */
export function tokenGate(
  token: string,
  symbol: string,
  accepted: readonly string[] | undefined,
  allowed: boolean | undefined
): string | undefined {
  if (!accepted || (!isEth(token) && allowed === undefined)) return COULDNT_CHECK_WORDS
  if (!accepted.some((t) => sameToken(t, token))) return `This collection no longer takes ${symbol}. Pick another token.`
  if (!isEth(token) && !allowed) return `miya no longer accepts ${symbol} for sales. Pick another token.`
  return undefined
}

/**
 * The cost read again. Higher than the screen showed: stop, so the person sees the new price before anything is
 * signed. Lower or the same: go on with the fresh cost, which is also the approval and `maxCost`.
 */
export function freshCost(shown: bigint, fresh: bigint): { amount: bigint; rose: boolean; changed: boolean } {
  return { amount: fresh, rose: fresh > shown, changed: fresh !== shown }
}

export const priceRoseWords = (now: string) => `The price went up to ${now}. Nothing was sent. Press again to pay it.`

/** An 1155 edition can still sell `qty` now: open, and not sold out (supply 0 = no limit). */
export function editionGate(
  ed: { supply: bigint; minted: bigint; openTime: bigint; pricingModel?: number },
  qty: bigint,
  nowSec: number
): string | undefined {
  if (ed.openTime > 0n && BigInt(nowSec) < ed.openTime) return 'This edition is not open yet.'
  if (ed.supply > 0n && ed.minted + qty > ed.supply) {
    return ed.minted >= ed.supply ? 'This edition just sold out.' : 'There are not that many copies left.'
  }
  return undefined
}

type Phase = {
  start: bigint
  end: bigint
  merkleRoot?: string
  supplyCap: number
  prices: readonly { token: string; price: bigint }[]
}

/**
 * A drop's phase read again: still running, room left (its own cap and the public supply) and still priced in
 * `token`. The price is the phase's own (fixed for the phase, but the artist can set new phases). `sold` is what this
 * phase has sold.
 */
export function phaseGate(
  phase: Phase | undefined,
  token: string,
  qty: number,
  nowSec: number,
  sold: bigint | undefined,
  publicRemaining: bigint | undefined
): { ok: true; price: bigint } | { ok: false; error: string } {
  if (!phase) return { ok: false, error: 'This sale phase has ended. Reload to see what is on now.' }
  const now = BigInt(nowSec)
  if (now < phase.start) return { ok: false, error: 'This sale phase has not started yet.' }
  if (phase.end !== 0n && now >= phase.end) return { ok: false, error: 'This sale phase has ended. Reload to see what is on now.' }
  if (phase.merkleRoot && !/^0x0*$/.test(phase.merkleRoot)) {
    return { ok: false, error: 'This sale phase is now for an allowlist only. Reload to see what is on now.' }
  }
  if (publicRemaining !== undefined && publicRemaining < BigInt(qty)) {
    return { ok: false, error: publicRemaining === 0n ? 'Sold out.' : 'There are not that many pieces left.' }
  }
  if (phase.supplyCap && sold !== undefined && sold + BigInt(qty) > BigInt(phase.supplyCap)) {
    return { ok: false, error: 'This sale phase does not have that many pieces left.' }
  }
  const p = phase.prices.find((x) => sameToken(x.token, token))
  if (!p) return { ok: false, error: 'This sale phase no longer takes that token. Pick another one.' }
  return { ok: true, price: p.price }
}

/**
 * A lot read again before a bid's approval: live, and the bid still reaches `minimum` (minimumNextBid of the fresh
 * read). Undefined = fine; else why, said as "no bid was sent".
 */
export function bidGate(
  lot: { startTime: number; endTime: number; settled: boolean },
  minimum: bigint,
  amount: bigint,
  nowSec: number,
  money: (v: bigint) => string
): string | undefined {
  if (lot.settled) return 'This lot is no longer up for auction. No bid was sent.'
  if (!lot.startTime || !lot.endTime) return "Bidding on this lot hasn't opened yet. No bid was sent."
  if (nowSec >= lot.endTime) return 'This auction has just ended. No bid was sent.'
  if (amount < minimum) return `Someone bid more. The next bid is now ${money(minimum)} or more. No bid was sent.`
  return undefined
}
