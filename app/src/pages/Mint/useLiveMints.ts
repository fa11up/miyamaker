import { useQuery } from '@tanstack/react-query'
import { useMemo, useRef } from 'react'
import type { Abi, Address } from 'viem'
import { parseAbi } from 'viem'
import { useReadContracts } from 'wagmi'

import type { SupportedChainId } from '@/config/wagmi'
import { chains } from '@/config/wagmi'
import { miyamintsAddresses } from '@/constants/contracts'
import type { DropPhase, LiveMintCard, LiveMintEntry, LiveMintReads, LivePhase, ReadAnswer } from '@/pages/Mint/liveMints'
import {
  activePublicPhase,
  livePhases,
  buildLiveMintList,
  entryKey,
  isLiveAddress,
  LIVE_MINTS,
  mergeReads,
  readKey,
  registryEntry,
} from '@/pages/Mint/liveMints'
import { knownToken, tokenLabel } from '@/miyamints/tokens'
import { fetchMetadataJson } from '@/utils/nftMetadata'
import { parseJsonDataUri, resolveUri } from '@/utils/resolveUri'

import { dropAbi } from './dropAbi'
import { erc721mAbi } from './Miyamini/abi'

export { dropAbi }

const registryAbi = parseAbi([
  'function instanceCount() view returns (uint256)',
  'function instances(uint256) view returns (address)',
  'function factoryOf(address) view returns (address)',
])

/** How many registry collections the home page looks at (newest first). */
const REGISTRY_LIMIT = 24
const REFRESH_MS = 30_000
/** How many values erc721mCalls and dropCalls read per collection. */
const READS_PER_COLLECTION = { erc721m: 5, drop: 8 } as const

const nowSec = () => Math.floor(Date.now() / 1000)

/** A read call with the chain id and function name loosened: the lists below mix ABIs and chains. */
type Call = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; chainId: SupportedChainId }
const call = (address: Address, abi: Abi, chainId: number, functionName: string, args?: readonly unknown[]): Call => ({
  address,
  abi,
  chainId: chainId as SupportedChainId,
  functionName,
  args,
})

/** erc721m: name, price, totalSupply, maxSupply, mintOpen. */
export const erc721mCalls = (a: Address, chainId: number) =>
  ['name', 'price', 'totalSupply', 'maxSupply', 'mintOpen'].map((f) => call(a, erc721mAbi, chainId, f))

/** miyamints drop: name, totalSupply, maxSupply, phases, contractURI, phasesMinted, publicRemaining, owner. */
export const dropCalls = (a: Address, chainId: number) =>
  ['name', 'totalSupply', 'maxSupply', 'phases', 'contractURI', 'phasesMinted', 'publicRemaining', 'owner'].map((f) =>
    call(a, dropAbi, chainId, f)
  )

export type ReadResult = { status: 'success' | 'failure'; result?: unknown } | undefined

/**
 * `data` from useReadContracts over `calls`, with each read's last good answer kept through a failed refetch
 * (mergeReads). `isError`: nothing good yet and the last try failed (or every read in it did).
 */
export function useStickyReads(
  calls: readonly { chainId?: number; address: string; functionName: string; args?: readonly unknown[] }[],
  q: { data?: readonly ReadAnswer[]; isError: boolean }
) {
  const memory = useRef(new Map<string, ReadAnswer>())
  const keys = calls.map(readKey)
  const joined = keys.join('|')
  return useMemo(() => {
    const m = mergeReads(memory.current, keys, q.data)
    return { data: m.results, isError: (q.isError || m.allFailed) && !m.everGood }
  }, [joined, q.data, q.isError])
}
const ok = <T>(r: ReadResult) => (r?.status === 'success' ? (r.result as T) : undefined)
const num = (v: bigint | number | undefined) => (v !== undefined ? Number(v) : undefined)

