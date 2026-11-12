/* eslint-disable no-restricted-syntax, no-continue -- planning and log reading read clearer as loops with early skips */
/**
 * Batched MiyaPool orders: sell several NFTs into one pool, or buy several out of one, in as few transactions as the
 * pool allows. Pure planning and encoding, no React. Only `viem` is imported (no relative runtime imports), so
 * `node --test` loads it directly (tests/pool-batch.test.mts); the small ABI below is checked against abi.ts there,
 * and abi.ts is checked against the contracts by tests/abi-drift.test.mts.
 *
 * How a pool trade works (contracts/src/pools/MiyaPool.sol): every NFT (or ERC-1155 unit) in a pool backs exactly
 * 1e18 pool tokens. There are no fees. A batch is "one transaction per pool":
 *
 *   SELL (any mode)
 *     ERC-1155, any number:   collection.safeBatchTransferFrom(you → pool)       1 tx, no approval
 *     ERC-721, one:           collection.safeTransferFrom(you → pool)            1 tx, no approval
 *     ERC-721, several:       collection.setApprovalForAll(pool, true)           its own press, only if not yet allowed
 *                             pool.deposit(ids, [], you)                         1 tx
 *     ERC-721, several, on a chain whose collections refuse operators (Robinhood Chain, see pool.ts directSendOnly):
 *                             one safeTransferFrom per NFT                       N txs (or one wallet batch)
 *     You receive 1 pool token per unit, minted to you. Turning those into ETH is a separate 0x swap on the Tokens
 *     tab, a second transaction, priced then. This module does not plan it.
 *
 *   BUY, TARGETED pool (pick ids)
 *     [get tokens]            you need units × 1 pool token; any shortfall is bought with a 0x swap on the Tokens
 *                             tab first: a separate transaction (plus an ERC-20 approval if paying with a token)
 *     pool.redeem(ids, amounts, you)                                              1 tx; burns from you, no allowance
 *
 *   BUY, RANDOM pool (ERC-721 only; a batch is "N random NFTs", ids cannot be chosen)
 *     [get tokens]            as above
 *     pool.commitRedeem(N, you)                                                   1 tx; pays now, N ≤ 50
 *     pool.revealRedeem(id) for every older unsettled draw, then for yours        1 tx each, at least one block
 *                             later; anyone can reveal, and an older draw's NFTs go to whoever made it
 */
import {
  type Address,
  decodeErrorResult,
  decodeFunctionData,
  encodeFunctionData,
  type Hex,
  parseAbi,
  parseEventLogs,
} from 'viem'

/* ---------- constants (mirrors pool.ts / MiyaPool.sol; repeated so this file has no relative imports) ---------- */

export const POOL_UNIT = 10n ** 18n
/** MiyaPool.MAX_COMMIT_UNITS: the most NFTs one random draw can take. */
export const MAX_DRAW = 50
/** The most ids one deposit / redeem is planned with, so it fits comfortably in a block. Same cap as parseTokenIds. */
export const MAX_BATCH = 50
const ZERO = '0x0000000000000000000000000000000000000000'
const KIND_721 = 0
const KIND_1155 = 1
const MODE_TARGETED = 0
/** Robinhood Chain: our collections there refuse an approved operator, so several ERC-721s go one transfer each. */
const directSendOnly = (chainId: number) => chainId === 4663

/** The pool calls and events used here. Each line is also in abi.ts poolAbi (tests/pool-batch.test.mts checks). */
export const poolBatchAbi = parseAbi([
  'function deposit(uint256[] ids, uint256[] amounts, address to)',
  'function redeem(uint256[] ids, uint256[] amounts, address to)',
  'function commitRedeem(uint256 amount, address to) returns (uint256 commitId)',
  'function revealRedeem(uint256 commitId)',
  'event Deposited(address indexed from, address indexed to, uint256[] ids, uint256[] amounts)',
  'event Redeemed(address indexed by, address indexed to, uint256[] ids, uint256[] amounts)',
  'event RedeemCommitted(uint256 indexed commitId, address indexed by, address indexed to, uint256 amount, uint256 targetBlock)',
  'event RedeemRearmed(uint256 indexed commitId, uint256 targetBlock)',
  'event RedeemRevealed(uint256 indexed commitId, uint256[] ids)',
  'event RedeemEscrowed(uint256 indexed commitId, address indexed recipient, uint256 id)',
  'error WrongMode()',
  'error EmptyRequest()',
  'error LengthMismatch()',
  'error NotHeld(uint256 id)',
  'error InsufficientHeld()',
  'error TooEarly()',
  'error UnknownCommit()',
  'error NotNextCommit()',
  'error CommitTooLarge()',
  'error InvalidRecipient()',
  'error AlreadyHeld(uint256 id)',
  'error RevealGasTooLow()',
  'error TransferNotReceived(uint256 id)',
  'error InsufficientBalance()',
  'error NotCollection()',
])

