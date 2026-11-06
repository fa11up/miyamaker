/* eslint-disable no-restricted-syntax, no-await-in-loop -- one estimate at a time: public RPCs are easily rate limited */
import { useQuery } from '@tanstack/react-query'
import type { Abi, Address } from 'viem'
import { usePublicClient } from 'wagmi'

import type { SupportedChainId } from '@/config/wagmi'

import { feeFromEstimates } from './fillLogic'

type FillCall = {
  address: Address
  abi: Abi | readonly unknown[]
  functionName: string
  args?: unknown
  value?: bigint
}

/**
 * About what the network will charge for these fills, in wei, before the wallet opens. Undefined while it works it out
 * or when nothing could be estimated (say an approval is still owed): the screen then says the wallet will show it.
 */
export function useFillFee({
  chainId,
  account,
  calls,
  key,
}: {
  chainId: SupportedChainId
  account: Address | undefined
  calls: readonly FillCall[]
  /** What makes these calls different from the last ones. */
  key: string
}): bigint | undefined {
  const client = usePublicClient({ chainId })
  const q = useQuery({
    queryKey: ['fill-fee', chainId, account?.toLowerCase(), key],
    enabled: !!client && !!account && calls.length > 0,
    staleTime: 30_000,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const gasPrice = await client!.getGasPrice()
      const gas: (string | undefined)[] = []
      for (const call of calls) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const used = await client!.estimateContractGas({ account, ...call } as any)
          gas.push(used.toString())
        } catch {
          gas.push(undefined)
        }
      }

      return { gasPrice: gasPrice.toString(), gas }
    },
  })
  if (!calls.length || !q.data) return undefined
  return feeFromEstimates(
    q.data.gas.map((g) => (g === undefined ? undefined : BigInt(g))),
    BigInt(q.data.gasPrice),
  )
}
