// Trade's market boards: src/pages/Swap/board.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { changeTone, formatChange, formatCompactUsd, formatUsd, quoteFrom } from '../src/pages/Swap/board.ts'

const A = '0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa'
const B = '0xbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBB'

test('quoteFrom takes the deepest pair where the token is the base', () => {
  const q = quoteFrom(
    [
      { baseToken: { address: A }, priceUsd: '1', liquidity: { usd: 10 } },
      { baseToken: { address: A.toLowerCase() }, priceUsd: '2', liquidity: { usd: 500 }, priceChange: { h24: -3 }, volume: { h24: 7 } },
      // Deeper, but A is the quote here: its priceUsd is the other token's price.
      { baseToken: { address: B }, priceUsd: '9', liquidity: { usd: 9000 } },
    ],
    A
  )
  assert.deepEqual(q, { priceUsd: 2, change24h: -3, liquidityUsd: 500, volume24h: 7 })
})

test('quoteFrom: no usable pair is no quote', () => {
  assert.equal(quoteFrom(null, A), undefined)
  assert.equal(quoteFrom([], A), undefined)
  assert.equal(quoteFrom([{ baseToken: { address: A }, priceUsd: '0' }], A), undefined)
  assert.equal(quoteFrom([{ baseToken: { address: B }, priceUsd: '1' }], A), undefined)
})

test('prices read at any size', () => {
  assert.equal(formatUsd(3412.7), '$3,413')
  assert.equal(formatUsd(0.99), '$0.990')
  assert.equal(formatUsd(1.5), '$1.50')
  assert.equal(formatUsd(0.0007962), '$0.000796')
  assert.equal(formatUsd(undefined), '–')
  assert.equal(formatCompactUsd(64108), '$64.1K')
  assert.equal(formatCompactUsd(1_200_000), '$1.2M')
  assert.equal(formatCompactUsd(106.5), '$107')
})

test('change shows its sign and tone', () => {
  assert.equal(formatChange(-5.41), '-5.4%')
  assert.equal(formatChange(2), '+2.0%')
  assert.equal(formatChange(-0.01), '0.0%')
  assert.equal(changeTone(-0.01), 'flat')
  assert.equal(formatChange(undefined), '–')
  assert.equal(changeTone(2), 'up')
  assert.equal(changeTone(-1), 'down')
  assert.equal(changeTone(0), 'flat')
  assert.equal(changeTone(undefined), 'flat')
})
