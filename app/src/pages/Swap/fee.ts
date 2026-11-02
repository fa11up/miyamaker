/**
 * Display-only mirror of the fee rule enforced by the server proxy (api/_lib/zeroex.ts).
 * The page never sends fee params; tests/zeroex.test.mts asserts these values match the proxy.
 */
export const FEE_BPS = 10
export const IMDUSD = '0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25'
/** Chains where the proxy charges the fee (only Ethereum has a Treasury today). */
export const FEE_CHAIN_IDS: readonly number[] = [1]

export const feeFree = (sellToken: string, buyToken: string) =>
  [sellToken, buyToken].some((t) => t.toLowerCase() === IMDUSD.toLowerCase())

export const feeApplies = (chainId: number, sellToken: string, buyToken: string) =>
  FEE_CHAIN_IDS.includes(chainId) && !feeFree(sellToken, buyToken)
