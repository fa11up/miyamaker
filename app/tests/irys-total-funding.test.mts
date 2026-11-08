// Paying for several files at once: src/utils/irysPayment.ts (ensureFunded with a list) and Launch/resume.ts
// (fundingPlan). One Ethereum payment and one wait before the first upload, never one per file. Run: yarn test
import assert from 'node:assert/strict'
import test from 'node:test'

import { fundingPlan } from '../src/pages/Launch/resume.ts'
import type { IrysPayment, PaymentStore } from '../src/utils/irysPayment.ts'
import { ensureFunded, FREE_BYTES, paidSizes } from '../src/utils/irysPayment.ts'

/** A fake Irys whose price grows with the size, and whose balance an upload spends. */
function fakeIrys(start = 0n, perByte = 10n) {
  const amt = (v: bigint) => ({ toFixed: () => v.toString() })
  const state = { balance: start, sent: 0, waits: 0 }
  const irys = {
    getPrice: async (size: number) => amt(BigInt(size) * perByte),
    getLoadedBalance: async () => {
      state.waits += 1
      return amt(state.balance)
    },
    funder: { submitFundTransaction: async () => undefined },
    tokenConfig: {
      async sendTx(data: { amount: string }) {
        state.sent += 1
        state.balance += BigInt(data.amount)
        return `0xpay${state.sent}`
      },
    },
    async fund(amount: string) {
      await irys.tokenConfig.sendTx({ amount })
    },
    /** What an upload of `size` bytes takes from the balance. */
    upload(size: number) {
      state.balance -= BigInt(size) * perByte
      assert.ok(state.balance >= 0n, 'an upload never runs short')
    },
  }
  return { irys, state }
}

function memoryStore(): PaymentStore {
  let value: IrysPayment | undefined
  return { read: () => value, write: (p) => (value = p) }
}

const deps = (store: PaymentStore) => ({ store, txState: async () => 'success' as const, setStage: () => undefined, sleep: async () => undefined, pollMs: 0 })

test('only files over the free size are paid for', () => {
  assert.deepEqual(paidSizes([FREE_BYTES, FREE_BYTES + 1, 10]), [FREE_BYTES + 1])
  assert.deepEqual(paidSizes(FREE_BYTES + 5), [FREE_BYTES + 5])
  assert.deepEqual(
    fundingPlan(
      [
        { size: FREE_BYTES + 1, stored: false },
        { size: FREE_BYTES + 2, stored: true },
        { size: 100, stored: false },
        { size: FREE_BYTES + 3, stored: false },
      ],
      FREE_BYTES
    ),
    [FREE_BYTES + 1, FREE_BYTES + 3],
    'stored files and small ones cost nothing'
  )
})

test('two paid files: one payment for both, then each upload pays nothing more', async () => {
  const sizes = [FREE_BYTES * 3, FREE_BYTES * 5]
  const { irys, state } = fakeIrys()
  const store = memoryStore()
  await ensureFunded(irys, sizes, deps(store))
  assert.equal(state.sent, 1, 'one Ethereum payment')
  for (const size of sizes) {
    // eslint-disable-next-line no-await-in-loop
    await ensureFunded(irys, size, deps(store))
    irys.upload(size)
  }
  assert.equal(state.sent, 1, 'still the one payment after both uploads')
})

test('the total is the sum of each file priced on its own', async () => {
  const { irys, state } = fakeIrys()
  await ensureFunded(irys, [FREE_BYTES + 1, FREE_BYTES + 1], deps(memoryStore()))
  const each = BigInt(FREE_BYTES + 1) * 10n
  assert.equal(state.balance, (2n * each * 110n) / 100n, 'both prices, with the margin')
})

test('a balance that already covers all of them pays nothing', async () => {
  const { irys, state } = fakeIrys(10n ** 12n)
  await ensureFunded(irys, [FREE_BYTES * 2, FREE_BYTES * 4], deps(memoryStore()))
  assert.equal(state.sent, 0)
})

test('all free: nothing is asked', async () => {
  const { irys, state } = fakeIrys()
  await ensureFunded(irys, [10, FREE_BYTES], deps(memoryStore()))
  assert.equal(state.sent, 0)
  assert.equal(state.waits, 0, 'not even a balance read')
})
