import { useFetch } from 'usehooks-ts'

import type { ContractMetadata } from '@/store/collections/reducer'
import { resolveMetadataUri, resolveUri } from '@/utils/resolveUri'

export function useContractMetadata({ metadataUri }: { metadataUri: string }) {
  let contractUri = metadataUri
  contractUri = resolveMetadataUri(contractUri)

  const { data: contractMetadata, error } = useFetch<ContractMetadata>(contractUri)

  if (error) {
    return { name: '', symbol: '', description: '', image: '', externalLink: '', collaborators: [] }
  }

  const imageUri = resolveUri(contractMetadata?.image)

  return {
    description: contractMetadata?.description || '',
    image: imageUri,
    externalLink: contractMetadata?.external_link || '',
    collaborators: contractMetadata?.collaborators || [],
  }
}
