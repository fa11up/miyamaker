import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

export function useAlignedNft({ address }: { address?: Address }) {
  const { data: alignedNft, isLoading } = useReadContract({
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

  return { alignedNft: alignedNft as Address, isLoading }
}
