// Batched MiyaPool orders (v2 pools: pick fee in IMD/INFER, random draws where enabled): src/pages/Swap/nft/poolBatch.ts
// (plans, call encoding, the recipient checker, simulation words, receipt reading). Offline. The same calls run on the real contract in contracts/test/pools/MiyaPoolBatch.t.sol.
// Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  type Hex,
  parseAbi,
  toFunctionSignature,
  toEventSignature,
} from 'viem'

import { erc721Abi, erc1155Abi, poolAbi } from '../src/pages/Swap/nft/abi.ts'
import {
  checkPoolCalls,
  collectionBatchAbi,
  explainPoolError,
  feeTokenAbi,
  MAX_DRAW,
  planPoolBatch,
  POOL_UNIT,
  poolBatchAbi,
  type PoolRef,
  readPoolReceipt,
  revealCalls,
  simulatePoolStep,
} from '../src/pages/Swap/nft/poolBatch.ts'

const ME = getAddress('0xabcdef0000000000000000000000000000000001')
const EVE = getAddress('0x000000000000000000000000000000000000e5e5')
const POOL = '0x1111111111111111111111111111111111111111' as Address
const NFT = '0x2222222222222222222222222222222222222222' as Address
const ZERO = '0x0000000000000000000000000000000000000000' as Address
const IMD = getAddress('0x0000000000000000000000000000000000001md0'.replace('md', 'a1'))
const INFER = getAddress('0x0000000000000000000000000000000000000f00')

/** A v2 pool. Picks are free unless fees are given; random draws only when `random`. */
const p721 = (random = false, fees: { imdFee?: bigint; inferFee?: bigint } = {}): PoolRef => ({
  address: POOL,
  collection: NFT,
  kind: 0,
  symbol: 'mMINI',
  randomEnabled: random,
  imdFee: fees.imdFee ?? 0n,
  inferFee: fees.inferFee ?? 0n,
  imd: IMD,
  infer: INFER,
})
const p1155: PoolRef = { address: POOL, collection: NFT, kind: 1, symbol: 'mED', randomEnabled: false, imdFee: 0n, inferFee: 0n, imd: IMD, infer: INFER }
const E18 = 10n ** 18n
const held = (...ids: number[]) => Object.fromEntries(ids.map((i) => [String(i), 1n]))

/* ---------- ABI ---------- */

test('every call, event and error the batch module uses is also in abi.ts (which abi-drift checks against the contract)', () => {
  const sig = (x: (typeof poolBatchAbi)[number] | (typeof collectionBatchAbi)[number]) =>
    x.type === 'function' ? toFunctionSignature(x) : x.type === 'event' ? toEventSignature(x) : `${x.name}(${x.inputs.map((i) => i.type).join(',')})`
  const known = (abi: readonly { type: string }[]) =>
    new Set(abi.map((x) => sig(x as never)))
  const pool = known(poolAbi)
  // Deposited / Redeemed were added to abi.ts for this module.
  for (const x of poolBatchAbi) assert.ok(pool.has(sig(x)), `${sig(x)} missing from poolAbi`)
  const coll = new Set([...known(erc721Abi), ...known(erc1155Abi)])
  for (const x of collectionBatchAbi) assert.ok(coll.has(sig(x)), `${sig(x)} missing from erc721Abi/erc1155Abi`)
})

/* ---------- sell ---------- */

