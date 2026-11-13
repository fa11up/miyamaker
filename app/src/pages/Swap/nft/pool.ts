/* eslint-disable no-restricted-syntax -- parseTokenIds reads clearer as a loop with early returns */
/**
 * Pure logic for trading NFTs through MiyaPool v2 (contracts/src/pools). No runtime imports, so `node --test` can load
 * it (tests/trade.test.mts).
 *
 * One pool per collection. Each NFT (or ERC1155 unit) in it backs exactly 1 pool token (1e18 base units).
 * Deposit an NFT: get 1 token. Two ways to take one out:
 *   Random (ERC721 only, not on Robinhood Chain): burn exactly 1 token per piece now; a future block picks the NFT,
 *     then anyone reveals it.
 *   Pick: choose the NFT, burn 1 token per piece and pay the pool's pick fee per piece in IMD or INFER (the picker
 *     chooses among the tokens the pool offers). The fees are set by whoever creates the pool and fixed forever: 0
 *     means that token is not offered, both 0 means picks are free. The fee goes straight to the INFER/IMD alignment
 *     vault as the picker's own contribution.
 */

/**
 * v1 MiyaPoolFactory deployments, which this (v2) app can't talk to: v2 changed redeem and createPool. On a chain whose
 * deployments file still names one of these, Trade says pools aren't on the network yet. DeployMiyaPoolV2 moves it to
 * `miyaPoolFactoryV1` and writes the v2 factory in its place, and pools come back on by themselves.
 */
export const V1_POOL_FACTORIES: Readonly<Record<number, readonly string[]>> = {
  1: ['0x05130d6B13961dc313cd2729Ae4Fd1C22b13efF3'],
}

/** The factory to use, or undefined when there is none or it is a v1 one. */
export function v2PoolFactory<A extends string>(chainId: number, factory: A | undefined): A | undefined {
  if (!factory) return undefined
  const v1 = V1_POOL_FACTORIES[chainId] ?? []
  return v1.some((a) => a.toLowerCase() === factory.toLowerCase()) ? undefined : factory
}

/** 1 NFT = 1e18 pool-token base units. Mirrors MiyaPool.UNIT. */
export const POOL_UNIT = 10n ** 18n

/** MiyaPool.Kind */
export const KIND = { ERC721: 0, ERC1155: 1 } as const
export type PoolKind = (typeof KIND)[keyof typeof KIND]

export const KIND_LABEL: Record<PoolKind, string> = { 0: 'ERC-721', 1: 'ERC-1155' }

export const asKind = (v: unknown): PoolKind | undefined => (v === 0 || v === 1 ? v : undefined)

/** Robinhood Chain's block hashes come from its sequencer, so its pools have no random redeems (MiyaPool.randomEnabled). */
export const ROBINHOOD_CHAIN_ID = 4663
/** Whether a new ERC-721 pool on this chain will have random redeems. ERC-1155 pools never do. */
export const randomOn = (chainId: number) => chainId !== ROBINHOOD_CHAIN_ID

/** Why a pool has no random redeems, in a few words (only asked when `randomEnabled` is false). */
export function noRandomWhy(kind: PoolKind | undefined, chainId: number): string {
  if (kind === KIND.ERC1155) return 'ERC-1155 pools have pick only.'
  if (!randomOn(chainId))
    return 'Robinhood Chain has pick only: its block hashes come from one sequencer, so a draw there would not be fair.'
  return 'This pool has pick only.'
}

/* ---------- the pick fee ---------- */

/** IMD and INFER both have 18 decimals; fees are token wei per piece. */
export const FEE_DECIMALS = 18

export type FeeSymbol = 'IMD' | 'INFER'
export const FEE_SYMBOLS: readonly FeeSymbol[] = ['IMD', 'INFER']

/** A pool's pick fees per piece (token wei); undefined when the read failed. */
export type PickFees = { imdFee?: bigint; inferFee?: bigint }

/**
 * A token amount for people: 1e18 → "1", 3500e18 → "3,500", 0.5e18 → "0.5". Exact (every decimal kept) unless
 * `maxDecimals` cuts it, so a fee is never shown smaller than it is.
 */
export function tokenAmountText(amount: bigint | undefined, decimals = FEE_DECIMALS, maxDecimals = decimals): string {
  if (amount === undefined) return '–'
  const base = 10n ** BigInt(decimals)
  const whole = amount / base
  let frac = (amount % base).toString().padStart(decimals, '0').slice(0, maxDecimals).replace(/0+$/, '')
  if (!frac && amount % base !== 0n) frac = `${'0'.repeat(Math.max(0, maxDecimals - 1))}1`
  return frac ? `${whole.toLocaleString('en-US')}.${frac}` : whole.toLocaleString('en-US')
}