/** Turns the raw results for one collection into reads (the order matches erc721mCalls / dropCalls). */
export function readsFromResults(
  kind: LiveMintEntry['kind'],
  r: ReadResult[],
  chainId = 1
): LiveMintReads & { phaseId?: number; maxPerWallet?: number; livePhases?: LivePhase[] } {
  if (kind === 'erc721m') {
    return {
      name: ok<string>(r[0]),
      price: ok<bigint>(r[1]),
      totalSupply: num(ok<bigint>(r[2])),
      maxSupply: num(ok<bigint>(r[3])),
      mintOpen: ok<boolean>(r[4]),
    }
  }

  const phases = ok<readonly DropPhase[]>(r[3])
  const sold = ok<readonly bigint[]>(r[5])
  const live = activePublicPhase(phases, nowSec(), sold)
  const all = livePhases(phases, nowSec(), sold)
  // No public phase on: a list phase with room is what the card shows (its price, and open).
  const list = live ? undefined : all.find((p) => p.isList && p.left !== 0)
  const shown = live ?? list
  const publicRemaining = num(ok<bigint>(r[6]))
  return {
    name: ok<string>(r[0]),
    totalSupply: num(ok<bigint>(r[1])),
    maxSupply: num(ok<number>(r[2])),
    price: shown?.price,
    prices: shown?.prices,
    priceLabel: shown && shown.price === undefined ? priceLabelOf(shown.prices, chainId) : undefined,
    // Without the sold counts and public supply we can't say whether a phase still has pieces.
    mintOpen: phases && sold && publicRemaining !== undefined ? !!shown : undefined,
    livePhases: phases ? all : undefined,
    contractURI: ok<string>(r[4]),
    phaseId: live?.phaseId,
    maxPerWallet: live?.maxPerWallet,
    publicRemaining,
    owner: ok<`0x${string}`>(r[7]),
    // What the live phase can still sell: its own cap or the public supply, whichever runs out first.
    left:
      shown?.left !== undefined && publicRemaining !== undefined
        ? Math.min(shown.left, publicRemaining)
        : publicRemaining,
  }
}

/** "25 USDC" for a phase that doesn't sell for ETH: the first token we know the decimals of. */
function priceLabelOf(prices: readonly { token: string; price: bigint }[], chainId: number): string | undefined {
  for (const p of prices) {
    const t = knownToken(chainId, p.token)
    if (t) return p.price === 0n ? 'Free' : tokenLabel(p.price, t)
  }
  return undefined
}

/** Collections registered in MiyaRegistry by the ERC721 drop factory, on every chain where miyamints is deployed. */
function useRegistryDrops() {
  const targets = useMemo(
    () =>
      chains
        .map((c) => ({ chainId: c.id as number, ...miyamintsAddresses(c.id) }))
        .filter(
          (t): t is typeof t & { registry: Address; erc721DropFactory: Address } =>
            !!t.registry && !!t.erc721DropFactory
        ),
    []
  )

  const counts = useReadContracts({
    contracts: targets.map((t) => call(t.registry, registryAbi, t.chainId, 'instanceCount')),
    query: { enabled: targets.length > 0, staleTime: REFRESH_MS },
  })

  const slots = useMemo(() => {
    const out: { chainId: number; registry: Address; factory: Address; index: bigint }[] = []
    targets.forEach((t, ti) => {
      const n = Number(ok<bigint>(counts.data?.[ti] as ReadResult) ?? 0n)
      for (let i = n - 1; i >= 0 && i >= n - REGISTRY_LIMIT; i--) {
        out.push({ chainId: t.chainId, registry: t.registry, factory: t.erc721DropFactory, index: BigInt(i) })
      }
    })
    return out
  }, [targets, counts.data])

  const instances = useReadContracts({
    contracts: slots.map((s) => call(s.registry, registryAbi, s.chainId, 'instances', [s.index])),
    query: { enabled: slots.length > 0, staleTime: REFRESH_MS },
  })

  const found = useMemo(
    () =>
      slots
        .map((s, i) => ({ ...s, instance: ok<Address>(instances.data?.[i] as ReadResult) }))
        .filter((s): s is typeof s & { instance: Address } => !!s.instance),
    [slots, instances.data]
  )

  const factories = useReadContracts({
    contracts: found.map((s) => call(s.registry, registryAbi, s.chainId, 'factoryOf', [s.instance])),
    query: { enabled: found.length > 0, staleTime: REFRESH_MS },
  })

  return useMemo(
    () =>
      found
        .filter((s, i) => ok<Address>(factories.data?.[i] as ReadResult)?.toLowerCase() === s.factory.toLowerCase())
        .map((s) => ({ chainId: s.chainId, address: s.instance })),
    [found, factories.data]
  )
}

