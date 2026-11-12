import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { Address } from 'viem'
import { isAddress, zeroAddress } from 'viem'
import { useReadContract, useReadContracts } from 'wagmi'

import { isRevert } from '@/hooks/readFailure'

import type { SupportedChainId } from '@/config/wagmi'
import { miyamintsAddresses } from '@/constants/contracts'
import { fetchOwnedNftsPage, NFT_INDEX_CHAINS, NftIndexOff } from '@/desktop/files/indexer'
import { parseAlchemyOwnedNfts } from '@/desktop/files/indexer/parse'
import { cleanText, sanitizeMetadata } from '@/desktop/files/sanitize'
import { useMetadata } from '@/utils/nftMetadata'
import { resolveUri } from '@/utils/resolveUri'

import { erc721Abi, erc1155Abi, poolAbi, poolFactoryAbi } from './abi'
import type { CommitRow, PoolKind, PoolSummary } from './pool'
import { asKind, heldAmount, KIND, pendingFor, poolIndexes, poolLookup } from './pool'

/** The MiyaPoolFactory on a chain, from env or contracts/deployments (undefined = not deployed there yet). */
export const poolFactoryFor = (chainId: number): Address | undefined => miyamintsAddresses(chainId).miyaPoolFactory

/** How many pools the list loads (newest first). Search by collection address finds older ones. */
const LIST_LIMIT = 60
/** How many recent random-redeem commits are checked for the connected wallet. */
const COMMIT_SCAN = 100
/** Alchemy getNFTsForOwner page size, and how many pages are followed before saying the list is partial. */
const OWNED_PAGE = 100
const OWNED_MAX_PAGES = 10
export const HELD_PAGE = 24

const ok = <T>(r: { status: string; result?: unknown } | undefined) =>
  r && r.status === 'success' ? (r.result as T) : undefined

export type Pool = PoolSummary & { address: Address; collection: Address; supply?: bigint }

const fields = [
  'collection',
  'kind',
  'premiumBps',
  'randomEnabled',
  'name',
  'symbol',
  'heldUnits',
  'totalSupply',
] as const

/** Reads the summary of each pool address (collection, kind, premium, random redeems, names, NFTs held). */
function usePoolSummaries(chainId: SupportedChainId, addresses: Address[]) {
  const reads = useReadContracts({
    allowFailure: true,
    contracts: addresses.flatMap((address) =>
      fields.map((functionName) => ({ address, abi: poolAbi, functionName, chainId }))
    ),
    query: { enabled: addresses.length > 0 },
  })
  const collections = addresses.map((_, i) => ok<Address>(reads.data?.[i * fields.length]))
  const names = useReadContracts({
    allowFailure: true,
    contracts: collections.map((address) => ({
      address: address || zeroAddress,
      abi: erc721Abi,
      functionName: 'name' as const,
      chainId,
    })),
    query: { enabled: collections.some(Boolean) },
  })

  const pools = useMemo(() => {
    const out: Pool[] = []
    addresses.forEach((address, i) => {
      const r = (k: number) => reads.data?.[i * fields.length + k]
      const collection = ok<Address>(r(0))
      const kind = asKind(ok<number>(r(1)))
      if (!collection || kind === undefined) return
      // A failed premium or random read stays unknown: the pool is still shown, and what needs it waits for a re-read.
      const premium = ok<number>(r(2))
      const random = ok<boolean>(r(3))
      out.push({
        address,
        collection,
        kind,
        premiumBps: typeof premium === 'number' ? premium : undefined,
        randomEnabled: typeof random === 'boolean' ? random : undefined,
        name: cleanText(ok<string>(r(4)), 80),
        symbol: cleanText(ok<string>(r(5)), 24) || 'mNFT',
        held: ok<bigint>(r(6)),
        supply: ok<bigint>(r(7)),
        collectionName: cleanText(ok<string>(names.data?.[i]), 80) || undefined,
      })
    })
    return out
  }, [addresses, reads.data, names.data])

  return { pools, loading: reads.isLoading, error: reads.error, refetch: reads.refetch }
}

