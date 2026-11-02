/* eslint-disable no-restricted-syntax, no-continue, no-await-in-loop, no-plusplus -- bounded, sequential RPC/parse loops read clearer as loops */
/**
 * Mint event plumbing that doesn't touch the network: turning Transfer logs into mint events,
 * de-duplicating them across overlapping polls, and choosing the next block range to poll.
 * Import-free (types only) so `node --test` runs it directly.
 */

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export interface TransferLogLike {
  address: string
  args: { from?: string; to?: string; tokenId?: bigint | number | string }
  transactionHash: string | null
  logIndex: number | null
  blockNumber: bigint | null
}

export interface MintEvent {
  key: string
  chainId: number
  collection: string
  tokenId: string
  to: string
  txHash: string
  logIndex: number
  blockNumber: bigint
  /** fired by the dev trigger, not the chain */
  demo?: boolean
  /** dev trigger only: celebrate as if the connected wallet minted */
  forceSelf?: boolean
}

export const mintKey = (txHash: string, logIndex: number) => `${txHash.toLowerCase()}:${logIndex}`

/** Bounded "have we seen this?" set; the oldest keys fall out first. */
export function createSeenSet(limit = 1000) {
  const seen = new Set<string>()
  return {
    /** true when the key is new (and records it) */
    add(key: string): boolean {
      if (seen.has(key)) return false
      seen.add(key)
      if (seen.size > limit) {
        const oldest = seen.values().next().value
        if (oldest !== undefined) seen.delete(oldest)
      }

      return true
    },
    has: (key: string) => seen.has(key),
    get size() {
      return seen.size
    },
  }
}

export type SeenSet = ReturnType<typeof createSeenSet>

/** Mints only (from == 0x0), new ones only, oldest first. */
export function toMintEvents(logs: TransferLogLike[], chainId: number, seen: SeenSet): MintEvent[] {
  const out: MintEvent[] = []
  const sorted = [...logs].sort((a, b) => {
    const ba = a.blockNumber ?? 0n
    const bb = b.blockNumber ?? 0n
    if (ba !== bb) return ba < bb ? -1 : 1
    return (a.logIndex ?? 0) - (b.logIndex ?? 0)
  })
  for (const log of sorted) {
    const { from, to, tokenId } = log.args || {}
    if (!log.transactionHash || log.logIndex === null || log.logIndex === undefined) continue
    if (!from || from.toLowerCase() !== ZERO_ADDRESS) continue
    if (!to || tokenId === undefined || tokenId === null) continue
    const key = mintKey(log.transactionHash, log.logIndex)
    if (!seen.add(key)) continue
    out.push({
      key,
      chainId,
      collection: log.address.toLowerCase(),
      tokenId: BigInt(tokenId).toString(),
      to,
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber ?? 0n,
    })
  }

  return out
}

/**
 * Next block range to poll. `cursor` is the last block already processed (undefined on the first
 * poll). Overlaps a couple of blocks behind the cursor to survive small reorgs / lagging RPC nodes:
 * the seen-set drops the duplicates.
 */
export function nextRange(
  cursor: bigint | undefined,
  latest: bigint,
  { maxSpan = 20n, overlap = 2n }: { maxSpan?: bigint; overlap?: bigint } = {}
): { fromBlock: bigint; toBlock: bigint } | undefined {
  if (latest <= 0n) return undefined
  let fromBlock = cursor === undefined ? latest - maxSpan + 1n : cursor + 1n - overlap
  if (latest - fromBlock + 1n > maxSpan) fromBlock = latest - maxSpan + 1n
  if (fromBlock < 0n) fromBlock = 0n
  if (cursor !== undefined && latest <= cursor && overlap === 0n) return undefined
  return { fromBlock, toBlock: latest }
}

export function shortAddress(address: string | undefined): string {
  if (!address) return ''
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

export const sameAddress = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
