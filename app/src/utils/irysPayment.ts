/**
 * A storage payment Irys hasn't counted yet. On Ethereum that takes minutes, and until then the balance looks unpaid, so a
 * retry would pay again. No imports, so `node --test` can load it (tests/irys-payment.test.mts).
 *
 * `txId` is written the moment the wallet hands back the payment's hash, before Irys is told about it. Inside the SDK,
 * `fund()` sends the ETH, waits, then posts the hash to the Irys node; if that post fails or the tab closes in between,
 * the ETH has left but Irys never heard of it. With the hash kept, a retry tells Irys about that payment instead of paying
 * again.
 */
export type IrysPayment = { amount: string; before: string; at: number; txId?: string }

/** After this long, a payment that never showed up isn't waited on: it can't be told from one that failed. */
export const PAYMENT_MEMORY_MS = 2 * 60 * 60 * 1000

/** How much is paid but not yet in the balance. */
export function uncounted(payment: IrysPayment | undefined, balance: string, now: number): string {
  if (!payment || now - payment.at > PAYMENT_MEMORY_MS) return '0'
  const arrived = BigInt(balance) - BigInt(payment.before)
  const left = BigInt(payment.amount) - arrived
  return left > 0n ? left.toString() : '0'
}

/** Pay a little over the price, so a small price move between paying and uploading does not fail the upload. */
export const PRICE_MARGIN = 1.1
/** Irys stores files up to 100 KiB free; leave room for the signature and tags. */
export const FREE_BYTES = 90 * 1024
const CREDIT_POLL_MS = 10_000
const CREDIT_WAIT_MS = 15 * 60_000

/** Where a payment on its way is remembered, across retries and reloads. */
export type PaymentStore = { read(): IrysPayment | undefined; write(payment: IrysPayment | undefined): void }

/** Where a payment stands on chain: mined and paid, mined and failed, sent but not mined, or unknown to the chain. */
export type TxState = 'success' | 'reverted' | 'pending' | 'missing'

type Amount = { toFixed(decimals: number): string }

/** The parts of the Irys client this uses. */
export type FundingIrys = {
  getPrice(size: number): Promise<Amount>
  getLoadedBalance(): Promise<Amount>
  fund(amount: string): Promise<unknown>
  funder: { submitFundTransaction(txId: string): Promise<unknown> }
  tokenConfig: { sendTx(data: any): Promise<string | undefined> }
}

export type FundingDeps = {
  store: PaymentStore
  /** Looks the payment up on chain. */
  txState(txId: string): Promise<TxState>
  setStage(stage: 'paying' | 'paid'): void
  status?: (words: string) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  pollMs?: number
  waitMs?: number
}

/** A payment whose hash is known is told to Irys again for this long; after that, one it still refuses is let go. */
export const SENT_MEMORY_MS = 24 * 60 * 60 * 1000

/** Errors whose words `uploadErrorWords` turns into "hasn't counted your payment yet". */
const notCountedYet = () => new Error('402: not enough funds yet')

const atomic = (amount: Amount) => BigInt(amount.toFixed(0))

/** What of a remembered payment hasn't shown up in the balance. One whose hash is known keeps its longer memory. */
function owed(payment: IrysPayment | undefined, balance: bigint, now: number): bigint {
  if (!payment) return 0n
  if (payment.txId && now - payment.at > SENT_MEMORY_MS) return 0n
  return BigInt(uncounted(payment.txId ? { ...payment, at: now } : payment, balance.toString(), now))
}

/**
 * Tell Irys about a payment that left the wallet but that it may never have heard of. Throws when it can't be told yet.
 * Returns false when nothing more is owed for it (it failed on chain, or Irys already counted it), and it is forgotten.
 */
async function resubmit(
  irys: FundingIrys,
  payment: IrysPayment & { txId: string },
  deps: FundingDeps
): Promise<boolean> {
  const now = (deps.now ?? Date.now)()
  const state = await deps.txState(payment.txId).catch((): TxState => 'pending')
  if (state === 'reverted' || (state === 'missing' && now - payment.at > PAYMENT_MEMORY_MS)) {
    deps.store.write(undefined)
    return false
  }

  // Not mined yet: Irys would refuse it, and paying again would pay twice.
  if (state !== 'success') throw notCountedYet()
  try {
    await irys.funder.submitFundTransaction(payment.txId)
  } catch (e) {
    // Irys counted it long ago, and the balance has been spent since: nothing is owed.
    if (/already|processed|exists|duplicate/i.test(String((e as Error)?.message ?? e))) {
      deps.store.write(undefined)
      return false
    }

    console.error('Telling Irys about an earlier payment failed', e)
    throw notCountedYet()
  }

  return true
}

