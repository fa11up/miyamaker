import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

import { useContractWrite } from '@/hooks/useContractWrite'

export function useMintOpen({ address }: { address?: Address }) {
  const { data, refetch } = useReadContract({
    query: { enabled: !!address },
    address,
    functionName: 'mintOpen',
    abi: [
      {
        inputs: [],
        name: 'mintOpen',
        outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
  })

  const { writeAsync } = useContractWrite({
    address,
    functionName: 'openMint',
    abi: [
      {
        inputs: [],
        name: 'openMint',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ],
  })

  const openMint = async () => writeAsync({ args: [] })

  return { mintOpen: (data as boolean) || false, openMint, refetch }
}
