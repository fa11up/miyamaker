// How useTx ends: src/miyamints/txOutcome.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { settle, TX_CANCELLED_WORDS, TX_REVERTED_WORDS, TX_UNCONFIRMED_WORDS } from '../src/miyamints/txOutcome.ts'

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

test("a wallet's cancel is not a success, though the replacement's receipt says so", async () => {
  await assert.rejects(
    () =>
      settle(async (onReplaced) => {
        onReplaced({ reason: 'cancelled' })
        return { status: 'success' }
      }),
    (e: any) => e.cancelled === true && e.unconfirmed === false && e.message === TX_CANCELLED_WORDS,
  )
})

test('a sped-up copy is the same transaction', async () => {
  const receipt = { status: 'success' }
  const got = await settle(async (onReplaced) => {
    onReplaced({ reason: 'repriced' })
    return receipt
  })
  assert.equal(got, receipt)
})

test('something else taking its place is not confirmed', async () => {
  await assert.rejects(
    () =>
      settle(async (onReplaced) => {
        onReplaced({ reason: 'replaced' })
        return { status: 'success' }
      }),
    (e: any) => e.unconfirmed === true && e.cancelled === false,
  )
})