test('sell several ERC-721s: approve as its own step, then one deposit to you', () => {
  const plan = planPoolBatch({
    side: 'sell',
    chainId: 1,
    account: ME,
    pool: p721(),
    items: [{ id: 3n }, { id: 4n }, { id: 9n }],
    owned: held(3, 4, 9),
    approvedForAll: false,
  })
  assert.equal(plan.blocked, undefined)
  assert.deepEqual(plan.steps.map((s) => s.key), ['approve', 'deposit'])
  assert.equal(plan.transactions, 2)
  assert.equal(plan.steps[1]!.afterPrevious, true)
  assert.equal(plan.totals.units, 3n)
  assert.equal(plan.totals.tokens, 3n * POOL_UNIT)
  assert.match(plan.receive, /3 mMINI/)
  assert.match(plan.steps[0]!.words, /until you revoke/)
  const approve = decodeFunctionData({ abi: collectionBatchAbi, data: plan.steps[0]!.call!.data })
  assert.equal(approve.functionName, 'setApprovalForAll')
  assert.deepEqual(approve.args, [POOL, true])
  const dep = decodeFunctionData({ abi: poolBatchAbi, data: plan.steps[1]!.call!.data })
  assert.equal(dep.functionName, 'deposit')
  assert.deepEqual(dep.args, [[3n, 4n, 9n], [], ME])
  assert.equal(plan.steps[1]!.call!.to, POOL)
  assert.ok(checkPoolCalls(plan.steps.map((s) => s.call), plan).ok)
  assert.ok(plan.notes.some((n) => /separate swap transaction/.test(n)), 'selling the tokens onward is said to be separate')
})

test('sell several ERC-721s already approved: one transaction', () => {
  const plan = planPoolBatch({
    side: 'sell', chainId: 1, account: ME, pool: p721(), items: [{ id: 3n }, { id: 4n }], owned: held(3, 4), approvedForAll: true,
  })
  assert.deepEqual(plan.steps.map((s) => s.key), ['deposit'])
  assert.equal(plan.steps[0]!.afterPrevious, false)
})