/** The collection calls used here (abi.ts erc721Abi / erc1155Abi). */
export const collectionBatchAbi = parseAbi([
  'function setApprovalForAll(address operator, bool approved)',
  'function safeTransferFrom(address from, address to, uint256 id, bytes data)',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
])

/** Transfer logs, read from receipts only. ERC-20 and ERC-721 Transfer share a topic; the log's address tells them apart. */
const transferAbi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])
const transfer721Abi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 indexed id)'])
const transfer1155Abi = parseAbi([
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
])

/* ---------- types ---------- */

export type PoolKindN = 0 | 1
export type PoolModeN = 0 | 1

/** What the planner needs to know about the pool (usePool's Pool fits). */
export type PoolRef = {
  address: Address
  collection: Address
  kind: PoolKindN
  mode: PoolModeN
  symbol: string
}

export type BatchItem = { id: bigint; amount?: bigint }

export type SellInput = {
  side: 'sell'
  chainId: number
  account: Address
  pool: PoolRef
  items: readonly BatchItem[]
  /** Units of each id the account holds, keyed by id string. Missing or undefined = the read gave no answer. */
  owned: Readonly<Record<string, bigint | undefined>>
  /** ERC-721: whether the pool may already move the account's NFTs. undefined = unknown. */
  approvedForAll?: boolean
}

export type BuyInput = {
  side: 'buy'
  chainId: number
  account: Address
  pool: PoolRef
  /** Pool-token balance of the account. undefined = unknown. */
  balance: bigint | undefined
  /** TARGETED pools: the ids wanted. */
  items?: readonly BatchItem[]
  /** TARGETED pools: units of each id the pool holds (isHeld → 1n/0n, or unitsOf), keyed by id string. */
  poolHeld?: Readonly<Record<string, bigint | undefined>>
  /** RANDOM pools: how many NFTs to draw. */
  count?: number
  /** RANDOM pools: NFTs not promised to an open draw (heldUnits − pendingUnits); undefined = unknown. */
  free?: bigint
}

export type PoolBatchInput = SellInput | BuyInput

export type ExcludeReason =
  | 'duplicate'
  | 'bad-amount'
  | 'not-owned'
  | 'not-in-pool'
  | 'too-many'
  | 'random-pool'
  | 'not-enough-free'

export type Excluded = { id?: bigint; amount?: bigint; reason: ExcludeReason; words: string }

export type Line = { id: bigint; amount: bigint; tokens: bigint; words: string }

export type Call = { to: Address; data: Hex; value: bigint }

export type StepKey = 'approve' | 'send' | 'deposit' | 'get-tokens' | 'redeem' | 'commit' | 'reveal'

export type PoolStep = {
  key: StepKey
  /** Short button-sized words. */
  title: string
  /** What it does, in plain words. */
  words: string
  /** The transaction to send. Absent for 'get-tokens' (a 0x swap the Tokens tab prices and builds) and for
   *  'reveal' (its draw id comes from the commit's receipt: use revealCalls). */
  call?: Call
  /** Every step is its own transaction; this says whether it can only go after the one before it has landed. */
  afterPrevious: boolean
}

export type PoolBatchPlan = {
  side: 'sell' | 'buy'
  pool: PoolRef
  account: Address
  lines: Line[]
  excluded: Excluded[]
  totals: {
    /** NFTs (ERC-1155 units) in the batch. */
    units: bigint
    /** Pool tokens (base units) received on a sell, or burned on a buy. Exactly units × 1e18: the pool has no fees. */
    tokens: bigint
    /** Buy: pool-token balance now; undefined when unknown. */
    have?: bigint
    /** Buy: pool tokens still to get before the redeem / commit; undefined when the balance is unknown. */
    shortfall?: bigint
  }
  steps: PoolStep[]
  /** Transactions the person signs, counting a token swap and each reveal as one. */
  transactions: number
  /** Plain words for what the person gets. */
  receive: string
  /** Set when the plan cannot be sent as it stands (an unknown read, nothing left to trade). */
  blocked?: string
  notes: string[]
}

/* ---------- helpers ---------- */

