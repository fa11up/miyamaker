import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

import type { SupportedChainId } from '@/config/wagmi'

/**
 * A collection's mint price, read on the collection's own chain. `price` is undefined until it has been read, and stays
 * undefined when the read fails: a price of 0 would let a mint go out underpaid, or look free.
 */
export function useNFTPrice({ address, chainId }: { address: Address; chainId: number }) {
  const { data, isLoading, isError, refetch } = useReadContract({
    address,
    chainId: chainId as SupportedChainId,
    query: { enabled: !!address },
    functionName: 'price',
    abi: [
      {
        inputs: [],
        name: 'price',
        outputs: [
          {
            internalType: 'uint80',
            name: '',
            type: 'uint80',
          },
        ],
        stateMutability: 'view',
        type: 'function',
      },
    ],
  })

  return {
    price: typeof data === 'bigint' ? data : undefined,
    loading: !!address && isLoading,
    failed: isError,
    refetch,
  }
}
