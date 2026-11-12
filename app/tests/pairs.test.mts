// MiyaPool pair tokens and pool-token pricing (src/pages/Swap/nft/pairs.ts): which pairs exist per chain, and the
// 0x price calls that price one pool token in a pair (bid, then the ask probe), with no-route as a plain answer.
// Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bestQuote, formatPrice, priceDecimals } from '../src/pages/Swap/nft/markets.ts'
import type { PriceAnswer, PriceRequest } from '../src/pages/Swap/nft/pairs.ts'
import { buyNeedsFee } from '../src/pages/Swap/nft/pool.ts'
import {
  askFromProbe,
  DEFAULT_PAIR_SYMBOL,
  pairTokens,
  pairWords,
  pickPair,
  quotePoolInPair,
} from '../src/pages/Swap/nft/pairs.ts'
import { IMDUSD_ADDRESS, INFER_ADDRESS, MIYA_LIST, NATIVE } from '../src/pages/Swap/tokenList.ts'

const POOL = '0x1111111111111111111111111111111111111111' as const
const E18 = 10n ** 18n

test('pairs per chain: all four on Ethereum in order, only ETH on Robinhood Chain, none on Sepolia', () => {
  assert.deepEqual(pairTokens(MIYA_LIST[1]!, 1).map((t) => t.symbol), ['ETH', 'imdUSD', 'IMD', 'INFER'])
  assert.deepEqual(pairTokens(MIYA_LIST[4663]!, 4663).map((t) => t.symbol), ['ETH'])
  assert.deepEqual(pairTokens(MIYA_LIST[1]!, 11155111), [])
  // Tokens from another chain never leak in, and blocked ones are skipped.
  assert.deepEqual(pairTokens(MIYA_LIST[1]!, 4663), [])
  const blocked = MIYA_LIST[1]!.map((t) => (t.symbol === 'IMD' ? { ...t, blocked: 'no' } : t))
  assert.deepEqual(pairTokens(blocked, 1).map((t) => t.symbol), ['ETH', 'imdUSD', 'INFER'])
  const main = pairTokens(MIYA_LIST[1]!, 1)
  assert.equal(main[0]!.address, NATIVE)
  assert.equal(main[1]!.address, IMDUSD_ADDRESS)
  assert.equal(main[3]!.address, INFER_ADDRESS)
})

test('the chosen pair falls back to ETH where it is not on the chain', () => {
  const rh = pairTokens(MIYA_LIST[4663]!, 4663)
  assert.equal(DEFAULT_PAIR_SYMBOL, 'ETH')
  assert.equal(pickPair(rh, 'INFER')!.symbol, 'ETH')
  assert.equal(pickPair(pairTokens(MIYA_LIST[1]!, 1), 'IMD')!.symbol, 'IMD')
  assert.equal(pickPair([], 'ETH'), undefined)
  assert.equal(pairWords(['ETH', 'imdUSD', 'IMD', 'INFER']), 'ETH, imdUSD, IMD or INFER')
  assert.equal(pairWords(['ETH']), 'ETH')
})

test('ask from the probe rounds up, never understating the cost', () => {
  assert.equal(askFromProbe(7n * E18 / 10n, E18), 7n * E18 / 10n)
  assert.equal(askFromProbe(1n, 3n), 333333333333333334n)
  assert.equal(askFromProbe(0n, 5n), undefined)
  assert.equal(askFromProbe(5n, 0n), undefined)
})

const ETH = { address: NATIVE as `0x${string}`, symbol: 'ETH', decimals: 18 }

function fake(answers: (req: PriceRequest) => PriceAnswer | Error) {
  const calls: PriceRequest[] = []
  const fetchPrice = async (req: PriceRequest) => {
    calls.push(req)
    const a = answers(req)
    if (a instanceof Error) throw a
    return a
  }
  return { calls, fetchPrice }
}

test('one pool token priced in ETH: sell 1 for the bid, then probe the ask with that much ETH', async () => {
  const { calls, fetchPrice } = fake((req) =>
    req.sellToken === POOL
      ? { liquidityAvailable: true, buyAmount: String((69n * E18) / 100n), sellAmount: String(E18) }
      : { liquidityAvailable: true, sellAmount: req.sellAmount.toString(), buyAmount: String((97n * E18) / 100n) }
  )
  const q = await quotePoolInPair(fetchPrice, { chainId: 1, pool: POOL, pair: ETH })
  assert.equal(calls.length, 2)
  assert.equal(calls[0]!.sellAmount, E18)
  assert.equal(calls[0]!.buyToken, NATIVE)
  assert.equal(calls[1]!.sellToken, NATIVE)
  assert.equal(calls[1]!.buyToken, POOL)
  assert.equal(calls[1]!.sellAmount, (69n * E18) / 100n)
  assert.equal(q.status, 'ok')
  if (q.status !== 'ok') return
  assert.equal(q.bid, (69n * E18) / 100n)
  // 0.69 ETH bought 0.97 tokens → about 0.7113 ETH per token.
  assert.equal(formatPrice({ amount: q.ask!, decimals: 18, symbol: 'ETH' }), '0.7113 ETH')
  assert.equal(formatPrice({ amount: q.bid, decimals: 18, symbol: 'ETH' }), '0.69 ETH')
})