const key = (id: bigint) => id.toString()
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const plural = (n: bigint | number, word: string) => `${n.toString()} ${word}${n.toString() === '1' ? '' : 's'}`

/** A pool-token amount in whole tokens, e.g. 2500000000000000000n → "2.5". */
export function tokensText(amount: bigint): string {
  const whole = amount / POOL_UNIT
  const frac = amount % POOL_UNIT
  if (frac === 0n) return whole.toString()
  const digits = ((frac * 10_000n) / POOL_UNIT).toString().padStart(4, '0').replace(/0+$/, '')
  return digits ? `${whole}.${digits}` : `${whole}.0001`
}

/** Drops duplicates, bad amounts and anything past MAX_BATCH; ERC-721 amounts are always 1. */
function cleanItems(
  items: readonly BatchItem[],
  kind: PoolKindN,
  excluded: Excluded[]
): { id: bigint; amount: bigint }[] {
  const seen = new Set<string>()
  const out: { id: bigint; amount: bigint }[] = []
  for (const item of items) {
    const amount = item.amount ?? 1n
    if (seen.has(key(item.id))) {
      excluded.push({ id: item.id, amount, reason: 'duplicate', words: `#${item.id} is listed twice; it counts once.` })
      continue
    }

    seen.add(key(item.id))
    if (amount <= 0n || (kind === KIND_721 && amount !== 1n)) {
      excluded.push({
        id: item.id,
        amount,
        reason: 'bad-amount',
        words:
          kind === KIND_721
            ? `#${item.id}: an ERC-721 moves one at a time.`
            : `#${item.id}: the amount must be at least 1.`,
      })
      continue
    }

    if (out.length >= MAX_BATCH) {
      excluded.push({ id: item.id, amount, reason: 'too-many', words: `#${item.id}: at most ${MAX_BATCH} per batch.` })
      continue
    }

    out.push({ id: item.id, amount })
  }

  return out
}

const countTxs = (steps: PoolStep[]) => steps.length

/* ---------- the planner ---------- */

function lineFor(it: { id: bigint; amount: bigint }, pool: PoolRef, side: 'sell' | 'buy'): Line {
  const tokens = it.amount * POOL_UNIT
  const what = pool.kind === KIND_1155 ? `${it.amount} × #${it.id}` : `#${it.id}`
  return {
    id: it.id,
    amount: it.amount,
    tokens,
    words:
      side === 'sell'
        ? `${what} → ${tokensText(tokens)} ${pool.symbol}`
        : `${what} for ${tokensText(tokens)} ${pool.symbol}`,
  }
}

