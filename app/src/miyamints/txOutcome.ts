/**
 * What a finished wait for a receipt means. No imports, so `node --test` can load it (tests/txOutcome.test.mts).
 *
 * `waitForTransactionReceipt` in @wagmi/core throws on a reverted transaction, with whatever it could decode, so the
 * status check after it never ran and the text could be anything. useTx waits through the public client instead, which
 * returns the status, and a look-up that fails stays apart from a transaction that failed: it may yet go through.
 */

export const TX_REVERTED_WORDS = 'This transaction failed on the network. Nothing moved. You only paid the network fee.'
export const TX_UNCONFIRMED_WORDS =
  'We could not confirm this yet. It may still go through. Check it before trying again.'
export const TX_CANCELLED_WORDS = 'You cancelled this in your wallet. Nothing moved. You only paid the network fee.'
/** For a wait that ran out of time: the transaction was sent and may still land, so nothing is offered again. */
export const TX_SLOW_WORDS = "Not confirmed yet. Check your wallet's activity before you try again."

/**
 * How long a screen waits for a receipt before it says "not confirmed yet". A dropped transaction never gets one, and
 * without a limit its screen waited for ever with Cancel greyed out.
 */
export const TX_TIME_LIMIT_MS = 5 * 60_000

/** viem's name for what took a pending transaction's place. A sped-up copy is 'repriced' and counts as the same one. */
export type TxReplaced = 'cancelled' | 'repriced' | 'replaced'

/** Thrown out of the wait, so `useTx`'s callers can tell the three endings apart. */
export class TxEndError extends Error {
  reverted: boolean

  unconfirmed: boolean

  cancelled: boolean

  /** Unconfirmed because the wait ran out of time (TX_TIME_LIMIT_MS), not because a look-up failed. */
  timedOut: boolean

  constructor(kind: 'reverted' | 'unconfirmed' | 'cancelled', timedOut = false) {
    super(
      kind === 'reverted'
        ? TX_REVERTED_WORDS
        : kind === 'cancelled'
        ? TX_CANCELLED_WORDS
        : timedOut
        ? TX_SLOW_WORDS
        : TX_UNCONFIRMED_WORDS,
    )
    this.reverted = kind === 'reverted'
    this.unconfirmed = kind === 'unconfirmed'
    this.cancelled = kind === 'cancelled'
    this.timedOut = kind === 'unconfirmed' && timedOut
  }
}

/** viem's own time-out, so a wait given `timeout` ends with the same words as one that ran past `limitMs`. */
const isTimeout = (e: unknown) => (e as { name?: string } | undefined)?.name === 'WaitForTransactionReceiptTimeoutError'

/**
 * Waits with the given lookup and throws a TxEndError unless the transaction succeeded. viem resolves a replaced
 * transaction with the replacement's receipt, so a wallet's cancel (a self-send, status success) would pass as success
 * without `onReplaced`. Something else taking its place says nothing about what moved, so that one is unconfirmed.
 * With `limitMs` the wait gives up after that long, as unconfirmed: the transaction may still land.
 */
export async function settle<R extends { status?: string }>(
  wait: (onReplaced: (r: { reason: TxReplaced }) => void) => Promise<R>,
  limitMs?: number,
): Promise<R> {
  let receipt: R
  let replaced: TxReplaced | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const waiting = wait((r) => {
      replaced = r.reason
    })
    receipt = limitMs
      ? await Promise.race([
          waiting,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new TxEndError('unconfirmed', true)), limitMs)
          }),
        ])
      : await waiting
  } catch (e) {
    throw new TxEndError('unconfirmed', isTimeout(e) || (e as TxEndError | undefined)?.timedOut === true)
  } finally {
    clearTimeout(timer)
  }

  if (replaced === 'cancelled') throw new TxEndError('cancelled')
  if (replaced === 'replaced') throw new TxEndError('unconfirmed')
  if (receipt.status !== 'success') throw new TxEndError('reverted')
  return receipt
}
