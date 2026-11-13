// Batched NFT orders on the collection page: src/pages/Swap/nft/batchRoute.ts (what is ticked, where each NFT goes,
// what the bar says) and the rules the review (BatchReview.tsx) and the page keep, as source scans. Offline.
// Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { encodeAbiParameters, encodeEventTopics, getAddress } from 'viem'

import './ts-paths.mts'
import {
  BATCH_MAX,
  batchSummary,
  ethText,
  ethValue,
  excludedWords,
  FULL_WORDS,
  ITEM_RESULT_WORDS,
  needsRefresh,
  POOL_TOKEN_NOTE,
  poolItemResults,
  preTick,
  REFRESH_BEFORE_S,
  reviewChange,
  routeSells,
  sameDeal,
  sellPicks,
  togglePick,
  venuesOf,
} from '../src/pages/Swap/nft/batchRoute.ts'
import { poolBatchAbi, readPoolReceipt } from '../src/pages/Swap/nft/poolBatch.ts'
import { code } from './source-scan.mts'

const { EXPIRY_MARGIN_S, MAX_BATCH } = await import('../src/pages/Swap/nft/batch.ts')

const ETH = 10n ** 18n
const order = (hash: string, amount: bigint, symbol = 'WETH', total?: bigint) => ({
  hash,
  price: { amount, symbol, decimals: 18 },
  ...(total !== undefined ? { total: { amount: total, symbol, decimals: 18 } } : {}),
})
const POOL_A = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa'
const POOL_B = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
const pool = (address: string, ethBid?: bigint, symbol = 'MIYAP') => ({ address, symbol, label: `MiyaPool ${symbol}`, ethBid })

/* ---------- selection ---------- */

test('the batch cap is the one batch.ts plans with, and the refresh margin covers its expiry margin', () => {
  assert.equal(BATCH_MAX, MAX_BATCH)
  assert.ok(REFRESH_BEFORE_S >= EXPIRY_MARGIN_S)
  assert.match(FULL_WORDS, new RegExp(`at most ${BATCH_MAX}\\b`))
})

test('ticking toggles, and past the cap nothing changes and the bar says why', () => {
  let picks: { key: string }[] = []
  for (let i = 0; i < BATCH_MAX; i += 1) picks = togglePick(picks, { key: `k${i}` }).picks
  assert.equal(picks.length, BATCH_MAX)
  const over = togglePick(picks, { key: 'one-more' })
  assert.equal(over.picks.length, BATCH_MAX)
  assert.equal(over.full, FULL_WORDS)
  assert.ok(!over.picks.some((p) => p.key === 'one-more'))
  const off = togglePick(picks, { key: 'k3' })
  assert.equal(off.picks.length, BATCH_MAX - 1)
  assert.equal(off.full, undefined)
})

test('the sweep ticks the N cheapest in place of other OpenSea ticks, keeps pool picks, never past the cap', () => {
  const picks = [
    { key: 'old-listing', venue: 'opensea' },
    { key: 'pool:7', venue: 'pool' },
  ]
  const cheapest = ['a', 'b', 'c'].map((key) => ({ key, venue: 'opensea' }))
  const r = preTick(picks, cheapest, (p) => p.venue === 'opensea')
  assert.deepEqual(
    r.picks.map((p) => p.key),
    ['pool:7', 'a', 'b', 'c']
  )
  const big = Array.from({ length: BATCH_MAX + 2 }, (_, i) => ({ key: `l${i}`, venue: 'opensea' }))
  const capped = preTick(picks, big, (p) => p.venue === 'opensea')
  assert.equal(capped.picks.length, BATCH_MAX)
  assert.equal(capped.full, FULL_WORDS)
  // Already ticked counts once.
  assert.equal(preTick([{ key: 'a', venue: 'opensea' }], cheapest, () => false).picks.length, 3)
})

/* ---------- amounts ---------- */

test('only ETH and WETH count as ETH; amounts read short', () => {
  assert.equal(ethValue({ amount: 5n, symbol: 'ETH' }), 5n)
  assert.equal(ethValue({ amount: 5n, symbol: 'WETH', decimals: 18 }), 5n)
  assert.equal(ethValue({ amount: 5n, symbol: 'USDC', decimals: 6 }), undefined)
  assert.equal(ethValue(undefined), undefined)
  assert.equal(ethText(ETH + ETH / 2n), '1.5')
  assert.equal(ethText(123_456_789_000_000_000n), '0.1235')
  assert.equal(ethText(2n * ETH), '2')
  assert.equal(ethText(1n), '<0.0001')
})