function planSell(input: SellInput): PoolBatchPlan {
  const { pool, account, chainId } = input
  const excluded: Excluded[] = []
  const notes: string[] = []
  let blocked: string | undefined
  const unknown: bigint[] = []

  const lines: Line[] = []
  for (const it of cleanItems(input.items, pool.kind, excluded)) {
    const have = input.owned[key(it.id)]
    if (have === undefined) {
      unknown.push(it.id)
      lines.push(lineFor(it, pool, 'sell'))
    } else if (have < it.amount) {
      excluded.push({
        id: it.id,
        amount: it.amount,
        reason: 'not-owned',
        words:
          pool.kind === KIND_721 ? `You do not hold #${it.id}.` : `You hold ${have} of #${it.id}, not ${it.amount}.`,
      })
    } else lines.push(lineFor(it, pool, 'sell'))
  }

  if (unknown.length) blocked = `We couldn't check that you hold ${unknown.map((i) => `#${i}`).join(', ')}.`

  const units = lines.reduce((s, l) => s + l.amount, 0n)
  const tokens = units * POOL_UNIT
  const ids = lines.map((l) => l.id)
  const steps: PoolStep[] = []

  if (!lines.length) blocked ??= 'Nothing left to sell.'
  else if (pool.kind === KIND_1155) {
    steps.push({
      key: 'send',
      title: `Sell ${plural(units, 'NFT')}`,
      words: `Sends ${ids
        .map((i) => `#${i}`)
        .join(', ')} straight from your wallet to the pool in one transfer. The pool mints ${tokensText(tokens)} ${
        pool.symbol
      } to you. No approval needed.`,
      call: {
        to: pool.collection,
        data: encodeFunctionData({
          abi: collectionBatchAbi,
          functionName: 'safeBatchTransferFrom',
          args: [account, pool.address, ids, lines.map((l) => l.amount), '0x'],
        }),
        value: 0n,
      },
      afterPrevious: false,
    })
  } else if (lines.length === 1 || directSendOnly(chainId)) {
    if (lines.length > 1)
      notes.push(
        `This collection only lets the owner move its NFTs, so each sale is its own transfer: ${lines.length} transactions (one signature if your wallet can batch).`
      )
    for (const l of lines)
      steps.push({
        key: 'send',
        title: `Sell #${l.id}`,
        words: `Sends #${l.id} straight from your wallet to the pool. The pool mints 1 ${pool.symbol} to you. No approval needed.`,
        call: {
          to: pool.collection,
          data: encodeFunctionData({
            abi: collectionBatchAbi,
            functionName: 'safeTransferFrom',
            args: [account, pool.address, l.id, '0x'],
          }),
          value: 0n,
        },
        afterPrevious: false,
      })
  } else {
    if (input.approvedForAll === undefined) blocked ??= "We couldn't check whether the pool may move your NFTs."
    if (input.approvedForAll !== true)
      steps.push({
        key: 'approve',
        title: 'Allow the pool',
        words: `Lets this pool move all your NFTs from this collection, until you revoke it. Needed once so one transaction can take ${lines.length} NFTs. Nothing is sold yet.`,
        call: {
          to: pool.collection,
          data: encodeFunctionData({
            abi: collectionBatchAbi,
            functionName: 'setApprovalForAll',
            args: [pool.address, true],
          }),
          value: 0n,
        },
        afterPrevious: false,
      })
    steps.push({
      key: 'deposit',
      title: `Sell ${plural(units, 'NFT')}`,
      words: `The pool takes ${ids.map((i) => `#${i}`).join(', ')} from your wallet and mints ${tokensText(tokens)} ${
        pool.symbol
      } to you, all or nothing.`,
      call: {
        to: pool.address,
        data: encodeFunctionData({ abi: poolBatchAbi, functionName: 'deposit', args: [ids, [], account] }),
        value: 0n,
      },
      afterPrevious: steps.length > 0,
    })
  }

  notes.push(
    `To turn ${pool.symbol} into ETH, sell it on the Tokens tab afterwards: that is a separate swap transaction, priced then.`
  )
  return {
    side: 'sell',
    pool,
    account,
    lines,
    excluded,
    totals: { units, tokens },
    steps,
    transactions: countTxs(steps),
    receive: lines.length ? `${tokensText(tokens)} ${pool.symbol}, sent to your wallet.` : 'Nothing.',
    blocked,
    notes,
  }
}

function getTokensStep(pool: PoolRef, shortfall: bigint): PoolStep {
  return {
    key: 'get-tokens',
    title: `Get ${tokensText(shortfall)} ${pool.symbol}`,
    words: `You need ${tokensText(shortfall)} more ${
      pool.symbol
    }. Buy it on the Tokens tab (a 0x swap) first: a separate transaction, plus an approval if you pay with a token rather than ETH. Its price is set then, not here.`,
    afterPrevious: false,
  }
}

function planBuy(input: BuyInput): PoolBatchPlan {
  const { pool, account } = input
  const excluded: Excluded[] = []
  const notes: string[] = []
  let blocked: string | undefined
  const lines: Line[] = []
  const steps: PoolStep[] = []
  let units = 0n

  if (pool.mode === MODE_TARGETED) {
    const unknown: bigint[] = []
    for (const it of cleanItems(input.items ?? [], pool.kind, excluded)) {
      const there = input.poolHeld?.[key(it.id)]
      if (there === undefined) {
        unknown.push(it.id)
        lines.push(lineFor(it, pool, 'buy'))
      } else if (there < it.amount) {
        excluded.push({
          id: it.id,
          amount: it.amount,
          reason: 'not-in-pool',
          words:
            there === 0n ? `#${it.id} is not in the pool.` : `The pool holds ${there} of #${it.id}, not ${it.amount}.`,
        })
      } else lines.push(lineFor(it, pool, 'buy'))
    }

    if (unknown.length) blocked = `We couldn't check that the pool holds ${unknown.map((i) => `#${i}`).join(', ')}.`
    units = lines.reduce((s, l) => s + l.amount, 0n)
  } else {
    for (const it of input.items ?? [])
      excluded.push({
        id: it.id,
        reason: 'random-pool',
        words: `#${it.id}: this pool picks NFTs at random, so ids can't be chosen. Ask for a number instead.`,
      })
    let n = BigInt(Math.max(0, Math.floor(input.count ?? 0)))
    if (n > BigInt(MAX_DRAW)) {
      excluded.push({
        amount: n - BigInt(MAX_DRAW),
        reason: 'too-many',
        words: `One draw takes at most ${MAX_DRAW} NFTs; ${n - BigInt(MAX_DRAW)} left out.`,
      })
      n = BigInt(MAX_DRAW)
    }

    if (input.free === undefined) blocked = "We couldn't read how many NFTs are free to draw."
    else if (n > input.free) {
      excluded.push({
        amount: n - input.free,
        reason: 'not-enough-free',
        words: `Only ${plural(input.free, 'NFT')} in the pool ${
          input.free === 1n ? 'is' : 'are'
        } not already in an open draw; ${n - input.free} left out.`,
      })
      n = input.free
    }

    units = n
  }

  const tokens = units * POOL_UNIT
  const have = input.balance
  const shortfall = have === undefined ? undefined : have >= tokens ? 0n : tokens - have
  if (have === undefined) blocked ??= `We couldn't read your ${pool.symbol} balance.`
  if (units === 0n) blocked ??= 'Nothing left to buy.'

  if (units > 0n) {
    if (shortfall && shortfall > 0n) steps.push(getTokensStep(pool, shortfall))
    if (pool.mode === MODE_TARGETED) {
      const ids = lines.map((l) => l.id)
      steps.push({
        key: 'redeem',
        title: `Buy ${plural(units, 'NFT')}`,
        words: `Burns ${tokensText(tokens)} ${pool.symbol} from your wallet and sends ${ids
          .map((i) => `#${i}`)
          .join(', ')} to you, all or nothing. No fee, no approval.`,
        call: {
          to: pool.address,
          data: encodeFunctionData({
            abi: poolBatchAbi,
            functionName: 'redeem',
            args: [ids, lines.map((l) => l.amount), account],
          }),
          value: 0n,
        },
        afterPrevious: steps.length > 0,
      })
    } else {
      steps.push({
        key: 'commit',
        title: `Pay for ${plural(units, 'random NFT')}`,
        words: `Step 1: burns ${tokensText(tokens)} ${
          pool.symbol
        } now. A block mined after this one picks which ${plural(units, 'NFT')} you get.`,
        call: {
          to: pool.address,
          data: encodeFunctionData({ abi: poolBatchAbi, functionName: 'commitRedeem', args: [units, account] }),
          value: 0n,
        },
        afterPrevious: steps.length > 0,
      })
      steps.push({
        key: 'reveal',
        title: 'Reveal',
        words:
          'Step 2, at least one block later: reveal sends the picked NFTs to you. Draws settle oldest first, so any older open draw is revealed before yours (its NFTs go to whoever made it). If the collection refuses a transfer, the pool holds that NFT for you to claim.',
        afterPrevious: true,
      })
      notes.push(
        'Which NFTs you get is decided after you pay. You cannot choose them, and the pay step cannot be undone.'
      )
    }
  }

  return {
    side: 'buy',
    pool,
    account,
    lines,
    excluded,
    totals: { units, tokens, have, shortfall },
    steps,
    transactions: countTxs(steps),
    receive:
      units === 0n
        ? 'Nothing.'
        : pool.mode === MODE_TARGETED
        ? `${lines
            .map((l) => (pool.kind === KIND_1155 ? `${l.amount} × #${l.id}` : `#${l.id}`))
            .join(', ')}, sent to your wallet.`
        : `${plural(units, 'random NFT')}, sent to your wallet when revealed.`,
    blocked,
    notes,
  }
}

/** Plan a batched sell into, or buy from, one MiyaPool. */
export function planPoolBatch(input: PoolBatchInput): PoolBatchPlan {
  return input.side === 'sell' ? planSell(input) : planBuy(input)
}

/* ---------- random draws: the reveal transactions ---------- */

/**
 * The reveals that settle your draw `mine`: one per open draw from `nextRevealId` up to and including yours, since
 * MiyaPool settles draws strictly in order. Each is its own transaction. Earlier draws' NFTs go to their makers.
 */
export function revealCalls(
  pool: Address,
  mine: bigint,
  nextRevealId: bigint
): (Call & { commitId: bigint; yours: boolean })[] {
  if (nextRevealId > mine) return []
  const out: (Call & { commitId: bigint; yours: boolean })[] = []
  for (let id = nextRevealId; id <= mine; id += 1n)
    out.push({
      to: pool,
      data: encodeFunctionData({ abi: poolBatchAbi, functionName: 'revealRedeem', args: [id] }),
      value: 0n,
      commitId: id,
      yours: id === mine,
    })
  return out
}

/* ---------- checker: every call pays out only to the account ---------- */

export type CheckResult = { ok: boolean; problems: string[]; notes: string[] }

/**
 * Decode every call in the plan and confirm it can only send NFTs or pool tokens to `account`, carries no ETH, and
 * talks only to this pool or its collection. A revealRedeem has no recipient argument (it was fixed at commit), so it
 * passes with a note.
 */
export function checkPoolCalls(
  calls: readonly (Call | undefined)[],
  ctx: { account: Address; pool: PoolRef }
): CheckResult {
  const { account, pool } = ctx
  const problems: string[] = []
  const notes: string[] = []
  const mintsTo = (data: Hex, from: string, where: string) => {
    // MiyaPool._recipient: 32 bytes of data name the recipient; anything else means `from`.
    if (data === '0x') {
      if (!same(from, account)) problems.push(`${where}: tokens would go to ${from}, not you.`)
      return
    }

    if ((data.length - 2) / 2 === 32) {
      const to = `0x${data.slice(26)}`
      const recipient = /^0x0{40}$/i.test(to) ? from : to
      if (!same(recipient, account)) problems.push(`${where}: tokens would go to ${recipient}, not you.`)
      return
    }

    if (!same(from, account)) problems.push(`${where}: tokens would go to ${from}, not you.`)
  }

  calls.forEach((call, i) => {
    if (!call) return
    const where = `Step ${i + 1}`
    if (call.value !== 0n) problems.push(`${where} sends ETH; pool calls never need it.`)
    if (same(call.to, pool.address)) {
      let d: ReturnType<typeof decodeFunctionData<typeof poolBatchAbi>>
      try {
        d = decodeFunctionData({ abi: poolBatchAbi, data: call.data })
      } catch {
        problems.push(`${where}: not a pool call we know.`)
        return
      }

      if (d.functionName === 'revealRedeem') notes.push(`${where}: a reveal pays out to whoever made that draw.`)
      else {
        const to = d.functionName === 'commitRedeem' ? d.args[1] : d.args[2]
        if (!same(to, account)) problems.push(`${where}: ${d.functionName} sends to ${to}, not you.`)
      }
    } else if (same(call.to, pool.collection)) {
      let d: ReturnType<typeof decodeFunctionData<typeof collectionBatchAbi>>
      try {
        d = decodeFunctionData({ abi: collectionBatchAbi, data: call.data })
      } catch {
        problems.push(`${where}: not a collection call we know.`)
        return
      }

      if (d.functionName === 'setApprovalForAll') {
        if (!same(d.args[0], pool.address)) problems.push(`${where}: approves ${d.args[0]}, not the pool.`)
      } else {
        const [from, to] = d.args
        if (!same(from, account)) problems.push(`${where}: moves NFTs from ${from}, not you.`)
        if (!same(to, pool.address)) problems.push(`${where}: sends NFTs to ${to}, not the pool.`)
        mintsTo(d.functionName === 'safeTransferFrom' ? d.args[3] : d.args[4], from, where)
      }
    } else problems.push(`${where} calls ${call.to}, which is neither the pool nor its collection.`)
  })
  return { ok: problems.length === 0, problems, notes }
}

/* ---------- simulation ---------- */

/** viem's publicClient.call fits. */
export type Caller = { call: (args: { account: Address; to: Address; data: Hex; value?: bigint }) => Promise<unknown> }

function revertData(error: unknown): Hex | undefined {
  let e = error as { data?: unknown; cause?: unknown } | undefined
  for (let depth = 0; e && depth < 8; depth += 1) {
    if (typeof e.data === 'string' && /^0x[0-9a-f]*$/i.test(e.data) && e.data.length >= 10) return e.data as Hex
    if (e.data && typeof e.data === 'object' && typeof (e.data as { data?: unknown }).data === 'string')
      return (e.data as { data: Hex }).data
    e = e.cause as typeof e
  }

  return undefined
}

/** A pool or collection revert in plain words; undefined when it isn't one we know. */
export function explainPoolError(error: unknown, symbol = 'pool tokens'): string | undefined {
  const data = revertData(error)
  if (!data) return undefined
  try {
    const d = decodeErrorResult({ abi: poolBatchAbi, data })
    switch (d.errorName) {
      case 'NotHeld':
        return `#${d.args[0]} is no longer in the pool. Remove it and review again.`
      case 'AlreadyHeld':
        return `#${d.args[0]} is already in the pool.`
      case 'InsufficientBalance':
        return `Not enough ${symbol} in your wallet.`
      case 'InsufficientHeld':
        return 'The pool no longer has that many NFTs free to draw.'
      case 'CommitTooLarge':
        return `One draw takes at most ${MAX_DRAW} NFTs.`
      case 'TooEarly':
        return 'Too early to reveal: wait for the next block.'
      case 'NotNextCommit':
        return 'An older draw must be revealed first.'
      case 'WrongMode':
        return "This pool doesn't allow that kind of buy."
      case 'TransferNotReceived':
        return `The collection did not hand over #${d.args[0]}.`
      default:
        return `The pool refused: ${d.errorName}.`
    }
  } catch {
    return undefined
  }
}

