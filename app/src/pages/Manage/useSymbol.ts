import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

export function useSymbol({ address }: { address?: Address }) {
  const { data: symbol } = useReadContract({
    address,
    query: { enabled: !!address },
    functionName: 'symbol',
    abi: [
      {
        inputs: [],
        name: 'symbol',
        outputs: [{ internalType: 'string', name: '', type: 'string' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
  })

  return symbol as string
}
