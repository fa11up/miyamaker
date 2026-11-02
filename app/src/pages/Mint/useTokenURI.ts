import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

export function useTokenURI({ address, tokenId }: { address: Address; tokenId: string }) {
  const { data: tokenURI, status } = useReadContract({
    address,
    query: { enabled: !!address },
    functionName: 'tokenURI',
    abi: [
      {
        inputs: [
          {
            internalType: 'uint256',
            name: 'tokenId',
            type: 'uint256',
          },
        ],
        name: 'tokenURI',
        outputs: [
          {
            internalType: 'string',
            name: '',
            type: 'string',
          },
        ],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    args: [BigInt(tokenId || 0)],
  })

  return {
    tokenURI: tokenURI as string | '',
    status,
  }
}