export type SimResult = { ok: true } | { ok: false; words: string }

/**
 * Check one step right now: the recipient checker, then an eth_call from the account. Run it at review and again just
 * before the wallet prompt. A step that waits on an earlier one (deposit after approve, redeem after a token swap) can
 * only pass once that one has landed, so simulate the first step at review and each later step right before its own
 * prompt.
 */
export async function simulatePoolStep(
  client: Caller,
  plan: Pick<PoolBatchPlan, 'account' | 'pool'>,
  call: Call
): Promise<SimResult> {
  const check = checkPoolCalls([call], plan)
  if (!check.ok) return { ok: false, words: check.problems.join(' ') }
  try {
    await client.call({ account: plan.account, to: call.to, data: call.data, value: call.value })
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      words:
        explainPoolError(e, plan.pool.symbol) ??
        `This would fail: ${(e as Error)?.message?.split('\n')[0] || 'unknown reason'}.`,
    }
  }
}

/* ---------- reading the receipt ---------- */

type Log = { address: Address; topics: readonly Hex[] | [Hex, ...Hex[]] | []; data: Hex }

export type ItemOutcome = {
  id: bigint
  amount: bigint
  /** sold: the pool's Deposited event lists it for you. bought: its Redeemed event sends it to you.
   *  missing: the receipt doesn't show it moving; we don't claim it did. */
  status: 'sold' | 'bought' | 'missing'
  words: string
}