/**
 * A fee typed into the create form, in whole tokens: "1", "3,500", "0.5", "1 IMD". Empty or 0 means not offered (0n).
 * Up to `decimals` decimals.
 */
export function parseTokenAmount(input: string, decimals = FEE_DECIMALS): { amount?: bigint; error?: string } {
  const t = input
    .trim()
    .replace(/\s*(IMD|INFER)$/i, '')
    .trim()
  if (!t) return { amount: 0n }
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/.exec(t)
  if (!m || (!m[1] && !m[2])) return { error: `"${input.trim()}" is not an amount. Use a number like 1 or 3500.` }
  const whole = (m[1] ?? '0').replace(/,/g, '')
  const frac = (m[2] ?? '').replace(/0+$/, '')
  if (frac.length > decimals) return { error: `Use at most ${decimals} decimals.` }
  if (whole.length > 30) return { error: 'That amount is too large.' }
  return { amount: BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0') }
}

/**
 * A fee against the vault's least contribution for that token. 0 (not offered) is always fine. A nonzero fee needs the
 * minimum: when it couldn't be read the answer is "unknown", never a guess.
 */
export function checkFee(
  amount: bigint,
  minimum: bigint | undefined,
  symbol: FeeSymbol
): { ok: true } | { ok: false; unknown?: boolean; error: string } {
  if (amount === 0n) return { ok: true }
  if (minimum === undefined)
    return {
      ok: false,
      unknown: true,
      error: `Couldn't read the vault's least ${symbol} amount, so this can't be checked.`,
    }
  if (amount < minimum)
    return {
      ok: false,
      error: `The vault takes at least ${tokenAmountText(minimum)} ${symbol}. Use that or more, or 0.`,
    }
  return { ok: true }
}

/** The tokens a pool takes pick fees in, IMD first, with the fee per piece. Empty = picks are free (or unknown). */
export function offeredFees(fees: PickFees): { symbol: FeeSymbol; fee: bigint }[] {
  const out: { symbol: FeeSymbol; fee: bigint }[] = []
  if (fees.imdFee) out.push({ symbol: 'IMD', fee: fees.imdFee })
  if (fees.inferFee) out.push({ symbol: 'INFER', fee: fees.inferFee })
  return out
}

/** Whether both fee reads answered. */
export const feesKnown = (fees: PickFees) => fees.imdFee !== undefined && fees.inferFee !== undefined

/** Picks cost only the pool token: neither fee is set (and both reads answered). */
export const picksFreeOf = (fees: PickFees) => fees.imdFee === 0n && fees.inferFee === 0n

/**
 * Which offered token a pick pays in: the one chosen, if the pool offers it, else the first offered. Undefined when
 * picks are free.
 */
export function chooseFeeToken(fees: PickFees, wanted?: FeeSymbol): { symbol: FeeSymbol; fee: bigint } | undefined {
  const offered = offeredFees(fees)
  return offered.find((o) => o.symbol === wanted) ?? offered[0]
}

/** The pick fee for `units` pieces: fee per piece × pieces (MiyaPool.pickFee). */
export const pickFeeTotal = (feePerPiece: bigint, units: number | bigint) => feePerPiece * BigInt(units)

/** The pick fee per NFT in words: "1 IMD or 3,500 INFER", "free", or undefined when a fee read failed. */
export function pickFeeAmounts(fees: PickFees, or = ' or '): string | undefined {
  if (!feesKnown(fees)) return undefined
  const offered = offeredFees(fees)
  if (!offered.length) return 'free'
  return offered.map((o) => `${tokenAmountText(o.fee)} ${o.symbol}`).join(or)
}

/** A pool's pick price in words for chips and rows: "Pick +1 IMD / 3,500 INFER", "Pick free", "Pick +?". */
export function pickFeeWords(fees: PickFees): string {
  const amounts = pickFeeAmounts(fees, ' / ')
  if (amounts === undefined) return 'Pick +?'
  return amounts === 'free' ? 'Pick free' : `Pick +${amounts}`
}

/**
 * Whether taking an NFT out costs more than 1 pool token: only when random is off (or unknown) and picks have a fee
 * (or the fee is unknown). Prices compare at the token price; the app has no IMD/INFER price, so the fee is said in
 * words, never converted.
 */
export const buyNeedsFee = (pool: PickFees & { randomEnabled?: boolean }) =>
  !(pool.randomEnabled === true || picksFreeOf(pool))

/**
 * A pool's line in the best-price comparison: 1 pool token at its price buys a random NFT where random is on, or a
 * picked one where picks are free. Where every way out pays a pick fee in IMD or INFER, the token price is not the cost
 * (the app has no IMD/INFER price), so the pool isn't ranked: undefined. Its own line names the fee instead.
 */
export function poolBuyQuote<P>(
  pool: PickFees & { randomEnabled?: boolean },
  price: P
): { where: string; price: P } | undefined {
  if (buyNeedsFee(pool)) return undefined
  return {
    where: pool.randomEnabled === true && !picksFreeOf(pool) ? 'on MiyaPool (a random NFT)' : 'on MiyaPool',
    price,
  }
}

/** The fee step of a pick: nothing to pay, approve the pool for the total first, or ready to pick. */
export function feeStep(
  total: bigint,
  allowance: bigint | undefined,
  balance: bigint | undefined
): 'free' | 'unknown' | 'short' | 'approve' | 'ready' {
  if (total === 0n) return 'free'
  if (balance === undefined || allowance === undefined) return 'unknown'
  if (balance < total) return 'short'
  return allowance < total ? 'approve' : 'ready'
}

/** Pool tokens a redeem of `units` NFTs burns, random or pick: exactly 1 each. */
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
/**
 * Quotrons and Chain Mancers, the Robinhood Chain collections we list, refuse transfers by an approved operator, so
 * approve-then-deposit reverts there (checked on a fork, 2026-11-06). Sending straight to the pool works, one at a time.
 */
export const directSendOnly = (chainId: number) => chainId === 4663

export type DepositPlan = 'transfer-721' | 'transfer-721-each' | 'transfer-1155' | 'approve' | 'deposit'

export function depositPlan(
  kind: PoolKind,
  count: number,
  approvedForAll: boolean | undefined,
  directOnly = false
): DepositPlan {
  if (kind === KIND.ERC1155) return 'transfer-1155'
  if (count <= 1) return 'transfer-721'
  if (directOnly) return 'transfer-721-each'
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
  /** Pick fee per piece in IMD (token wei; 0 = not offered), fixed at creation; undefined when the read failed. */
  imdFee?: bigint
  /** Pick fee per piece in INFER, likewise. */
  inferFee?: bigint
  /** Random redeems on this pool; undefined when the read failed. */
  randomEnabled?: boolean
  symbol: string
  name: string
  collectionName?: string
  /** NFTs (or ERC1155 units) in the pool; undefined when the read failed. */
  held?: bigint
}

/**
 * Whether `address` is the pool the factory made for its collection: the factory's poolOf answer must be that
 * same address. A pool page opened from a link shows only such a pool, never any contract that answers collection()
 * and kind(). undefined = not answered yet (or the read failed).
 */
export function factoryMadePool(poolOfAnswer: string | undefined, address: string): boolean | undefined {
  if (poolOfAnswer === undefined) return undefined
  return poolOfAnswer.toLowerCase() === address.toLowerCase()
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

export type PoolLookup = { state: 'unknown' } | { state: 'none' } | { state: 'found'; address: string }

/**
 * A collection's pool from the factory's poolOf read. A read that gave no answer (`undefined`) is `unknown`, never
 * `none`, so a failed read never offers to start a pool that already exists.
 */
export function poolLookup(
  poolOf: string | undefined,
  zero = '0x0000000000000000000000000000000000000000'
): PoolLookup {
  if (poolOf === undefined) return { state: 'unknown' }
  return poolOf.toLowerCase() === zero ? { state: 'none' } : { state: 'found', address: poolOf }
}

/**
 * Picked ids a pending random redeem has locked (MiyaPool.isLocked), and picked ids whose lock read failed. Picks
 * can go ahead only when both are empty.
 */
export function pickLocks(picked: readonly string[], lockOf: (id: string) => boolean | undefined) {
  const locked: string[] = []
  const unknown: string[] = []
  for (const id of picked) {
    const l = lockOf(id)
    if (l === undefined) unknown.push(id)
    else if (l) locked.push(id)
  }

  return { locked, unknown }
}

/** NFTs in a pool not promised to an open draw; undefined when either read failed. */
export function freeUnits(held: bigint | undefined, pending: bigint | undefined): number | undefined {
  if (held === undefined || pending === undefined) return undefined
  return held > pending ? Number(held - pending) : 0
}

/**
 * What useOwnership knows per id: the amount held, or `undefined` when the read gave no answer. A revert from
 * ownerOf / balanceOf is a real "not held" (0n); an RPC failure is not.
 */
export type HeldRead = { status: 'success'; result: unknown } | { status: 'failure'; reverted: boolean }
export function heldAmount(r: HeldRead | undefined, erc721: boolean, owner: string | undefined): bigint | undefined {
  if (!r) return undefined
  if (r.status !== 'success') return r.reverted ? 0n : undefined
  if (erc721) return String(r.result).toLowerCase() === owner?.toLowerCase() ? 1n : 0n
  return typeof r.result === 'bigint' ? r.result : undefined
}
