// src/pages/Swap/quoteGuard.ts: a firm quote is only used when it matches the request and the pinned
// AllowanceHolder. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ALLOWANCE_HOLDER, quoteProblem } from '../src/pages/Swap/quoteGuard.ts'

const AH = '0x0000000000001fF3684f28c67538d4D072C22734'
const ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const MIYA = '0xa358491CA72B793ddf21cF46C7289CC6e0ce9e5A'
const EVIL = '0x000000000000000000000000000000000000dEaD'

const erc20Req = { chainId: 1, sellToken: USDC, buyToken: MIYA, sellAmount: 1_000_000n }
const erc20Quote = {
  sellToken: USDC.toLowerCase(),
  buyToken: MIYA,
  sellAmount: '1000000',
  allowanceTarget: AH,
  issues: { allowance: { actual: '0', spender: AH.toLowerCase() } },
  transaction: { to: AH, data: '0x', value: '0' },
}

test('AllowanceHolder is pinned on Ethereum and Robinhood Chain', () => {
  assert.equal(ALLOWANCE_HOLDER[1], AH)
  assert.equal(ALLOWANCE_HOLDER[4663], AH)
})

test('a matching quote passes (ERC-20 and native sells)', () => {
  assert.equal(quoteProblem(erc20Quote, erc20Req), undefined)
  const nativeReq = { chainId: 4663, sellToken: ETH, buyToken: USDC, sellAmount: 5n }
  const nativeQuote = {
    sellToken: ETH,
    buyToken: USDC,
    sellAmount: '5',
    allowanceTarget: null,
    issues: { allowance: null },
    transaction: { to: AH, value: '5' },
  }
  assert.equal(quoteProblem(nativeQuote, nativeReq), undefined)
  assert.match(quoteProblem({ ...nativeQuote, transaction: { to: AH, value: '6' } }, nativeReq) ?? '', /value/)
})

test('any mismatch with the request or the pinned contract is refused', () => {
  const bad: [Record<string, unknown>, RegExp][] = [
    [{ sellToken: MIYA }, /sells a different token/],
    [{ buyToken: USDC }, /buys a different token/],
    [{ sellAmount: '1000001' }, /different amount/],
    [{ transaction: { to: EVIL, value: '0' } }, /unexpected contract/],
    [{ transaction: undefined }, /unexpected contract/],
    [{ issues: { allowance: { actual: '0', spender: EVIL } } }, /spender/],
    [{ allowanceTarget: EVIL }, /spender/],
    [{ transaction: { to: AH, value: '1' } }, /value/],
  ]
  for (const [patch, why] of bad) assert.match(quoteProblem({ ...erc20Quote, ...patch }, erc20Req) ?? '', why, JSON.stringify(patch))
  assert.match(quoteProblem(erc20Quote, { ...erc20Req, chainId: 8453 }) ?? '', /not supported/)
})
