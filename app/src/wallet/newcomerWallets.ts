import { createConnector } from 'wagmi'
import { coinbaseWallet as coinbaseConnector } from 'wagmi/connectors'

import { privyBridge } from './privyBridge'
import { privyConnector } from './privyConnector'

// Plain wagmi connectors with no RainbowKit details: the wallet list leaves them out, and NewHere offers them instead.

/** A smart wallet made with Face ID or a fingerprint: nothing to install and no seed phrase. The Coinbase popup makes it. */
export const passkeyConnector = (appName: string) =>
  createConnector((config) => ({
    ...coinbaseConnector({ appName, preference: { options: 'smartWalletOnly' } })(config),
    // Its own id, so it isn't taken for the Coinbase Wallet entry when reconnecting.
    id: 'miya-passkey',
    name: 'Create a wallet',
  }))

/** Log in with an account people already have: Privy makes a wallet behind it. */
export const socialConnector = () =>
  // Cast: wagmi types its connector's events more strictly than this one needs to know about.
  createConnector(((config: { emitter: Parameters<typeof privyConnector>[1]; chains: readonly { id: number }[] }) =>
    privyConnector(privyBridge, config.emitter, config.chains[0]!.id)) as never)