/** The newest pools of the factory on `chainId`. */
export function usePools(chainId: SupportedChainId, factory: Address | undefined) {
  const length = useReadContract({
    address: factory,
    abi: poolFactoryAbi,
    functionName: 'allPoolsLength',
    chainId,
    query: { enabled: !!factory },
  })
  const total = length.data === undefined ? undefined : Number(length.data)
  const indexes = useMemo(() => poolIndexes(total ?? 0, LIST_LIMIT), [total])
  const list = useReadContracts({
    allowFailure: true,
    contracts: indexes.map((i) => ({
      address: factory,
      abi: poolFactoryAbi,
      functionName: 'allPools' as const,
      args: [BigInt(i)] as const,
      chainId,
    })),
    query: { enabled: !!factory && indexes.length > 0 },
  })
  const addresses = useMemo(
    () => (list.data || []).map((r) => ok<Address>(r)).filter((a): a is Address => !!a),
    [list.data]
  )
  const summaries = usePoolSummaries(chainId, addresses)
  return {
    total,
    pools: summaries.pools,
    loading: length.isLoading || list.isLoading || summaries.loading,
    error: length.error || list.error || summaries.error,
    refetch: () => {
      length.refetch()
      list.refetch()
      summaries.refetch()
    },
  }
}

/**
 * The factory's alignment vault on `chainId`: where pick premiums are sold to. address(0) means this chain has none, so
 * a new pool's premium must be 0. Undefined while loading or when the read failed.
 */
export function useFactoryVault(chainId: SupportedChainId, factory: Address | undefined) {
  const q = useReadContract({
    address: factory,
    abi: poolFactoryAbi,
    functionName: 'vault',
    chainId,
    query: { enabled: !!factory, staleTime: Infinity },
  })
  return { vault: q.data as Address | undefined, loading: q.isLoading, failed: q.isError, refetch: q.refetch }
}

/** A collection address's pool (one per collection), for finding a pool past the list or offering to create one. */
export function usePoolsForCollection(chainId: SupportedChainId, factory: Address | undefined, query: string) {
  const collection = isAddress(query.trim()) ? (query.trim() as Address) : undefined
  const read = useReadContract({
    address: factory,
    abi: poolFactoryAbi,
    functionName: 'poolOf',
    args: [collection || zeroAddress],
    chainId,
    query: { enabled: !!factory && !!collection },
  })
  const found = poolLookup(read.data as string | undefined)
  const foundAddress = found.state === 'found' ? (found.address as Address) : undefined
  const addresses = useMemo(() => (foundAddress ? [foundAddress] : []), [foundAddress])
  const summaries = usePoolSummaries(chainId, addresses)
  return {
    collection,
    /** The collection's pool, as a one-item list (empty when it has none, or while it loads). */
    pools: summaries.pools,
    /** The factory says this collection has no pool yet (false until the lookup is done; a failed read is never free). */
    free: !!collection && !!factory && found.state === 'none' && !read.isError,
    /** The lookup failed, so "no pool" can't be told apart from "couldn't check". */
    checkFailed: !!collection && !!factory && (read.isError || (!read.isLoading && found.state === 'unknown')),
    loading: read.isLoading || summaries.loading,
    refetch: () => {
      read.refetch()
      summaries.refetch()
    },
  }
}

