// src/pages/Swap/quoteGuard.ts: a firm quote is only used when it matches the request and the pinned
// AllowanceHolder, and its calldata (AllowanceHolder.exec → Settler.execute) says the same. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { encodeAbiParameters, encodeFunctionData } from 'viem'

import {
  ALLOWANCE_HOLDER,
  allowanceHolderAbi,
  decodeSwapCall,
  quoteProblem,
  SETTLER_EXECUTE,
  settlerIsCurrent,
} from '../src/pages/Swap/quoteGuard.ts'

const AH = '0x0000000000001fF3684f28c67538d4D072C22734'
const ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const MIYA = '0xa358491CA72B793ddf21cF46C7289CC6e0ce9e5A'
const EVIL = '0x000000000000000000000000000000000000dEaD'
const ME = '0x5167d014a056e43883e1bbea5530c3c0dc993281'
// The mainnet taker-submitted Settler that Deployer.ownerOf(2) named in Nov 2026.
const SETTLER = '0xaddc26a3854feabfd20d6bf658254088d83a425a'
const ZERO = '0x0000000000000000000000000000000000000000'

/** The shape of a real AllowanceHolder.exec(…, Settler.execute(…)) transaction (read off mainnet, Nov 2026). */
function swapData(
  o: {
    operator?: string
    token?: string
    amount?: bigint
    target?: string
    recipient?: string
    buyToken?: string
    minOut?: bigint
    selector?: string
  } = {},
) {
  const inner =
    (o.selector ?? SETTLER_EXECUTE) +
    encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'recipient', type: 'address' },
            { name: 'buyToken', type: 'address' },
            { name: 'minAmountOut', type: 'uint256' },
          ],
        },
        { type: 'bytes[]' },
        { type: 'bytes32' },
      ],
      [
        {
          recipient: (o.recipient ?? ME) as `0x${string}`,
          buyToken: (o.buyToken ?? MIYA) as `0x${string}`,
          minAmountOut: o.minOut ?? 990n,
        },
        ['0xbd01c226' as `0x${string}`],
        `0x${'5c'.repeat(16)}${'0'.repeat(32)}`,
      ],
    ).slice(2)
  return encodeFunctionData({
    abi: allowanceHolderAbi,
    functionName: 'exec',
    args: [
      (o.operator ?? SETTLER) as `0x${string}`,
      (o.token ?? USDC) as `0x${string}`,
      o.amount ?? 1_000_000n,
      (o.target ?? o.operator ?? SETTLER) as `0x${string}`,
      inner as `0x${string}`,
    ],
  })
}

const erc20Req = { chainId: 1, sellToken: USDC, buyToken: MIYA, sellAmount: 1_000_000n, taker: ME, slippageBps: 100 }
const erc20Quote = {
  sellToken: USDC.toLowerCase(),
  buyToken: MIYA,
  sellAmount: '1000000',
  buyAmount: '1000',
  minBuyAmount: '990',
  allowanceTarget: AH,
  issues: { allowance: { actual: '0', spender: AH.toLowerCase() } },
  transaction: { to: AH, data: swapData(), value: '0' },
}

test('AllowanceHolder is pinned on Ethereum and Robinhood Chain', () => {
  assert.equal(ALLOWANCE_HOLDER[1], AH)
  assert.equal(ALLOWANCE_HOLDER[4663], AH)
})

test('a matching quote passes (ERC-20 and native sells)', () => {
  assert.equal(quoteProblem(erc20Quote, erc20Req), undefined)
  const nativeReq = { chainId: 4663, sellToken: ETH, buyToken: USDC, sellAmount: 5n, taker: ME, slippageBps: 100 }
  const nativeData = swapData({ token: ZERO, amount: 5n, buyToken: USDC, minOut: 990n })
  const nativeQuote = {
    sellToken: ETH,
    buyToken: USDC,
    sellAmount: '5',
    buyAmount: '1000',
    minBuyAmount: '990',
    allowanceTarget: null,
    issues: { allowance: null },
    transaction: { to: AH, value: '5', data: nativeData },
  }
  assert.equal(quoteProblem(nativeQuote, nativeReq), undefined)
  assert.match(
    quoteProblem({ ...nativeQuote, transaction: { to: AH, value: '6', data: nativeData } }, nativeReq) ?? '',
    /value/,
  )
  // Native sells name 0x0 to AllowanceHolder; the sell token itself (or anything else) is refused.
  const wrongToken = swapData({ token: USDC, amount: 5n, buyToken: USDC })
  assert.match(
    quoteProblem({ ...nativeQuote, transaction: { to: AH, value: '5', data: wrongToken } }, nativeReq) ?? '',
    /different amount/,
  )
})

