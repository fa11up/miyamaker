import MiyaLogo from 'assets/134321870.png'
import type { Address } from 'viem'
import { mainnet, robinhood } from 'viem/chains'

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

export type SwapToken = {
  chainId: number
  address: Address
  symbol: string
  name: string
  decimals: number
  logoURI?: string
  /** true for user-pasted addresses that are not on any list we trust */
  unverified?: boolean
}

const ETH_LOGO = 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'

export const MIYA: SwapToken = {
  chainId: mainnet.id,
  // name/symbol/decimals verified on mainnet with `cast call` ("Black Hearted Cyber Baby Angel Token", MIYA, 18)
  address: '0xa358491CA72B793ddf21cF46C7289CC6e0ce9e5A',
  symbol: 'MIYA',
  name: 'Black Hearted Cyber Baby Angel Token',
  decimals: 18,
  logoURI: MiyaLogo,
}

const nativeEth = (chainId: number): SwapToken => ({
  chainId,
  address: NATIVE_TOKEN,
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  logoURI: ETH_LOGO,
})

/** Pinned to the top of the list, in order. Addresses verified on-chain. */
export const PINNED_TOKENS: Record<SwapChainId, SwapToken[]> = {
  [mainnet.id]: [
    nativeEth(mainnet.id),
    {
      chainId: mainnet.id,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      logoURI:
        'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
    },
    {
      chainId: mainnet.id,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      logoURI:
        'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
    },
    MIYA,
  ],
  [robinhood.id]: [
    nativeEth(robinhood.id),
    {
      chainId: robinhood.id,
      // verified on Robinhood Chain: name "Global Dollar", symbol USDG, 6 decimals
      address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
      symbol: 'USDG',
      name: 'Global Dollar',
      decimals: 6,
      logoURI: 'https://coin-images.coingecko.com/coins/images/51281/large/GDN_USDG_Token_200x200.png',
    },
  ],
}

/** Default pair per chain: ETH -> MIYA on mainnet, ETH -> USDG on Robinhood Chain. */
export const DEFAULT_PAIR: Record<SwapChainId, [SwapToken, SwapToken]> = {
  [mainnet.id]: [PINNED_TOKENS[mainnet.id][0]!, MIYA],
  [robinhood.id]: [PINNED_TOKENS[robinhood.id][0]!, PINNED_TOKENS[robinhood.id][1]!],
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

export const isNative = (address: string | undefined) => address?.toLowerCase() === NATIVE_TOKEN.toLowerCase()
export const sameAddress = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
