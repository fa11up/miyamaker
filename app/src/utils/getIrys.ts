/* eslint-disable @typescript-eslint/return-await */
/* eslint-disable no-underscore-dangle */
import { WebIrys } from '@irys/sdk'
import { getAccount, getTransaction, getTransactionReceipt, switchChain } from '@wagmi/core'
import type { Address, Chain } from 'viem'
import { createWalletClient, custom, TransactionNotFoundError, TransactionReceiptNotFoundError } from 'viem'
import { mainnet } from 'viem/chains'

import { wagmiConfig } from '@/config/wagmi'

import type { TxState } from './irysPayment'

/** The chain Irys is paid on for a token. Storage is paid on Ethereum whatever network the wallet is on for the rest. */
const PAYMENT_CHAIN: Record<string, Chain> = { ethereum: mainnet }
/** Payments are sent on this chain, which is also where they are looked up. */
const payChains = new WeakMap<WebIrys, Chain>()

/**
 * Where a storage payment stands on the chain it was paid on. Throws when the chain can't be asked, so a node that is
 * down is never taken for a payment that doesn't exist.
 */
export async function paymentTxState(irys: WebIrys, txId: string): Promise<TxState> {
  const hash = txId as `0x${string}`
  const chainId = (payChains.get(irys) ?? mainnet).id as 1
  try {
    const receipt = await getTransactionReceipt(wagmiConfig, { hash, chainId })
    return receipt.status === 'success' ? 'success' : 'reverted'
  } catch (e) {
    if (!(e instanceof TransactionReceiptNotFoundError)) throw e
  }

  try {
    await getTransaction(wagmiConfig, { hash, chainId })
    return 'pending'
  } catch (e) {
    if (e instanceof TransactionNotFoundError) return 'missing'
    throw e
  }
}

/**
 * Creates a new Irys object with the specified configuration.
 *
 * @param {string} url - The Irys network URL.
 * @param {string} token - The currency to use (e.g., "matic").
 * @param {string} providerUrl - The provider URL for the Ethereum network.
 * @returns {Promise<WebIrys>} - A reference to the initialized Irys object.
 */
const getIrys = async (
  url: string = import.meta.env.VITE_IRYS_NODE || 'https://uploader.irys.xyz',
  token: string = import.meta.env.VITE_IRYS_TOKEN || 'ethereum',
  chain: Chain = mainnet
): Promise<WebIrys> => {
  // The connected wallet, whichever kind (extension, WalletConnect, ...), not whatever sits on window.ethereum.
  const account = getAccount(wagmiConfig)
  if (!account.address || !account.connector) throw new Error('Connect a wallet first.')
  const payChain = PAYMENT_CHAIN[token] ?? chain
  const eip1193 = (await account.connector.getProvider()) as Parameters<typeof custom>[0]
  const provider = createWalletClient({
    account: account.address,
    chain: payChain,
    transport: custom(eip1193),
  })
  // @ts-expect-error injected
  provider.getSigner = () => provider

  // @ts-expect-error injected
  provider.getAddress = async () => provider.getAddresses().then((a) => a[0])
  const wallet = { name: 'viem', provider }
  const webIrys = new WebIrys({ url, token, wallet })
  await webIrys.ready()
  payChains.set(webIrys, payChain)

  /*
   * The SDK looks a payment up with `getTransaction` on the wallet it was given, which a viem wallet client doesn't
   * have, so every lookup threw and every payment sat out the SDK's full 30 s wait before Irys was told. This asks the
   * payment chain instead, and calls a payment ready once it is mined: Irys checks it again itself.
   */
  const getTx = async (txId: string) => {
    const hash = txId as `0x${string}`
    const chainId = payChain.id as 1
    const tx = await getTransaction(wagmiConfig, { hash, chainId })
    const receipt =
      tx.blockNumber != null
        ? await getTransactionReceipt(wagmiConfig, { hash, chainId }).catch(() => undefined)
        : undefined
    if (receipt?.status === 'reverted') throw new Error('The storage payment failed on chain.')
    // Only `confirmed` is read by the SDK's wait.
    return { from: tx.from, to: tx.to ?? '', pending: !receipt, confirmed: !!receipt }
  }

  Object.assign(webIrys.tokenConfig, { getTx })

  // @ts-expect-error injected
  webIrys.tokenConfig.getFee = async (_amount, _to): Promise<number> => {
    return 0
  }

  // Otherwise
  webIrys.tokenConfig.sendTx = async (data): Promise<string> => {
    // Money sent to Irys on any other chain is lost, so the wallet moves first, and viem refuses a mismatch.
    const from = getAccount(wagmiConfig).chainId
    if (from !== payChain.id) await switchChain(wagmiConfig, { chainId: payChain.id as 1 })
    try {
      const hash = await provider.sendTransaction({
        to: data.to,
        value: data.amount,
        account: webIrys.address as `0x${string}`,
      })
      return hash
    } finally {
      // Back where it was, for what the screen does next. A wallet that refuses is caught by that screen's own check.
      if (from && from !== payChain.id) await switchChain(wagmiConfig, { chainId: from as 1 }).catch(() => undefined)
    }
  }

  webIrys.tokenConfig.createTx = async (amount, to, fee): Promise<{ txId: string | undefined; tx: any }> => {
    // dummy value/method
    return { txId: undefined, tx: { amount, to, fee } }
  }

  await webIrys.ready()

  // @ts-expect-error injected
  provider._signTypedData = async (domain, types, message) => {
    message['Transaction hash'] = `0x${Buffer.from(message['Transaction hash']).toString('hex')}`
    return await provider.signTypedData({
      domain,
      message,
      types,
      account: webIrys.address! as Address,
      primaryType: 'Bundlr',
    })
  }

  console.log(`Conected to webIrys from ${webIrys.address}`)
  return webIrys
}

export default getIrys
