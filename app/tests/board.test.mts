// Trade's market boards: src/pages/Swap/board.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  changeTone,
  ethInUsd,
  formatChange,
  formatCompactUsd,
  formatUsd,
  quoteFrom,
  FEATURED_COLLECTIONS,
  featuredOn,
  buyShare,
  formatAge,
  marketLinks,
  marketsFor,
  nextSort,
  sortRows,
} from '../src/pages/Swap/board.ts'

const A = '0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa'
const B = '0xbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBB'

test('quoteFrom takes the deepest pair where the token is the base', () => {
  const q = quoteFrom(
    [
      { baseToken: { address: A }, priceUsd: '1', liquidity: { usd: 10 } },
      {
        baseToken: { address: A.toLowerCase() },
        priceUsd: '2',
        liquidity: { usd: 500 },
        priceChange: { h24: -3 },
        volume: { h24: 7 },
      },
      // Deeper, but A is the quote here: its priceUsd is the other token's price.
      { baseToken: { address: B }, priceUsd: '9', liquidity: { usd: 9000 } },
    ],
    A,
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

test('ETH amounts read in dollars when the price is known', () => {
  assert.equal(ethInUsd(700000000000000000n, 2250), '≈ $1,575')
  assert.equal(ethInUsd(700000000000000000n, undefined), '')
  assert.equal(ethInUsd(undefined, 2250), '')
})

test('featured collections are listed per chain, each once', () => {
  assert.equal(new Set(FEATURED_COLLECTIONS.map((c) => c.slug)).size, FEATURED_COLLECTIONS.length)
  assert.ok(FEATURED_COLLECTIONS.every((c) => /^0x[0-9a-fA-F]{40}$/.test(c.address)))
  assert.ok(featuredOn(1).some((c) => c.slug === 'identitymd'))
  assert.deepEqual(
    featuredOn(4663).map((c) => c.slug),
    ['quotrons404', 'chain-mancers'],
  )
  assert.deepEqual(featuredOn(11155111), [])
})

test('a token only charts on pairs where it is the token being priced', () => {
  const T = '0xAbC'
  const pairs = [
    { pairAddress: 'a', baseToken: { address: '0xOther' }, quoteToken: { address: T }, liquidity: { usd: 99 } },
    { pairAddress: 'b', baseToken: { address: '0xabc' }, liquidity: { usd: 1 } },
    { pairAddress: 'c', baseToken: { address: T }, liquidity: { usd: 5 } },
    { baseToken: { address: T }, liquidity: { usd: 50 } },
  ]
  assert.deepEqual(
    marketsFor(pairs, T).map((p) => p.pairAddress),
    ['c', 'b'],
  )
  assert.deepEqual(marketsFor(undefined, T), [])
})

test('buy share and pool age', () => {
  assert.equal(buyShare({ buys: 3, sells: 1 }), 75)
  assert.equal(buyShare({ buys: 0, sells: 0 }), undefined)
  assert.equal(buyShare(undefined), undefined)
  const day = 86_400_000
  assert.equal(formatAge(1000 * day - day / 4, 1000 * day), '6h')
  assert.equal(formatAge(1000 * day - 3 * day, 1000 * day), '3d')
  assert.equal(formatAge(1000 * day - 90 * day, 1000 * day), '3mo')
  assert.equal(formatAge(undefined, 1000), '–')
})

test('links a token creator typed in stay https only', () => {
  const links = marketLinks({
    info: {
      websites: [
        { url: 'https://imd.fun', label: 'Website' },
        { url: 'javascript:alert(1)', label: 'Bad' },
      ],
      socials: [
        { url: 'http://plain.test', type: 'x' },
        { url: 'https://x.com/imd', type: 'twitter' },
      ],
    },
  })
  assert.deepEqual(links, [
    { label: 'Website', url: 'https://imd.fun' },
    { label: 'twitter', url: 'https://x.com/imd' },
  ])
})

test('a column sorts down, then up, then back to the list order', () => {
  assert.deepEqual(nextSort(undefined, 'floor'), { key: 'floor', dir: 'desc' })
  assert.deepEqual(nextSort({ key: 'floor', dir: 'desc' }, 'floor'), { key: 'floor', dir: 'asc' })
  assert.equal(nextSort({ key: 'floor', dir: 'asc' }, 'floor'), undefined)
  assert.deepEqual(nextSort({ key: 'floor', dir: 'asc' }, 'volume'), { key: 'volume', dir: 'desc' })
})

test('sorting keeps ties in order and leaves rows with no figure at the bottom', () => {
  const rows = [{ id: 'a', n: 2 }, { id: 'b' }, { id: 'c', n: 9 }, { id: 'd', n: 2 }, { id: 'e', n: 0 }]
  const ids = (dir) =>
    sortRows(rows, { key: 'n', dir }, (r) => r.n)
      .map((r) => r.id)
      .join('')
  assert.equal(ids('desc'), 'cadeb')
  assert.equal(ids('asc'), 'eadcb')
  assert.equal(
    sortRows(rows, undefined, (r) => r.n)
      .map((r) => r.id)
      .join(''),
    'abcde',
  )
})
