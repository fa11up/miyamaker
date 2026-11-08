import { getPublicClient, simulateContract, writeContract } from '@wagmi/core'
import { useRef, useState } from 'react'
import type { Hash, TransactionReceipt } from 'viem'
import { useAccount } from 'wagmi'

import { wagmiConfig } from '@/config/wagmi'
import { tryBatch } from '@/utils/batch'

import { describeError } from './errors'
import { settle, TX_TIME_LIMIT_MS } from './txOutcome'

export type TxState = {
  id?: string
  phase: 'idle' | 'wallet' | 'pending' | 'done' | 'error'
  /** Kept through an error: an unconfirmed transaction's hash is what the wallet's activity can be checked against. */
  hash?: Hash
  message?: string
  /** What went wrong (phase 'error'), for screens with their own words. */
  error?: unknown
  /**
   * Where it went wrong (phase 'error'): 'check' is the dry run before the wallet opens, so nothing was sent; 'wallet' may
   * or may not have sent; 'wait' was sent.
   */
  stage?: 'check' | 'wallet' | 'wait'
  /** Set when phase is 'done', for callers that read events from it. */
  receipt?: TransactionReceipt
}

/** One call as a string, so the same thing sent twice can be told apart from something new. */
const callKey = (call: unknown) =>
  JSON.stringify(call, (_, v) => (typeof v === 'bigint' ? v.toString() : v === undefined ? null : v)) || ''

/**
 * One contract write at a time with plain states: simulate → wallet → pending → done / error.
 * `run(id, call)` takes the same object as simulateContract (minus account).
 *
 * The wait for a receipt ends after TX_TIME_LIMIT_MS as unconfirmed (hash kept), so a dropped transaction can't hold a
 * screen busy for ever. A call that ended unconfirmed is not sent again by `run` until the screen calls `reset`
 * ("Start over"): it may still land, and a second copy would spend twice.
 */
export function useTx(onDone?: (id: string) => void) {
  const { address } = useAccount()
  const [tx, setTx] = useState<TxState>({ phase: 'idle' })
  const unsettled = useRef(new Set<string>())

  /** Resolves true once the call landed, false when it didn't (the screen shows why from `tx`). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = async (id: string, call: any): Promise<boolean> => {
    if (!address) {
      setTx({ id, phase: 'error', message: 'Connect a wallet first.' })
      return false
    }

    const key = callKey({ ...call, account: address })
    if (unsettled.current.has(key)) return false

    setTx({ id, phase: 'wallet' })
    let hash: Hash | undefined
    let stage: TxState['stage'] = 'check'
    try {
      const { request } = await simulateContract(wagmiConfig, { account: address, ...call })
      stage = 'wallet'
      const sent = await writeContract(wagmiConfig, request)
      hash = sent
      stage = 'wait'
      setTx({ id, phase: 'pending', hash })
      const client = getPublicClient(wagmiConfig, { chainId: call.chainId })
      // The public client rather than wagmi's wait: txOutcome.ts says why. viem stops polling at the same limit.
      const receipt = await settle(
        (onReplaced) => client!.waitForTransactionReceipt({ hash: sent, timeout: TX_TIME_LIMIT_MS, onReplaced }),
        TX_TIME_LIMIT_MS
      )
      setTx({ id, phase: 'done', hash, receipt: receipt as TransactionReceipt })
    } catch (e) {
      if ((e as { unconfirmed?: boolean }).unconfirmed) unsettled.current.add(key)
      setTx({ id, phase: 'error', hash, message: describeError(e), error: e, stage })
      return false
    }

    // Outside the try: a screen's follow-up failing must not report a finished transaction as failed.
    onDone?.(id)
    return true
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
    /**
     * Stops before the wallet with `message`, as a failed dry run: nothing was sent. For a check a screen makes itself
     * (the price moved, the sale ended) before it would send anything.
     */
    refuse: (id: string, message: string) =>
      setTx({ id, phase: 'error', message, stage: 'check', error: { precheck: true, message } }),
    /** Starts over: also lets a call that ended unconfirmed be sent again, which only the person should choose. */
    reset: () => {
      unsettled.current.clear()
      setTx({ phase: 'idle' })
    },
  }
}

export function txWords(tx: TxState): string {
  if (tx.phase === 'wallet') return 'Confirm in your wallet…'
  if (tx.phase === 'pending') return 'Waiting for the network…'
  if (tx.phase === 'done') return 'Done.'
  if (tx.phase === 'error') return tx.message || 'Something went wrong.'
  return ''
}
