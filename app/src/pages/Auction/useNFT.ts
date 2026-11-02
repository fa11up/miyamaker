import { useFetch } from 'usehooks-ts'
import type { Address } from 'viem'
import { useReadContracts } from 'wagmi'

import type { ContractMetadata } from '@/store/collections/reducer'
import { resolveMetadataUri, resolveUri } from '@/utils/resolveUri'

export function useNFT({ address }: { address: Address }) {
  const { data } = useReadContracts({
    query: { enabled: !!address },
    contracts: [
      {
        address,
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

  const { data: contractMetadata, error } = useFetch<ContractMetadata>(contractUri)

  if (error) {
    return { name: '', symbol: '', description: '', image: '', externalLink: '', collaborators: [] }
  }

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
