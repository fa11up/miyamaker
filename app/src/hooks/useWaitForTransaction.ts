import { useEffect, useRef } from 'react'
import type { Hash, TransactionReceipt } from 'viem'
import { useWaitForTransactionReceipt } from 'wagmi'

/**
 * wagmi v1-style wrapper around `useWaitForTransactionReceipt` (wagmi v2 dropped the
 * onSuccess/onError callbacks). Callbacks fire once per hash.
 */
export function useWaitForTransaction({
  hash,
  enabled = true,
  onSuccess,
  onError,
  onReplaced,
}: {
  hash?: Hash | `0x${string}` | ''
  enabled?: boolean
  onSuccess?: (receipt: TransactionReceipt) => void
  onError?: (error: Error) => void
  onReplaced?: () => void
}) {
  const validHash = hash && hash !== '0x' ? (hash as Hash) : undefined
  const result = useWaitForTransactionReceipt({
    hash: validHash,
    onReplaced: onReplaced ? () => onReplaced() : undefined,
    query: { enabled: enabled && !!validHash },
  })

  const handled = useRef<string | undefined>()
  useEffect(() => {
    if (!validHash || handled.current === validHash) return
    if (result.isSuccess && result.data) {
      handled.current = validHash
      onSuccess?.(result.data)
    } else if (result.isError && result.error) {
      handled.current = validHash
      onError?.(result.error)
    }
  }, [validHash, result.isSuccess, result.isError])

  return result
}
