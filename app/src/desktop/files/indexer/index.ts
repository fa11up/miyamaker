import type { PublicClient } from 'viem'

import { createAlchemyIndexer } from './alchemy'
import { createOnchainIndexer } from './onchain'
import type { KnownCollection, NftIndexer } from './types'

export type { IndexerResult, KnownCollection, NftIndexer, OwnedNft } from './types'

export const ALCHEMY_KEY: string = import.meta.env.VITE_ALCHEMY_KEY || ''

/** Try `primary`; if it fails (bad key, rate limit, network), fall back to `fallback`. */
function withFallback(primary: NftIndexer, fallback: NftIndexer): NftIndexer {
  return {
    id: `${primary.id}+${fallback.id}`,
    label: primary.label,
    async getNftsForOwner(owner, opts) {
      try {
        return await primary.getNftsForOwner(owner, opts)
      } catch (error) {
        if (opts.signal?.aborted) throw error
        const result = await fallback.getNftsForOwner(owner, opts)
        return { ...result, source: `${result.source} (${primary.label} unavailable)` }
      }
    },
  }
}

/**
 * The wallet's NFT source. With VITE_ALCHEMY_KEY: Alchemy (every collection), falling back to the
 * chain. Without: the on-chain reader for known collections only.
 */
export function getNftIndexer(client: PublicClient, collections: KnownCollection[]): NftIndexer {
  const onchain = createOnchainIndexer(client, collections)
  if (!ALCHEMY_KEY) return onchain
  return withFallback(createAlchemyIndexer(ALCHEMY_KEY, client.chain?.id ?? 1), onchain)
}
