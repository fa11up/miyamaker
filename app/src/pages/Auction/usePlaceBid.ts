import type { Address } from 'viem'
import { parseEther } from 'viem'

import { useContractWrite } from '@/hooks/useContractWrite'

import { abi } from './constants'

/** Parses a user-typed ETH amount; undefined for '' or anything parseEther rejects (never throws). */
export function parseBidAmount(bidAmount: string): bigint | undefined {
  if (!/^(\d+\.?\d*|\.\d+)$/.test(bidAmount)) return undefined
  try {
    const value = parseEther(bidAmount)
    return value > 0n ? value : undefined
  } catch {
    return undefined
  }
}

export function usePlaceBid({ address, bidAmount }: { address: Address; bidAmount: string }) {
  const value = parseBidAmount(bidAmount)
  const { writeAsync } = useContractWrite({
    address,
    functionName: 'placeBid',
    abi,
    value,
  })

  const placeBid = async (nft: Address, tokenId: number) => {
    if (value === undefined) throw new Error('Enter a valid bid amount')
    return writeAsync({ args: [nft, tokenId] })
  }

  return { placeBid, isValidBid: value !== undefined }
}
