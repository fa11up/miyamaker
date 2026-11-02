import { simulateContract, waitForTransactionReceipt, writeContract } from '@wagmi/core'
import { useState } from 'react'
import type { Hash } from 'viem'
import { useAccount } from 'wagmi'

import { wagmiConfig } from '@/config/wagmi'

import { describeError } from './errors'

export type TxState = {
  id?: string
  phase: 'idle' | 'wallet' | 'pending' | 'done' | 'error'
  hash?: Hash
  message?: string
}

/**
 * One contract write at a time with plain states: simulate → wallet → pending → done / error.
 * `run(id, call)` takes the same object as simulateContract (minus account).
 */
export function useTx(onDone?: (id: string) => void) {
  const { address } = useAccount()
  const [tx, setTx] = useState<TxState>({ phase: 'idle' })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = async (id: string, call: any) => {
    if (!address) {
      setTx({ id, phase: 'error', message: 'Connect a wallet first.' })
      return
    }

    setTx({ id, phase: 'wallet' })
    try {
      const { request } = await simulateContract(wagmiConfig, { account: address, ...call })
      const hash = await writeContract(wagmiConfig, request)
      setTx({ id, phase: 'pending', hash })
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: call.chainId })
      if (receipt.status !== 'success') throw new Error('The transaction failed on-chain.')
      setTx({ id, phase: 'done', hash })
      onDone?.(id)
    } catch (e) {
      setTx({ id, phase: 'error', message: describeError(e) })
    }
  }

  return { tx, run, busy: tx.phase === 'wallet' || tx.phase === 'pending', reset: () => setTx({ phase: 'idle' }) }
}

export function txWords(tx: TxState): string {
  if (tx.phase === 'wallet') return 'Confirm in your wallet…'
  if (tx.phase === 'pending') return 'Waiting for the network…'
  if (tx.phase === 'done') return 'Done.'
  if (tx.phase === 'error') return tx.message || 'Something went wrong.'
  return ''
}
