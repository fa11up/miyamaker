import type { Address } from 'viem'
import { getAddress, numberToHex, SwitchChainError, UserRejectedRequestError } from 'viem'

import type { Eip1193, PrivyBridge } from './privyBridge'

const READY_MS = 20_000
/** A person can take their time in the login window, and the wallet is made just after it. */
const WALLET_MS = 45_000

type Emitter = { emit: (event: string, data?: unknown) => void }

/**
 * Privy's embedded wallet as an ordinary wagmi connector, so it sits in the wallet dialog beside MetaMask and every wagmi hook
 * keeps working. Privy's own wagmi package isn't used because it takes over wagmi's connectors, which would lose the others.
 */
export function privyConnector(bridge: PrivyBridge, emitter: Emitter, defaultChainId: number) {
  let provider: Eip1193 | undefined

  const onAccounts = (accounts: string[]) => {
    if (accounts.length) emitter.emit('change', { accounts: accounts.map((a) => getAddress(a)) })
    else emitter.emit('disconnect')
  }
  const onChain = (chain: string) => emitter.emit('change', { chainId: Number(chain) })
  const onGone = () => emitter.emit('disconnect')
  const detach = () => {
    if (!provider) return
    provider.removeListener('accountsChanged', onAccounts as never)
    provider.removeListener('chainChanged', onChain as never)
    provider.removeListener('disconnect', onGone as never)
    provider = undefined
  }

  // A session can end on Privy's side, and the provider says nothing. wagmi hears it here, or it would stay connected
  // with every call failing.
  let unwatch: (() => void) | undefined
  const watchSession = () => {
    unwatch?.()
    unwatch = bridge.watch((s) => {
      if (!s.ready || s.authenticated) return
      unwatch?.()
      unwatch = undefined
      bridge.remember(false)
      detach()
      onGone()
    })
  }

  const wallet = async () => {
    bridge.request()
    // Logged out answers at once, not after the wait for a wallet.
    if (!(await bridge.wait((s) => (s.ready ? s.authenticated : undefined), READY_MS)))
      throw new Error('Not logged in.')
    return bridge.wait((s) => s.wallet, WALLET_MS)
  }
  const attach = async () => {
    const next = await (await wallet()).getEthereumProvider()
    if (next !== provider) {
      provider = next
      next.on('accountsChanged', onAccounts as never)
      next.on('chainChanged', onChain as never)
      next.on('disconnect', onGone as never)
    }
    return next
  }
  const accounts = async () => {
    const list = (await (await attach()).request({ method: 'eth_accounts' })) as string[]
    return list.map((a) => getAddress(a)) as Address[]
  }
  const chain = async () => Number(await (await attach()).request({ method: 'eth_chainId' }))
  const switchTo = async (chainId: number) => {
    try {
      await (await wallet()).switchChain(chainId)
    } catch (e) {
      throw new SwitchChainError(e as Error)
    }
    emitter.emit('change', { chainId })
  }

  return {
    id: 'privy',
    name: 'Google, X or email',
    type: 'privy',
    async connect({ chainId }: { chainId?: number } = {}) {
      bridge.request()
      const authenticated = await bridge.wait((s) => (s.ready ? s.authenticated : undefined), READY_MS)
      if (!authenticated) {
        try {
          await bridge.login()
        } catch (e) {
          // Only closing the window is someone declining. Anything else is a failure to say so about.
          if (/exited_auth_flow/.test((e as Error).message)) throw new UserRejectedRequestError(e as Error)
          throw e
        }
      }
      const list = await accounts()
      if (chainId && chainId !== (await chain())) await switchTo(chainId)
      bridge.remember(true)
      watchSession()
      return { accounts: list, chainId: await chain() }
    },
    async disconnect() {
      bridge.remember(false)
      unwatch?.()
      unwatch = undefined
      detach()
      const state = await bridge.wait((s) => s, READY_MS)
      await state.logout()
    },
    getAccounts: accounts,
    // RainbowKit asks this before connecting, when there's no login to wait for yet.
    getChainId: async () => (provider ? chain() : defaultChainId),
    getProvider: attach,
    async isAuthorized() {
      if (!bridge.remembered()) return false
      try {
        bridge.request()
        return await bridge.wait((s) => (s.ready ? s.authenticated : undefined), READY_MS)
      } catch {
        return false
      }
    },
    switchChain: async ({ chainId }: { chainId: number }) => {
      await switchTo(chainId)
      return { id: chainId, hex: numberToHex(chainId) }
    },
    onAccountsChanged: onAccounts,
    onChainChanged: onChain,
    onDisconnect: onGone,
  }
}
