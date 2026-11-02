import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getPublicClient } from '@wagmi/core'
import { useEffect } from 'react'
import type { Address, PublicClient } from 'viem'
import { getAddress } from 'viem'
import { useAccount } from 'wagmi'

import { chains, wagmiConfig } from '@/config/wagmi'
import { miyamintsAddresses } from '@/constants/contracts'
import { fetchMetadata } from '@/music/discovery'
import { resolveUri } from '@/utils/resolveUri'

import { auctionInstanceAbi, dropInstanceAbi, erc1155InstanceAbi, ownerAbi, registryAbi } from './abi'
import type { LaunchKind, LaunchRef } from './collections'
import { keyOf, kindFromFactory, mergeLaunches, scanRange } from './collections'
import { localLaunches, onLaunchesChange } from './local'

export type MyLaunch = LaunchRef & {
  chainName: string
  name: string
  image?: string
  minted?: bigint
  supply?: bigint
}

/** Registry entries scanned per chain (newest first). Plenty while the registry is young; see open items. */
const REGISTRY_SCAN = 400
const MAX_EDITIONS = 12

const legacyAbi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'maxSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'contractURI', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const

function client(chainId: number): PublicClient | undefined {
  return getPublicClient(wagmiConfig, { chainId: chainId as (typeof chains)[number]['id'] }) as PublicClient | undefined
}

async function imageFrom(uri: string | undefined): Promise<string | undefined> {
  if (!uri) return undefined
  const json = (await fetchMetadata(uri).catch(() => undefined)) as { image?: unknown } | undefined
  const img = typeof json?.image === 'string' ? resolveUri(json.image) : ''
  return img || undefined
}

/** Instances in MiyaRegistry (newest REGISTRY_SCAN) plus locally remembered ones, owned by `owner`. */
async function launchesOnChain(chainId: number, owner: Address): Promise<LaunchRef[]> {
  const c = client(chainId)
  const a = miyamintsAddresses(chainId)
  const local = localLaunches().filter((l) => l.chainId === chainId)
  if (!c || (!a.registry && !local.length)) return []

  let fromRegistry: LaunchRef[] = []
  if (a.registry) {
    const count = Number(await c.readContract({ address: a.registry, abi: registryAbi, functionName: 'instanceCount' }))
    const idx = scanRange(count, REGISTRY_SCAN)
    const addrs = idx.length
      ? await c.multicall({
          allowFailure: false,
          contracts: idx.map((i) => ({
            address: a.registry as Address,
            abi: registryAbi,
            functionName: 'instances' as const,
            args: [BigInt(i)] as const,
          })),
        })
      : []
    fromRegistry = (addrs as Address[]).map((address, n) => ({
      chainId,
      address: getAddress(address),
      kind: 'unknown' as LaunchKind,
      order: idx[n] as number,
      source: 'registry' as const,
    }))
  }

  const candidates = mergeLaunches(
    fromRegistry,
    local.map((l) => ({
      chainId,
      address: l.address,
      kind: l.kind,
      order: -1,
      source: l.kind === 'legacy' ? ('legacy' as const) : ('local' as const),
    }))
  )
  if (!candidates.length) return []

  const reads = await c.multicall({
    allowFailure: true,
    contracts: candidates.flatMap((r) => [
      { address: r.address, abi: ownerAbi, functionName: 'owner' as const },
      { address: a.registry || r.address, abi: registryAbi, functionName: 'factoryOf' as const, args: [r.address] },
    ]),
  })
  return candidates
    .map((r, i) => {
      const own = reads[i * 2]
      const fac = reads[i * 2 + 1]
      const factory = a.registry && fac?.status === 'success' ? (fac.result as string) : undefined
      const kind = r.kind === 'legacy' ? 'legacy' : kindFromFactory(factory, a)
      const ownerOk = own?.status === 'success' && (own.result as string).toLowerCase() === owner.toLowerCase()
      return { ref: { ...r, kind: kind === 'unknown' ? r.kind : kind }, ownerOk }
    })
    .filter((x) => x.ownerOk)
    .map((x) => x.ref)
}

