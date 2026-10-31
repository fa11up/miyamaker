import { useFetch } from 'usehooks-ts'

import type { TokenMetadata } from '@/store/collections/reducer'
import { resolveUri } from '@/utils/resolveUri'

export function useToken({ tokenURI, isFetch }: { tokenURI: string; isFetch: boolean }) {
  if (!isFetch) {
    return {
      name: '',
      description: '',
      image: '',
      externalURL: '',
      attributes: [],
    }
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { data: tokenMetadata, error } = useFetch<TokenMetadata>(tokenURI)

  if (error) {
    return { name: '', description: '', image: '', externalURL: '', attributes: [] }
  }

  const imageUri = resolveUri(tokenMetadata?.image)

  return {
    name: tokenMetadata?.name || '',
    description: tokenMetadata?.description || '',
    image: imageUri,
    externalURL: tokenMetadata?.external_url || '',
    attributes: tokenMetadata?.attributes || [],
  }
}
