import type { Wallet } from '@rainbow-me/rainbowkit'
import { createConnector } from 'wagmi'
import { coinbaseWallet as coinbaseConnector } from 'wagmi/connectors'

import { privyBridge } from './privyBridge'
import { privyConnector } from './privyConnector'

const icon = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${body}</svg>`,
  )}`
const KEY = icon(
  '<path fill="#fff" d="M3 3h5v1h1v3H8v1H6v1H5v1H4v1H3v1H2V7h1zM4 5v1h2V5z"/><path fill="#fff" d="M9 8h4v2h-1v1h-1v1H9z"/>',
)
const AT = icon(
  '<path fill="#fff" d="M5 2h6v1h1v1h1v7h-3v-1H6V9H5V6h1V5h4v5h1V5h-1V4H5v1H4v6h1v1h6v1H5v-1H3v-1H2V4h1V3h2zM7 7v2h2V7z"/>',
)

/** A smart wallet made with Face ID or a fingerprint: nothing to install and no seed phrase. The Coinbase popup makes it. */
export const passkeyWallet =
  ({ appName, appIcon }: { appName: string; appIcon?: string }) =>
  (): Wallet => ({
    id: 'miya-passkey',
    name: 'Create a wallet',
    shortName: 'Create',
    iconUrl: KEY,
    iconBackground: '#4f1f96',
    installed: true,
    createConnector: (details) =>
      createConnector((config) => ({
        ...coinbaseConnector({ appName, appLogoUrl: appIcon, preference: { options: 'smartWalletOnly' } })(config),
        ...details,
        // Its own id, so it isn't taken for the Coinbase Wallet entry when reconnecting.
        id: 'miya-passkey',
        name: 'Create a wallet',
      })),
  })

/** Log in with an account people already have: Privy makes a wallet behind it. */
export const socialWallet = (): Wallet => ({
  id: 'miya-privy',
  name: 'Google, X or email',
  shortName: 'Log in',
  iconUrl: AT,
  iconBackground: '#d97ada',
  installed: true,
  // Cast: wagmi types its connector's events more strictly than this one needs to know about.
  createConnector: (details) =>
    createConnector(((config: {
      emitter: Parameters<typeof privyConnector>[1]
      chains: readonly { id: number }[]
    }) => ({
      ...privyConnector(privyBridge, config.emitter, config.chains[0]!.id),
      ...details,
    })) as never),
})
