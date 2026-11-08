/**
 * Client-side checks on a firm 0x quote before anything is approved or sent. The quote comes through our
 * proxy from 0x, but the page signs whatever `transaction` says, so it is checked against what was asked.
 * Only viem (pure ABI code) is imported, so `node --test` can load it directly (tests/quoteGuard.test.mts).
 *
 * What is decoded from `transaction.data` (shape read off real mainnet transactions, Nov 2026):
 *   AllowanceHolder.exec(operator, token, amount, target, data)
 *     token/amount   what AllowanceHolder may pull from the taker: must be the sell token and the sell amount
 *                    (native sells: token 0x0 and amount = the ETH sent).
 *     operator       = target = the Settler it calls. Settler addresses rotate, so the address is checked against
 *                    0x's on-chain registry (Deployer.ownerOf(2), or prev(2) while a new one beds in) before the
 *                    quote can be used: see `settlerIsCurrent` and useSwap.getQuote.
 *   Settler.execute((recipient, buyToken, minAmountOut), actions[], zid)
 *     recipient      must be the connected wallet (the taker).
 *     buyToken       must be the requested buy token.
 *     minAmountOut   must equal the quote's minBuyAmount (the "Minimum received" on screen) and be no lower than
 *                    buyAmount less the slippage the person set.
 * Limit: the `actions` (the route through pools) are not decoded. They cannot take more than token/amount above
 * (AllowanceHolder only lends that much, for this call), and Settler reverts unless `recipient` ends up with at least
 * `minAmountOut` of `buyToken`, so the worst a bad route can do is fail.
 */

import { decodeAbiParameters, decodeFunctionData } from 'viem'


/**
 * 0x AllowanceHolder, pinned per chain. Same address on every Cancun chain; bytecode verified identical on
 * Ethereum (1) and Robinhood Chain (4663) with `cast code`. In the AllowanceHolder flow this contract is both
 * the ERC-20 spender (`issues.allowance.spender`) and the transaction target (`transaction.to`); it then calls
 * Settler itself. Approving or calling anything else is refused.
 */
export const ALLOWANCE_HOLDER: Readonly<Record<number, string>> = {
  1: '0x0000000000001fF3684f28c67538d4D072C22734',
  4663: '0x0000000000001fF3684f28c67538d4D072C22734',
}

/** 0x v2's native-token placeholder (kept here so this file stays import-free). */
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

const eq = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

type QuoteLike = {
  sellToken?: string
  buyToken?: string
  sellAmount?: string
  buyAmount?: string
  minBuyAmount?: string
  allowanceTarget?: string | null
  issues?: { allowance?: { spender?: string } | null } | null
  transaction?: { to?: string; value?: string; data?: string } | null
}

type RequestLike = {
  chainId: number
  sellToken: string
  buyToken: string
  sellAmount: bigint
  /** The connected wallet the quote was asked for. */
  taker?: string
  /** The slippage the person set, in basis points. */
  slippageBps: number
}

const ZERO = '0x0000000000000000000000000000000000000000'

export const allowanceHolderAbi = [
  {
    type: 'function',
    name: 'exec',
    stateMutability: 'payable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: 'result', type: 'bytes' }],
  },
] as const

/** Settler's taker-submitted entry point. Only the slippage struct is read; the actions stay opaque. */
const settlerExecuteParams = [
  {
    name: 'slippage',
    type: 'tuple',
    components: [
      { name: 'recipient', type: 'address' },
      { name: 'buyToken', type: 'address' },
      { name: 'minAmountOut', type: 'uint256' },
    ],
  },
  { name: 'actions', type: 'bytes[]' },
  { name: 'zid', type: 'bytes32' },
] as const
/** toFunctionSelector('execute((address,address,uint256),bytes[],bytes32)') */
export const SETTLER_EXECUTE = '0x1fff991f'

