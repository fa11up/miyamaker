/* eslint-disable no-restricted-syntax, no-continue, no-await-in-loop, no-plusplus -- bounded, sequential RPC/parse loops read clearer as loops */
import { resolveUri } from '@/utils/resolveUri'

import { cleanText, sanitizeMetadata } from '../sanitize'
import { parseAlchemyOwnedNfts } from './parse'
import type { NftIndexer, OwnedNft } from './types'

const NETWORKS: Record<number, string> = {
  1: 'eth-mainnet',
}

const MAX_PAGES = 5 // 500 NFTs; the window says "partial" past that

/**
 * Alchemy NFT API v3 getNFTsForOwner. Enabled by VITE_ALCHEMY_KEY. That key ends up in the client
 * bundle: use an Alchemy key restricted to your domains (allowlist) with NFT API only.
 */
export function createAlchemyIndexer(apiKey: string, chainId = 1): NftIndexer {
  const network = NETWORKS[chainId]
  return {
    id: 'alchemy',
    label: 'Alchemy NFT API',
    async getNftsForOwner(owner, { signal }) {
      if (!network) throw new Error(`Alchemy: chain ${chainId} not configured`)
      const nfts: OwnedNft[] = []
      let pageKey: string | undefined
      let pages = 0
      do {
        const url = new URL(`https://${network}.g.alchemy.com/nft/v3/${encodeURIComponent(apiKey)}/getNFTsForOwner`)
        url.searchParams.set('owner', owner)
        url.searchParams.set('withMetadata', 'true')
        url.searchParams.set('pageSize', '100')
        if (pageKey) url.searchParams.set('pageKey', pageKey)
        const res = await fetch(url.toString(), { signal, headers: { accept: 'application/json' } })
        if (!res.ok) throw new Error(`Alchemy: HTTP ${res.status}`)
        const parsed = parseAlchemyOwnedNfts(await res.json(), chainId, {
          sanitize: sanitizeMetadata,
          cleanText,
          resolve: resolveUri,
        })
        nfts.push(...parsed.nfts)
        pageKey = parsed.pageKey
        pages += 1
      } while (pageKey && pages < MAX_PAGES)

      return { nfts, source: 'Alchemy NFT API', partial: !!pageKey }
    },
  }
}
