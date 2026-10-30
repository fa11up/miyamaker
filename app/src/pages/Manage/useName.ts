import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

export function useName({ address }: { address?: Address }) {
  const { data: name, refetch } = useReadContract({
    address,
    query: { enabled: !!address },
    functionName: 'name',
    abi: [
      {
        inputs: [],
        name: 'name',
        outputs: [{ internalType: 'string', name: '', type: 'string' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
  })

  return {
    realName: name as string,
    setRealName: (input: string) => {
      console.log(input)
    },
    refetch,
  }
}
