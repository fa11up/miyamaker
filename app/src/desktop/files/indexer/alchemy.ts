/* eslint-disable no-restricted-syntax, no-continue, no-await-in-loop, no-plusplus -- bounded, sequential RPC/parse loops read clearer as loops */
import { resolveUri } from '@/utils/resolveUri'

import { cleanText, sanitizeMetadata } from '../sanitize'
import { NFT_PREFIX } from '../../../../api/_lib/rpc'
import { parseAlchemyOwnedNfts } from './parse'
import type { NftIndexer, OwnedNft } from './types'

/** Chains the Worker's NFT index serves (api/_lib/rpc.ts). */
export const NFT_INDEX_CHAINS: ReadonlySet<number> = new Set([1])

/** The Worker has no NFT index key (ALCHEMY_API_KEY): read from the chain instead, and don't call it a failure. */
export class NftIndexOff extends Error {
  constructor() {
    super('The NFT index is not set up.')
    this.name = 'NftIndexOff'
  }
}

/**
 * One page of Alchemy's getNFTsForOwner, through the Worker (/api/nft/<chainId>/getNFTsForOwner), which holds the key.
 * Throws NftIndexOff when the Worker has no key.
 */
export async function fetchOwnedNftsPage(
  chainId: number,
  params: URLSearchParams,
  signal?: AbortSignal
): Promise<unknown> {
  const res = await fetch(`${NFT_PREFIX}/${chainId}/getNFTsForOwner?${params}`, {
    signal,
    headers: { accept: 'application/json' },
  })
  if (res.status === 503 && res.headers.get('x-rpc-proxy') === 'off') throw new NftIndexOff()
  if (!res.ok) throw new Error(`NFT index: HTTP ${res.status}`)
  return res.json()
}

const MAX_PAGES = 5 // 500 NFTs; the window says "partial" past that

/** Alchemy NFT API v3 getNFTsForOwner, through the Worker (the key is its ALCHEMY_API_KEY secret, never bundled). */
export function createAlchemyIndexer(chainId = 1): NftIndexer {
  return {
    id: 'alchemy',
    label: 'Alchemy NFT API',
    async getNftsForOwner(owner, { signal }) {
      if (!NFT_INDEX_CHAINS.has(chainId)) throw new NftIndexOff()
      const nfts: OwnedNft[] = []
      let pageKey: string | undefined
      let pages = 0
      do {
        const params = new URLSearchParams({ owner, withMetadata: 'true', pageSize: '100' })
        if (pageKey) params.set('pageKey', pageKey)
        const parsed = parseAlchemyOwnedNfts(await fetchOwnedNftsPage(chainId, params, signal), chainId, {
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
