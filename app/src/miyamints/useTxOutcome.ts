import { getPublicClient } from '@wagmi/core'
import { useQuery } from '@tanstack/react-query'
import type { Hash } from 'viem'
import { usePublicClient } from 'wagmi'

import { wagmiConfig } from '@/config/wagmi'
import { receiptOutcome } from '@/pages/Swap/swapLogic'

import { settle, TX_TIME_LIMIT_MS, type TxReplaced } from './txOutcome'

/**
 * Waits for a sent transaction, up to TX_TIME_LIMIT_MS. Throws a TxEndError saying whether it failed or just couldn't be
 * confirmed (in time).
 */
export const waitForTx = (chainId: number, hash: Hash) =>
  settle(
    (onReplaced) =>
      getPublicClient(wagmiConfig, { chainId: chainId as never })!.waitForTransactionReceipt({
        hash,
        timeout: TX_TIME_LIMIT_MS,
        onReplaced,
      }),
    TX_TIME_LIMIT_MS,
  )

const timedOut = (e: unknown) => (e as { name?: string } | null)?.name === 'WaitForTransactionReceiptTimeoutError'

/**
 * A sent transaction's ending for a screen: waiting, success, reverted, cancelled or unknown. wagmi's own hook reports a revert and a
 * failed lookup as the same error, and clears "busy" for both, which offered the action again while it could still land.
 * A wait past TX_TIME_LIMIT_MS is unknown too (not retried), so a dropped transaction doesn't keep the screen busy.
 */
export function useTxOutcome(chainId: number, hash: Hash | undefined) {
  const client = usePublicClient({ chainId: chainId as never })
  const q = useQuery({
    queryKey: ['tx-receipt', chainId, hash],
    enabled: !!hash && !!client,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: (count, e) => !timedOut(e) && count < 3,
    queryFn: async () => {
      let replaced: TxReplaced | undefined
      const receipt = await client!.waitForTransactionReceipt({
        hash: hash!,
        timeout: TX_TIME_LIMIT_MS,
        onReplaced: (r) => {
          replaced = r.reason
        },
      })
      return { receipt, replaced }
    },
  })
  return { receipt: q.data?.receipt, outcome: receiptOutcome(hash, q.data?.receipt, q.isError, q.data?.replaced) }
}
