import { values } from 'lodash'
import type { Address } from 'viem'
import { formatUnits, parseAbi } from 'viem'
import { useReadContract, useReadContracts } from 'wagmi'

import { abi } from './constants'

const TOKEN_URI_ABI = parseAbi(['function tokenURI(uint256 tokenId) view returns (string)'])

export function useActiveTokenIds({ nft, address }: { nft: Address; address: Address }) {
  const { data } = useReadContract({
    address,
    query: { enabled: !!address },
    functionName: 'getActiveTokenIds',
    abi,
    args: [nft],
  })

  const list = data || []
  const ids = values(list).map((id: bigint) => Number(formatUnits(id, 0)))

  const { data: tokenURIData } = useReadContracts({
    query: { enabled: !!ids },
    contracts: ids.map((item) => ({
      address: nft,
      abi: TOKEN_URI_ABI,
      functionName: 'tokenURI' as const,
      args: [BigInt(item)] as const,
    })),
  })

  const tokenURIList = (tokenURIData?.map(({ result }) => result) as string[]) || []
  const tokenURIs = tokenURIList.map((item: string) => {
    const uri = item.replace('ipfs://', '')
    const cid = uri.split('/')[0]
    const tokenFile = uri.split('/')[1]
    return `https://${cid}.ipfs.nftstorage.link/${tokenFile}`
  })

  return {
    tokenIds: [...ids] as number[],
    tokenURIs,
  }
}
