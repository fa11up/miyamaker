// How useTx ends: src/miyamints/txOutcome.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  settle,
  TX_CANCELLED_WORDS,
  TX_REVERTED_WORDS,
  TX_SLOW_WORDS,
  TX_TIME_LIMIT_MS,
  TX_UNCONFIRMED_WORDS,
} from '../src/miyamints/txOutcome.ts'

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

test('a wait past the limit ends as not confirmed yet, never as failed', async () => {
  await assert.rejects(
    () => settle(() => new Promise(() => {}), 20),
    (e: any) =>
      e.unconfirmed === true && e.timedOut === true && e.reverted === false && e.cancelled === false && e.message === TX_SLOW_WORDS,
  )
})

test("viem's own time-out reads the same as the limit", async () => {
  const err = Object.assign(new Error('Timed out while waiting for transaction'), {
    name: 'WaitForTransactionReceiptTimeoutError',
  })
  await assert.rejects(
    () => settle(async () => Promise.reject(err)),
    (e: any) => e.unconfirmed === true && e.timedOut === true && e.message === TX_SLOW_WORDS,
  )
})

test('an answer inside the limit still counts, and a sped-up copy is still the same one', async () => {
  const receipt = { status: 'success' }
  const got = await settle(async (onReplaced) => {
    onReplaced({ reason: 'repriced' })
    return receipt
  }, 1000)
  assert.equal(got, receipt)
  await assert.rejects(
    () =>
      settle(async (onReplaced) => {
        onReplaced({ reason: 'cancelled' })
        return { status: 'success' }
      }, 1000),
    (e: any) => e.cancelled === true,
  )
})

test('the limit is minutes, not seconds: a slow block is not a dropped transaction', () => {
  assert.ok(TX_TIME_LIMIT_MS >= 3 * 60_000 && TX_TIME_LIMIT_MS <= 10 * 60_000)
})

test('the slow words tell people where to look and say nothing failed', () => {
  assert.match(TX_SLOW_WORDS, /wallet's activity/)
  assert.doesNotMatch(TX_SLOW_WORDS, /failed|nothing moved/i)
})
