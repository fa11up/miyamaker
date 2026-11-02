/* eslint-disable no-restricted-syntax, no-continue, no-await-in-loop, no-plusplus -- bounded, sequential RPC/parse loops read clearer as loops */
import type { Address, PublicClient } from 'viem'
import { parseAbi, parseAbiItem } from 'viem'

import { resolveUri } from '@/utils/resolveUri'

import { cleanText, decodeDataJson, safeImageUrl, sanitizeMetadata } from '../sanitize'
import { heldFromOwnerSweep, heldFromTransfers, logChunks } from './parse'
import type { KnownCollection, NftIndexer, OwnedNft } from './types'

const erc721 = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
])
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')

const MAX_PER_COLLECTION = 200
const MAX_SWEEP = 5000
const SWEEP_BATCH = 500
const LOG_CHUNK = 10_000n
const LOG_MAX_CHUNKS = 30
const META_CONCURRENCY = 6
const META_TIMEOUT_MS = 8000

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), META_TIMEOUT_MS)
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
    if (!res.ok) return undefined
    const len = Number(res.headers.get('content-length') || 0)
    if (len > 512_000) return undefined
    return await res.json()
  } catch {
    return undefined
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const index = i++
      out[index] = await fn(items[index]!)
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * Indexer-free fallback: asks the chain directly, but only for collections we know about
 * (see desktop/collections.ts). Finds token ids with tokenOfOwnerByIndex (ERC721Enumerable),
 * an ownerOf multicall sweep (small collections) or a bounded Transfer-log scan.
 */
export function createOnchainIndexer(client: PublicClient, collections: KnownCollection[]): NftIndexer {
  const chainId = client.chain?.id ?? 1
  const mine = collections.filter((c) => c.chainId === chainId && /^0x[0-9a-f]{40}$/i.test(c.address))

  async function tokenIds(
    c: KnownCollection,
    owner: Address,
    balance: number
  ): Promise<{ ids: string[]; partial: boolean }> {
    const address = c.address as Address
    const want = Math.min(balance, MAX_PER_COLLECTION)

    if (c.strategy === 'enumerable') {
      const res = await client.multicall({
        allowFailure: true,
        contracts: Array.from({ length: want }, (_, i) => ({
          address,
          abi: erc721,
          functionName: 'tokenOfOwnerByIndex' as const,
          args: [owner, BigInt(i)] as const,
        })),
      })
      const ids = res.filter((r) => r.status === 'success').map((r) => String(r.result))
      return { ids, partial: balance > want }
    }

    if (c.strategy === 'sweep') {
      let last = c.sweepMax
      if (last === undefined) {
        const supply = await client
          .readContract({ address, abi: erc721, functionName: 'totalSupply' })
          .catch(() => undefined)
        // Slack for burned tokens (ids keep counting up while totalSupply drops).
        last = supply !== undefined ? Number(supply) + 25 : 1000
      }

      const first = c.firstTokenId ?? 0
      const count = Math.min(MAX_SWEEP, Math.max(0, last - first + 1))
      const found: string[] = []
      for (let start = 0; start < count && found.length < want; start += SWEEP_BATCH) {
        const ids = Array.from({ length: Math.min(SWEEP_BATCH, count - start) }, (_, i) => BigInt(first + start + i))
        const res = await client.multicall({
          allowFailure: true,
          contracts: ids.map((id) => ({ address, abi: erc721, functionName: 'ownerOf' as const, args: [id] as const })),
        })
        found.push(...heldFromOwnerSweep(ids, res as { status: 'success' | 'failure'; result?: unknown }[], owner))
      }

      return { ids: found.slice(0, want), partial: found.length < balance }
    }

    // 'logs': replay transfers in bounded chunks (newest first), then confirm with ownerOf.
    const latest = await client.getBlockNumber()
    const { chunks, partial } = logChunks(c.fromBlock ?? 0n, latest, LOG_CHUNK, LOG_MAX_CHUNKS)
    const transfers: Parameters<typeof heldFromTransfers>[0] = []
    for (const range of chunks) {
      const [inbound, outbound] = await Promise.all([
        client.getLogs({ address, event: TRANSFER, args: { to: owner }, ...range }),
        client.getLogs({ address, event: TRANSFER, args: { from: owner }, ...range }),
      ])
      for (const l of [...inbound, ...outbound]) {
        transfers.push({ ...l.args, blockNumber: l.blockNumber, logIndex: l.logIndex })
      }
    }

    const candidates = heldFromTransfers(transfers, owner)
      .slice(0, want)
      .map((id) => BigInt(id))
    const owners = await client.multicall({
      allowFailure: true,
      contracts: candidates.map((id) => ({
        address,
        abi: erc721,
        functionName: 'ownerOf' as const,
        args: [id] as const,
      })),
    })
    const ids = heldFromOwnerSweep(candidates, owners as { status: 'success' | 'failure'; result?: unknown }[], owner)
    return { ids, partial: partial || ids.length < balance }
  }

  async function describe(c: KnownCollection, ids: string[], signal?: AbortSignal): Promise<OwnedNft[]> {
    const base = (id: string): OwnedNft => ({
      chainId,
      contract: c.address.toLowerCase(),
      collectionName: cleanText(c.name, 80),
      tokenId: id,
      name: `${cleanText(c.name, 80)} #${id}`,
      description: '',
      image: c.imageFor ? safeImageUrl(c.imageFor(id)) : '',
      externalUrl: '',
    })
    // Collections with a known image convention skip tokenURI/JSON (their hosts often lack CORS).
    if (c.imageFor) return ids.map(base)

    const uris = await client.multicall({
      allowFailure: true,
      contracts: ids.map((id) => ({
        address: c.address as Address,
        abi: erc721,
        functionName: 'tokenURI' as const,
        args: [BigInt(id)] as const,
      })),
    })
    return mapLimit(ids, META_CONCURRENCY, async (id) => {
      const nft = base(id)
      const idx = ids.indexOf(id)
      const uri = uris[idx]?.status === 'success' ? String(uris[idx]!.result) : ''
      if (!uri) return nft
      const url = uri.startsWith('data:') ? '' : safeImageUrl(uri, resolveUri)
      const raw = uri.startsWith('data:') ? decodeDataJson(uri) : url ? await fetchJson(url, signal) : undefined
      if (!raw) return nft
      const meta = sanitizeMetadata(raw, resolveUri)
      return {
        ...nft,
        name: meta.name || nft.name,
        description: meta.description,
        image: meta.image || nft.image,
        externalUrl: meta.externalUrl,
      }
    })
  }

  return {
    id: 'onchain',
    label: 'On-chain (known collections)',
    async getNftsForOwner(owner, { signal }) {
      const who = owner as Address
      const balances = await client.multicall({
        allowFailure: true,
        contracts: mine.map((c) => ({
          address: c.address as Address,
          abi: erc721,
          functionName: 'balanceOf' as const,
          args: [who] as const,
        })),
      })
      const nfts: OwnedNft[] = []
      let partial = false
      for (let i = 0; i < mine.length; i++) {
        if (signal?.aborted) break
        const c = mine[i]!
        const r = balances[i]
        const balance = r?.status === 'success' ? Number(r.result) : 0
        if (!balance) continue
        try {
          const found = await tokenIds(c, who, balance)
          partial = partial || found.partial
          nfts.push(...(await describe(c, found.ids, signal)))
        } catch {
          partial = true
        }
      }

      return { nfts, source: 'On-chain (known collections)', partial }
    },
  }
}
