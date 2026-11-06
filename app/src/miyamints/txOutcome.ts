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

/** Thrown out of the wait, so `useTx`'s callers can tell the three endings apart. */
export class TxEndError extends Error {
  reverted: boolean

  unconfirmed: boolean

  constructor(kind: 'reverted' | 'unconfirmed') {
    super(kind === 'reverted' ? TX_REVERTED_WORDS : TX_UNCONFIRMED_WORDS)
    this.reverted = kind === 'reverted'
    this.unconfirmed = kind === 'unconfirmed'
  }
}

/** Waits with the given lookup and throws a TxEndError unless the transaction succeeded. */
export async function settle<R extends { status?: string }>(wait: () => Promise<R>): Promise<R> {
  let receipt: R
  try {
    receipt = await wait()
  } catch {
    throw new TxEndError('unconfirmed')
  }

  if (receipt.status !== 'success') throw new TxEndError('reverted')
  return receipt
}