async function details(ref: LaunchRef): Promise<MyLaunch> {
  const c = client(ref.chainId) as PublicClient
  const chainName = chains.find((ch) => ch.id === ref.chainId)?.name || `Chain ${ref.chainId}`
  const base = { ...ref, chainName, name: `${ref.address.slice(0, 6)}…${ref.address.slice(-4)}` }
  try {
    if (ref.kind === 'drop') {
      const [name, minted, supply, contractURI] = await c.multicall({
        allowFailure: false,
        contracts: (['name', 'totalSupply', 'maxSupply', 'contractURI'] as const).map((functionName) => ({
          address: ref.address,
          abi: dropInstanceAbi,
          functionName,
        })),
      })
      return {
        ...base,
        name: name as unknown as string,
        minted: minted as unknown as bigint,
        supply: BigInt(supply as unknown as number),
        image: await imageFrom(contractURI as unknown as string),
      }
    }

    if (ref.kind === 'auction') {
      const [name, next] = await c.multicall({
        allowFailure: false,
        contracts: [
          { address: ref.address, abi: auctionInstanceAbi, functionName: 'name' },
          { address: ref.address, abi: auctionInstanceAbi, functionName: 'nextTokenId' },
        ],
      })
      const pieces = BigInt((next as number) - 1)
      const first =
        pieces > 0n
          ? await c
              .readContract({ address: ref.address, abi: auctionInstanceAbi, functionName: 'getAuction', args: [1] })
              .catch(() => undefined)
          : undefined
      return { ...base, name: name as string, minted: pieces, image: await imageFrom(first?.tokenURI) }
    }

    if (ref.kind === 'editions') {
      const [name, ids] = await c.multicall({
        allowFailure: false,
        contracts: [
          { address: ref.address, abi: erc1155InstanceAbi, functionName: 'name' },
          { address: ref.address, abi: erc1155InstanceAbi, functionName: 'getAllEditionIds' },
        ],
      })
      const list = (ids as readonly bigint[]).slice(0, MAX_EDITIONS)
      const eds = list.length
        ? await c.multicall({
            allowFailure: false,
            contracts: list.map((id) => ({
              address: ref.address,
              abi: erc1155InstanceAbi,
              functionName: 'getEdition' as const,
              args: [id] as const,
            })),
          })
        : []
      type Ed = { minted: bigint; supply: bigint; metadataURI: string }
      const minted = (eds as Ed[]).reduce((s, e) => s + e.minted, 0n)
      const open = (eds as Ed[]).some((e) => e.supply === 0n)
      const supply = open ? undefined : (eds as Ed[]).reduce((s, e) => s + e.supply, 0n)
      return {
        ...base,
        name: name as string,
        minted,
        supply,
        image: await imageFrom((eds as Ed[])[0]?.metadataURI),
      }
    }

    const r = await c.multicall({
      allowFailure: true,
      contracts: (['name', 'totalSupply', 'maxSupply', 'contractURI'] as const).map((functionName) => ({
        address: ref.address,
        abi: legacyAbi,
        functionName,
      })),
    })
    const ok = <T>(i: number) => (r[i]?.status === 'success' ? (r[i]?.result as T) : undefined)
    return {
      ...base,
      name: ok<string>(0) || base.name,
      minted: ok<bigint>(1),
      supply: ok<bigint>(2),
      image: await imageFrom(ok<string>(3)),
    }
  } catch {
    return base
  }
}

/** Every chain with a registry, plus chains with locally remembered launches. */
function chainsToScan(): number[] {
  const withLocal = new Set(localLaunches().map((l) => l.chainId))
  return chains.map((c) => c.id as number).filter((id) => !!miyamintsAddresses(id).registry || withLocal.has(id))
}

/**
 * NFT collections the connected wallet launched or owns on the miyamints contracts (plus legacy collections it
 * opened in Manage), newest first, with name, thumbnail and minted / supply.
 */
export function useMyLaunches() {
  const { address } = useAccount()
  const qc = useQueryClient()
  useEffect(() => onLaunchesChange(() => qc.invalidateQueries({ queryKey: ['my-launches'] })), [qc])
  const q = useQuery({
    queryKey: ['my-launches', address],
    enabled: !!address,
    staleTime: 30_000,
    queryFn: async () => {
      const owner = address as Address
      const perChain = await Promise.all(chainsToScan().map((id) => launchesOnChain(id, owner).catch(() => [])))
      const refs = mergeLaunches(...perChain)
      return Promise.all(refs.map(details))
    },
  })
  return {
    launches: q.data || [],
    loading: q.isLoading && !!address,
    error: q.error as Error | null,
    refetch: q.refetch,
    anyDeployed: chains.some((c) => !!miyamintsAddresses(c.id).registry),
  }
}

export { keyOf }