/**
 * On Ethereum a payment takes minutes to be
 * credited, so after paying this waits for it rather than uploading into a "not enough funds". A payment still on its way
 * is remembered, across retries and reloads, because the balance doesn't show it: only what it doesn't cover is paid,
 * and one Irys never heard of is told to it again rather than paid twice.
 */
/** The files that cost anything: each is stored on its own, so only those over the free size are paid for. */
export function paidSizes(sizes: number | readonly number[]): number[] {
  return (typeof sizes === 'number' ? [sizes] : [...sizes]).filter((size) => size > FREE_BYTES)
}

/**
 * Make sure Irys holds enough of this wallet's money for `size` bytes, or for every file in a list. A list is priced
 * file by file and paid as one total, so several files cost one Ethereum payment and one wait; each upload after it
 * then finds its price already covered.
 */
export async function ensureFunded(irys: FundingIrys, size: number | readonly number[], deps: FundingDeps): Promise<void> {
  const paid = paidSizes(size)
  if (!paid.length) return
  const now = deps.now ?? Date.now
  const sleep =
    deps.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
      }))
  const prices = await Promise.all(paid.map((bytes) => irys.getPrice(bytes)))
  const price = prices.reduce((sum, p) => sum + atomic(p), 0n)
  let balance = atomic(await irys.getLoadedBalance())
  let payment = deps.store.read()

  // A payment that left the wallet and hasn't shown up: make sure Irys knows of it before anything else is paid.
  if (payment?.txId && owed(payment, balance, now()) > 0n) {
    const covered = balance > price
    deps.status?.('Checking on the storage payment you already sent.')
    try {
      const stillOwed = await resubmit(irys, payment as IrysPayment & { txId: string }, deps)
      if (!stillOwed) payment = undefined
      // Irys has it now. With the balance already covering this upload there is nothing to wait for.
      else if (covered) deps.store.write(undefined)
    } catch (e) {
      // The balance already covers this upload: carry on, and try that payment again next time.
      if (!covered) {
        deps.setStage('paid')
        throw e
      }
    }

    balance = atomic(await irys.getLoadedBalance())
  }

  if (balance > price) {
    // One Irys hasn't counted yet stays remembered, to be told again next time.
    if (!payment?.txId || owed(payment, balance, now()) === 0n) deps.store.write(undefined)
    deps.setStage('paid')
    return
  }

  const onItsWay = owed(payment, balance, now())
  const toPay = (price * BigInt(Math.round(PRICE_MARGIN * 100))) / 100n - balance - onItsWay
  if (toPay > 0n) {
    deps.status?.('Pay for storage in your wallet (once, on Ethereum).')
    deps.setStage('paying')
    const before = balance.toString()
    const amount = (toPay + onItsWay).toString()
    // The hash is kept the moment the wallet returns it, before the SDK waits and then tells Irys.
    const send = irys.tokenConfig.sendTx
    let sent = false
    irys.tokenConfig.sendTx = async (data) => {
      const txId = await send.call(irys.tokenConfig, data)
      if (txId) {
        sent = true
        deps.store.write({ amount, before, at: now(), txId })
      }

      return txId
    }

    try {
      await irys.fund(toPay.toString())
    } catch (e) {
      // The money left but Irys wasn't told. The hash is kept, and the next try tells Irys instead of paying again.
      if (sent) {
        console.error('Irys was not told about the payment', e)
        deps.setStage('paid')
        throw notCountedYet()
      }

      throw e
    } finally {
      irys.tokenConfig.sendTx = send
    }

    if (!sent) deps.store.write({ amount, before, at: now() })
  }

  deps.setStage('paid')
  deps.status?.('Waiting for the storage service to count your payment. This can take a few minutes.')
  const deadline = now() + (deps.waitMs ?? CREDIT_WAIT_MS)
  // eslint-disable-next-line no-await-in-loop
  while (atomic(await irys.getLoadedBalance()) < price) {
    if (now() > deadline) throw notCountedYet()
    // eslint-disable-next-line no-await-in-loop
    await sleep(deps.pollMs ?? CREDIT_POLL_MS)
  }

  // Counted: the balance only reaches the price once the payment arrives.
  deps.store.write(undefined)
}
