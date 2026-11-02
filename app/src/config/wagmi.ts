import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets'
import type { Chain } from 'viem'
import { mainnet, robinhood, sepolia } from 'viem/chains'
import { createConfig, fallback, http } from 'wagmi'

export { mainnet, robinhood, sepolia }

/** Chains miyaOS supports. The first entry is the default. */
export const chains = [mainnet, sepolia, robinhood] as const satisfies readonly [Chain, ...Chain[]]
export type SupportedChainId = (typeof chains)[number]['id']

/**
 * Per-chain RPC overrides from env. Falls back to the chain's public RPCs.
 *   VITE_RPC_URL_1, VITE_RPC_URL_11155111, VITE_RPC_URL_4663
 */
const RPC_OVERRIDES: Record<number, string | undefined> = {
  [mainnet.id]: import.meta.env.VITE_RPC_URL_1,
  [sepolia.id]: import.meta.env.VITE_RPC_URL_11155111,
  [robinhood.id]: import.meta.env.VITE_RPC_URL_4663,
}

const PUBLIC_FALLBACKS: Record<number, string[]> = {
  [mainnet.id]: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'],
  [sepolia.id]: ['https://ethereum-sepolia-rpc.publicnode.com'],
  [robinhood.id]: [],
}

export function rpcUrlsFor(chain: Chain): string[] {
  const override = RPC_OVERRIDES[chain.id]
  return [
    ...(override ? [override] : []),
    ...(PUBLIC_FALLBACKS[chain.id] || []),
    ...chain.rpcUrls.default.http,
  ].filter((url, i, all) => all.indexOf(url) === i)
}

const transportFor = (chain: Chain) => fallback(rpcUrlsFor(chain).map((url) => http(url, { batch: true })))

/** WalletConnect project id. Without one, WalletConnect-based wallets are hidden instead of crashing the app. */
export const walletConnectProjectId: string = import.meta.env.VITE_WC_PROJECT_ID || ''

const appName = 'miyamaker'

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Recommended',
      wallets: walletConnectProjectId
        ? [metaMaskWallet, rabbyWallet, coinbaseWallet, injectedWallet]
        : [rabbyWallet, coinbaseWallet, injectedWallet],
    },
    ...(walletConnectProjectId ? [{ groupName: 'Other wallets', wallets: [rainbowWallet, walletConnectWallet] }] : []),
  ],
  // RainbowKit requires a non-empty id even when no WalletConnect wallet is listed.
  { appName, projectId: walletConnectProjectId || 'miyamaker-no-walletconnect' }
)

export const wagmiConfig = createConfig({
  chains,
  connectors,
  transports: {
    [mainnet.id]: transportFor(mainnet),
    [sepolia.id]: transportFor(sepolia),
    [robinhood.id]: transportFor(robinhood),
  },
  pollingInterval: 12_000,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}

/** Block explorer base URL for a chain id (defaults to Etherscan). */
export function explorerUrl(chainId: number | undefined): string {
  const chain = chains.find((c) => c.id === chainId) || mainnet
  return chain.blockExplorers?.default.url || 'https://etherscan.io'
}
