import type { PublicClient } from 'viem'

import { createAlchemyIndexer, NFT_INDEX_CHAINS, NftIndexOff } from './alchemy'
import { createOnchainIndexer } from './onchain'
import type { KnownCollection, NftIndexer } from './types'

export type { IndexerResult, KnownCollection, NftIndexer, OwnedNft } from './types'

export { fetchOwnedNftsPage, NFT_INDEX_CHAINS, NftIndexOff } from './alchemy'

/**
 * Try `primary`; if it fails (bad key, rate limit, network), fall back to `fallback`. When it is simply not set up
 * (NftIndexOff) the fallback's answer is given as it is, without "unavailable".
 */
function withFallback(primary: NftIndexer, fallback: NftIndexer): NftIndexer {
  return {
    id: `${primary.id}+${fallback.id}`,
    label: primary.label,
    async getNftsForOwner(owner, opts) {
      try {
        return await primary.getNftsForOwner(owner, opts)
      } catch (error) {
        if (opts.signal?.aborted) throw error
        if (error instanceof NftIndexOff) return fallback.getNftsForOwner(owner, opts)
        const result = await fallback.getNftsForOwner(owner, opts)
        return { ...result, source: `${result.source} (${primary.label} unavailable)` }
      }
    },
  }
}

/** Set for the session once the Worker says it has no NFT index key, so it isn't asked again. */
let indexOff = false

/**
 * The wallet's NFT source. When the Worker has ALCHEMY_API_KEY: Alchemy (every collection), falling back to the
 * chain. Without: the on-chain reader for known collections only.
 */
export function getNftIndexer(client: PublicClient, collections: KnownCollection[]): NftIndexer {
  const onchain = createOnchainIndexer(client, collections)
  const chainId = client.chain?.id ?? 1
  if (indexOff || !NFT_INDEX_CHAINS.has(chainId)) return onchain
  const alchemy = createAlchemyIndexer(chainId)
  const remembering: NftIndexer = {
    ...alchemy,
    async getNftsForOwner(owner, opts) {
      try {
        return await alchemy.getNftsForOwner(owner, opts)
      } catch (error) {
        if (error instanceof NftIndexOff) indexOff = true
        throw error
      }
    },
  }
  return withFallback(remembering, onchain)
}
