/**
 * A storage payment Irys hasn't counted yet. On Ethereum that takes minutes, and until then the balance looks unpaid, so a
 * retry would pay again. No imports, so `node --test` can load it (tests/irys-payment.test.mts).
 */
export type IrysPayment = { amount: string; before: string; at: number }

/** After this long, a payment that never showed up isn't waited on: it can't be told from one that failed. */
export const PAYMENT_MEMORY_MS = 2 * 60 * 60 * 1000

/** How much is paid but not yet in the balance. */
export function uncounted(payment: IrysPayment | undefined, balance: string, now: number): string {
  if (!payment || now - payment.at > PAYMENT_MEMORY_MS) return '0'
  const arrived = BigInt(balance) - BigInt(payment.before)
  const left = BigInt(payment.amount) - arrived
  return left > 0n ? left.toString() : '0'
}