/** One pool, with the connected wallet's pool-token balance. */
export function usePool(chainId: SupportedChainId, pool: Address | undefined, owner: Address | undefined) {
  const addresses = useMemo(() => (pool ? [pool] : []), [pool])
  const summary = usePoolSummaries(chainId, addresses)
  const extra = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: pool, abi: poolAbi, functionName: 'heldIdsCount', chainId },
      { address: pool, abi: poolAbi, functionName: 'pendingUnits', chainId },
      { address: pool, abi: poolAbi, functionName: 'nextCommitId', chainId },
      { address: pool, abi: poolAbi, functionName: 'nextRevealId', chainId },
      { address: pool, abi: poolAbi, functionName: 'balanceOf', args: [owner || zeroAddress], chainId },
      { address: pool, abi: poolAbi, functionName: 'premiumPerUnit', chainId },
    ],
    query: { enabled: !!pool },
  })
  const [count, pending, nextCommit, nextReveal, balance, perUnit] = extra.data || []
  return {
    pool: summary.pools[0],
    /** Undefined when the read failed: the held list can't be paged without it. */
    heldIdsCount: ok<bigint>(count) === undefined ? undefined : Number(ok<bigint>(count)),
    /** Undefined when the read failed: free NFTs for a random draw are then unknown. */
    pendingUnits: ok<bigint>(pending),
    nextCommitId: ok<bigint>(nextCommit),
    nextRevealId: ok<bigint>(nextReveal),
    balance: owner ? ok<bigint>(balance) : undefined,
    /** Pool-token base units a pick burns per piece on top of the 1 token; undefined when the read failed. */
    premiumPerUnit: ok<bigint>(perUnit),
    loading: summary.loading || extra.isLoading,
    missing: !summary.loading && !extra.isLoading && !summary.pools[0],
    refetch: () => {
      summary.refetch()
      extra.refetch()
    },
  }
}

/** Ids held by a pool, `pages` pages of HELD_PAGE; ERC1155 pools also return units per id. */
export function useHeldIds(
  chainId: SupportedChainId,
  pool: Pool | undefined,
  count: number | undefined,
  pages: number
) {
  const want = Math.min(count ?? 0, pages * HELD_PAGE)
  const ids = useReadContract({
    address: pool?.address,
    abi: poolAbi,
    functionName: 'heldIds',
    args: [0n, BigInt(want)],
    chainId,
    query: { enabled: !!pool && want > 0 },
  })
  const list = useMemo(() => (want > 0 ? [...(ids.data || [])] : []), [ids.data, want])
  const units = useReadContracts({
    allowFailure: true,
    contracts: list.map((id) => ({
      address: pool?.address,
      abi: poolAbi,
      functionName: 'unitsOf' as const,
      args: [id] as const,
      chainId,
    })),
    query: { enabled: !!pool && pool.kind === KIND.ERC1155 && list.length > 0 },
  })
  // A pending random redeem locks the ids it could draw against picking. Only random pools have locks.
  const locks = useReadContracts({
    allowFailure: true,
    contracts: list.map((id) => ({
      address: pool?.address,
      abi: poolAbi,
      functionName: 'isLocked' as const,
      args: [id] as const,
      chainId,
    })),
    query: { enabled: !!pool && pool.randomEnabled === true && list.length > 0 },
  })
  return {
    ids: list,
    unitsOf: (i: number) => (pool?.kind === KIND.ERC1155 ? ok<bigint>(units.data?.[i]) : 1n),
    /** Whether a pending random redeem has locked the id at `i` (undefined: the read failed or is loading). */
    lockedAt: (i: number): boolean | undefined =>
      pool?.randomEnabled === false ? false : ok<boolean>(locks.data?.[i]),
    loading: ids.isLoading,
    /** The list couldn't be read (count or ids), so an empty list is not "the pool is empty". */
    failed: count === undefined || ids.isError,
    more: want < (count ?? 0),
    refetch: () => {
      ids.refetch()
      units.refetch()
      locks.refetch()
    },
  }
}

/** Name and image of one NFT, from tokenURI (ERC721) or uri (ERC1155). Metadata is untrusted: it is sanitized. */
export function useNftMeta(chainId: SupportedChainId, collection: Address | undefined, kind: PoolKind, id: bigint) {
  const uri = useReadContract({
    address: collection,
    abi: kind === KIND.ERC721 ? erc721Abi : erc1155Abi,
    functionName: kind === KIND.ERC721 ? 'tokenURI' : 'uri',
    args: [id],
    chainId,
    query: { enabled: !!collection, staleTime: Infinity },
  })
  const raw = typeof uri.data === 'string' ? uri.data : undefined
  // ERC1155 {id}: lowercase hex, zero-padded to 64 characters.
  const filled = raw?.replace(/\{id\}/g, id.toString(16).padStart(64, '0'))
  const meta = useMetadata(filled)
  const clean = meta.data ? sanitizeMetadata(meta.data, resolveUri) : undefined
  return { name: clean?.name, image: clean?.image, loading: uri.isLoading || meta.isLoading }
}