export type ReceiptReading = {
  ok: boolean
  items: ItemOutcome[]
  /** Pool tokens minted to you (sells) or burned from you (buys), from the pool token's Transfer logs. */
  tokensMinted: bigint
  tokensBurned: bigint
  /** Random buys: the draw your commit opened. */
  commit?: { commitId: bigint; amount: bigint; targetBlock: bigint }
  /** Reveals: ids the draw picked, and which of those the pool escrowed instead of sending. */
  revealed?: { commitId: bigint; ids: bigint[]; escrowed: bigint[]; rearmed: boolean }
  words: string
}

/** Units of each id the collection's own Transfer logs show arriving at `account`. */
function collectionReceived(logs: readonly Log[], pool: PoolRef, account: Address): Map<string, bigint> {
  const own = logs.filter((l) => same(l.address, pool.collection)) as Log[]
  const got = new Map<string, bigint>()
  const add = (id: bigint, n: bigint) => got.set(key(id), (got.get(key(id)) ?? 0n) + n)
  if (pool.kind === KIND_721) {
    for (const t of parseEventLogs({ abi: transfer721Abi, logs: own as never, strict: true }))
      if (same(t.args.to, account)) add(t.args.id, 1n)
  } else {
    for (const t of parseEventLogs({ abi: transfer1155Abi, logs: own as never, strict: true })) {
      if (!same(t.args.to, account)) continue
      if (t.eventName === 'TransferSingle') add(t.args.id, t.args.value)
      else t.args.ids.forEach((id, i) => add(id, t.args.values[i] ?? 0n))
    }
  }

  return got
}

