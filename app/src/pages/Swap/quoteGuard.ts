/**
 * Client-side checks on a firm 0x quote before anything is approved or sent. The quote comes through our
 * proxy from 0x, but the page signs whatever `transaction` says, so it is checked against what was asked.
 * No imports, so `node --test` can load it directly (tests/quoteGuard.test.mts).
 */

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
  allowanceTarget?: string | null
  issues?: { allowance?: { spender?: string } | null } | null
  transaction?: { to?: string; value?: string } | null
}

type RequestLike = { chainId: number; sellToken: string; buyToken: string; sellAmount: bigint }

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

  const expected = req.sellToken.toLowerCase() === NATIVE ? req.sellAmount : 0n
  if (value !== expected) return 'The quote sends a different ETH value than requested.'
  return undefined
}