/**
 * Open random-redeem draws that send NFTs to `owner`. Draws settle in order, so only ids from nextRevealId up can be
 * open: those are scanned, newest first, up to COMMIT_SCAN (`partial` when more are open than that).
 */
export function useMyCommits(
  chainId: SupportedChainId,
  pool: Address | undefined,
  nextCommitId: bigint | undefined,
  owner: Address | undefined,
  nextRevealId?: bigint
) {
  const ids = useMemo(() => {
    if (nextCommitId === undefined) return []
    const from = nextRevealId !== undefined && nextRevealId < nextCommitId ? nextRevealId : 0n
    const open = Number(nextCommitId - from)
    return Array.from({ length: Math.min(open, COMMIT_SCAN) }, (_, i) => nextCommitId - 1n - BigInt(i))
  }, [nextCommitId, nextRevealId])
  const partial =
    nextCommitId !== undefined &&
    Number(nextCommitId - (nextRevealId !== undefined && nextRevealId < nextCommitId ? nextRevealId : 0n)) > COMMIT_SCAN
  const reads = useReadContracts({
    allowFailure: true,
    contracts: ids.map((id) => ({
      address: pool,
      abi: poolAbi,
      functionName: 'commits' as const,
      args: [id] as const,
      chainId,
    })),
    query: { enabled: !!pool && !!owner && ids.length > 0 },
  })
  const commits = useMemo(() => {
    const rows: (CommitRow | undefined)[] = ids.map((id, i) => {
      const r = ok<readonly [Address, bigint, number, number]>(reads.data?.[i])
      return r ? { id, recipient: r[0], targetBlock: r[1], amount: r[2] } : undefined
    })
    return pendingFor(rows, owner)
  }, [ids, reads.data, owner])
  const failed = !!reads.error || (reads.data?.some((r) => r.status !== 'success') ?? false)
  return { commits, partial, failed, refetch: reads.refetch }
}

/**
 * The wallet's NFTs in one collection, when an indexer can list them (Alchemy through the Worker, Ethereum only).
 * `supported: false` means "type the token numbers instead".
 */
export function useOwnedInCollection(chainId: number, collection: Address | undefined, owner: Address | undefined) {
  const q = useQuery({
    queryKey: ['trade-owned', chainId, collection, owner],
    enabled: NFT_INDEX_CHAINS.has(chainId) && !!collection && !!owner,
    staleTime: 30_000,
    // The Worker has no index key: nothing to retry.
    retry: (count, error) => !(error instanceof NftIndexOff) && count < 2,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ owner: owner as string, withMetadata: 'true', pageSize: String(OWNED_PAGE) })
      params.append('contractAddresses[]', collection as string)
      const nfts: ReturnType<typeof parseAlchemyOwnedNfts>['nfts'] = []
      let pageKey: string | undefined
      for (let page = 0; page < OWNED_MAX_PAGES; page += 1) {
        if (pageKey) params.set('pageKey', pageKey)
        // eslint-disable-next-line no-await-in-loop -- each page needs the previous page's key
        const body = (await fetchOwnedNftsPage(chainId, params, signal)) as { pageKey?: unknown }
        nfts.push(...parseAlchemyOwnedNfts(body, chainId, { sanitize: sanitizeMetadata, cleanText, resolve: resolveUri }).nfts)
        pageKey = typeof body?.pageKey === 'string' && body.pageKey ? body.pageKey : undefined
        if (!pageKey) return { nfts, partial: false }
      }
      return { nfts, partial: true }
    },
  })
  // Served on this chain, and the Worker has its index key (until it says otherwise).
  const supported = NFT_INDEX_CHAINS.has(chainId) && !(q.error instanceof NftIndexOff)
  return {
    supported,
    nfts: q.data?.nfts,
    /** More pages exist than were read: the list is not every NFT in the wallet. */
    partial: !!q.data?.partial,
    loading: q.isLoading && supported,
    error: q.error,
    refetch: q.refetch,
  }
}

/**
 * Checks that `owner` holds each id. ERC721: ownerOf. ERC1155: the balance per id.
 * Returns the held amount per id (0n when not held, undefined while loading or when the read failed).
 */