/* ---------- sells ---------- */

test('each NFT goes to its best ETH outcome: an OpenSea bid or a pool priced through 0x', () => {
  const routes = routeSells(
    [
      { tokenId: '1', bid: order('0xbid1', ETH / 2n) },
      { tokenId: '2', bid: order('0xbid2', ETH / 10n) },
    ],
    [pool(POOL_A, ETH / 5n)]
  )
  assert.equal(routes[0]!.venue, 'opensea')
  assert.equal(routes[1]!.venue, POOL_A.toLowerCase())
  assert.equal(routes[1]!.note, POOL_TOKEN_NOTE)
  // A pool is shown as what it is: one pool token, with the ETH it might fetch only as an estimate.
  const poolOpt = routes[1]!.options.find((o) => o.venue === POOL_A.toLowerCase())!
  assert.equal(poolOpt.token, true)
  assert.match(poolOpt.gets, /^1 MIYAP \(≈ 0\.2 ETH if swapped\)$/)
  assert.match(routes[0]!.options[0]!.gets, /0\.5 WETH before fees/)
})

test('a tie goes to OpenSea, and an unpriced pool never beats a bid', () => {
  const tie = routeSells([{ tokenId: '1', bid: order('0x1', ETH) }], [pool(POOL_A, ETH)])
  assert.equal(tie[0]!.venue, 'opensea')
  const unpriced = routeSells([{ tokenId: '1', bid: order('0x1', 1n) }], [pool(POOL_A)])
  assert.equal(unpriced[0]!.venue, 'opensea')
  // A bid in a token that isn't ETH still beats a pool token with no price: it is money now.
  const usdc = routeSells([{ tokenId: '1', bid: order('0x1', 5_000_000n, 'USDC') }], [pool(POOL_A)])
  assert.equal(usdc[0]!.venue, 'opensea')
  // ...but a priced pool beats a bid that can't be compared in ETH.
  const priced = routeSells([{ tokenId: '1', bid: order('0x1', 5_000_000n, 'USDC') }], [pool(POOL_A, 1n)])
  assert.equal(priced[0]!.venue, POOL_A.toLowerCase())
})

test('with no bid the pool takes it; with neither, it has no venue and says so', () => {
  const r = routeSells(
    [
      { tokenId: '1', bid: null },
      { tokenId: '2', bid: undefined },
    ],
    [pool(POOL_A)]
  )
  assert.equal(r[0]!.venue, POOL_A.toLowerCase())
  assert.equal(r[1]!.checking, true)
  const none = routeSells([{ tokenId: '3', bid: null }], [])
  assert.equal(none[0]!.venue, undefined)
  assert.match(none[0]!.note!, /No bid and no pool/)
  assert.deepEqual(sellPicks(none), [])
})

test('the person can switch an NFT to another venue; an unknown choice falls back to the best', () => {
  const items = [{ tokenId: '1', bid: order('0x1', ETH) }]
  const pools = [pool(POOL_A, ETH / 10n), pool(POOL_B, ETH / 20n, 'MINIP')]
  assert.equal(routeSells(items, pools, { '1': POOL_B })[0]!.venue, POOL_B.toLowerCase())
  assert.equal(routeSells(items, pools, { '1': POOL_B.toUpperCase().replace('0X', '0x') })[0]!.venue, POOL_B.toLowerCase())
  assert.equal(routeSells(items, pools, { '1': '0xnot-a-venue' })[0]!.venue, 'opensea')
  const picks = sellPicks(routeSells(items, pools, { '1': POOL_B }))
  assert.deepEqual(picks, [{ key: '1', tokenId: '1', venue: 'pool', pool: POOL_B.toLowerCase() }])
})

