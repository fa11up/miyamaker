/**
 * The rules that keep a swap honest: what may be signed, what a receipt means and what the screen says about it. No
 * imports, so `node --test` can load it (tests/swapLogic.test.mts).
 */

/** Only the newest request counts: an older answer that lands late is dropped. */
export function latestOnly() {
  let newest = 0
  return {
    begin: () => {
      newest += 1
      return newest
    },
    isCurrent: (ticket: number) => ticket === newest,
    cancel: () => {
      newest += 1
    },
  }
}

export type QuoteTerms = {
  chainId: number
  sellToken: string
  buyToken: string
  sellAmount: bigint | undefined
  slippageBps: number
  taker?: string
}

const same = (a: string | undefined, b: string | undefined) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()

/**
 * A firm quote may be signed only while it still matches every term on the screen, and the amount there is the amount
 * as typed: it is compared before the debounce catches up, so no key press can leave an old quote armed.
 */
export function quoteIsCurrent(quoted: QuoteTerms | undefined, onScreen: QuoteTerms): boolean {
  if (!quoted || quoted.sellAmount === undefined || onScreen.sellAmount === undefined) return false
  return (
    quoted.sellAmount === onScreen.sellAmount &&
    quoted.chainId === onScreen.chainId &&
    quoted.slippageBps === onScreen.slippageBps &&
    same(quoted.sellToken, onScreen.sellToken) &&
    same(quoted.buyToken, onScreen.buyToken) &&
    same(quoted.taker, onScreen.taker)
  )
}

export type ReceiptOutcome = 'none' | 'waiting' | 'success' | 'reverted' | 'cancelled' | 'unknown'

/**
 * What a transaction did. A failed look-up is not a failed transaction: the swap may yet land, so that is `unknown`, and
 * only a receipt that says so counts as `reverted`. The receipt of a replaced transaction is the replacement's: a
 * wallet's cancel reads as success on it, and anything but a sped-up copy says nothing about this one.
 */
export function receiptOutcome(
  hash: string | undefined,
  receipt: { status?: string } | undefined,
  lookupFailed: boolean,
  replaced?: 'cancelled' | 'repriced' | 'replaced',
): ReceiptOutcome {
  if (!hash) return 'none'
  if (replaced === 'cancelled') return 'cancelled'
  if (replaced === 'replaced') return 'unknown'
  if (receipt?.status === 'success') return 'success'
  if (receipt?.status === 'reverted') return 'reverted'
  return lookupFailed || receipt ? 'unknown' : 'waiting'
}

export const SWAP_FAILED_WORDS =
  'This swap failed on the network. Your tokens did not move. You only paid the network fee.'
export const APPROVE_FAILED_WORDS =
  'This approval failed on the network. Your tokens did not move. You only paid the network fee.'
export const CANCELLED_WORDS =
  'You cancelled this in your wallet. Your tokens did not move. You only paid the network fee.'
export const UNCONFIRMED_WORDS = 'We could not confirm this yet. It may still go through. Check it before trying again.'
/** For an error we can't read: it may have come after the swap was sent, so only the wallet can say what moved. */
export const GENERIC_SWAP_WORDS = "That did not go through. Check your wallet's activity, then try again."
export const OFFLINE_SWAP_WORDS = 'Swaps are offline right now. Nothing has moved. Try again later.'

/** The error's own words and those of everything it wraps. Duck-typed so this file needs no imports. */
function errorText(error: unknown): string {
  const parts: string[] = []
  let e = error as { shortMessage?: unknown; details?: unknown; message?: unknown; cause?: unknown } | undefined
  for (let depth = 0; e && depth < 8; depth += 1) {
    for (const part of [e.shortMessage, e.details, e.message]) if (typeof part === 'string') parts.push(part)
    e = e.cause as typeof e
  }
  return parts.join(' ')
}

/**
 * Wallet and RPC errors as one plain sentence; a refusal in the wallet is a cancel, not a failure. Anything not known
 * gets the general line, since these messages are written for developers and can quote calldata.
 */