test('an approval that could not be read blocks the plan instead of guessing', () => {
  const plan = planPoolBatch({
    side: 'sell', chainId: 1, account: ME, pool: p721(), items: [{ id: 3n }, { id: 4n }], owned: held(3, 4),
  })
  assert.match(plan.blocked!, /couldn't check whether the pool may move/)
})

test('one ERC-721 goes straight to the pool, no approval', () => {
  const plan = planPoolBatch({
    side: 'sell', chainId: 1, account: ME, pool: p721(), items: [{ id: 5n }], owned: held(5), approvedForAll: false,
  })
  assert.deepEqual(plan.steps.map((s) => s.key), ['send'])
  const d = decodeFunctionData({ abi: collectionBatchAbi, data: plan.steps[0]!.call!.data })
  assert.equal(d.functionName, 'safeTransferFrom')
  assert.deepEqual(d.args, [ME, POOL, 5n, '0x'])
})

test('Robinhood Chain: several ERC-721s are one transfer each, and the plan says so', () => {
  const plan = planPoolBatch({
    side: 'sell', chainId: 4663, account: ME, pool: p721(), items: [{ id: 1n }, { id: 2n }], owned: held(1, 2), approvedForAll: false,
  })
  assert.deepEqual(plan.steps.map((s) => s.key), ['send', 'send'])
  assert.equal(plan.transactions, 2)
  assert.ok(plan.notes.some((n) => /2 transactions/.test(n)))
})

test('ERC-1155 sell: one batch transfer with amounts, no approval', () => {
  const plan = planPoolBatch({
    side: 'sell', chainId: 1, account: ME, pool: p1155,
    items: [{ id: 1n, amount: 3n }, { id: 2n, amount: 2n }],
    owned: { '1': 5n, '2': 3n },
  })
  assert.deepEqual(plan.steps.map((s) => s.key), ['send'])
  assert.equal(plan.totals.units, 5n)
  assert.equal(plan.totals.tokens, 5n * POOL_UNIT)
  const d = decodeFunctionData({ abi: collectionBatchAbi, data: plan.steps[0]!.call!.data })
  assert.equal(d.functionName, 'safeBatchTransferFrom')
  assert.deepEqual(d.args, [ME, POOL, [1n, 2n], [3n, 2n], '0x'])
  assert.deepEqual(plan.lines.map((l) => l.words), ['3 × #1 → 3 mED', '2 × #2 → 2 mED'])
})

test('sell exclusions: not held, too few, duplicates, bad amounts; unknown holdings block', () => {
  const plan = planPoolBatch({
    side: 'sell', chainId: 1, account: ME, pool: p1155,
    items: [{ id: 1n, amount: 9n }, { id: 2n }, { id: 2n }, { id: 3n, amount: 0n }, { id: 4n }],
    owned: { '1': 5n, '2': 1n, '4': 0n },
  })
  assert.deepEqual(plan.excluded.map((e) => [e.id, e.reason]), [
    [2n, 'duplicate'], [3n, 'bad-amount'], [1n, 'not-owned'], [4n, 'not-owned'],
  ])
  assert.match(plan.excluded[2]!.words, /hold 5 of #1, not 9/)
  assert.deepEqual(plan.lines.map((l) => l.id), [2n])

  const unknown = planPoolBatch({
    side: 'sell', chainId: 1, account: ME, pool: p721(), items: [{ id: 7n }], owned: {}, approvedForAll: true,
  })
  assert.match(unknown.blocked!, /couldn't check that you hold #7/)
  const none = planPoolBatch({ side: 'sell', chainId: 1, account: ME, pool: p721(), items: [], owned: {} })
  assert.equal(none.blocked, 'Nothing left to sell.')
  assert.equal(none.steps.length, 0)
})

test('more than 50 ids: the rest are left out with a reason', () => {
  const items = Array.from({ length: 52 }, (_, i) => ({ id: BigInt(i + 1) }))
  const plan = planPoolBatch({
    side: 'sell', chainId: 1, account: ME, pool: p721(), items, owned: held(...items.map((_, i) => i + 1)), approvedForAll: true,
  })
  assert.equal(plan.lines.length, 50)
  assert.deepEqual(plan.excluded.map((e) => e.reason), ['too-many', 'too-many'])
})

/* ---------- buy, targeted ---------- */

test('buy several ids from a pick pool: one redeem to you, exact token cost, no shortfall', () => {
  const plan = planPoolBatch({
    side: 'buy', chainId: 1, account: ME, pool: p721(), balance: 3n * POOL_UNIT,
    items: [{ id: 2n }, { id: 8n }], poolHeld: held(2, 8),
  })
  assert.equal(plan.blocked, undefined)
  assert.deepEqual(plan.steps.map((s) => s.key), ['redeem'])
  assert.equal(plan.totals.tokens, 2n * POOL_UNIT)
  assert.equal(plan.totals.shortfall, 0n)
  const d = decodeFunctionData({ abi: poolBatchAbi, data: plan.steps[0]!.call!.data })
  assert.equal(d.functionName, 'redeem')
  assert.deepEqual(d.args, [[2n, 8n], [1n, 1n], ME, ZERO])
  assert.match(plan.receive, /#2, #8/)
  assert.match(plan.steps[0]!.words, /No pick fee/)
  assert.equal(plan.totals.fee, undefined)
})

test('buy with too few pool tokens: a separate get-tokens step for exactly the shortfall, then the redeem', () => {
  const plan = planPoolBatch({
    side: 'buy', chainId: 1, account: ME, pool: p721(), balance: POOL_UNIT / 2n,
    items: [{ id: 2n }, { id: 8n }, { id: 11n }], poolHeld: { ...held(2, 8), '11': 0n },
  })
  assert.deepEqual(plan.excluded.map((e) => [e.id, e.reason]), [[11n, 'not-in-pool']])
  assert.equal(plan.totals.tokens, 2n * POOL_UNIT)
  assert.equal(plan.totals.shortfall, POOL_UNIT + POOL_UNIT / 2n)
  assert.deepEqual(plan.steps.map((s) => s.key), ['get-tokens', 'redeem'])
  assert.equal(plan.steps[0]!.call, undefined, 'the swap is built by the Tokens tab, not here')
  assert.match(plan.steps[0]!.title, /Get 1\.5 mMINI/)
  assert.match(plan.steps[0]!.words, /separate transaction/)
  assert.equal(plan.steps[1]!.afterPrevious, true)
  assert.equal(plan.transactions, 2)
})

test('unknown balance or unknown pool holdings block the buy', () => {
  const a = planPoolBatch({ side: 'buy', chainId: 1, account: ME, pool: p721(), balance: undefined, items: [{ id: 2n }], poolHeld: held(2) })
  assert.match(a.blocked!, /balance/)
  assert.equal(a.totals.shortfall, undefined)
  const b = planPoolBatch({ side: 'buy', chainId: 1, account: ME, pool: p721(), balance: POOL_UNIT, items: [{ id: 2n }], poolHeld: {} })
  assert.match(b.blocked!, /pool holds #2/)
})

test('ERC-1155 buy: amounts per id, cost is the unit sum', () => {
  const plan = planPoolBatch({
    side: 'buy', chainId: 1, account: ME, pool: p1155, balance: 10n * POOL_UNIT,
    items: [{ id: 1n, amount: 2n }, { id: 2n, amount: 4n }], poolHeld: { '1': 5n, '2': 3n },
  })
  assert.deepEqual(plan.excluded.map((e) => e.reason), ['not-in-pool'])
  assert.match(plan.excluded[0]!.words, /holds 3 of #2, not 4/)
  const d = decodeFunctionData({ abi: poolBatchAbi, data: plan.steps[0]!.call!.data })
  assert.deepEqual(d.args, [[1n], [2n], ME, ZERO])
  assert.equal(plan.totals.tokens, 2n * POOL_UNIT)
})

/* ---------- buy, random ---------- */

test('random pool: N random is one commit and then reveals; chosen ids are refused', () => {
  const plan = planPoolBatch({
    side: 'buy', chainId: 1, account: ME, pool: p721(true), balance: 5n * POOL_UNIT, count: 3, free: 10n,
  })
  assert.deepEqual(plan.excluded, [])
  assert.deepEqual(plan.steps.map((s) => s.key), ['commit', 'reveal'])
  assert.equal(plan.steps[1]!.call, undefined, 'the draw id comes from the commit receipt')
  const d = decodeFunctionData({ abi: poolBatchAbi, data: plan.steps[0]!.call!.data })
  assert.equal(d.functionName, 'commitRedeem')
  assert.deepEqual(d.args, [3n, ME])
  assert.equal(plan.totals.tokens, 3n * POOL_UNIT)
  assert.match(plan.receive, /3 random NFTs/)
})

test('random pool caps: at most 50 per draw and no more than the free NFTs; shortfall adds a token step', () => {
  const big = planPoolBatch({ side: 'buy', chainId: 1, account: ME, pool: p721(true), balance: 0n, count: 60, free: 100n })
  assert.equal(big.totals.units, BigInt(MAX_DRAW))
  assert.deepEqual(big.steps.map((s) => s.key), ['get-tokens', 'commit', 'reveal'])
  assert.equal(big.totals.shortfall, 50n * POOL_UNIT)
  const few = planPoolBatch({ side: 'buy', chainId: 1, account: ME, pool: p721(true), balance: 9n * POOL_UNIT, count: 5, free: 2n })
  assert.equal(few.totals.units, 2n)
  assert.deepEqual(few.excluded.map((e) => e.reason), ['not-enough-free'])
  const unk = planPoolBatch({ side: 'buy', chainId: 1, account: ME, pool: p721(true), balance: 9n * POOL_UNIT, count: 2 })
  assert.match(unk.blocked!, /free to draw/)
})

test('reveals run oldest first: one call per open draw up to and including yours', () => {
  const calls = revealCalls(POOL, 7n, 5n)
  assert.deepEqual(calls.map((c) => [c.commitId, c.yours]), [[5n, false], [6n, false], [7n, true]])
  assert.deepEqual(decodeFunctionData({ abi: poolBatchAbi, data: calls[2]!.data }).args, [7n])
  assert.deepEqual(revealCalls(POOL, 3n, 4n), [])
  const check = checkPoolCalls(calls, { account: ME, pool: p721(true) })
  assert.ok(check.ok)
  assert.equal(check.notes.length, 3)
})

/* ---------- buy, v2: pick fee, locks, random only where enabled ---------- */

test('a pick with a fee: an exact fee approval as its own step, then one redeem paying it in IMD', () => {
  const plan = planPoolBatch({
    side: 'buy', chainId: 1, account: ME, pool: p721(false, { imdFee: 2n * E18, inferFee: 3500n * E18 }),
    balance: 2n * POOL_UNIT, items: [{ id: 2n }, { id: 8n }], poolHeld: held(2, 8),
    feeWallet: { IMD: { balance: 10n * E18, allowance: 0n }, INFER: { balance: 0n, allowance: 0n } },
  })
  assert.equal(plan.blocked, undefined)
  assert.deepEqual(plan.steps.map((s) => s.key), ['approve', 'redeem'])
  assert.deepEqual(plan.totals.fee, { symbol: 'IMD', token: IMD, amount: 4n * E18 })
  const approve = plan.steps[0]!
  assert.equal(approve.call!.to, IMD)
  assert.deepEqual(decodeFunctionData({ abi: feeTokenAbi, data: approve.call!.data }).args, [POOL, 4n * E18])
  assert.match(approve.title, /Allow 4 IMD for the pick fee/)
  assert.equal(plan.steps[1]!.afterPrevious, true)
  assert.deepEqual(decodeFunctionData({ abi: poolBatchAbi, data: plan.steps[1]!.call!.data }).args, [[2n, 8n], [1n, 1n], ME, IMD])
  assert.match(plan.steps[1]!.words, /4 IMD pick fee/)
  assert.ok(plan.notes.some((n) => /4 IMD or 7000 INFER; this batch pays it in IMD/.test(n)))
  assert.ok(checkPoolCalls(plan.steps.map((s) => s.call), plan).ok)
})

test('pick fee: INFER when IMD is short, no approval when already allowed, blocked when neither covers it', () => {
  const pool = p721(false, { imdFee: 2n * E18, inferFee: 3500n * E18 })
  const base = { side: 'buy' as const, chainId: 1, account: ME, pool, balance: POOL_UNIT, items: [{ id: 2n }], poolHeld: held(2) }
  const infer = planPoolBatch({ ...base, feeWallet: { IMD: { balance: E18, allowance: 0n }, INFER: { balance: 3500n * E18, allowance: 3500n * E18 } } })
  assert.deepEqual(infer.steps.map((s) => s.key), ['redeem'])
  assert.equal(infer.totals.fee?.symbol, 'INFER')
  assert.equal(decodeFunctionData({ abi: poolBatchAbi, data: infer.steps[0]!.call!.data }).args[3], INFER)

  const short = planPoolBatch({ ...base, feeWallet: { IMD: { balance: 0n, allowance: 0n }, INFER: { balance: 0n, allowance: 0n } } })
  assert.match(short.blocked!, /pick fee of 2 IMD or 3500 INFER, and your wallet doesn't hold enough/)
  const unread = planPoolBatch({ ...base, feeWallet: {} })
  assert.match(unread.blocked!, /couldn't read your IMD or INFER balance/)
  const noAllowance = planPoolBatch({ ...base, feeWallet: { IMD: { balance: 5n * E18 } } })
  assert.match(noAllowance.blocked!, /couldn't check what the pool may take of your IMD/)
  const feeUnknown = planPoolBatch({ ...base, pool: { ...pool, imdFee: undefined } })
  assert.match(feeUnknown.blocked!, /couldn't read this pool's pick fee/)
})

test('picks from a random pool skip NFTs an open draw has locked, and an unread lock blocks', () => {
  const plan = planPoolBatch({
    side: 'buy', chainId: 1, account: ME, pool: p721(true), balance: 2n * POOL_UNIT,
    items: [{ id: 2n }, { id: 8n }], poolHeld: held(2, 8), locked: { '2': true, '8': false },
  })
  assert.deepEqual(plan.excluded.map((e) => [e.id, e.reason]), [[2n, 'locked']])
  assert.match(plan.excluded[0]!.words, /open random draw/)
  assert.deepEqual(plan.lines.map((l) => l.id), [8n])
  const unknown = planPoolBatch({
    side: 'buy', chainId: 1, account: ME, pool: p721(true), balance: POOL_UNIT, items: [{ id: 2n }], poolHeld: held(2), locked: {},
  })
  assert.match(unknown.blocked!, /open random draw holds #2/)
})

test('a random draw from a pool without random redeems is blocked, not sent', () => {
  const plan = planPoolBatch({ side: 'buy', chainId: 1, account: ME, pool: p721(false), balance: 5n * POOL_UNIT, count: 2, free: 5n })
  assert.match(plan.blocked!, /doesn't do random draws/)
})

/* ---------- checker ---------- */

test('the checker refuses calls that pay someone else, carry ETH, or hit another contract', () => {
  const pool = p721()
  const enc = (abi: readonly unknown[], functionName: string, args: unknown[]) =>
    (encodeFunctionData as (p: { abi: readonly unknown[]; functionName: string; args: unknown[] }) => Hex)({ abi, functionName, args })
  const bad = [
    { to: POOL, data: enc(poolBatchAbi, 'deposit', [[1n], [], EVE]), value: 0n },
    { to: POOL, data: enc(poolBatchAbi, 'redeem', [[1n], [1n], EVE, ZERO]), value: 0n },
    // The pick fee paid in a token that is neither IMD nor INFER.
    { to: POOL, data: enc(poolBatchAbi, 'redeem', [[1n], [1n], ME, EVE]), value: 0n },
    // A fee approval for someone other than the pool, or on a token that isn't a fee token.
    { to: IMD, data: enc(feeTokenAbi, 'approve', [EVE, 5n]), value: 0n },
    { to: NFT, data: enc(feeTokenAbi, 'approve', [POOL, 5n]), value: 0n },
    { to: POOL, data: enc(poolBatchAbi, 'commitRedeem', [2n, EVE]), value: 0n },
    { to: NFT, data: enc(collectionBatchAbi, 'setApprovalForAll', [EVE, true]), value: 0n },
    { to: NFT, data: enc(collectionBatchAbi, 'safeTransferFrom', [ME, EVE, 1n, '0x']), value: 0n },
    // Sent to the pool, but the data names Eve as the one the pool mints to.
    { to: NFT, data: enc(collectionBatchAbi, 'safeTransferFrom', [ME, POOL, 1n, encodeAbiParameters([{ type: 'address' }], [EVE])]), value: 0n },
    { to: NFT, data: enc(collectionBatchAbi, 'safeBatchTransferFrom', [EVE, POOL, [1n], [1n], '0x']), value: 0n },
    { to: POOL, data: enc(poolBatchAbi, 'deposit', [[1n], [], ME]), value: 1n },
    { to: EVE, data: '0x' as Hex, value: 0n },
    { to: POOL, data: '0xdeadbeef' as Hex, value: 0n },
  ]
  for (const [i, call] of bad.entries()) assert.equal(checkPoolCalls([call], { account: ME, pool }).ok, false, `bad call ${i}`)
  // Data naming the account itself is fine.
  const mine = { to: NFT, data: enc(collectionBatchAbi, 'safeTransferFrom', [ME, POOL, 1n, encodeAbiParameters([{ type: 'address' }], [ME])]), value: 0n }
  assert.ok(checkPoolCalls([mine], { account: ME, pool }).ok)
})

/* ---------- simulation ---------- */

test('simulation: a pass, a decoded pool revert in plain words, and the checker before any call', async () => {
  const plan = planPoolBatch({
    side: 'buy', chainId: 1, account: ME, pool: p721(), balance: POOL_UNIT, items: [{ id: 2n }], poolHeld: held(2),
  })
  const call = plan.steps[0]!.call!
  const seen: unknown[] = []
  const ok = await simulatePoolStep({ call: async (a) => void seen.push(a) }, plan, call)
  assert.deepEqual(ok, { ok: true })
  assert.deepEqual(seen, [{ account: ME, to: POOL, data: call.data, value: 0n }])

  const revert = encodeErrorResult({ abi: poolBatchAbi, errorName: 'NotHeld', args: [2n] })
  const failing = { call: async () => { throw Object.assign(new Error('execution reverted'), { cause: { data: revert } }) } }
  const no = await simulatePoolStep(failing, plan, call)
  assert.deepEqual(no, { ok: false, words: '#2 is no longer in the pool. Remove it and review again.' })

  const short = encodeErrorResult({ abi: parseAbi(['error InsufficientBalance()']), errorName: 'InsufficientBalance' })
  assert.equal(explainPoolError({ cause: { cause: { data: short } } }, 'mMINI'), 'Not enough mMINI in your wallet.')
  assert.equal(explainPoolError(new Error('network down')), undefined)
  const locked = encodeErrorResult({ abi: poolBatchAbi, errorName: 'LockedForRandomRedeem', args: [2n] })
  assert.match(explainPoolError({ data: locked })!, /#2 could be drawn by an open random draw/)

  let called = false
  const evil = { to: POOL, data: encodeFunctionData({ abi: poolBatchAbi, functionName: 'redeem', args: [[2n], [1n], EVE, ZERO] }), value: 0n }
  const refused = await simulatePoolStep({ call: async () => { called = true } }, plan, evil)
  assert.equal(refused.ok, false)
  assert.equal(called, false)
})

/* ---------- receipts ---------- */

const poolEvent = (eventName: string, args: Record<string, unknown>, data: { types: { type: string }[]; values: unknown[] }) => ({
  address: POOL,
  topics: encodeEventTopics({ abi: poolBatchAbi, eventName: eventName as never, args: args as never }) as Hex[],
  data: encodeAbiParameters(data.types, data.values as never),
})
const erc20 = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])
const nft721 = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 indexed id)'])
const tokenMove = (from: Address, to: Address, value: bigint, address: Address = POOL) => ({
  address,
  topics: encodeEventTopics({ abi: erc20, eventName: 'Transfer', args: { from, to } }) as Hex[],
  data: encodeAbiParameters([{ type: 'uint256' }], [value]),
})
const nftMove = (from: Address, to: Address, id: bigint) => ({
  address: NFT,
  topics: encodeEventTopics({ abi: nft721, eventName: 'Transfer', args: { from, to, id } }) as Hex[],
  data: '0x' as Hex,
})
const arr = [{ type: 'uint256[]' }, { type: 'uint256[]' }]

test('a sell receipt: per id what the Deposited events show, tokens minted from Transfer logs, missing said plainly', () => {
  const logs = [
    nftMove(ME, POOL, 3n),
    tokenMove(ZERO, ME, POOL_UNIT),
    poolEvent('Deposited', { from: ME, to: ME }, { types: arr, values: [[3n], [1n]] }),
    nftMove(ME, POOL, 4n),
    tokenMove(ZERO, ME, POOL_UNIT),
    poolEvent('Deposited', { from: ME, to: ME }, { types: arr, values: [[4n], [1n]] }),
    // A look-alike from another contract must not count.
    { ...poolEvent('Deposited', { from: ME, to: ME }, { types: arr, values: [[9n], [1n]] }), address: EVE },
    tokenMove(ZERO, ME, POOL_UNIT, EVE),
  ]
  const r = readPoolReceipt({ status: 'success', logs }, { account: ME, pool: p721(), requested: [{ id: 3n }, { id: 4n }, { id: 9n }] })
  assert.deepEqual(r.items.map((i) => i.status), ['sold', 'sold', 'missing'])
  assert.equal(r.tokensMinted, 2n * POOL_UNIT)
  assert.match(r.words, /You received 2 mMINI\. Not shown in this transaction: #9\./)
})

test('a buy receipt reads Redeemed; a reverted receipt claims nothing moved', () => {
  const logs = [
    tokenMove(ME, ZERO, 2n * POOL_UNIT),
    nftMove(POOL, ME, 2n),
    nftMove(POOL, ME, 8n),
    poolEvent('Redeemed', { by: ME, to: ME }, { types: arr, values: [[2n, 8n], [1n, 1n]] }),
  ]
  const r = readPoolReceipt({ status: 'success', logs }, { account: ME, pool: p721(), requested: [{ id: 2n }, { id: 8n }] })
  assert.deepEqual(r.items.map((i) => i.status), ['bought', 'bought'])
  assert.equal(r.tokensBurned, 2n * POOL_UNIT)

  const fee = poolEvent('PickFeePaid', { by: ME, token: IMD }, { types: [{ type: 'uint256' }], values: [4n * E18] })
  const paid = readPoolReceipt({ status: 'success', logs: [...logs, fee] }, { account: ME, pool: p721(), requested: [{ id: 2n }] })
  assert.deepEqual(paid.feePaid, { token: IMD, amount: 4n * E18 })
  assert.match(paid.words, /Pick fee paid: 4 IMD, to the alignment vault\./)

  const failed = readPoolReceipt({ status: 'reverted', logs: [] }, { account: ME, pool: p721(), requested: [{ id: 2n }] })
  assert.equal(failed.ok, false)
  assert.deepEqual(failed.items.map((i) => i.status), ['missing'])
  assert.match(failed.words, /Nothing moved/)
})

test('a commit receipt gives the draw id; a reveal receipt gives the ids, escrowed ones not claimed as received', () => {
  const commitLogs = [
    tokenMove(ME, ZERO, 3n * POOL_UNIT),
    poolEvent('RedeemCommitted', { commitId: 7n, by: ME, to: ME }, { types: [{ type: 'uint256' }, { type: 'uint256' }], values: [3n, 101n] }),
  ]
  const c = readPoolReceipt({ status: 'success', logs: commitLogs }, { account: ME, pool: p721(true) })
  assert.deepEqual(c.commit, { commitId: 7n, amount: 3n, targetBlock: 101n })
  assert.match(c.words, /draw #7 for 3 NFTs is open; reveal it after block 101/)

  const revealLogs = [
    nftMove(POOL, ME, 4n),
    poolEvent('RedeemEscrowed', { commitId: 7n, recipient: ME }, { types: [{ type: 'uint256' }], values: [6n] }),
    nftMove(POOL, ME, 9n),
    poolEvent('RedeemRevealed', { commitId: 7n }, { types: [{ type: 'uint256[]' }], values: [[4n, 6n, 9n]] }),
  ]
  const r = readPoolReceipt({ status: 'success', logs: revealLogs }, { account: ME, pool: p721(true), requested: [{ id: 4n }, { id: 6n }, { id: 9n }] })
  assert.deepEqual(r.revealed, { commitId: 7n, ids: [4n, 6n, 9n], escrowed: [6n], rearmed: false })
  assert.deepEqual(r.items.map((i) => i.status), ['bought', 'missing', 'bought'])
  assert.match(r.words, /You got #4, #9\. The pool is holding #6/)

  const rearm = readPoolReceipt(
    { status: 'success', logs: [poolEvent('RedeemRearmed', { commitId: 7n }, { types: [{ type: 'uint256' }], values: [300n] })] },
    { account: ME, pool: p721(true) },
  )
  assert.equal(rearm.revealed?.rearmed, true)
  assert.match(rearm.words, /Reveal again/)
})
