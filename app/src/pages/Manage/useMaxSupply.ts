import { type Address } from 'viem'
import { useReadContract } from 'wagmi'
import { useContractWrite } from '@/hooks/useContractWrite'

export function useMaxSupply({ address }: { address?: Address }) {
  const { data: maxSupply, refetch } = useReadContract({
    address,
    query: { enabled: !!address },
    functionName: 'maxSupply',
    abi: [
      {
        inputs: [],
        name: 'maxSupply',
        outputs: [{ internalType: 'uint40', name: '', type: 'uint40' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
  })

  const { writeAsync } = useContractWrite({
    address,
    functionName: 'decreaseSupply',
    abi: [
      {
        inputs: [{ internalType: 'uint40', name: '_maxSupply', type: 'uint40' }],
        name: 'decreaseSupply',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ],
  })

  const decreaseSupply = async (input: bigint) => writeAsync({ args: [input] })

  return { maxSupply: BigInt(maxSupply ?? 0), decreaseSupply, refetch }
}
