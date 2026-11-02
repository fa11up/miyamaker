import type { TokenMetadata } from '@/store/collections/reducer'
import { useMetadata } from '@/utils/nftMetadata'
import { resolveUri } from '@/utils/resolveUri'

/**
 * Token metadata for one lot. Cached by react-query for the whole session (IPFS metadata never changes), so the
 * lots list, the detail panel and the viewer share one request per token instead of one per component mount.
 */
export function useToken({ tokenURI, isFetch }: { tokenURI: string; isFetch: boolean }) {
  const { data: tokenMetadata } = useMetadata<TokenMetadata>(tokenURI || undefined, isFetch)

  return {
    name: tokenMetadata?.name || '',
    description: tokenMetadata?.description || '',
    image: resolveUri(tokenMetadata?.image),
    externalURL: tokenMetadata?.external_url || '',
    attributes: tokenMetadata?.attributes || [],
  }
}
