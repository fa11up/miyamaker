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
import type { CreateConnectorFn } from 'wagmi'
import { createConfig, fallback, http } from 'wagmi'
import { reconnect } from 'wagmi/actions'

import { passkeyConnector, socialConnector } from '@/wallet/newcomerWallets'

export { mainnet, robinhood, sepolia }

/** Chains miyaOS supports. The first entry is the default. */
export const chains = [mainnet, sepolia, robinhood] as const satisfies readonly [Chain, ...Chain[]]

/** The chains a network picker offers: test networks only in development builds. */
export const pickerChains = chains.filter((c) => import.meta.env.DEV || !('testnet' in c && c.testnet))
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

/** Privy app id, for logging in with Google, X or email. It's public by design. Without one that option is hidden. */
export const privyAppId: string = import.meta.env.VITE_PRIVY_APP_ID || ''

/** Offered only when a wallet is there to answer: otherwise it waits on an extension that doesn't exist. */
const browserWallets =
  typeof window !== 'undefined' && (window as { ethereum?: unknown }).ethereum ? [injectedWallet] : []

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Have a wallet?',
      wallets: walletConnectProjectId
        ? [metaMaskWallet, rabbyWallet, coinbaseWallet, ...browserWallets]
        : [rabbyWallet, coinbaseWallet, ...browserWallets],
    },
    ...(walletConnectProjectId ? [{ groupName: 'Other wallets', wallets: [rainbowWallet, walletConnectWallet] }] : []),
  ],
  // RainbowKit requires a non-empty id even when no WalletConnect wallet is listed.
  { appName, projectId: walletConnectProjectId || 'miyamaker-no-walletconnect' }
)

/** Their setup downloads their code, over a megabyte with a socket, for everyone at startup. Now it loads when they're picked. */
const onDemand = (connector: CreateConnectorFn): CreateConnectorFn => (config) => {
  const made = connector(config)
  return made.type === 'walletConnect' || made.type === 'coinbaseWallet' ? { ...made, setup: undefined } : made
}

export const wagmiConfig = createConfig({
  chains,
  connectors: [...connectors, passkeyConnector(appName), ...(privyAppId ? [socialConnector()] : [])].map(onDemand),
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

/**
 * Picks the session back up after a reload. wagmi's own version asks every wallet for its provider first, which downloads
 * WalletConnect and Coinbase for everyone, and waits on a Privy login that isn't coming. Only browser wallets, which cost
 * nothing to ask, and the wallet this person last used are asked here.
 */
export async function reconnectWallets() {
  let last: string | null = null
  try {
    last = (await wagmiConfig.storage?.getItem('recentConnectorId')) ?? null
  } catch {
    // Then only browser wallets are asked.
  }
  return reconnect(wagmiConfig, {
    connectors: wagmiConfig.connectors.filter((c) => c.type === 'injected' || c.id === last),
  })
}
