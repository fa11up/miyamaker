import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { Address } from 'viem'
import { parseAbi } from 'viem'
import { useReadContracts } from 'wagmi'

import type { Artwork } from '@/components/ArtViewer'
import { toArtwork } from '@/components/ArtViewer'
import { AUCTION_CHAIN_ID } from '@/constants/contracts'
import { shortAddress } from '@/desktop/mints/dedupe'
import type { Auction } from '@/store/auction/reducer'
import type { TokenMetadata } from '@/store/collections/reducer'
import { metadataQuery } from '@/utils/nftMetadata'
import { resolveUri } from '@/utils/resolveUri'

import { lotFacts, lotPhase } from './bidding'

const GET_AUCTION_ABI = parseAbi([
  'struct AuctionData { address bidder; uint96 amount; uint96 minPrice; uint40 startTime; uint40 endTime; bool settled; }',
  'function getAuction(address nft, uint256 tokenId) view returns (AuctionData)',
])

/** Every lot's auction in one read, in the order of `tokenIds`. A lot that failed to read is undefined. */
export function useLotAuctions({ nft, tokenIds, address }: { nft: Address; tokenIds: number[]; address: Address }) {
  const { data, isPending, isError } = useReadContracts({
    query: { enabled: !!address && tokenIds.length > 0 },
    contracts: tokenIds.map((id) => ({
      address,
      chainId: AUCTION_CHAIN_ID,
      abi: GET_AUCTION_ABI,
      functionName: 'getAuction' as const,
      args: [nft, BigInt(id)] as const,
    })),
  })
  return {
    auctions: tokenIds.map((_, i) => data?.[i]?.result as unknown as Auction | undefined),
    isLoading: isPending && !isError,
    isError,
  }
}

/** The lots as the viewer shows them, each with its bid. `ids[n]` is the token of `items[n]`; a lot with no picture yet is left out. */
export function useLotGallery({
  nft,
  tokenIds,
  tokenURIs,
  address,
}: {
  nft: Address
  tokenIds: number[]
  tokenURIs: string[]
  address: Address
}) {
  const { auctions } = useLotAuctions({ nft, tokenIds, address })
  const metadata = useQueries({
    queries: tokenIds.map((_, i) => metadataQuery<TokenMetadata>(tokenURIs[i] || undefined)),
  })

  return useMemo(() => {
    const ids: number[] = []
    const items: Artwork[] = []
    tokenIds.forEach((id, i) => {
      const meta = metadata[i]?.data
      const image = resolveUri(meta?.image)
      if (!meta || !image) return
      const auction = auctions[i]
      let rows: [string, string | undefined][] = []
      if (auction) {
        const { startTime, endTime, settled, bidder, amount, minPrice } = auction
        const phase = lotPhase({ status: 'ready', startTime, endTime, settled }, Date.now())
        const facts = lotFacts({ phase, bidder, currentBid: BigInt(amount), minPrice: BigInt(minPrice) })
        rows = [
          [facts.bidLabel, facts.bidValue],
          [facts.bidderLabel, facts.bidderValue || shortAddress(bidder)],
        ]
      }
      ids.push(id)
      items.push(toArtwork({ ...meta, image }, rows))
    })
    return { ids, items }
    // The query results are new objects on every render; these say when they really changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tokenIds.join(),
    metadata.map((m) => m.dataUpdatedAt).join(),
    auctions.map((a) => `${a?.bidder}:${a?.amount}:${a?.settled}`).join(),
  ])
}
