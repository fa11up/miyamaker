// The rules behind the swap button: src/pages/Swap/swapLogic.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  compactAmount,
  describeTxError,
  GENERIC_SWAP_WORDS,
  impactLevel,
  impactPercent,
  latestOnly,
  quoteIsCurrent,
  receiptOutcome,
  swapApiWords,
  swapStep,
} from '../src/pages/Swap/swapLogic.ts'

const TERMS = {
  chainId: 1,
  sellToken: '0xAAAA000000000000000000000000000000000001',
  buyToken: '0xBBBB000000000000000000000000000000000002',
  sellAmount: 500n,
  slippageBps: 50,
  taker: '0xCCCC000000000000000000000000000000000003',
}

test('a retyped amount disarms the quote at once, before any debounce', () => {
  assert.equal(quoteIsCurrent(TERMS, { ...TERMS }), true)
  assert.equal(quoteIsCurrent(TERMS, { ...TERMS, sellAmount: 5000n }), false, 'one more digit typed')
  assert.equal(quoteIsCurrent(TERMS, { ...TERMS, sellAmount: undefined }), false, 'field cleared')
  assert.equal(quoteIsCurrent(undefined, TERMS), false, 'no quote')
})

test('a quote is only good for the same pair, chain, slippage and wallet', () => {
  assert.equal(quoteIsCurrent(TERMS, { ...TERMS, buyToken: '0xDDDD000000000000000000000000000000000004' }), false)
  assert.equal(quoteIsCurrent(TERMS, { ...TERMS, sellToken: '0xDDDD000000000000000000000000000000000004' }), false)
  assert.equal(quoteIsCurrent(TERMS, { ...TERMS, chainId: 4663 }), false)
  assert.equal(quoteIsCurrent(TERMS, { ...TERMS, slippageBps: 100 }), false)
  assert.equal(quoteIsCurrent(TERMS, { ...TERMS, taker: '0xEEEE000000000000000000000000000000000005' }), false)
  assert.equal(
    quoteIsCurrent(TERMS, { ...TERMS, buyToken: TERMS.buyToken.toLowerCase() }),
    true,
    'case does not matter',
  )
})

test('a late answer from an older quote request is dropped', async () => {
  const quotes = latestOnly()
  const armed: string[] = []
  const answer = async (ms: number, name: string) => {
    const ticket = quotes.begin()
    await new Promise((r) => setTimeout(r, ms))
    if (quotes.isCurrent(ticket)) armed.push(name)
  }

  await Promise.all([answer(20, 'old amount'), answer(1, 'new amount')])
  assert.deepEqual(armed, ['new amount'])
})

test('Edit while a quote is on its way cancels it', async () => {
  const quotes = latestOnly()
  const ticket = quotes.begin()
  quotes.cancel()
  assert.equal(quotes.isCurrent(ticket), false)
})

test('a receipt says what happened, and a failed look-up says nothing about the swap', () => {
  const HASH = '0xabc'
  assert.equal(receiptOutcome(undefined, undefined, false), 'none')
  assert.equal(receiptOutcome(HASH, undefined, false), 'waiting')
  assert.equal(receiptOutcome(HASH, { status: 'success' }, false), 'success')
  assert.equal(receiptOutcome(HASH, { status: 'reverted' }, false), 'reverted')
  assert.equal(receiptOutcome(HASH, undefined, true), 'unknown', 'never told "your tokens did not move"')
})

test('step counts follow what really happened', () => {
  const base = { needsApproval: false, needsReset: false, didReset: false, didApprove: false, batches: false }
  // An allowance already in place: the swap is the only step and gets no number.
  assert.deepEqual(swapStep(base), { stage: 'swap' })
  // Approve, then swap.
  assert.deepEqual(swapStep({ ...base, needsApproval: true }), { stage: 'approve', at: 1, of: 2 })
  assert.deepEqual(swapStep({ ...base, didApprove: true }), { stage: 'swap', at: 2, of: 2 })
  // Reset to 0, approve, then swap.
  assert.deepEqual(swapStep({ ...base, needsApproval: true, needsReset: true }), { stage: 'reset', at: 1, of: 3 })
  assert.deepEqual(swapStep({ ...base, needsApproval: true, didReset: true }), { stage: 'approve', at: 2, of: 3 })
  assert.deepEqual(swapStep({ ...base, didReset: true, didApprove: true }), { stage: 'swap', at: 3, of: 3 })
  // One signature.
  assert.deepEqual(swapStep({ ...base, needsApproval: true, needsReset: true, batches: true }), { stage: 'batch' })
})

test('price impact levels', () => {
  assert.equal(impactLevel(undefined), 'unknown')
  assert.equal(impactLevel(Number.NaN), 'unknown')
  assert.equal(impactLevel(0.001), 'low')
  assert.equal(impactLevel(0.02), 'notable')
  assert.equal(impactLevel(0.0499), 'notable')
  assert.equal(impactLevel(0.05), 'high')
  assert.equal(impactPercent(0.124), '12.4')
  assert.equal(impactPercent(0.12399999), '12.4', 'agrees with the 12.40% on the review line')
})

test('raw errors never reach the screen', () => {
  const raw = Object.assign(new Error('The contract function "execute" reverted. Raw Call Arguments: 0xdeadbeef'), {
    shortMessage: 'The contract function "execute" reverted.',
  })
  assert.deepEqual(describeTxError(raw), { message: GENERIC_SWAP_WORDS, cancelled: false })
  assert.deepEqual(describeTxError(new Error('unknown reason')), { message: GENERIC_SWAP_WORDS, cancelled: false })
  assert.equal(describeTxError(undefined).message, '')
})

test('a refusal in the wallet is a cancel, however deep it is wrapped', () => {
  const wrapped = Object.assign(new Error('x'), { cause: { message: 'User rejected the request.' } })
  assert.deepEqual(describeTxError(wrapped), { message: 'Cancelled in wallet.', cancelled: true })
})

test('our own words pass through; 0x and the proxy stay off the screen', () => {
  const ours = Object.assign(new Error('Swap refused for your safety.'), { plainWords: true })
  assert.equal(describeTxError(ours).message, 'Swap refused for your safety.')
  assert.match(swapApiWords('SWAP_NOT_CONFIGURED'), /offline/)
  assert.doesNotMatch(swapApiWords('SWAP_NOT_CONFIGURED'), /ZEROX|key/i)
  assert.equal(swapApiWords('VALIDATION_FAILED'), 'Could not get a price right now. Nothing has moved. Try again.')
})

test('amounts short enough for a button', () => {
  assert.equal(compactAmount(1_400_000), '1.4M')
  assert.equal(compactAmount(2_000_000_000), '2B')
  assert.equal(compactAmount(12_500), '12.5K')
  assert.equal(compactAmount(1234.5), '1,235')
  assert.equal(compactAmount(12.345), '12.35')
  assert.equal(compactAmount(1), '1')
  assert.equal(compactAmount(0.5), '0.5')
  assert.equal(compactAmount(0.000123456), '0.000123')
  assert.equal(compactAmount(0), '0')
})
