/* eslint-disable no-restricted-syntax -- parseTokenIds reads clearer as a loop with early returns */
/**
 * Pure logic for trading NFTs through MiyaPool (contracts/src/pools). No runtime imports, so `node --test` can load
 * it (tests/trade.test.mts).
 *
 * A pool holds NFTs of one collection. Each NFT (or ERC1155 unit) in it backs exactly 1 pool token (1e18 base units).
 * Deposit an NFT: get 1 token. Burn 1 token: take one back. No fees. The redeem mode is fixed per pool:
 *   TARGETED: pick the NFT you want.
 *   RANDOM (ERC721 only): pay now, a future block picks the NFT, then anyone reveals it.
 */

/** 1 NFT = 1e18 pool-token base units. Mirrors MiyaPool.UNIT. */
export const POOL_UNIT = 10n ** 18n

/** MiyaPool.Kind */
export const KIND = { ERC721: 0, ERC1155: 1 } as const
export type PoolKind = (typeof KIND)[keyof typeof KIND]

/** MiyaPool.RedeemMode */
export const MODE = { TARGETED: 0, RANDOM: 1 } as const
export type PoolMode = (typeof MODE)[keyof typeof MODE]

export const MODE_LABEL: Record<PoolMode, string> = { 0: 'Pick', 1: 'Random' }
export const MODE_HINT: Record<PoolMode, string> = {
  0: 'You choose which NFT you get.',
  1: 'You get a random NFT from the pool.',
}
export const KIND_LABEL: Record<PoolKind, string> = { 0: 'ERC-721', 1: 'ERC-1155' }

export const asKind = (v: unknown): PoolKind | undefined => (v === 0 || v === 1 ? v : undefined)
/** Robinhood Chain's block hashes come from its sequencer, so the factory refuses Random pools there. */
export const modesOn = (chainId: number): PoolMode[] =>
  chainId === 4663 ? [MODE.TARGETED] : [MODE.TARGETED, MODE.RANDOM]

export const asMode = (v: unknown): PoolMode | undefined => (v === 0 || v === 1 ? v : undefined)

/** Pool tokens needed to take `units` NFTs out. */
export const redeemCost = (units: number | bigint) => POOL_UNIT * BigInt(units)

/** How many whole NFTs a pool-token balance can take out. */
export const wholeUnits = (balance: bigint | undefined) => (balance && balance > 0n ? Number(balance / POOL_UNIT) : 0)

/** A pool-token amount in NFTs, e.g. 2500000000000000000n → "2.5". */
export function unitsText(amount: bigint | undefined): string {
  if (amount === undefined) return '–'
  const whole = amount / POOL_UNIT
  const frac = amount % POOL_UNIT
  if (frac === 0n) return whole.toLocaleString('en-US')
  const digits = ((frac * 10_000n) / POOL_UNIT).toString().padStart(4, '0').replace(/0+$/, '')
  return digits ? `${whole.toLocaleString('en-US')}.${digits}` : `${whole.toLocaleString('en-US')}.0001`
}

const MAX_IDS = 50

/**
 * Token ids typed by a person: "12", "1, 2, 3", "4-7", "#9". Returns the unique ids in order, or a plain error.
 * Ranges are capped so a typo like "1-100000" cannot ask for a huge list.
 */
