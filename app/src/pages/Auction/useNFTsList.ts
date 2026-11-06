import { values } from 'lodash'
import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

import { AUCTION_CHAIN_ID } from '@/constants/contracts'

import { abi } from './constants'

export function useNFTsList({ address }: { address: Address }) {
  const { data, isPending, isError, refetch } = useReadContract({
    address,
    chainId: AUCTION_CHAIN_ID,
    query: { enabled: !!address },
    functionName: 'getNfts',
    abi,
  })

  const list = data || []
  const nfts = values(list)

  return {
    nftsList: [...nfts] as string[],
    isLoading: isPending && !isError,
    isError,
    refetch,
  }
}
