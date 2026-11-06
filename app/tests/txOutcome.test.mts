// How useTx ends: src/miyamints/txOutcome.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { settle, TX_REVERTED_WORDS, TX_UNCONFIRMED_WORDS } from '../src/miyamints/txOutcome.ts'

test('a success passes the receipt through', async () => {
  const receipt = { status: 'success', blockNumber: 5n }
  assert.equal(await settle(async () => receipt), receipt)
})

test('a reverted receipt is reported as failed on the network', async () => {
  await assert.rejects(
    () => settle(async () => ({ status: 'reverted' })),
    (e: any) => e.reverted === true && e.unconfirmed === false && e.message === TX_REVERTED_WORDS,
  )
})

test('a failed look-up is not a failed transaction', async () => {
  await assert.rejects(
    () => settle(async () => Promise.reject(new Error('rpc down'))),
    (e: any) => e.unconfirmed === true && e.reverted === false && e.message === TX_UNCONFIRMED_WORDS,
  )
})