export function useOwnership(
  chainId: SupportedChainId,
  collection: Address | undefined,
  kind: PoolKind,
  owner: Address | undefined,
  ids: bigint[]
) {
  const reads = useReadContracts({
    allowFailure: true,
    contracts: ids.map((id) =>
      kind === KIND.ERC721
        ? { address: collection, abi: erc721Abi, functionName: 'ownerOf' as const, args: [id] as const, chainId }
        : {
            address: collection,
            abi: erc1155Abi,
            functionName: 'balanceOf' as const,
            args: [owner || zeroAddress, id] as const,
            chainId,
          }
    ),
    query: { enabled: !!collection && !!owner && ids.length > 0 },
  })
  // A revert (e.g. ownerOf on a burned id) is a real "not held"; an RPC failure stays unknown.
  const held = ids.map((_, i) => {
    const r = reads.data?.[i]
    return heldAmount(
      r && (r.status === 'success' ? { status: 'success', result: r.result } : { status: 'failure', reverted: isRevert(r.error) }),
      kind === KIND.ERC721,
      owner
    )
  })
  const failed = !!reads.error || (!!reads.data && held.some((h) => h === undefined))
  return { held, loading: reads.isLoading, failed, refetch: reads.refetch }
}

/** Whether `operator` (the pool) may move the owner's NFTs in this collection. */
export function useApprovedForAll(
  chainId: SupportedChainId,
  collection: Address | undefined,
  owner: Address | undefined,
  operator: Address | undefined
) {
  const q = useReadContract({
    address: collection,
    abi: erc721Abi,
    functionName: 'isApprovedForAll',
    args: [owner || zeroAddress, operator || zeroAddress],
    chainId,
    query: { enabled: !!collection && !!owner && !!operator },
  })
  return { approved: q.data as boolean | undefined, refetch: q.refetch }
}

/** How often the premium-lot price is re-read: it falls continuously while a lot is for sale. */
const LOT_REFRESH_MS = 30_000

/**
 * A pool's premium lots: the reserve of premium tokens, whether a whole token is for sale, and its ETH price now.
 * Every field is undefined when its read failed.
 */
export function usePremiumLots(chainId: SupportedChainId, pool: Address | undefined, enabled = true) {
  const reads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: pool, abi: poolAbi, functionName: 'premiumReserve', chainId },
      { address: pool, abi: poolAbi, functionName: 'lotAvailable', chainId },
      { address: pool, abi: poolAbi, functionName: 'lotPrice', chainId },
    ],
    query: { enabled: !!pool && enabled, refetchInterval: LOT_REFRESH_MS },
  })
  const [reserve, available, price] = reads.data || []
  return {
    reserve: ok<bigint>(reserve),
    available: ok<boolean>(available),
    /** Wei. When no lot is for sale: what the next one will start at. */
    price: ok<bigint>(price),
    loading: reads.isLoading,
    failed: !!reads.error || (reads.data?.some((r) => r.status !== 'success') ?? false),
    refetch: reads.refetch,
  }
}

/**
 * The oldest unrevealed random draw (anyone's): while it is pending, the NFTs it could get are locked against picking.
 * Anyone can reveal it from the block after its target block. `none` when no draw is pending.
 */
export function useNextDraw(
  chainId: SupportedChainId,
  pool: Address | undefined,
  nextRevealId: bigint | undefined,
  nextCommitId: bigint | undefined
) {
  const pending = nextRevealId !== undefined && nextCommitId !== undefined && nextRevealId < nextCommitId
  const q = useReadContract({
    address: pool,
    abi: poolAbi,
    functionName: 'commits',
    args: [nextRevealId ?? 0n],
    chainId,
    query: { enabled: !!pool && pending },
  })
  const r = q.data as readonly [Address, bigint, number, number] | undefined
  const draw: CommitRow | undefined =
    pending && r && r[2] > 0 ? { id: nextRevealId!, recipient: r[0], targetBlock: r[1], amount: r[2] } : undefined
  return {
    none: nextRevealId !== undefined && nextCommitId !== undefined && !pending,
    draw,
    failed: q.isError,
    refetch: q.refetch,
  }
}