test('any mismatch with the request or the pinned contract is refused', () => {
  const bad: [Record<string, unknown>, RegExp][] = [
    [{ sellToken: MIYA }, /sells a different token/],
    [{ buyToken: USDC }, /buys a different token/],
    [{ sellAmount: '1000001' }, /different amount/],
    [{ transaction: { to: EVIL, value: '0', data: swapData() } }, /unexpected contract/],
    [{ transaction: undefined }, /unexpected contract/],
    [{ issues: { allowance: { actual: '0', spender: EVIL } } }, /spender/],
    [{ allowanceTarget: EVIL }, /spender/],
    [{ transaction: { to: AH, value: '1', data: swapData() } }, /value/],
  ]
  for (const [patch, why] of bad)
    assert.match(quoteProblem({ ...erc20Quote, ...patch }, erc20Req) ?? '', why, JSON.stringify(patch))
  assert.match(quoteProblem(erc20Quote, { ...erc20Req, chainId: 8453 }) ?? '', /not supported/)
})

test('the calldata itself is checked: amount pulled, recipient, buy token, minimum out', () => {
  const withData = (data: string, extra: Record<string, unknown> = {}) => ({
    ...erc20Quote,
    ...extra,
    transaction: { to: AH, value: '0', data },
  })
  const cases: [string, RegExp][] = [
    [swapData({ amount: 1_000_001n }), /take a different amount/],
    [swapData({ token: MIYA }), /take a different amount/],
    [swapData({ recipient: EVIL }), /another wallet/],
    [swapData({ buyToken: USDC }), /buys a different token/],
    [swapData({ minOut: 1n }), /different minimum/],
    [swapData({ selector: '0xdeadbeef' }), /could not be read/],
    [swapData({ operator: SETTLER, target: EVIL }), /could not be read/],
    ['0x', /could not be read/],
    ['not hex', /could not be read/],
  ]
  for (const [data, why] of cases) assert.match(quoteProblem(withData(data), erc20Req) ?? '', why, data.slice(0, 80))
  // Minimum in the calldata and on screen agree, but it is lower than the slippage the person set allows.
  assert.match(
    quoteProblem(withData(swapData({ minOut: 900n }), { minBuyAmount: '900' }), erc20Req) ?? '',
    /more slippage than you set/,
  )
  // The same minimum is fine at 10% slippage.
  assert.equal(
    quoteProblem(withData(swapData({ minOut: 900n }), { minBuyAmount: '900' }), { ...erc20Req, slippageBps: 1000 }),
    undefined,
  )
  // No taker known = nowhere to check the recipient against.
  assert.match(quoteProblem(erc20Quote, { ...erc20Req, taker: undefined }) ?? '', /another wallet/)
  // A recipient in another case is the same wallet.
  assert.equal(quoteProblem(erc20Quote, { ...erc20Req, taker: ME.toUpperCase().replace('0X', '0x') }), undefined)
})

test('the Settler is decoded and must be one 0x lists on chain', () => {
  const call = decodeSwapCall(swapData())
  assert.equal(call?.settler.toLowerCase(), SETTLER)
  assert.equal(call?.minAmountOut, 990n)
  assert.equal(settlerIsCurrent(SETTLER, [SETTLER.toUpperCase().replace('0X', '0x'), undefined]), true)
  assert.equal(settlerIsCurrent(SETTLER, [EVIL, SETTLER]), true, 'the previous Settler while 0x rotates')
  assert.equal(settlerIsCurrent(EVIL, [SETTLER, undefined]), false)
  assert.equal(settlerIsCurrent(ZERO, [ZERO]), false, 'an empty registry slot never matches')
})

test("0x's real minimum, a hair under buyAmount less slippage, passes; a lower one is refused", () => {
  // Live ETH -> USDC price (2026-11-08): buyAmount 222954531, minBuyAmount 220721713 at 1% (about 15 ppm under).
  const nativeReq = { chainId: 1, sellToken: ETH, buyToken: USDC, sellAmount: 10n ** 17n, taker: ME, slippageBps: 100 }
  const quote = (min: bigint) => ({
    sellToken: ETH,
    buyToken: USDC,
    sellAmount: String(10n ** 17n),
    buyAmount: '222954531',
    minBuyAmount: String(min),
    allowanceTarget: null,
    issues: { allowance: null },
    transaction: { to: AH, value: String(10n ** 17n), data: swapData({ token: ZERO, amount: 10n ** 17n, buyToken: USDC, minOut: min }) },
  })
  assert.equal(quoteProblem(quote(220721713n), nativeReq), undefined)
  assert.match(quoteProblem(quote(219000000n), nativeReq) ?? '', /more slippage/)
})