export function describeTxError(error: unknown): { message: string; cancelled: boolean } {
  if (!error) return { message: '', cancelled: false }
  // Our own swap errors: written for this screen (api.ts, quoteGuard.ts).
  if ((error as { plainWords?: unknown }).plainWords === true) {
    return { message: (error as Error).message, cancelled: false }
  }
  const text = errorText(error)
  if (/reject|denied|cancel/i.test(text)) return { message: 'Cancelled in wallet.', cancelled: true }
  if (/insufficient funds/i.test(text)) return { message: 'Not enough ETH for this trade plus gas.', cancelled: false }
  return { message: GENERIC_SWAP_WORDS, cancelled: false }
}

/** Words from the swap proxy that are safe to show. Anything else 0x or the proxy says stays off the screen. */
const API_WORDS: Record<string, string> = {
  SWAP_NOT_CONFIGURED: OFFLINE_SWAP_WORDS,
  TOKEN_NOT_SUPPORTED: 'This token cannot be swapped here. Try another one.',
  INSUFFICIENT_BALANCE: 'Not enough balance for this trade.',
  UPSTREAM_UNREACHABLE: 'Could not reach the swap service. Nothing has moved. Try again.',
  NETWORK: 'Could not reach the swap service. Nothing has moved. Try again.',
  RATE_LIMITED: 'The swap service is busy. Wait a moment, then try again.',
}

export const swapApiWords = (code: string) =>
  API_WORDS[code] ?? 'Could not get a price right now. Nothing has moved. Try again.'

export const HIGH_IMPACT = 0.05
const NOTABLE_IMPACT = 0.02

export type ImpactLevel = 'unknown' | 'low' | 'notable' | 'high'

export function impactLevel(impact: number | undefined): ImpactLevel {
  if (impact === undefined || !Number.isFinite(impact)) return 'unknown'
  if (impact >= HIGH_IMPACT) return 'high'
  return impact >= NOTABLE_IMPACT ? 'notable' : 'low'
}

/** "12.4": the percent to one decimal, rounded the same way as the review's own line. */
export const impactPercent = (impact: number) => (impact * 100).toFixed(1)

export type StepFacts = {
  needsApproval: boolean
  needsReset: boolean
  /** This wallet's old allowance was set to 0 during this review. */
  didReset: boolean
  /** The allowance was set during this review. */
  didApprove: boolean
  batches: boolean
}

/**
 * Where the person is in the approve-then-swap steps. Counted from what has really happened in this review, so "Step 2"
 * never appears when no step 1 did: with an allowance already in place, the swap is the only step and has no number.
 */
export function swapStep(f: StepFacts): { stage: 'reset' | 'approve' | 'swap' | 'batch'; of?: number; at?: number } {
  if (f.needsApproval && f.batches) return { stage: 'batch' }
  if (f.needsApproval && f.needsReset) return { stage: 'reset', at: 1, of: 3 }
  if (f.needsApproval) return f.didReset ? { stage: 'approve', at: 2, of: 3 } : { stage: 'approve', at: 1, of: 2 }
  if (f.didApprove) return f.didReset ? { stage: 'swap', at: 3, of: 3 } : { stage: 'swap', at: 2, of: 2 }
  return { stage: 'swap' }
}

/** "1.4M", "12.5K", "0.5": short enough for a button. */
export function compactAmount(amount: number): string {
  if (!Number.isFinite(amount)) return '–'
  const trim = (n: number, digits: number) => n.toFixed(digits).replace(/\.?0+$/, '')
  if (amount >= 1e9) return `${trim(amount / 1e9, 1)}B`
  if (amount >= 1e6) return `${trim(amount / 1e6, 1)}M`
  if (amount >= 1e4) return `${trim(amount / 1e3, 1)}K`
  if (amount >= 1000) return Math.round(amount).toLocaleString('en-US')
  if (amount >= 1) return trim(amount, 2)
  if (amount === 0) return '0'
  return Number(amount.toPrecision(3)).toString()
}
