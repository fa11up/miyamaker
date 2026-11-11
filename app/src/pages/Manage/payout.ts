/**
 * What a withdraw would actually pay, from reads that may have failed. A failed read gives `undefined`, never 0:
 * "couldn't check" must not look like "nothing to pay out".
 */

const BPS = 10_000n

/**
 * What `withdraw(token)` would pay the owner now, per contracts/src/libraries/PaymentLib.sol: the owner's balance, plus
 * the artist's part of any proceeds not split yet (withdraw splits them first: protocol and vault cuts round down, the
 * artist gets the rest). Auctions have no unsplit proceeds (pass 0n). Undefined when any read behind it failed.
 */
export function tokenPayout(
  ownerBalance: bigint | undefined,
  unsplit: bigint | undefined,
  protocolBps: number | undefined,
  alignmentBps: number | undefined
): bigint | undefined {
  if (ownerBalance === undefined || unsplit === undefined) return undefined
  if (unsplit === 0n) return ownerBalance
  if (protocolBps === undefined || alignmentBps === undefined) return undefined
  const protocol = (unsplit * BigInt(protocolBps)) / BPS
  const vault = (unsplit * BigInt(alignmentBps)) / BPS
  return ownerBalance + unsplit - protocol - vault
}

/** One token's money on a collection, from per-token reads that may have failed (undefined, never 0). */
export type TokenMoney = {
  token: `0x${string}`
  payout?: bigint
  /** Vault cuts the vault refused (e.g. under its minimum), waiting for flushPendingVaultCut. */
  parkedVault?: bigint
  /** Protocol cuts the treasury refused, waiting for flushPendingProtocolCut. */
  parkedProtocol?: bigint
}

/** "Withdraw all" pays something only if some token has a payout; undefined while any payout is unknown. */
export function anyPayout(rows: readonly TokenMoney[]): boolean | undefined {
  if (rows.some((r) => r.payout !== undefined && r.payout > 0n)) return true
  if (rows.some((r) => r.payout === undefined)) return undefined
  return false
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