export function parseTokenIds(input: string): { ids: bigint[]; error?: string } {
  const ids: bigint[] = []
  const seen = new Set<string>()
  const push = (id: bigint) => {
    const k = id.toString()
    if (!seen.has(k)) {
      seen.add(k)
      ids.push(id)
    }
  }

  const parts = input
    .split(/[\s,]+/)
    .map((p) => p.replace(/^#/, '').trim())
    .filter(Boolean)
  for (const part of parts) {
    const range = /^(\d+)-(\d+)$/.exec(part)
    if (range) {
      const a = BigInt(range[1]!)
      const b = BigInt(range[2]!)
      if (b < a) return { ids: [], error: `"${part}" goes backwards. Write the smaller number first.` }
      if (b - a >= BigInt(MAX_IDS)) return { ids: [], error: `"${part}" is too many at once. Use up to ${MAX_IDS}.` }
      for (let i = a; i <= b; i += 1n) push(i)
    } else if (/^\d+$/.test(part)) {
      push(BigInt(part))
    } else {
      return { ids: [], error: `"${part}" is not a token number.` }
    }

    if (ids.length > MAX_IDS) return { ids: [], error: `That is more than ${MAX_IDS} NFTs. Do it in smaller batches.` }
  }

  return { ids }
}

/**
 * How to put NFTs into a pool with the fewest transactions:
 *  - ERC1155, any number: one safeBatchTransferFrom on the collection straight to the pool (no approval).
 *  - ERC721, one NFT: one safeTransferFrom on the collection straight to the pool (no approval).
 *  - ERC721, several: pool.deposit, which needs the pool approved to move them (one-time setApprovalForAll).
 * The pool mints the tokens in its receive hook in every case.
 */
export type DepositPlan = 'transfer-721' | 'transfer-1155' | 'approve' | 'deposit'

export function depositPlan(kind: PoolKind, count: number, approvedForAll: boolean | undefined): DepositPlan {
  if (kind === KIND.ERC1155) return 'transfer-1155'
  if (count <= 1) return 'transfer-721'
  return approvedForAll ? 'deposit' : 'approve'
}

/** A random redeem in flight, as read from MiyaPool.commits(id). */
export type CommitRow = {
  id: bigint
  recipient: string
  targetBlock: bigint
  amount: number
}

/** Commits still waiting for a reveal that send NFTs to `owner`, oldest first. */
export function pendingFor(rows: (CommitRow | undefined)[], owner: string | undefined): CommitRow[] {
  if (!owner) return []
  const me = owner.toLowerCase()
  return rows
    .filter((r): r is CommitRow => !!r && r.amount > 0 && r.recipient.toLowerCase() === me)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

/** Plain blockhash covers 256 blocks. Past that the pool falls back to the EIP-2935 history or picks a new block. */
export const BLOCKHASH_WINDOW = 256n
/** MiyaPool.MAX_COMMIT_UNITS: the most NFTs one random draw can take. */
export const MAX_DRAW_UNITS = 50

export type CommitPhase = 'waiting' | 'ready' | 'late'

/** A commit can be revealed once a block after its target block exists. */
export function commitPhase(targetBlock: bigint, currentBlock: bigint | undefined): CommitPhase {
  if (currentBlock === undefined || currentBlock <= targetBlock) return 'waiting'
  return currentBlock - targetBlock > BLOCKHASH_WINDOW ? 'late' : 'ready'
}

/** Blocks left until the commit can be revealed (0 when it can be revealed now). */
export const blocksToReveal = (targetBlock: bigint, currentBlock: bigint | undefined) =>
  currentBlock === undefined ? 2 : currentBlock > targetBlock ? 0 : Number(targetBlock - currentBlock + 1n)

/** Newest-first indexes into factory.allPools for one page. */
export function poolIndexes(total: number, limit: number): number[] {
  const n = Math.max(0, Math.min(total, limit))
  return Array.from({ length: n }, (_, i) => total - 1 - i)
}

export type PoolSummary = {
  address: string
  collection: string
  kind: PoolKind
  mode: PoolMode
  symbol: string
  name: string
  collectionName?: string
  held: bigint
}

/** Pools whose name, ticker, collection name or addresses match `query` (case-insensitive). */
export function filterPools<T extends PoolSummary>(pools: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return pools
  return pools.filter((p) =>
    [p.symbol, p.name, p.collectionName || '', p.address, p.collection].some((s) => s.toLowerCase().includes(q))
  )
}

/** The pool name without the contract's "miya pool: " prefix. */
export const poolTitle = (p: Pick<PoolSummary, 'name' | 'collectionName' | 'collection'>) =>
  p.collectionName || p.name.replace(/^miya pool:\s*/i, '') || `${p.collection.slice(0, 6)}…${p.collection.slice(-4)}`

/** What a finished reveal gave the buyer. `held`: ids the collection refused to send, so the pool keeps them to claim. */
export function revealWords(ids: readonly bigint[], held: readonly bigint[] = []) {
  const list = (xs: readonly bigint[]) => xs.map((id) => `#${id}`).join(', ')
  const sent = ids.filter((id) => !held.includes(id))
  if (!held.length) return `You got ${list(ids)}. It is in your wallet.`
  const keep = `The collection refused to send ${list(held)}, so the pool is holding it for you to claim below.`
  return sent.length ? `You got ${list(sent)}, now in your wallet. ${keep}` : keep
}
