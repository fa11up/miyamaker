/**
 * How far an upload got before it failed, which decides what can honestly be said about the money:
 * - `free`: nothing to pay, or not reached paying yet;
 * - `paying`: the payment was being sent, and a failure here may come after the money left the wallet;
 * - `paid`: the storage balance covers this upload, so whatever fails next leaves that balance in place.
 */
export type UploadStage = 'free' | 'paying' | 'paid'

/** Plain words for what went wrong. No raw error text ever reaches the screen; it belongs in the console. */
export function uploadErrorWords(error: unknown, stage: UploadStage): string {
  const raw = String((error as { shortMessage?: string })?.shortMessage || (error as Error)?.message || error)
  if (/user rejected|user denied|rejected the request|denied transaction/i.test(raw)) {
    return stage === 'paid'
      ? 'You cancelled it in your wallet. Your payment is safe on your storage balance.'
      : 'You cancelled it in your wallet. Nothing was uploaded.'
  }
  if (/insufficient funds|exceeds the balance/i.test(raw)) {
    return 'This wallet needs a little more ETH on Ethereum to pay for storage and gas.'
  }
  if (/\b402\b|not enough/i.test(raw)) {
    return "The storage service hasn't counted your payment yet. Wait a few minutes, then try again."
  }
  if (stage === 'paid') return "The upload didn't go through. Your payment is safe on your storage balance. Try again."
  if (stage === 'paying') return "The payment didn't finish. Check your wallet for it before you try again."
  return "The upload didn't go through. Try again."
}
