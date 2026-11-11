/**
 * One token payment, in order: read again (`prepare`), approve if the allowance is short, then send. Pure: every read,
 * wallet prompt and screen update is a callback, so node:test checks the order and where it stops
 * (tests/pay-run.test.mts). usePay.ts and the live mint's drop path (pages/Mint/LiveMint) both run it.
 *
 * - `prepare` (optional) runs first. It stops the run with a reason (nothing is approved or sent), or hands back a fresh
 *   amount and call. A prepare that throws (a read failed) stops too: nothing is approved on a guess.
 * - For an ERC-20 with an account and a non-zero amount, the allowance is read fresh. A failed allowance read is not a
 *   stop: it asks for the approval of exactly the amount (payPlan), which is never more than the payment needs.
 * - A refused or failed approval stops before the send.
 */
import { COULDNT_CHECK_WORDS } from './precheck'
import { isEth, payPlan } from './tokens'

/** What a payment's `prepare` says: stop with a reason, or go on (with a fresh amount and call when they changed). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Prepared<C = any> = { ok: false; error: string } | { ok: true; amount?: bigint; call?: C }

export type PayStep = 'check' | 'approve' | 'pay'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PayRun<C = any> = {
  token: string
  amount: bigint
  call: C
  /** The paying wallet; without one the allowance is not read (the send itself will ask to connect). */
  account?: string
  prepare?: () => Promise<Prepared<C>>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PayHooks<C = any> = {
  /** Which step is out (undefined when the run is over). */
  step: (step: PayStep | undefined) => void
  /** prepare stopped the run: show why. Nothing was sent. */
  refuse: (error: string) => void
  /** The wallet's allowance for the spender; may reject or return undefined (unread). */
  readAllowance: () => Promise<bigint | undefined>
  /** Ask the wallet to approve exactly `amount`; true once it landed. */
  approve: (amount: bigint) => Promise<boolean>
  /** The payment itself, with the (possibly fresh) call and amount; true once it landed (or was handed off). */
  send: (call: C, amount: bigint) => Promise<boolean>
}

export async function runPay<C>(p: PayRun<C>, h: PayHooks<C>): Promise<boolean> {
  let { amount, call } = p
  if (p.prepare) {
    h.step('check')
    let r: Prepared<C>
    try {
      r = await p.prepare()
    } catch {
      r = { ok: false, error: COULDNT_CHECK_WORDS }
    }
    if (!r.ok) {
      h.step(undefined)
      h.refuse(r.error)
      return false
    }
    amount = r.amount ?? amount
    call = r.call ?? call
  }
  if (!isEth(p.token) && p.account && amount > 0n) {
    const allowance = await h.readAllowance().catch(() => undefined)
    const plan = payPlan(p.token, amount, allowance)
    if (plan.approve !== undefined) {
      h.step('approve')
      const approved = await h.approve(plan.approve).catch(() => false)
      if (!approved) {
        h.step(undefined)
        return false
      }
    }
  }
  h.step('pay')
  try {
    return await h.send(call, amount)
  } finally {
    h.step(undefined)
  }
}