/**
 * What a confirmed receipt shows, per requested item. Only logs from this pool and its collection count, and an item
 * is reported moved only when an event says so; anything else is 'missing'.
 */
export function readPoolReceipt(
  receipt: { status: 'success' | 'reverted'; logs: readonly Log[] },
  ctx: { account: Address; pool: PoolRef; requested?: readonly BatchItem[] }
): ReceiptReading {
  const { account, pool } = ctx
  const requested = (ctx.requested ?? []).map((r) => ({ id: r.id, amount: r.amount ?? 1n }))
  if (receipt.status !== 'success')
    return {
      ok: false,
      items: requested.map((r) => ({
        ...r,
        status: 'missing',
        words: `#${r.id}: nothing moved (the transaction failed).`,
      })),
      tokensMinted: 0n,
      tokensBurned: 0n,
      words: 'The transaction failed on chain. Nothing moved.',
    }

  const poolLogs = receipt.logs.filter((l) => same(l.address, pool.address)) as Log[]
  const events = parseEventLogs({ abi: poolBatchAbi, logs: poolLogs as never, strict: true })
  const tokenTransfers = parseEventLogs({ abi: transferAbi, logs: poolLogs as never, strict: true })

  let tokensMinted = 0n
  let tokensBurned = 0n
  for (const t of tokenTransfers) {
    if (same(t.args.from, ZERO) && same(t.args.to, account)) tokensMinted += t.args.value
    if (same(t.args.from, account) && same(t.args.to, ZERO)) tokensBurned += t.args.value
  }

  // Units per id that events say moved to / from the account.
  const sold = new Map<string, bigint>()
  const bought = new Map<string, bigint>()
  const add = (m: Map<string, bigint>, id: bigint, n: bigint) => m.set(key(id), (m.get(key(id)) ?? 0n) + n)
  let commit: ReceiptReading['commit']
  let revealed: ReceiptReading['revealed']
  for (const e of events) {
    if (e.eventName === 'Deposited' && same(e.args.to, account))
      e.args.ids.forEach((id, i) => add(sold, id, e.args.amounts[i] ?? 0n))
    else if (e.eventName === 'Redeemed' && same(e.args.to, account))
      e.args.ids.forEach((id, i) => add(bought, id, e.args.amounts[i] ?? 0n))
    else if (e.eventName === 'RedeemCommitted' && same(e.args.to, account))
      commit = { commitId: e.args.commitId, amount: e.args.amount, targetBlock: e.args.targetBlock }
    else if (e.eventName === 'RedeemRevealed') {
      revealed = { commitId: e.args.commitId, ids: [...e.args.ids], escrowed: revealed?.escrowed ?? [], rearmed: false }
    } else if (e.eventName === 'RedeemEscrowed') {
      revealed ??= { commitId: e.args.commitId, ids: [], escrowed: [], rearmed: false }
      revealed.escrowed.push(e.args.id)
    } else if (e.eventName === 'RedeemRearmed')
      revealed = { commitId: e.args.commitId, ids: [], escrowed: [], rearmed: true }
  }

  // A reveal's NFTs: confirm each with the collection's own transfer to the account.
  if (revealed && !revealed.rearmed) {
    const got = collectionReceived(receipt.logs, pool, account)
    const { escrowed } = revealed
    const sent = revealed.ids.filter((id) => !escrowed.includes(id) && (got.get(key(id)) ?? 0n) > 0n)
    for (const id of sent) add(bought, id, 1n)
  }

  const items: ItemOutcome[] = requested.map((r) => {
    const s = sold.get(key(r.id)) ?? 0n
    const b = bought.get(key(r.id)) ?? 0n
    if (s >= r.amount)
      return {
        ...r,
        status: 'sold',
        words: `#${r.id}: sold into the pool for ${tokensText(r.amount * POOL_UNIT)} ${pool.symbol}.`,
      }
    if (b >= r.amount) return { ...r, status: 'bought', words: `#${r.id}: in your wallet.` }
    return { ...r, status: 'missing', words: `#${r.id}: this transaction doesn't show it moving.` }
  })

  const parts: string[] = []
  if (tokensMinted) parts.push(`You received ${tokensText(tokensMinted)} ${pool.symbol}.`)
  if (tokensBurned) parts.push(`${tokensText(tokensBurned)} ${pool.symbol} was spent.`)
  if (commit)
    parts.push(
      `Your draw #${commit.commitId} for ${plural(commit.amount, 'NFT')} is open; reveal it after block ${
        commit.targetBlock
      }.`
    )
  if (revealed?.rearmed)
    parts.push('That draw waited too long, so a new block will pick. Reveal again after the next block.')
  else if (revealed) {
    const mine = revealed.ids.filter((id) => bought.has(key(id)))
    if (mine.length) parts.push(`You got ${mine.map((i) => `#${i}`).join(', ')}.`)
    if (revealed.escrowed.length)
      parts.push(
        `The pool is holding ${revealed.escrowed
          .map((i) => `#${i}`)
          .join(', ')} because the collection refused to send it.`
      )
  }

  const missing = items.filter((i) => i.status === 'missing')
  if (missing.length) parts.push(`Not shown in this transaction: ${missing.map((i) => `#${i.id}`).join(', ')}.`)
  return { ok: true, items, tokensMinted, tokensBurned, commit, revealed, words: parts.join(' ') || 'Confirmed.' }
}
