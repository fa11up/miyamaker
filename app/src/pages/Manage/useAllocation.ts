import { type Address } from 'viem'
import { useReadContract } from 'wagmi'

import { useContractWrite } from '@/hooks/useContractWrite'

export function useAllocation({ address }: { address?: Address }) {
  const { data: allocation, refetch } = useReadContract({
    address,
    query: { enabled: !!address },
    functionName: 'allocation',
    abi: [
      {
        inputs: [],
        name: 'allocation',
        outputs: [{ internalType: 'uint16', name: '', type: 'uint16' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
  })

  const { writeAsync } = useContractWrite({
    address,
    functionName: 'increaseAlignment',
    abi: [
      {
        inputs: [{ internalType: 'uint16', name: '_allocation', type: 'uint16' }],
        name: 'decreaseSupply',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ],
  })

  const increaseAllocation = async (input: bigint) => writeAsync({ args: [input] })

  return { allocation: BigInt(allocation ?? 0), increaseAllocation, refetch }
}
