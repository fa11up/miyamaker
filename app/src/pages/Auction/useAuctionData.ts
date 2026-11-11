import { useRef } from 'react'
import type { Address } from 'viem'
import { useReadContracts } from 'wagmi'

import { AUCTION_CHAIN_ID } from '@/constants/contracts'
import type { Auction } from '@/store/auction/reducer'

import { lotPhase, lotReadStatus } from './bidding'
import { ADDRESS0 } from './constants'

/** How often the lot on show is read again while it can still be bid on. Other people's bids arrive this way. */
const LIVE_REFRESH_MS = 15_000

export function useAuctionData({
  nft,
  tokenId,
  address,
  live = false,
}: {
  nft: Address
  /** undefined until the lot list has answered: nothing is read for a guessed lot. */
  tokenId: number | undefined
  address: Address
  live?: boolean
}) {
  const { data: latest, refetch, isError, dataUpdatedAt } = useReadContracts({
    query: {
      enabled: !!address && tokenId !== undefined,
      refetchInterval: (query) => {
        if (!live) return false
        const lot = query.state.data?.[0]?.result as unknown as Auction | undefined
        const read = lot && { status: 'ready' as const, startTime: lot.startTime, endTime: lot.endTime, settled: lot.settled }
        return read && lotPhase(read, Date.now()) === 'ended' ? false : LIVE_REFRESH_MS
      },
    },
    contracts: [
      {
        address,
        chainId: AUCTION_CHAIN_ID,
        functionName: 'getAuction',
        abi: [
          {
            inputs: [
              {
                internalType: 'address',
                name: '_nft',
                type: 'address',
              },
              {
                internalType: 'uint256',
                name: '_tokenId',
                type: 'uint256',
              },
            ],
            name: 'getAuction',
            outputs: [
              {
                components: [
                  {
                    internalType: 'address',
                    name: 'bidder',
                    type: 'address',
                  },
                  {
                    internalType: 'uint96',
                    name: 'amount',
                    type: 'uint96',
                  },
                  {
                    internalType: 'uint96',
                    name: 'minPrice',
                    type: 'uint96',
                  },
                  {
                    internalType: 'uint40',
                    name: 'startTime',
                    type: 'uint40',
                  },
                  {
                    internalType: 'uint40',
                    name: 'endTime',
                    type: 'uint40',
                  },
                  {
                    internalType: 'bool',
                    name: 'settled',
                    type: 'bool',
                  },
                ],
                internalType: 'struct MiyaAuction.AuctionData',
                name: '',
                type: 'tuple',
              },
            ],
            stateMutability: 'view',
            type: 'function',
          },
        ],
        args: [nft, BigInt(tokenId ?? 0)],
      },
      {
        address,
        chainId: AUCTION_CHAIN_ID,
        functionName: 'bidIncrement',
        abi: [
          {
            inputs: [],
            name: 'bidIncrement',
            outputs: [
              {
                internalType: 'uint96',
                name: '',
                type: 'uint96',
              },
            ],
            stateMutability: 'view',
            type: 'function',
          },
        ],
      },
    ],
  })

  // A failed multicall entry arrives inside a successful query, so each answer is checked. The minimum needs both.
  const answered = latest?.[0]?.status === 'success' && latest[1]?.status === 'success'
  // Keyed by the whole lot: token #3 of one collection must never stand in for #3 of another.
  const lot = `${address}:${nft}:${tokenId}`.toLowerCase()
  const lastGood = useRef<{ lot: string; data: NonNullable<typeof latest>; at: number }>()
  if (answered) lastGood.current = { lot, data: latest, at: dataUpdatedAt }
  const good = lastGood.current?.lot === lot ? lastGood.current : undefined
  const data = good?.data
  const auction = data?.[0]?.result as unknown as Auction
  const bidIncrement = data?.[1]?.result as bigint
  const failed = isError || (!!latest && !answered)

  return {
    status: lotReadStatus(!!good, failed),
    updatedAt: good?.at ?? 0,
    bidder: auction?.bidder || ADDRESS0,
    currentBid: (auction?.amount || 0n) as bigint,
    minPrice: (auction?.minPrice || 0n) as bigint,
    startTime: (auction?.startTime || 0) as number,
    endTime: (auction?.endTime || 0) as number,
    settled: (auction?.settled || false) as boolean,
    bidIncrement: bidIncrement || 0n,
    refetch,
  }
}
