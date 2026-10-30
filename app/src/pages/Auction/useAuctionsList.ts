import { values } from 'lodash'
import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

import type { Auction } from '@/store/auction/reducer'

import { abi } from './constants'

export function useAuctionsList({ nft, address, chainId }: { nft: Address; address: Address; chainId?: number }) {
  const { data, refetch } = useReadContract({
    address,
    query: { enabled: !!address && !!chainId },
    functionName: 'getActiveAuctionsList',
    abi,
    args: [nft],
  })

  const list = data || []
  const auctions = values(list)

  return {
    auctionsList: [...auctions] as Auction[],
    refetch,
  }
}
