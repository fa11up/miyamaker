import { values } from 'lodash'
import type { Address } from 'viem'
import { formatUnits, parseAbi } from 'viem'
import { useReadContract, useReadContracts } from 'wagmi'

import { AUCTION_CHAIN_ID } from '@/constants/contracts'
import { resolveMetadataUri } from '@/utils/resolveUri'

import { abi } from './constants'

const TOKEN_URI_ABI = parseAbi(['function tokenURI(uint256 tokenId) view returns (string)'])

export function useAllTokenIds({ nft, address }: { nft: Address; address: Address }) {
  const { data, isPending, isError } = useReadContract({
    address,
    chainId: AUCTION_CHAIN_ID,
    query: { enabled: !!address },
    functionName: 'getAllTokenIds',
    abi,
    args: [nft],
  })

  const list = data || []
  const ids = values(list).map((id: bigint) => Number(formatUnits(id, 0)))

  const { data: tokenURIData } = useReadContracts({
    query: { enabled: ids.length > 0, staleTime: 10 * 60_000 },
    contracts: ids.map((item) => ({
      address: nft,
      chainId: AUCTION_CHAIN_ID,
      abi: TOKEN_URI_ABI,
      functionName: 'tokenURI' as const,
      args: [BigInt(item)] as const,
    })),
  })

  const tokenURIList = (tokenURIData?.map(({ result }) => result) as string[]) || []
  const tokenURIs = tokenURIList.map((item: string) => resolveMetadataUri(item))

  return {
    tokenIds: [...ids] as number[],
    tokenURIs,
    isLoading: isPending && !isError,
    isError,
  }
}
