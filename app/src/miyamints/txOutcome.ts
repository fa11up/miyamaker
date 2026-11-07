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

/** viem's name for what took a pending transaction's place. A sped-up copy is 'repriced' and counts as the same one. */
export type TxReplaced = 'cancelled' | 'repriced' | 'replaced'

/** Thrown out of the wait, so `useTx`'s callers can tell the three endings apart. */
export class TxEndError extends Error {
  reverted: boolean

  unconfirmed: boolean

  cancelled: boolean

  constructor(kind: 'reverted' | 'unconfirmed' | 'cancelled') {
    super(
      kind === 'reverted' ? TX_REVERTED_WORDS : kind === 'cancelled' ? TX_CANCELLED_WORDS : TX_UNCONFIRMED_WORDS,
    )
    this.reverted = kind === 'reverted'
    this.unconfirmed = kind === 'unconfirmed'
    this.cancelled = kind === 'cancelled'
  }
}

/**
 * Waits with the given lookup and throws a TxEndError unless the transaction succeeded. viem resolves a replaced
 * transaction with the replacement's receipt, so a wallet's cancel (a self-send, status success) would pass as success
 * without `onReplaced`. Something else taking its place says nothing about what moved, so that one is unconfirmed.
 */
export async function settle<R extends { status?: string }>(
  wait: (onReplaced: (r: { reason: TxReplaced }) => void) => Promise<R>,
): Promise<R> {
  let receipt: R
  let replaced: TxReplaced | undefined
  try {
    receipt = await wait((r) => {
      replaced = r.reason
    })
  } catch {
    throw new TxEndError('unconfirmed')
  }

  if (replaced === 'cancelled') throw new TxEndError('cancelled')
  if (replaced === 'replaced') throw new TxEndError('unconfirmed')
  if (receipt.status !== 'success') throw new TxEndError('reverted')
  return receipt
}