test('no route for a pair is an answer, not an error, and costs one call', async () => {
  const { calls, fetchPrice } = fake(() => ({ liquidityAvailable: false }))
  const q = await quotePoolInPair(fetchPrice, { chainId: 1, pool: POOL, pair: { ...ETH, symbol: 'IMD' } })
  assert.deepEqual(q, { status: 'no-route', symbol: 'IMD' })
  assert.equal(calls.length, 1)
})

test('a bid without an ask probe still prices the sell side; service errors are thrown to the caller', async () => {
  const half = fake((req) =>
    req.sellToken === POOL ? { liquidityAvailable: true, buyAmount: '5' } : { liquidityAvailable: false }
  )
  const q = await quotePoolInPair(half.fetchPrice, { chainId: 1, pool: POOL, pair: ETH })
  assert.equal(q.status === 'ok' && q.bid, 5n)
  assert.equal(q.status === 'ok' && q.ask, undefined)
  const down = fake(() => new Error('Swap service not configured.'))
  await assert.rejects(quotePoolInPair(down.fetchPrice, { chainId: 1, pool: POOL, pair: ETH }), /not configured/)
})

test('a pool priced in ETH competes with OpenSea in the cheapest line', () => {
  const os = { venue: 'OpenSea', price: { amount: (72n * E18) / 100n, decimals: 18, symbol: 'ETH' } }
  const pool = { venue: 'MiyaPool (random)', price: { amount: (71n * E18) / 100n, decimals: 18, symbol: 'ETH' } }
  assert.equal(bestQuote([os, pool])!.venue, 'MiyaPool (random)')
  assert.equal(bestQuote([os, { ...pool, price: undefined }])!.venue, 'OpenSea')
  // Offers are WETH on OpenSea; a pool bid in ETH compares with them.
  const offer = { venue: 'OpenSea', price: { amount: (65n * E18) / 100n, decimals: 18, symbol: 'WETH' } }
  const bid = { venue: 'MiyaPool', price: { amount: (69n * E18) / 100n, decimals: 18, symbol: 'ETH' } }
  assert.equal(bestQuote([offer, bid], 'highest')!.venue, 'MiyaPool')
})

test('pools compare at the pool-token price; a pick fee is named, never priced', () => {
  const os = { venue: 'OpenSea', price: { amount: (72n * E18) / 100n, decimals: 18, symbol: 'ETH' } }
  const token = { amount: (70n * E18) / 100n, decimals: 18, symbol: 'ETH' }
  // Pick-only (ERC-1155 or Robinhood Chain) with a fee: still the token price, the fee said beside it.
  const pickOnly = { imdFee: E18, inferFee: 0n, randomEnabled: false }
  assert.equal(buyNeedsFee(pickOnly), true)
  const where = buyNeedsFee(pickOnly) ? 'MiyaPool, plus the pick fee' : 'MiyaPool'
  assert.equal(bestQuote([os, { venue: where, price: token }])!.venue, 'MiyaPool, plus the pick fee')
  assert.equal(buyNeedsFee({ ...pickOnly, randomEnabled: true }), false)
})

test('prices show sensible decimals: dollars to the cent, big amounts whole', () => {
  const p = (n: bigint, symbol: string, decimals = 18) => ({ amount: n, decimals, symbol })
  assert.equal(formatPrice(p((21632653n * E18) / 10000n, 'imdUSD')), '2,163.27 imdUSD')
  assert.equal(formatPrice(p(5n * E18, 'imdUSD')), '5 imdUSD')
  assert.equal(formatPrice(p(1_500_000n, 'USDG', 6)), '1.5 USDG')
  assert.equal(formatPrice(p((21632653n * E18) / 10000n, 'IMD')), '2,163 IMD')
  assert.equal(formatPrice(p(1_234_567n * E18, 'INFER')), '1,234,567 INFER')
  assert.equal(formatPrice(p((12345n * E18) / 1000n, 'INFER')), '12.35 INFER')
  assert.equal(formatPrice(p((71134n * E18) / 100000n, 'ETH')), '0.7113 ETH')
  assert.equal(priceDecimals(p(1n, 'imdUSD')), 2)
  assert.equal(formatPrice(p(1n, 'imdUSD')), '<0.01 imdUSD')
})
