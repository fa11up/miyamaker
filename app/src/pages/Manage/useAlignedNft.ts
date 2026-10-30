import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

export function useAlignedNft({ address }: { address?: Address }) {
  const { data: alignedNft } = useReadContract({
    address,
    query: { enabled: !!address },
    functionName: 'alignedNft',
    abi: [
      {
        inputs: [],
        name: 'alignedNft',
        outputs: [{ internalType: 'address', name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
  })

  return alignedNft as Address
}
