import type { Address } from 'viem'

import { AUCTION_CHAIN_ID } from '@/constants/contracts'
import { useContractWrite } from '@/hooks/useContractWrite'

import { parseBidAmount } from './bidding'
import { abi } from './constants'

export function usePlaceBid({ address, bidAmount }: { address: Address; bidAmount: string }) {
  const value = parseBidAmount(bidAmount)
  const { writeAsync } = useContractWrite({
    address,
    functionName: 'placeBid',
    abi,
    value,
    // Reads are pinned to this chain too, so a wallet on another network can never send ETH to this address there.
    chainId: AUCTION_CHAIN_ID,
  })

  const placeBid = async (nft: Address, tokenId: number) => {
    if (value === undefined) throw new Error('Enter a valid bid amount')
    return writeAsync({ args: [nft, tokenId] })
  }

  return { placeBid }
}