/** Cover image from a contractURI (data: JSON or a fetched URI). Cached for the session. */
export function useContractImage(contractURI: string | undefined) {
  return useQuery({
    queryKey: ['contract-image', contractURI],
    enabled: !!contractURI,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const uri = contractURI as string
      const json = uri.startsWith('data:')
        ? parseJsonDataUri<{ image?: string }>(uri)
        : await fetchMetadataJson<{ image?: string }>(uri)
      return resolveUri(json?.image) || null
    },
  })
}

/**
 * Every live mint card: curated entries (LIVE_MINTS) plus drops discovered in MiyaRegistry, with on-chain reads.
 * A failed read (RPC down, contract missing) degrades that card to "unknown" instead of erroring the page.
 */
export function useLiveMints() {
  const readable = useMemo(() => LIVE_MINTS.filter((e) => isLiveAddress(e.address)), [])
  const curatedCalls = useMemo(
    () =>
      readable.flatMap((e) =>
        e.kind === 'erc721m' ? erc721mCalls(e.address as Address, e.chainId) : dropCalls(e.address as Address, e.chainId)
      ),
    [readable]
  )
  const curatedQuery = useReadContracts({
    contracts: curatedCalls,
    query: { refetchInterval: REFRESH_MS, staleTime: REFRESH_MS / 2 },
  })
  // A poll that fails keeps each card's last good reads: one bad answer must not turn every card "unknown".
  const curatedReads = useStickyReads(curatedCalls, curatedQuery as { data?: readonly ReadAnswer[]; isError: boolean })

  const discovered = useRegistryDrops()
  // The last name each registry drop read back. A card's slug is made from its name, so a later read that fails must
  // not rename it to its address: the open collection would no longer be found, and Mint would drop to the menu.
  const knownNames = useRef(new Map<string, string>())
  const registryCalls = useMemo(() => discovered.flatMap((d) => dropCalls(d.address, d.chainId)), [discovered])
  const registryQuery = useReadContracts({
    contracts: registryCalls,
    query: { enabled: discovered.length > 0, refetchInterval: REFRESH_MS, staleTime: REFRESH_MS / 2 },
  })
  const registryReads = useStickyReads(registryCalls, registryQuery as { data?: readonly ReadAnswer[]; isError: boolean })

  const cards: LiveMintCard[] = useMemo(() => {
    const byKey: Record<string, LiveMintReads | undefined> = {}
    let at = 0
    readable.forEach((e) => {
      const next = at + READS_PER_COLLECTION[e.kind]
      byKey[entryKey(e)] = curatedReads.data
        ? readsFromResults(e.kind, curatedReads.data.slice(at, next) as ReadResult[], e.chainId)
        : undefined
      at = next
    })

    const registry = discovered.map((d, i) => {
      const n = READS_PER_COLLECTION.drop
      const reads = registryReads.data
        ? readsFromResults('drop', registryReads.data.slice(i * n, (i + 1) * n) as ReadResult[], d.chainId)
        : undefined
      const key = `${d.chainId}:${d.address.toLowerCase()}`
      if (reads?.name) knownNames.current.set(key, reads.name)
      return { entry: registryEntry(d.chainId, d.address, reads?.name || knownNames.current.get(key)), reads }
    })

    return buildLiveMintList(LIVE_MINTS, byKey, registry)
  }, [readable, curatedReads.data, registryReads.data, discovered])

  return {
    cards,
    isLoading: curatedQuery.isLoading,
    isError: curatedReads.isError,
  }
}
