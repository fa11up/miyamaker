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

/** How many editions' getEdition reads go into the overview's totals (one multicall), whatever the table shows. */
export const TOTALS_CAP = 500

/**
 * The overview's "Sold" for an editions collection, from every edition (up to TOTALS_CAP), not the table's page.
 * Any failed or missing read gives `minted: undefined` (not a smaller total). `supply` is undefined when any edition
 * is open (no cap). `scope` says when only the first TOTALS_CAP were counted.
 */
export function editionTotals(
  reads: readonly ({ minted: bigint; supply: bigint } | undefined)[] | undefined,
  totalIds: number | undefined,
  cap = TOTALS_CAP
): { minted?: bigint; supply?: bigint; scope?: string } {
  if (!reads || totalIds === undefined) return {}
  const counted = Math.min(totalIds, cap)
  if (reads.length !== counted || reads.some((e) => !e)) return {}
  const eds = reads as { minted: bigint; supply: bigint }[]
  const minted = eds.reduce((s, e) => s + e.minted, 0n)
  const supply = eds.length && !eds.some((e) => e.supply === 0n) ? eds.reduce((s, e) => s + e.supply, 0n) : undefined
  return { minted, supply, scope: totalIds > cap ? `of the first ${cap} of ${totalIds} editions` : undefined }
}
