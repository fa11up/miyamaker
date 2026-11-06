import MiyaLogo from 'assets/134321870.png'
import CultLogo from 'assets/tokens/cult.webp'
import EthLogo from 'assets/tokens/eth.webp'
import ImdLogo from 'assets/tokens/imd.webp'
import ImdusdLogo from 'assets/tokens/imdusd.webp'
import InferLogo from 'assets/tokens/infer.webp'
import UsdcLogo from 'assets/tokens/usdc.webp'
import UsdgLogo from 'assets/tokens/usdg.webp'
import WbtcLogo from 'assets/tokens/wbtc.webp'
import WethLogo from 'assets/tokens/weth.webp'
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

/** The curated tokens' logos, bundled so the picker never waits on or trusts someone else's image host. */
const LOGOS: Record<string, string> = {
  [NATIVE_TOKEN.toLowerCase()]: EthLogo,
  [MIYA_ADDRESS.toLowerCase()]: MiyaLogo,
  '0x53d0ea0a685220718dc6a0a6e4617194c6f37921': InferLogo,
  '0x61aaf8a992a3143e2b0c9cb0030b9fe702854a25': ImdusdLogo,
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': UsdcLogo,
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': WbtcLogo,
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': WethLogo,
  '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7': ImdLogo,
  '0x0000000000c5dc95539589fbd24be07c6c14eca4': CultLogo,
  '0x5fc5360d0400a0fd4f2af552add042d716f1d168': UsdgLogo,
}

export const withLogo = (t: ListToken): SwapToken => {
  const logoURI = LOGOS[t.address.toLowerCase()]
  return (logoURI ? { ...t, logoURI } : t) as SwapToken
}

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
