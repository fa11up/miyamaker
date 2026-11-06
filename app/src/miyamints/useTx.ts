import { simulateContract, waitForTransactionReceipt, writeContract } from '@wagmi/core'
import { useState } from 'react'
import type { Hash, TransactionReceipt } from 'viem'
import { useAccount } from 'wagmi'

import { wagmiConfig } from '@/config/wagmi'
import { tryBatch } from '@/utils/batch'

import { describeError } from './errors'

export type TxState = {
  id?: string
  phase: 'idle' | 'wallet' | 'pending' | 'done' | 'error'
  hash?: Hash
  message?: string
  /** Set when phase is 'done', for callers that read events from it. */
  receipt?: TransactionReceipt
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
      setTx({ id, phase: 'done', hash, receipt })
      onDone?.(id)
    } catch (e) {
      setTx({ id, phase: 'error', message: describeError(e) })
    }
  }

  /**
   * Several steps as one signature. A wallet that turns out not to batch gets the first step alone under `fallbackId`,
   * and the screen carries on with its separate steps from there.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runBatch = async (id: string, steps: any[], fallbackId: string) => {
    if (!address) {
      setTx({ id, phase: 'error', message: 'Connect a wallet first.' })
      return
    }

    setTx({ id, phase: 'wallet' })
    try {
      const sent = await tryBatch(steps, {
        account: address,
        chainId: steps[0].chainId,
        onSent: () => setTx({ id, phase: 'pending' }),
      })
      if (!sent) {
        await run(fallbackId, steps[0])
        return
      }

      setTx({ id, phase: 'done', hash: sent.hash })
      onDone?.(id)
    } catch (e) {
      setTx({ id, phase: 'error', message: describeError(e) })
    }
  }

  return {
    tx,
    run,
    runBatch,
    busy: tx.phase === 'wallet' || tx.phase === 'pending',
    reset: () => setTx({ phase: 'idle' }),
  }
}

export function txWords(tx: TxState): string {
  if (tx.phase === 'wallet') return 'Confirm in your wallet…'
  if (tx.phase === 'pending') return 'Waiting for the network…'
  if (tx.phase === 'done') return 'Done.'
  if (tx.phase === 'error') return tx.message || 'Something went wrong.'
  return ''
}
