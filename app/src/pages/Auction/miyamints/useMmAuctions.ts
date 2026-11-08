import { useQuery } from '@tanstack/react-query'
import { getPublicClient } from '@wagmi/core'
import { useRef } from 'react'
import type { Address, PublicClient } from 'viem'
import { getAddress } from 'viem'

import { chains, wagmiConfig } from '@/config/wagmi'
import { miyamintsAddresses } from '@/constants/contracts'
import { scanRange } from '@/miyamints/collections'
import { registryAbi } from '@/miyamints/abi'

import { mmAuctionAbi } from './abi'
import type { MmLot } from './rules'
import { cleanBidMessage, lotIds } from './rules'

/** Registry entries read per chain, newest first, and lots per auction house. A cut list says so (`truncated`). */
const REGISTRY_SCAN = 200
const LOTS_PER_HOUSE = 40
const LIVE_REFRESH_MS = 15_000

export type MmHouse = {
  chainId: number
  chainName: string
  address: Address
  name: string
  owner: Address
  bidIncrement: bigint
  /** Seconds. A bid with less than this left moves the end to this long after the bid. */
  timeBuffer: number
  protocolFeeBps: number
  alignmentBps: number
  /** More lots than were read. */
  truncated: boolean
}

export type MmLotRef = { key: string; house: MmHouse; lot: MmLot }

export const lotKeyOf = (chainId: number, address: string, tokenId: number) =>
  `${chainId}:${address.toLowerCase()}:${tokenId}`

/** Chains where the miyamints registry and auction factory are known (env or contracts/deployments). */
export function auctionChains() {
  return chains
    .map((c) => ({ chainId: c.id as number, chainName: c.name, ...miyamintsAddresses(c.id) }))
    .filter((c) => !!c.registry && !!c.erc721AuctionFactory)
}

const client = (chainId: number) =>
  getPublicClient(wagmiConfig, { chainId: chainId as (typeof chains)[number]['id'] }) as PublicClient | undefined

/** Reads in parallel: the client batches them into one request. */
async function readHouse(c: PublicClient, chainId: number, chainName: string, address: Address): Promise<MmLotRef[]> {
  const read = <T>(functionName: string, args?: readonly unknown[]) =>
    c.readContract({ address, abi: mmAuctionAbi, functionName, args } as never) as Promise<T>
  const [name, owner, next, bidIncrement, timeBuffer, protocolFeeBps, alignmentBps] = await Promise.all([
    read<string>('name'),
    read<Address>('owner'),
    read<number>('nextTokenId'),
    read<bigint>('bidIncrement'),
    read<number>('timeBuffer'),
    read<number>('protocolFeeBps'),
    read<number>('alignmentBps'),
  ])
  const ids = lotIds(Number(next), LOTS_PER_HOUSE)
  const house: MmHouse = {
    chainId,
    chainName,
    address,
    name,
    owner,
    bidIncrement,
    timeBuffer: Number(timeBuffer),
    protocolFeeBps: Number(protocolFeeBps),
    alignmentBps: Number(alignmentBps),
    truncated: Number(next) - 1 > ids.length,
  }
  const lots = await Promise.all(ids.map((id) => read<MmLot>('getAuction', [id])))
  return lots.map((lot) => ({
    key: lotKeyOf(chainId, address, Number(lot.tokenId)),
    house,
    lot: { ...lot, tokenId: Number(lot.tokenId), startTime: Number(lot.startTime), endTime: Number(lot.endTime) },
  }))
}

async function lotsOnChain(chainId: number, chainName: string, registry: Address, factory: Address) {
  const c = client(chainId)
  if (!c) return []
  const count = Number(await c.readContract({ address: registry, abi: registryAbi, functionName: 'instanceCount' }))
  const idx = scanRange(count, REGISTRY_SCAN)
  const addrs = await Promise.all(
    idx.map((i) =>
      c.readContract({ address: registry, abi: registryAbi, functionName: 'instances', args: [BigInt(i)] })
    )
  )
  const made = await Promise.all(
    addrs.map((a) => c.readContract({ address: registry, abi: registryAbi, functionName: 'factoryOf', args: [a] }))
  )
  const houses = addrs
    .filter((_, i) => (made[i] as string | undefined)?.toLowerCase() === factory.toLowerCase())
    .map((a) => getAddress(a))
  const perHouse = await Promise.all(houses.map((a) => readHouse(c, chainId, chainName, a)))
  return perHouse.flat()
}

/**
 * Every miyamints auction lot on the chains it is deployed on: live, up next and ended. Nothing deployed means nothing
 * to read, and the section shows nothing. A chain that fails is reported (`failed`) while the others still show.
 */
