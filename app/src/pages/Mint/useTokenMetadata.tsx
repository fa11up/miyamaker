import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'

import { useTokenURI } from '@/pages/Mint/useTokenURI'
import type { TokenMetadata } from '@/store/collections/reducer'
import { resolveMetadataUri, resolveUri } from '@/utils/resolveUri'

export function useTokenMetadata({ address, tokenId }: { address: Address; tokenId: string }) {
  const [NFTMetadata, setNFTMetadata] = useState<TokenMetadata>({
    name: '',
    description: '',
    image: '',
    external_url: '',
    attributes: [],
  } as TokenMetadata)
  const { tokenURI, status } = useTokenURI({ address, tokenId })

  const fetchData = useCallback(async () => {
    if (tokenURI && status === 'success') {
      try {
        const link = resolveMetadataUri(tokenURI as string)

        const response = await fetch(link)
        const data = await response.json()
        setNFTMetadata(data as TokenMetadata)
      } catch (_) {
        setNFTMetadata({
          name: '',
          description: '',
          image: '',
          external_url: '',
          attributes: [],
        })
      }
    }
  }, [status, tokenURI])

  useEffect(() => {
    fetchData()
  }, [])

  const imageUri = resolveUri(NFTMetadata?.image)

  return {
    name: NFTMetadata?.name || '',
    description: NFTMetadata?.description || '',
    image: imageUri,
    externalURL: NFTMetadata?.external_url || '',
    attributes: NFTMetadata?.attributes || [],
  }
}
