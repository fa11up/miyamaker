import MiyaLogo from 'assets/134321870.png'
import type { Address } from 'viem'
import { mainnet, robinhood } from 'viem/chains'

import type { ListToken } from './tokenList'
import { INFER_ADDRESS, MIYA_ADDRESS, MIYA_LIST } from './tokenList'

/**
 * 0x v2 represents the native token (ETH on Ethereum and Robinhood Chain) with this placeholder.
 * Source: https://docs.0x.org/evm/0x-swap-api/additional-topics/handling-native-tokens
 */
export const NATIVE_TOKEN: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

/** Chains the Swap window supports (0x serves both; Sepolia is not served by 0x). */
export const SWAP_CHAINS = [mainnet, robinhood] as const
export type SwapChainId = (typeof SWAP_CHAINS)[number]['id']
export const isSwapChain = (id: number | undefined): id is SwapChainId => SWAP_CHAINS.some((c) => c.id === id)

export const TOKEN_LIST_URL = 'https://tokens.uniswap.org'

export const isNative = (address: string | undefined) => address?.toLowerCase() === NATIVE_TOKEN.toLowerCase()
export const sameAddress = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export type SwapToken = ListToken & { address: Address }

const withLogo = (t: ListToken): SwapToken =>
  sameAddress(t.address, MIYA_ADDRESS) ? { ...t, logoURI: MiyaLogo } : (t as SwapToken)

/** The curated miya list per chain, pinned to the top of the picker and shown as quick picks. */
export const PINNED_TOKENS: Record<SwapChainId, SwapToken[]> = {
  [mainnet.id]: MIYA_LIST[mainnet.id]!.map(withLogo),
  [robinhood.id]: MIYA_LIST[robinhood.id]!.map(withLogo),
}

const find = (chainId: SwapChainId, address: string) =>
  PINNED_TOKENS[chainId].find((t) => sameAddress(t.address, address))!

/** Default pair per chain: ETH -> INFER on Ethereum, ETH -> USDG on Robinhood Chain. */
export const DEFAULT_PAIR: Record<SwapChainId, [SwapToken, SwapToken]> = {
  [mainnet.id]: [find(mainnet.id, NATIVE_TOKEN), find(mainnet.id, INFER_ADDRESS)],
  [robinhood.id]: [find(robinhood.id, NATIVE_TOKEN), PINNED_TOKENS[robinhood.id][1]!],
}

export const DEFAULT_SLIPPAGE_BPS = 50
export const SLIPPAGE_PRESETS_BPS = [10, 50, 100] as const
/** The proxy accepts 10..300 bps (0.1%..3%). */
export const SLIPPAGE_MIN_BPS = 10
export const SLIPPAGE_MAX_BPS = 300
/** Firm quotes older than this are refreshed before sending. */
export const QUOTE_MAX_AGE_MS = 30_000
/** ETH kept back by the Max button to pay gas. */
export const GAS_HEADROOM_WEI: Record<SwapChainId, bigint> = {
  [mainnet.id]: 5_000_000_000_000_000n, // 0.005 ETH
  [robinhood.id]: 200_000_000_000_000n, // 0.0002 ETH (L2)
}