export function useMmAuctions() {
  const targets = auctionChains()
  const q = useQuery({
    queryKey: ['mm-auctions', targets.map((t) => `${t.chainId}:${t.registry}:${t.erc721AuctionFactory}`)],
    enabled: targets.length > 0,
    staleTime: 20_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const results = await Promise.allSettled(
        targets.map((t) =>
          lotsOnChain(t.chainId, t.chainName, t.registry as Address, t.erc721AuctionFactory as Address)
        )
      )
      const failed = targets.filter((_, i) => results[i]?.status === 'rejected').map((t) => t.chainName)
      if (failed.length === targets.length) throw new Error('No chain answered')
      const lots = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      return { lots, failed }
    },
  })
  return {
    deployed: targets.length > 0,
    lots: q.data?.lots || [],
    /** Chains that didn't answer the last read, while others did. */
    failed: q.data?.failed || [],
    loading: q.isLoading && targets.length > 0,
    error: q.isError && !q.data,
    refetch: q.refetch,
  }
}

/**
 * One lot, read again every 15s while it can change (live, or ended and not closed). A failed poll keeps the last good
 * answer, keyed by the whole lot so another lot's answer never stands in.
 */
export function useMmLot(house: MmHouse | undefined, tokenId: number | undefined, account: Address | undefined) {
  const key = house && tokenId !== undefined ? lotKeyOf(house.chainId, house.address, tokenId) : ''
  const q = useQuery({
    queryKey: ['mm-lot', key, account],
    enabled: !!key,
    refetchInterval: (query) => {
      const lot = query.state.data?.lot
      return lot && lot.settled ? false : LIVE_REFRESH_MS
    },
    queryFn: async () => {
      const c = client(house!.chainId)
      if (!c) throw new Error('No client')
      const [raw, escrowedTo] = await Promise.all([
        c.readContract({ address: house!.address, abi: mmAuctionAbi, functionName: 'getAuction', args: [tokenId!] }),
        c.readContract({
          address: house!.address,
          abi: mmAuctionAbi,
          functionName: 'escrowedWinner',
          args: [tokenId!],
        }),
      ])
      const lot: MmLot = {
        ...raw,
        tokenId: Number(raw.tokenId),
        startTime: Number(raw.startTime),
        endTime: Number(raw.endTime),
      }
      return { lot, escrowedTo: escrowedTo as Address, at: Date.now() }
    },
  })
  const lastGood = useRef<{ key: string; data: NonNullable<typeof q.data> }>()
  if (q.data && q.data !== lastGood.current?.data) lastGood.current = { key, data: q.data }
  const good = lastGood.current?.key === key ? lastGood.current.data : undefined
  return {
    status: good ? ('ready' as const) : q.isError ? ('failed' as const) : ('loading' as const),
    lot: good?.lot,
    escrowedTo: good?.escrowedTo,
    updatedAt: good?.at ?? 0,
    refetch: q.refetch,
  }
}

export type BidRow = { bidder: Address; amount: bigint; hash: string; block: bigint }

/**
 * Bids on a lot, newest first, from its BidPlaced events. Read again when the high bid changes. A node that refuses the
 * range answers `failed`, and the screen says the history can't be shown rather than showing none.
 */
export function useBidHistory(house: MmHouse | undefined, tokenId: number | undefined, highBid: bigint | undefined) {
  const key = house && tokenId !== undefined ? lotKeyOf(house.chainId, house.address, tokenId) : ''
  const q = useQuery({
    queryKey: ['mm-bids', key, highBid?.toString()],
    enabled: !!key,
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const c = client(house!.chainId)
      if (!c) throw new Error('No client')
      const range = { address: house!.address, abi: mmAuctionAbi, args: { tokenId: tokenId! }, fromBlock: 'earliest', toBlock: 'latest' } as const
      const [logs, notes] = await Promise.all([
        c.getContractEvents({ ...range, eventName: 'BidPlaced' }),
        // Messages are extras: if they can't be read, the bids still show.
        c.getContractEvents({ ...range, eventName: 'BidMessage' }).catch(() => []),
      ])
      const said = new Map(notes.map((n) => [`${n.transactionHash}:${(n.args.bidder as string)?.toLowerCase()}`, cleanBidMessage(n.args.message)]))
      return logs
        .map((l) => ({
          bidder: l.args.bidder as Address,
          amount: l.args.amount as bigint,
          hash: l.transactionHash as string,
          block: l.blockNumber as bigint,
          message: said.get(`${l.transactionHash}:${(l.args.bidder as string)?.toLowerCase()}`) || undefined,
        }))
        .reverse()
    },
  })
  return { rows: q.data, failed: q.isError, loading: q.isLoading && !!key }
}
