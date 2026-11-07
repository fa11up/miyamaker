import { getPublicClient, simulateContract, writeContract } from '@wagmi/core'
import { useState } from 'react'
import type { Hash, TransactionReceipt } from 'viem'
import { useAccount } from 'wagmi'

import { wagmiConfig } from '@/config/wagmi'
import { tryBatch } from '@/utils/batch'

import { describeError } from './errors'
import { settle } from './txOutcome'

export type TxState = {
  id?: string
  phase: 'idle' | 'wallet' | 'pending' | 'done' | 'error'
  hash?: Hash
  message?: string
  /** What went wrong (phase 'error'), for screens with their own words. */
  error?: unknown
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
    let hash: Hash | undefined
    try {
      const { request } = await simulateContract(wagmiConfig, { account: address, ...call })
      const sent = await writeContract(wagmiConfig, request)
      hash = sent
      setTx({ id, phase: 'pending', hash })
      const client = getPublicClient(wagmiConfig, { chainId: call.chainId })
      // No timeout, as in wagmi's own wait: a slow transaction keeps waiting. txOutcome.ts says why it isn't wagmi's.
      const receipt = await settle((onReplaced) =>
        client!.waitForTransactionReceipt({ hash: sent, timeout: 0, onReplaced })
      )
      setTx({ id, phase: 'done', hash, receipt: receipt as TransactionReceipt })
    } catch (e) {
      setTx({ id, phase: 'error', hash, message: describeError(e), error: e })
      return
    }

    // Outside the try: a screen's follow-up failing must not report a finished transaction as failed.
    onDone?.(id)
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
    } catch (e) {
      setTx({ id, phase: 'error', message: describeError(e), error: e })
      return
    }

    onDone?.(id)
  }

  return {
    tx,
    run,
    runBatch,
    busy: tx.phase === 'wallet' || tx.phase === 'pending',
    /** Sent, but its ending couldn't be read: it may still land, so a screen must not offer the same thing again. */
    unconfirmed: tx.phase === 'error' && !!(tx.error as { unconfirmed?: boolean } | undefined)?.unconfirmed,
    /** Replaced by the wallet's cancel: nothing moved, so the same thing may be offered again. */
    cancelled: tx.phase === 'error' && !!(tx.error as { cancelled?: boolean } | undefined)?.cancelled,
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
