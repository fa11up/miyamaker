// src/pages/Auction/fitText.ts: the lot description steps down through whole-pixel sizes until it fits, and says so
// when even the smallest does not. Run: yarn test
import { lotAction } from '../src/pages/Auction/lotAction.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DESCRIPTION_SIZES, pickFitSize } from '../src/pages/Auction/fitText.ts'

test('keeps the largest size when the text already fits', () => {
  assert.deepEqual(
    pickFitSize(DESCRIPTION_SIZES, () => true),
    { size: 15, overflow: false }
  )
})

test('steps down to the first size that fits, trying largest first', () => {
  const tried: number[] = []
  const result = pickFitSize(DESCRIPTION_SIZES, (size) => {
    tried.push(size)
    return size <= 13
  })
  assert.deepEqual(result, { size: 13, overflow: false })
  assert.deepEqual(tried, [15, 14, 13])
})

test('flags overflow at the smallest size when nothing fits', () => {
  assert.deepEqual(
    pickFitSize(DESCRIPTION_SIZES, () => false),
    { size: 12, overflow: true }
  )
})

test('sizes are whole pixels, descending, and never below 12px', () => {
  for (let i = 0; i < DESCRIPTION_SIZES.length; i++) {
    const size = DESCRIPTION_SIZES[i] as number
    assert.ok(Number.isInteger(size) && size >= 12)
    if (i > 0) assert.ok(size < (DESCRIPTION_SIZES[i - 1] as number))
  }
})

test('lotAction: Bid only while the auction is running', () => {
  assert.equal(lotAction(2000, false, 1_000_000), 'Bid')
  assert.equal(lotAction(1000, false, 1_000_000), 'Open lot', 'ends exactly now')
  assert.equal(lotAction(500, false, 1_000_000), 'Open lot', 'ended')
  assert.equal(lotAction(2000, true, 1_000_000), 'Open lot', 'settled')
  assert.equal(lotAction(0, false, 1_000_000), 'Open lot', 'chain has not answered')
})