/** 0x's Settler registry: same address on Ethereum and Robinhood Chain (checked with eth_getCode / eth_call). */
export const SETTLER_DEPLOYER = '0x00000000000004533Fe15556B1E086BB1A72cEae' as const
/** Feature 2 = the taker-submitted Settler, the one AllowanceHolder quotes call. */
export const SETTLER_FEATURE = 2n
export const settlerDeployerAbi = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'prev',
    stateMutability: 'view',
    inputs: [{ name: 'feature', type: 'uint128' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export type DecodedSwap = {
  settler: string
  /** What AllowanceHolder may pull from the taker (0x0 = native). */
  token: string
  amount: bigint
  recipient: string
  buyToken: string
  minAmountOut: bigint
}

/** The 0x call decoded, or undefined when it is not AllowanceHolder.exec → Settler.execute. */
export function decodeSwapCall(data: string | undefined): DecodedSwap | undefined {
  if (typeof data !== 'string' || !/^0x[0-9a-fA-F]*$/.test(data)) return undefined
  try {
    const outer = decodeFunctionData({ abi: allowanceHolderAbi, data: data as `0x${string}` })
    const [operator, token, amount, target, inner] = outer.args
    if (!eq(operator, target)) return undefined
    if (inner.slice(0, 10).toLowerCase() !== SETTLER_EXECUTE) return undefined
    const [slippage] = decodeAbiParameters(settlerExecuteParams, `0x${inner.slice(10)}`)
    return {
      settler: target,
      token,
      amount,
      recipient: slippage.recipient,
      buyToken: slippage.buyToken,
      minAmountOut: slippage.minAmountOut,
    }
  } catch {
    return undefined
  }
}

/** Whether the Settler the quote calls is the one 0x's registry names now (or the one before it). */
export const settlerIsCurrent = (settler: string, registry: readonly (string | undefined)[]) =>
  registry.some((r) => !!r && !eq(r, ZERO) && eq(r, settler))

/** Why this firm quote must not be used, or undefined when it matches the request and pins. */
export function quoteProblem(quote: QuoteLike, req: RequestLike): string | undefined {
  const ah = ALLOWANCE_HOLDER[req.chainId]
  if (!ah) return 'Swaps are not supported on this chain.'
  if (!eq(quote.sellToken, req.sellToken)) return 'The quote sells a different token than requested.'
  if (!eq(quote.buyToken, req.buyToken)) return 'The quote buys a different token than requested.'
  if (quote.sellAmount !== req.sellAmount.toString()) return 'The quote sells a different amount than requested.'
  const tx = quote.transaction
  if (!tx || !eq(tx.to, ah)) return 'The quote targets an unexpected contract.'
  const spender = quote.issues?.allowance?.spender
  if (spender !== undefined && !eq(spender, ah)) return 'The quote asks to approve an unexpected spender.'
  if (quote.allowanceTarget && !eq(quote.allowanceTarget, ah)) return 'The quote asks to approve an unexpected spender.'
  let value: bigint
  try {
    value = BigInt(tx.value || '0')
  } catch {
    return 'The quote has an invalid value.'
  }

  const native = req.sellToken.toLowerCase() === NATIVE
  const expected = native ? req.sellAmount : 0n
  if (value !== expected) return 'The quote sends a different ETH value than requested.'

  // What is signed: the calldata itself, not the quote's own summary of it.
  const call = decodeSwapCall(tx.data)
  if (!call) return 'The quote could not be read.'
  if (!eq(call.token, native ? ZERO : req.sellToken) || call.amount !== req.sellAmount)
    return 'The quote would take a different amount than requested.'
  if (!req.taker || !eq(call.recipient, req.taker)) return 'The quote would send the tokens to another wallet.'
  if (!eq(call.buyToken, req.buyToken)) return 'The quote buys a different token than requested.'
  let shownMin: bigint
  let buyAmount: bigint
  try {
    shownMin = BigInt(quote.minBuyAmount ?? '')
    buyAmount = BigInt(quote.buyAmount ?? '')
  } catch {
    return 'The quote could not be read.'
  }

  if (call.minAmountOut !== shownMin) return 'The quote promises a different minimum than it shows.'
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(req.slippageBps))))
  const floor = (buyAmount * (10_000n - bps)) / 10_000n
  // 0x's minimum sits a hair under buyAmount less slippage (measured live, 2026-11-08: ~15 parts per million on ETH to
  // USDC, since its fee and rounding come off first). 0.1% of give covers that; a quote that lowers the minimum further
  // than the slippage set is still refused. The minimum must also equal what the screen shows, checked above.
  if (call.minAmountOut <= 0n || call.minAmountOut < floor - floor / 1_000n - 1n)
    return 'The quote allows more slippage than you set.'
  return undefined
}