test('one collection bid fills one NFT per batch: the next NFT with the same best bid goes elsewhere', () => {
  const shared = order('0xCOLLECTION', ETH)
  const r = routeSells(
    [
      { tokenId: '1', bid: shared },
      { tokenId: '2', bid: shared },
      { tokenId: '3', bid: shared },
    ],
    [pool(POOL_A, ETH / 10n)]
  )
  assert.equal(r[0]!.venue, 'opensea')
  assert.equal(r[1]!.venue, POOL_A.toLowerCase())
  assert.match(r[1]!.options[0]!.blocked!, /already used by #1/)
  // Picking OpenSea for a blocked one isn't possible: it stays where it can go.
  assert.equal(routeSells([{ tokenId: '1', bid: shared }, { tokenId: '2', bid: shared }], [], { '2': 'opensea' })[1]!.venue, undefined)
  const noPool = routeSells([{ tokenId: '1', bid: shared }, { tokenId: '2', bid: shared }], [])
  assert.match(noPool[1]!.note!, /already used by #1/)
  assert.equal(sellPicks(noPool).length, 1)
})

/* ---------- the bar ---------- */

test('the bar names ETH for listings and tokens for pools, never adding a pool token into ETH', () => {
  const buy = batchSummary(
    'buy',
    [
      { key: 'a', tokenId: '1', venue: 'opensea', order: order('0xa', ETH / 4n, 'ETH') },
      { key: 'b', tokenId: '2', venue: 'opensea', order: order('0xb', ETH / 5n, 'ETH', (ETH * 2n) / 5n) },
      { key: 'p:3', tokenId: '3', venue: 'pool', pool: POOL_A },
    ],
    [{ address: POOL_A, symbol: 'MIYAP', ethAsk: ETH / 10n }]
  )
  // The ERC-1155 order counts in full (its total), not one item of it.
  assert.equal(buy.words, 'Buy 3 · 0.65 ETH + 1 MIYAP')
  assert.equal(buy.eth, (ETH * 65n) / 100n)
  assert.equal(buy.poolEth, ETH / 10n)
  const sell = batchSummary(
    'sell',
    [
      { key: '1', tokenId: '1', venue: 'opensea', order: order('0xa', ETH / 2n) },
      { key: '2', tokenId: '2', venue: 'pool', pool: POOL_A.toLowerCase() },
      { key: '3', tokenId: '3', venue: 'pool', pool: POOL_A },
    ],
    [{ address: POOL_A, symbol: 'MIYAP' }]
  )
  assert.equal(sell.words, 'Sell 3 · ~0.5 WETH before fees + 2 MIYAP')
  assert.equal(sell.poolEth, undefined)
  // A pool whose picks pay a fee says so on a buy (never on a sell): the fee is in IMD/INFER, not ETH.
  const picks = [{ key: 'p:3', tokenId: '3', venue: 'pool' as const, pool: POOL_A }]
  const fee = [{ address: POOL_A, symbol: 'MIYAP', pickFee: true }]
  assert.equal(batchSummary('buy', picks, fee).words, 'Buy 1 · 1 MIYAP + pick fee')
  assert.equal(batchSummary('sell', picks, fee).words, 'Sell 1 · 1 MIYAP')
  const usdc = batchSummary('buy', [{ key: 'a', tokenId: '1', venue: 'opensea', order: order('0xa', 5n, 'USDC') }], [])
  assert.equal(usdc.words, 'Buy 1 · 1 order in another token')
  assert.equal(batchSummary('buy', [], []).words, '')
})

/* ---------- the review ---------- */

test('venues run OpenSea first, then each pool in the order first ticked', () => {
  const v = venuesOf([
    { key: 'p1', tokenId: '1', venue: 'pool', pool: POOL_B },
    { key: 'a', tokenId: '2', venue: 'opensea', order: order('0xa', 1n) },
    { key: 'p2', tokenId: '3', venue: 'pool', pool: POOL_A },
    { key: 'p3', tokenId: '4', venue: 'pool', pool: POOL_B.toUpperCase().replace('0X', '0x') },
  ])
  assert.deepEqual(
    v.map((x) => [x.venue, x.picks.length]),
    [
      ['opensea', 1],
      [POOL_B.toLowerCase(), 2],
      [POOL_A.toLowerCase(), 1],
    ]
  )
})

test("OpenSea's fill data is fetched again when its permission is close to running out", () => {
  assert.equal(needsRefresh(undefined, 1000), false)
  assert.equal(needsRefresh(1000 + REFRESH_BEFORE_S, 1000), false)
  assert.equal(needsRefresh(1000 + REFRESH_BEFORE_S - 1, 1000), true)
  assert.equal(needsRefresh(1000 + EXPIRY_MARGIN_S - 1, 1000), true)
  assert.equal(needsRefresh(900, 1000), true)
})

test('a refreshed plan goes ahead only when it is the same orders at no worse a price', () => {
  const agreed = { keys: ['a', 'b'], total: 100n }
  assert.ok(sameDeal('buy', agreed, { keys: ['b', 'a'], total: 100n }))
  assert.ok(sameDeal('buy', agreed, { keys: ['a', 'b'], total: 90n }))
  assert.ok(!sameDeal('buy', agreed, { keys: ['a', 'b'], total: 101n }))
  assert.ok(!sameDeal('buy', agreed, { keys: ['a'], total: 50n }))
  assert.ok(sameDeal('sell', agreed, { keys: ['a', 'b'], total: 120n }))
  assert.ok(!sameDeal('sell', agreed, { keys: ['a', 'b'], total: 99n }))
})

test('another account, or leaving the network, cancels the review; arriving on the network does not', () => {
  const A = '0x00000000000000000000000000000000000000aa'
  const B = '0x00000000000000000000000000000000000000bb'
  assert.equal(reviewChange({ account: A, onChain: true }, { account: A.toUpperCase().replace('0X', '0x'), chainId: 1 }, 1), undefined)
  assert.equal(reviewChange({ account: A, onChain: true }, { account: B, chainId: 1 }, 1), 'Account changed. Review again.')
  assert.equal(reviewChange({ account: A, onChain: true }, { account: undefined, chainId: 1 }, 1), 'Account changed. Review again.')
  assert.equal(reviewChange({ account: A, onChain: true }, { account: A, chainId: 4663 }, 1), 'Network changed. Review again.')
  assert.equal(reviewChange({ account: A, onChain: false }, { account: A, chainId: 4663 }, 1), undefined)
  assert.equal(reviewChange({ account: undefined, onChain: false }, { account: B, chainId: 1 }, 1), undefined)
})

test("a shared collection bid's batch.ts reason is said for this screen", () => {
  assert.match(excludedWords('Already in this batch.', 'sell'), /already used by another NFT/)
  assert.equal(excludedWords('Already in this batch.', 'buy'), 'Already in this batch.')
})

test('pool rows are sold or bought only when the receipt shows it; no receipt stays not confirmed', () => {
  const ME = getAddress('0xabcdef0000000000000000000000000000000001')
  const POOL = getAddress('0x1111111111111111111111111111111111111111')
  const NFT = getAddress('0x2222222222222222222222222222222222222222')
  const ref = { address: POOL, collection: NFT, kind: 0 as const, mode: 0 as const, symbol: 'MIYAP' }
  const deposited = {
    address: POOL,
    topics: encodeEventTopics({ abi: poolBatchAbi, eventName: 'Deposited', args: { from: ME, to: ME } }),
    data: encodeAbiParameters([{ type: 'uint256[]' }, { type: 'uint256[]' }], [[3n], [1n]]),
  }
  const reading = readPoolReceipt({ status: 'success', logs: [deposited] as never }, {
    account: ME,
    pool: ref,
    requested: [{ id: 3n }, { id: 4n }],
  })
  assert.deepEqual(poolItemResults(reading, ['3', '4']), { '3': 'sold', '4': 'missing' })
  const failed = readPoolReceipt({ status: 'reverted', logs: [] }, { account: ME, pool: ref, requested: [{ id: 3n }] })
  assert.deepEqual(poolItemResults(failed, ['3']), { '3': 'failed' })
  assert.deepEqual(poolItemResults(undefined, ['3']), { '3': 'unconfirmed' })
  assert.equal(ITEM_RESULT_WORDS.unconfirmed, 'Not confirmed yet')
})

/* ---------- the review's rules, read from its source ---------- */

const review = code('src/pages/Swap/nft/BatchReview.tsx')
const between = (from: string, to: string) => {
  const a = review.indexOf(from)
  const b = review.indexOf(to, a + from.length)
  assert.ok(a >= 0 && b > a, `missing ${from} … ${to}`)
  return review.slice(a, b)
}

test('every venue is checked again right before its wallet prompt, and nothing is sent unchecked', () => {
  const run = between('await runSweep(jobs, {', 'onRefused:')
  const simulate = between('simulate: async (job) => {', 'send: (_job, call)')
  // The words the person sees, then the account check, then the check of the call itself.
  assert.match(simulate, /setStage\('check'\)[\s\S]*guard\(\)/)
  assert.match(simulate, /needsRefresh\(plan\.expiresAt, nowS\(\)\)[\s\S]*fetchInputs\(\)[\s\S]*sameDeal\(/)
  assert.match(simulate, /simulateOs\(plan\)[\s\S]*check\.problem[\s\S]*guard\(\)[\s\S]*setStage\('wallet'\)/)
  assert.match(simulate, /simulatePoolStep\([\s\S]*if \(!sim\.ok\) throw[\s\S]*guard\(\)/)
  assert.match(review, /'Checking the transaction again…'/)
  // The only send is runSweep's, with the call the check returned; the wallet is never opened anywhere else.
  assert.equal((review.match(/sendTransaction\(/g) ?? []).length, 1)
  assert.match(run, /send: \(_job, call\) =>\s*sendTransaction\(wagmiConfig, \{ account: me, chainId, to: call\.to, data: call\.data, value: call\.value \}\)/)
  assert.match(run, /isStopped: \(\) => left\.current/)
  // The OpenSea check runs on exactly the bytes that are signed.
  assert.match(review, /client\.call\(\{ account: me!, to: plan\.call\.to, data: plan\.call\.data, value: plan\.call\.value \}\)/)
})

test('approvals are their own presses, never folded into a wallet batch with the trade', () => {
  assert.doesNotMatch(review, /tryBatch|runBatch|sendCalls/)
  assert.match(review, /tx\.run\('os-nft'/)
  // A pool approval is checked (only this pool, only this batch's exact fee), then sent as a decoded contract write.
  assert.match(
    review,
    /const id = `pool-approve-[\s\S]*checkPoolCalls\(\[s\.call\], plan\)[\s\S]*contractCall\(s\.call, ref\)[\s\S]*tx\.run\(id, \{ \.\.\.write, chainId \}\)/
  )
  // An ERC-20 allowance is exactly the fees, never unlimited.
  assert.match(review, /functionName: 'approve',\s*args: \[operator, osPlan\.fromYou\]/)
  assert.doesNotMatch(review, /maxUint256/)
})

test('per-NFT results come from the receipt: bought or sold is never set by hand', () => {
  assert.match(review, /receiptOutcome\(plan, receipt as never, me\)/)
  assert.match(review, /readPoolReceipt\(receipt as never/)
  assert.match(review, /poolItemResults\(reading, job\.ids\)/)
  // Only "stopped" (nothing sent) is ever set without a receipt.
  const direct = [...review.matchAll(/setItems\(.*?,\s*'(\w+)'\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(direct)], ['stopped'])
  assert.doesNotMatch(review, /\[k(ey)?, '(bought|sold)'\]/)
  // A receipt that can't be read leaves rows unconfirmed.
  assert.match(review, /run\.state === 'unconfirmed' \|\| !receipt\s*\? receiptOutcome\(plan, undefined, me\)/)
})

test('an account or network change cancels the review and stops prompts; closing mid-run does too', () => {
  assert.match(review, /reviewChange\(start\.current, \{ account: me, chainId: walletChain \}, chainId\)[\s\S]*left\.current = true/)
  assert.match(review, /const guard = \(\) => \{[\s\S]*getAccount\(wagmiConfig\)[\s\S]*reviewChange\([\s\S]*left\.current = true[\s\S]*if \(left\.current\) throw/)
  assert.match(review, /if \(running\) left\.current = true\s*onClose\(\)/)
  assert.match(review, /return \(\) => \{\s*left\.current = true/)
  assert.match(review, /label: 'Review again', onClick: onAgain/)
})

test("a wallet refusal stops the venues after it, and the batch falls back to one by one when it can't go", () => {
  assert.match(review, /isRefusal: refused/)
  assert.match(review, /onRefused: \(\) => setStopWords\('You stopped it in your wallet\. Nothing else will be sent\.'\)/)
  assert.match(review, /Buy them one by one|them one by one/)
  assert.match(review, /setOsFallback\(true\)/)
})

test('the ticket takes a batch like a sweep, and a finished batch does not re-ask OpenSea for its own orders', () => {
  const index = code('src/pages/Swap/index.tsx')
  assert.match(index, /nftTicket\.kind === 'batch' \? \(\s*<BatchReview/)
  assert.match(index, /'os-batch', 'os-batch-sim'/)
  const ticket = code('src/pages/Swap/terminal/ticket.tsx')
  assert.match(ticket, /kind: 'batch'/)
})

test('the collection page: ticks are 32px presses, the sweep pre-ticks the same batch, the bar caps and clears', () => {
  const view = code('src/pages/Swap/nft/CollectionView.tsx')
  assert.match(view, /const Tick = styled\.button`[\s\S]*width: 32px;\s*height: 32px;/)
  assert.match(view, /min-height: 32px;[\s\S]*\.narrow & select \{\s*min-height: 44px;/)
  assert.match(view, /const tickCheapest = \(\) => \{[\s\S]*preTick\(/)
  assert.doesNotMatch(view, /kind: 'sweep'/)
  assert.match(view, /ticket\.open\(\{ kind: 'batch'/)
  assert.match(view, /data-batch-full/)
  assert.match(view, /Clear/)
  // Only listings a batch can take get a tick (ETH, not yours, not still unconfirmed).
  assert.match(view, /const tickable = new Set\(canSweep\.map\(\(l\) => l\.hash\)\)/)
})
