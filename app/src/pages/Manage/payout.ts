/**
 * What a withdraw would actually pay, from reads that may have failed. A failed read gives `undefined`, never 0:
 * "couldn't check" must not look like "nothing to pay out".
 */

/** ERC1155Instance.withdraw(amount) allows at most totalProceeds - totalWithdrawn. */
export function editionsWaiting(proceeds: bigint | undefined, withdrawn: bigint | undefined): bigint | undefined {
  if (proceeds === undefined || withdrawn === undefined) return undefined
  return proceeds > withdrawn ? proceeds - withdrawn : 0n
}

/** ERC721DropInstance.withdraw() splits balance - pendingVaultCut - pendingProtocolCut. */
export function dropWaiting(
  balance: bigint | undefined,
  pendingVaultCut: bigint | undefined,
  pendingProtocolCut: bigint | undefined
): bigint | undefined {
  if (balance === undefined || pendingVaultCut === undefined || pendingProtocolCut === undefined) return undefined
  const parked = pendingVaultCut + pendingProtocolCut
  return balance > parked ? balance - parked : 0n
}

/** Reads cap the list; say so instead of showing the first N as if they were all. */
export function cappedNote(shown: number, total: number | undefined, noun: string): string | undefined {
  if (total === undefined || total <= shown) return undefined
  return `Showing the first ${shown} of ${total} ${noun}.`
}
