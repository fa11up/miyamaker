import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

export function useNFTPrice({ address }: { address: Address }) {
  const { data: price } = useReadContract({
    address,
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
    price: (price as bigint) || 0n,
  }
}
