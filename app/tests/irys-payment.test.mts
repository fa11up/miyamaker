import assert from 'node:assert/strict'
import test from 'node:test'

import { PAYMENT_MEMORY_MS, uncounted } from '../src/utils/irysPayment.ts'

const paid = { amount: '100', before: '5', at: 1000 }

test('a payment not yet in the balance still counts, so a retry does not pay again', () => {
  assert.equal(uncounted(paid, '5', 2000), '100')
})

test('once it has arrived there is nothing left to wait for', () => {
  assert.equal(uncounted(paid, '105', 2000), '0')
  assert.equal(uncounted(paid, '500', 2000), '0')
})

test('a balance spent down since is still only what has not arrived', () => {
  assert.equal(uncounted(paid, '0', 2000), '105')
})

test('a payment that never showed up is forgotten in time, and no payment means nothing owed', () => {
  assert.equal(uncounted(paid, '5', 1000 + PAYMENT_MEMORY_MS + 1), '0')
  assert.equal(uncounted(undefined, '5', 2000), '0')
})
