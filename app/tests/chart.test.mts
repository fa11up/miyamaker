// Trade's price chart and wallet history: src/pages/Swap/chart.ts, history.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { candleAt, candlesUrl, chartPrice, parseCandles, priceRange, priceTicks, TIMEFRAMES } from '../src/pages/Swap/chart.ts'
import { formatAmount, mergeMoves, transferQuery } from '../src/pages/Swap/history.ts'

const WBTC = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
const ME = '0x' + 'a'.repeat(40)
const HIM = '0x' + 'b'.repeat(40)
const hash = (c: string) => '0x' + c.repeat(64)

test('the chart asks for one token by address, on a known network', () => {
  const url = candlesUrl('ethereum', '0xabc', WBTC, TIMEFRAMES[1]) ?? ''
  assert.match(url, /networks\/eth\/pools\/0xabc\/ohlcv\/hour\?aggregate=1/)
  assert.ok(url.includes(`token=${WBTC}`))
  assert.ok(candlesUrl('robinhood', '0xabc', WBTC, TIMEFRAMES[0])?.includes('/ohlcv/minute?aggregate=15'))
  assert.equal(candlesUrl('solana', '0xabc', WBTC, TIMEFRAMES[1]), undefined)
  assert.equal(candlesUrl('ethereum', '../evil', WBTC, TIMEFRAMES[1]), undefined)
  assert.equal(candlesUrl('ethereum', '0xabc', 'nope', TIMEFRAMES[1]), undefined)
})

test('candles come out oldest first, one per time, with bad rows dropped', () => {
  const candles = parseCandles({
    data: {
      attributes: {
        ohlcv_list: [
          [300, 3, 4, 2, 3, 9],
          [100, 1, 2, 1, 2, 5],
          [100, 9, 9, 9, 9, 9],
          [200, 0, 1, 1, 1, 1],
          'junk',
          [400, 1, 1, 1],
        ],
      },
    },
  })
  assert.deepEqual(
    candles.map((c) => c.at),
    [100, 300],
  )
  assert.equal(candles[0]?.open, 9)
  assert.deepEqual(parseCandles({}), [])
  assert.deepEqual(parseCandles(null), [])
})

test('range and price lines', () => {
  const c = { at: 1, open: 1, close: 1, volume: 0 }
  const { low, high } = priceRange([{ ...c, low: 10, high: 20 }])
  assert.ok(low < 10 && high > 20)
  assert.deepEqual(priceTicks(0, 10), [0, 2, 4, 6, 8, 10])
  assert.deepEqual(
    priceTicks(0.00071, 0.00079, 4),
    [0.00072, 0.00074, 0.00076, 0.00078].map((n) =>
      priceTicks(0.00071, 0.00079, 4).find((t) => Math.abs(t - n) < 1e-9),
    ),
  )
  assert.deepEqual(priceTicks(5, 5), [])
  const flat = priceRange([{ ...c, low: 7, high: 7 }])
  assert.ok(flat.high > flat.low)
})

test('hover finds the candle', () => {
  assert.equal(candleAt(0, 100, 10), 0)
  assert.equal(candleAt(99, 100, 10), 9)
  assert.equal(candleAt(150, 100, 10), undefined)
  assert.equal(candleAt(5, 100, 0), undefined)
})

test('history query: tokens by contract, ETH by plain transfers', () => {
  const erc = transferQuery(WBTC, false, 'toAddress', ME).params[0] as Record<string, unknown>
  assert.deepEqual(erc.contractAddresses, [WBTC])
  assert.deepEqual(erc.category, ['erc20'])
  assert.equal(erc.toAddress, ME)
  const eth = transferQuery(WBTC, true, 'fromAddress', ME).params[0] as Record<string, unknown>
  assert.equal(eth.contractAddresses, undefined)
  assert.deepEqual(eth.category, ['external'])
})

test('history merges both directions, newest first, without repeats or strangers', () => {
  const move = (o: object) => ({ metadata: { blockTimestamp: '2026-11-01T00:00:00Z' }, value: 1, ...o })
  const moves = mergeMoves(
    [
      {
        result: {
          transfers: [
            move({
              uniqueId: 'a',
              hash: hash('1'),
              from: ME.toUpperCase().replace('0X', '0x'),
              to: HIM,
              metadata: { blockTimestamp: '2026-11-02T00:00:00Z' },
            }),
          ],
        },
      },
      {
        result: {
          transfers: [
            move({ uniqueId: 'b', hash: hash('2'), from: HIM, to: ME }),
            move({ uniqueId: 'a', hash: hash('1'), from: ME, to: HIM }),
            move({ uniqueId: 'c', hash: hash('3'), from: HIM, to: HIM }),
            move({ uniqueId: 'd', hash: 'bad', from: HIM, to: ME }),
          ],
        },
      },
      { error: { message: 'nope' } },
    ],
    ME,
  )
  assert.deepEqual(
    moves.map((m) => [m.id, m.side, m.other]),
    [
      ['a', 'out', HIM],
      ['b', 'in', HIM],
    ],
  )
})

test('amounts read well at any size', () => {
  assert.equal(formatAmount(1234567.8), '1,234,568')
  assert.equal(formatAmount(1.23456), '1.235')
  assert.equal(formatAmount(0.000123456), '0.000123')
})

test('a live price outside the candles stays in view', () => {
  const c = [{ at: 1, open: 10, high: 12, low: 9, close: 11, volume: 1 }]
  const plain = priceRange(c)
  const live = priceRange(c, 20)
  assert.ok(live.high > 20)
  assert.equal(live.low < plain.low, true, 'more air on the wider range')
  assert.deepEqual(priceRange(c, Number.NaN), plain, 'a bad price is ignored')
})

test('the chart tags the live price, unless it cannot be this market', () => {
  assert.equal(chartPrice(0.00078, 0.000853), 0.00078, 'a thin pool whose last trade is old')
  assert.equal(chartPrice(3000, 0.00085), 0.00085, 'some other market altogether')
  assert.equal(chartPrice(0.0001, 0.00085), 0.00085)
  assert.equal(chartPrice(undefined, 5), 5)
  assert.equal(chartPrice(Number.NaN, 5), 5)
})
