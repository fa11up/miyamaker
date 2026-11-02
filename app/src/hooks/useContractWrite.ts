import { useCallback } from 'react'
import type { Abi, Address, Hash } from 'viem'
import { useWriteContract } from 'wagmi'

/**
 * wagmi v1-style `writeAsync({ args })` on top of wagmi v2's `useWriteContract`.
 * Returns `{ hash }` like v1 so existing call sites keep working.
 */
export function useContractWrite({
  address,
  abi,
  functionName,
  value,
  chainId,
}: {
  address?: Address
  abi: Abi | readonly unknown[]
  functionName: string
  value?: bigint
  chainId?: number
}) {
  const { writeContractAsync, ...rest } = useWriteContract()

  const writeAsync = useCallback(
    async (overrides: { args?: readonly unknown[]; value?: bigint } = {}): Promise<{ hash: Hash }> => {
      if (!address) throw new Error('No contract address')
      const hash = await writeContractAsync({
        address,
        abi: abi as Abi,
        functionName,
        args: overrides.args ?? [],
        value: overrides.value ?? value,
        chainId,
      } as Parameters<typeof writeContractAsync>[0])
      return { hash }
    },
    [address, abi, functionName, value, chainId, writeContractAsync]
  )

  return { writeAsync, ...rest }
}
