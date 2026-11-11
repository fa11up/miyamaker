// src/miyamints/payRun.ts: a token payment runs read again -> approve (if short) -> send, and stops where it must.
// usePay and the live mint's drop path both run it, so this is the order every token payment keeps. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { zeroAddress } from 'viem'

import './ts-paths.mts'

const { runPay } = await import('../src/miyamints/payRun.ts')
const { COULDNT_CHECK_WORDS } = await import('../src/miyamints/precheck.ts')

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const ME = '0x000000000000000000000000000000000000bEEF'

type Call = { fn: string }
type Over = {
  allowance?: bigint | undefined | Error
  approve?: boolean | Error
  send?: boolean
}

/** Hooks that log every call in order. */
function hooks(o: Over = {}) {
  const log: string[] = []
  return {
    log,
    h: {
      step: (s: string | undefined) => log.push(`step:${s ?? '-'}`),
      refuse: (e: string) => log.push(`refuse:${e}`),
      readAllowance: async () => {
        log.push('readAllowance')
        if (o.allowance instanceof Error) throw o.allowance
        return 'allowance' in o ? (o.allowance as bigint | undefined) : 0n
      },
      approve: async (amount: bigint) => {
        log.push(`approve:${amount}`)
        if (o.approve instanceof Error) throw o.approve
        return o.approve ?? true
      },
      send: async (call: Call, amount: bigint) => {
        log.push(`send:${call.fn}:${amount}`)
        return o.send ?? true
      },
    },
  }
}

test('an ERC-20 with a short allowance: check, approve exactly the fresh amount, then send the fresh call', async () => {
  const { log, h } = hooks({ allowance: 5n })
  const ok = await runPay(
    { token: USDC, amount: 100n, call: { fn: 'old' }, account: ME, prepare: async () => ({ ok: true, amount: 120n, call: { fn: 'new' } }) },
    h
  )
  assert.equal(ok, true)
  assert.deepEqual(log, ['step:check', 'readAllowance', 'step:approve', 'approve:120', 'step:pay', 'send:new:120', 'step:-'])
})

test('a failed prepare stops before any read, approval or send, with its own words', async () => {
  const { log, h } = hooks()
  const ok = await runPay(
    { token: USDC, amount: 100n, call: { fn: 'x' }, account: ME, prepare: async () => ({ ok: false, error: 'Sold out. Nothing was sent.' }) },
    h
  )
  assert.equal(ok, false)
  assert.deepEqual(log, ['step:check', 'step:-', 'refuse:Sold out. Nothing was sent.'])
})

test("a prepare whose reads failed (it throws) stops too: nothing is approved on a guess", async () => {
  const { log, h } = hooks()
  const ok = await runPay(
    { token: USDC, amount: 100n, call: { fn: 'x' }, account: ME, prepare: async () => { throw new Error('rpc 503') } },
    h
  )
  assert.equal(ok, false)
  assert.deepEqual(log, ['step:check', 'step:-', `refuse:${COULDNT_CHECK_WORDS}`])
})

test('a refused or failed approval stops before the send', async () => {
  for (const approve of [false, new Error('wallet closed')]) {
    const { log, h } = hooks({ approve })
    assert.equal(await runPay({ token: USDC, amount: 100n, call: { fn: 'x' }, account: ME }, h), false)
    assert.deepEqual(log, ['readAllowance', 'step:approve', 'approve:100', 'step:-'])
  }
})

test('enough allowance: no approval; ETH: no allowance read at all', async () => {
  const a = hooks({ allowance: 100n })
  assert.equal(await runPay({ token: USDC, amount: 100n, call: { fn: 'x' }, account: ME }, a.h), true)
  assert.deepEqual(a.log, ['readAllowance', 'step:pay', 'send:x:100', 'step:-'])
  const e = hooks()
  assert.equal(await runPay({ token: zeroAddress, amount: 100n, call: { fn: 'x' }, account: ME }, e.h), true)
  assert.deepEqual(e.log, ['step:pay', 'send:x:100', 'step:-'])
})

test('a failed allowance read asks for the exact approval (never more), it does not skip it', async () => {
  for (const allowance of [new Error('429'), undefined]) {
    const { log, h } = hooks({ allowance })
    assert.equal(await runPay({ token: USDC, amount: 100n, call: { fn: 'x' }, account: ME }, h), true)
    assert.deepEqual(log, ['readAllowance', 'step:approve', 'approve:100', 'step:pay', 'send:x:100', 'step:-'])
  }
})

test("a failed send ends the run (false) and still clears the step", async () => {
  const { log, h } = hooks({ allowance: 1000n, send: false })
  assert.equal(await runPay({ token: USDC, amount: 100n, call: { fn: 'x' }, account: ME }, h), false)
  assert.deepEqual(log.slice(-2), ['send:x:100', 'step:-'])
})
