// api/_lib/contractcheck.ts: Etherscan calls per request and per isolate stay inside the key's plan. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createCallBudget, handleContractCheck, MAX_LOOKUPS } from '../api/_lib/contractcheck.ts'

const VERIFIED = { status: '1', result: '[]' }
const addr = (i: number) => `0x${String(i).padStart(40, '0')}`
const deps = (over = {}) => ({
  key: 'k',
  cache: { get: async () => undefined, put: async () => undefined },
  sameOrigin: () => true,
  clientKey: () => 'me',
  limiter: () => true,
  wait: async () => undefined,
  ...over,
})
const ask = (n: number) =>
  new Request(`https://x.test/api/contracts/verified?a=${Array.from({ length: n }, (_, i) => addr(i + 1)).join(',')}`)

test('turns are spaced by the rate and refused once the line is too long', () => {
  let now = 0
  const budget = createCallBudget({ perSecond: 2, maxWaitMs: 1000, clock: () => now })
  assert.deepEqual([budget(), budget(), budget()], [0, 500, 1000])
  assert.equal(budget(), undefined, 'a 1500 ms wait is over the limit')
  now = 1000
  assert.equal(budget(), 500, 'the line moves on with time')
  now = 10_000
  assert.equal(budget(), 0, 'and an idle budget starts fresh')
})

test('one request asks Etherscan about at most MAX_LOOKUPS addresses; the rest are unknown', async () => {
  const asked: string[] = []
  const res = await handleContractCheck(
    ask(20),
    deps({ budget: () => 0, etherscan: async (a: string) => (asked.push(a), VERIFIED) }),
  )
  assert.equal(asked.length, MAX_LOOKUPS)
  const { verified } = (await res.json()) as { verified: Record<string, boolean> }
  assert.equal(Object.keys(verified).length, MAX_LOOKUPS)
  assert.ok(Object.values(verified).every((v) => v === true))
})

test('over budget the addresses are left unknown, never unverified', async () => {
  let turns = 2
  const waits: number[] = []
  const asked: string[] = []
  const res = await handleContractCheck(
    ask(5),
    deps({
      budget: () => (turns-- > 0 ? 400 : undefined),
      wait: async (ms: number) => void waits.push(ms),
      etherscan: async (a: string) => (asked.push(a), VERIFIED),
    }),
  )
  assert.equal(asked.length, 2)
  assert.deepEqual(waits, [400, 400], 'each call waited for its turn')
  const { verified } = (await res.json()) as { verified: Record<string, boolean> }
  assert.deepEqual(Object.keys(verified), [addr(1), addr(2)])
  assert.ok(!Object.values(verified).includes(false))
})

test('a rate-limited call is retried only when the budget has another turn', async () => {
  let turns = 1
  let calls = 0
  const res = await handleContractCheck(
    ask(1),
    deps({
      budget: () => (turns-- > 0 ? 0 : undefined),
      etherscan: async () => (calls++, { status: '0', result: 'Max rate limit reached' }),
    }),
  )
  assert.equal(calls, 1)
  assert.deepEqual(await res.json(), { verified: {} })
})
