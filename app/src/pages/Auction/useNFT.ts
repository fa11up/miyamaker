import type { Address } from 'viem'
import { useReadContracts } from 'wagmi'

import { AUCTION_CHAIN_ID } from '@/constants/contracts'
import type { ContractMetadata } from '@/store/collections/reducer'
import { useMetadata } from '@/utils/nftMetadata'
import { resolveMetadataUri, resolveUri } from '@/utils/resolveUri'

export function useNFT({ address }: { address: Address }) {
  const { data } = useReadContracts({
    query: { enabled: !!address, staleTime: 10 * 60_000 },
    contracts: [
      {
        address,
        chainId: AUCTION_CHAIN_ID,
        functionName: 'contractURI',
        abi: [
          {
            inputs: [],
            name: 'contractURI',
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
      },
      {
        address,
        chainId: AUCTION_CHAIN_ID,
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
      },
    ],
  })

  let contractUri = (data?.[0]?.result as string) || ''
  const symbol = (data?.[1]?.result as string) || ''

  contractUri = resolveMetadataUri(contractUri)

  // Cached across mounts (react-query; never stale for IPFS) and raced across gateways when the primary is slow.
  const { data: contractMetadata } = useMetadata<ContractMetadata>(contractUri || undefined)

  const imageUri = resolveUri(contractMetadata?.image)

  return {
    name: contractMetadata?.name || '',
    symbol,
    description: contractMetadata?.description || '',
    image: imageUri,
    externalLink: contractMetadata?.external_link || '',
    collaborators: contractMetadata?.collaborators || [],
  }
}
