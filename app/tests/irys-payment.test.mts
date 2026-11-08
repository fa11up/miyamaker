import assert from 'node:assert/strict'
import test from 'node:test'

import type { IrysPayment, PaymentStore, TxState } from '../src/utils/irysPayment.ts'
import { ensureFunded, FREE_BYTES, PAYMENT_MEMORY_MS, uncounted } from '../src/utils/irysPayment.ts'

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

// A fake Irys that pays the way the SDK's fund() does: the wallet sends, then the node is told the hash.
function fakeIrys(opts: { price: bigint; balance: bigint; postFails?: number }) {
  const amt = (v: bigint) => ({ toFixed: () => v.toString() })
  const calls = { sent: 0, posted: [] as string[], recordAtPost: [] as (IrysPayment | undefined)[] }
  let postFails = opts.postFails ?? 0
  const state = { balance: opts.balance, credit: new Map<string, bigint>() }
  const store = memoryStore()
  const irys = {
    getPrice: async () => amt(opts.price),
    getLoadedBalance: async () => amt(state.balance),
    funder: {
      async submitFundTransaction(txId: string) {
        calls.posted.push(txId)
        calls.recordAtPost.push(store.read())
        if (postFails > 0) {
          postFails -= 1
          throw new Error('HTTP Error: Posting transaction information to the bundler: 503 Service Unavailable')
        }
        state.balance += state.credit.get(txId) ?? 0n
        state.credit.delete(txId)
      },
    },
    tokenConfig: {
      async sendTx(data: { amount: string }) {
        calls.sent += 1
        const txId = `0xpay${calls.sent}`
        state.credit.set(txId, BigInt(data.amount))
        return txId
      },
    },
    async fund(amount: string) {
      const txId = await irys.tokenConfig.sendTx({ amount })
      try {
        await irys.funder.submitFundTransaction(txId!)
      } catch (e) {
        throw new Error(`failed to post funding tx - ${txId} - keep this id! ${(e as Error).message}`)
      }
    },
  }
  return { irys, calls, store, state }
}

function memoryStore(): PaymentStore & { value?: IrysPayment } {
  const s: PaymentStore & { value?: IrysPayment } = {
    read: () => s.value,
    write: (p) => {
      s.value = p
    },
  }
  return s
}

const deps = (store: PaymentStore, txState: () => Promise<TxState> = async () => 'success') => ({
  store,
  txState,
  setStage: () => undefined,
  sleep: async () => undefined,
  pollMs: 0,
})

const SIZE = FREE_BYTES + 1

test('the payment hash is kept before Irys is told about it', async () => {
  const { irys, calls, store } = fakeIrys({ price: 100n, balance: 0n })
  await ensureFunded(irys, SIZE, deps(store))
  assert.equal(calls.sent, 1)
  assert.equal(calls.recordAtPost[0]?.txId, '0xpay1')
  assert.equal(calls.recordAtPost[0]?.amount, '110')
  assert.equal(calls.recordAtPost[0]?.before, '0')
})

test('when telling Irys fails, a retry tells it again and does not pay again', async () => {
  const { irys, calls, store, state } = fakeIrys({ price: 100n, balance: 0n, postFails: 1 })
  await assert.rejects(ensureFunded(irys, SIZE, deps(store)), /402/)
  assert.equal(calls.sent, 1)
  assert.equal(store.read()?.txId, '0xpay1')

  await ensureFunded(irys, SIZE, deps(store))
  assert.equal(calls.sent, 1, 'paid only once')
  assert.deepEqual(calls.posted, ['0xpay1', '0xpay1'])
  assert.equal(state.balance, 110n)
})

test('once counted the record is cleared', async () => {
  const { irys, store } = fakeIrys({ price: 100n, balance: 0n })
  await ensureFunded(irys, SIZE, deps(store))
  assert.equal(store.read(), undefined)
})

test('a payment still unmined is waited on, not paid again', async () => {
  const { irys, calls, store } = fakeIrys({ price: 100n, balance: 0n })
  store.write({ amount: '110', before: '0', at: Date.now(), txId: '0xold' })
  await assert.rejects(
    ensureFunded(irys, SIZE, deps(store, async () => 'pending')),
    /402/
  )
  assert.equal(calls.sent, 0)
  assert.equal(store.read()?.txId, '0xold')
})

test('a payment that failed on chain is forgotten, and paid for fresh', async () => {
  const { irys, calls, store } = fakeIrys({ price: 100n, balance: 0n })
  store.write({ amount: '110', before: '0', at: Date.now(), txId: '0xold' })
  await ensureFunded(irys, SIZE, deps(store, async () => 'reverted'))
  assert.equal(calls.sent, 1)
  assert.deepEqual(calls.posted, ['0xpay1'])
  assert.equal(store.read(), undefined)
})

test('a payment whose hash is known outlives the plain memory, while the chain says it went through', async () => {
  const { irys, calls, store } = fakeIrys({ price: 100n, balance: 0n })
  store.write({ amount: '110', before: '0', at: Date.now() - PAYMENT_MEMORY_MS - 1, txId: '0xpay9' })
  irys.tokenConfig.sendTx = async () => {
    throw new Error('should not pay')
  }
  // Irys would credit the old payment once told.
  await assert.rejects(ensureFunded(irys, SIZE, { ...deps(store), waitMs: -1 }), /402/)
  assert.deepEqual(calls.posted, ['0xpay9'])
  assert.equal(calls.sent, 0)
})

test('a payment Irys says it already counted is forgotten, not waited on', async () => {
  const { irys, calls, store } = fakeIrys({ price: 100n, balance: 0n })
  store.write({ amount: '110', before: '0', at: Date.now(), txId: '0xspent' })
  const post = irys.funder.submitFundTransaction
  irys.funder.submitFundTransaction = async (txId: string) => {
    if (txId !== '0xspent') return post(txId)
    throw new Error('HTTP Error: Posting transaction information to the bundler: 400 Transaction already processed')
  }
  await ensureFunded(irys, SIZE, deps(store))
  assert.equal(calls.sent, 1, 'pays for this upload, once')
  assert.equal(store.read(), undefined)
})
