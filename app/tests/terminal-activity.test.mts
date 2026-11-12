// Trade terminal activity feed: src/pages/Swap/terminal/activity.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { activityTime, mergeActivity, newlyMinted } from '../src/pages/Swap/terminal/activity.ts'

const MIYA = { chainId: 1, address: '0xb86b68bca287afd48f81d1f792db69368664a120', ticker: 'MIYA' }
const MILADY = { chainId: 1, address: '0x5Af0D9827E0c53E4799BB226655A1de152A425a5', ticker: 'MILADY' }
const sale = (tokenId: string, at: number, tx = `0x${tokenId}`) => ({
  tokenId,
  price: '10000000000000000',
  currency: 'ETH',
  at,
  buyer: '0xb',
  seller: '0xs',
  tx,
})

test('sales from every collection and mints, newest first; untimed mints last, highest id first', () => {
  const rows = mergeActivity(
    [
      { collection: MILADY, sales: [sale('5', 100), sale('6', 300)] },
      { collection: MIYA, sales: [sale('7', 200)] },
      { collection: MIYA, sales: undefined },
    ],
    [
      { ...MIYA, tokenId: '90', at: 250 },
      { ...MIYA, tokenId: '88' },
      { ...MIYA, tokenId: '89' },
    ]
  )
  assert.deepEqual(
    rows.map((r) => `${r.kind}:${r.ticker}#${r.tokenId}`),
    ['sale:MILADY#6', 'mint:MIYA#90', 'sale:MIYA#7', 'sale:MILADY#5', 'mint:MIYA#89', 'mint:MIYA#88']
  )
})

test('duplicates (the same sale or mint twice) appear once; bad ids are dropped; the list is capped', () => {
  const rows = mergeActivity(
    [{ collection: MIYA, sales: [sale('1', 10, '0xa'), sale('1', 10, '0xa'), sale('x', 11), sale('2', NaN)] }],
    [
      { ...MIYA, tokenId: '3' },
      { ...MIYA, tokenId: '3' },
    ]
  )
  assert.deepEqual(
    rows.map((r) => r.key),
    ['sale:0xa:0xb86b68bca287afd48f81d1f792db69368664a120:1', 'mint:0xb86b68bca287afd48f81d1f792db69368664a120:3']
  )
  const many = mergeActivity([{ collection: MIYA, sales: Array.from({ length: 30 }, (_, i) => sale(String(i), i)) }], [], 5)
  assert.equal(many.length, 5)
})

test('times: HH:MM today, month and day before, "earlier" when unknown', () => {
  const now = Date.UTC(2026, 10, 12, 18, 30) / 1000
  assert.equal(activityTime(Date.UTC(2026, 10, 12, 9, 5) / 1000, now), '09:05')
  assert.equal(activityTime(Date.UTC(2026, 10, 11, 23, 59) / 1000, now), 'Nov 11 23:59')
  assert.equal(activityTime(undefined, now), 'earlier')
})

test('newly minted ids between two supply reads, capped, nothing when it did not grow', () => {
  assert.deepEqual(newlyMinted(89, 91), ['90', '91'])
  assert.deepEqual(newlyMinted(undefined, 91), [])
  assert.deepEqual(newlyMinted(91, 91), [])
  assert.deepEqual(newlyMinted(91, 80), [])
  assert.deepEqual(newlyMinted(0, 500, 3), ['498', '499', '500'])
})
