/** One NFT the wallet holds, already sanitized (see ../sanitize.ts). */
export interface OwnedNft {
  chainId: number
  contract: string
  collectionName: string
  tokenId: string
  name: string
  description: string
  /** safe http(s)/data:image URL or '' */
  image: string
  externalUrl: string
}

export interface IndexerResult {
  nfts: OwnedNft[]
  /** which adapter produced this, for the status bar */
  source: string
  /** true when the adapter stopped early (page / chunk limits) */
  partial: boolean
}

/**
 * Wallet NFT source. Add an adapter (Reservoir, SimpleHash, a self-hosted indexer...) by
 * implementing this and listing it in ./index.ts.
 */
export interface NftIndexer {
  id: string
  label: string
  getNftsForOwner(owner: string, opts: { signal?: AbortSignal }): Promise<IndexerResult>
}

/** Collections the on-chain fallback knows how to enumerate without an indexer. */
export interface KnownCollection {
  chainId: number
  address: string
  name: string
  /** window that can open this collection's tokens */
  app?: 'mint' | 'auction'
  /**
   * How to find a holder's tokens without an indexer:
   *  - 'enumerable': ERC721Enumerable tokenOfOwnerByIndex
   *  - 'sweep': ownerOf(firstId..lastId) via multicall (small collections, ERC721A etc.)
   *  - 'logs': Transfer(to=owner) logs in bounded chunks (needs an RPC that serves log history)
   */
  strategy: 'enumerable' | 'sweep' | 'logs'
  firstTokenId?: number
  /** upper bound for 'sweep' when the contract has no totalSupply() */
  sweepMax?: number
  /** first block to scan for 'logs' */
  fromBlock?: bigint
  /** image when tokenURI JSON can't be read from the browser (no CORS) */
  imageFor?: (tokenId: string) => string
}
