import { getPublicClient } from '@wagmi/core'
import type { Address, PublicClient } from 'viem'
import { getAddress, isAddress } from 'viem'

import { wagmiConfig } from '@/config/wagmi'
import { resolveUri } from '@/utils/resolveUri'

import { erc1155FactoryAbi, erc1155InstanceAbi, miyaRegistryAbi, tokenMetadataAbi } from './abi'
import type { ParsedMusic } from './audio'
import { decodeDataJson, musicTrack, parseMusicMetadata, safeUri } from './audio'
import { musicConfig } from './config'
import { knownCollections } from './known'
import type { Track } from './types'

/** A playable token found on-chain, with enough context for the Music listing to mint it. */
export type MusicItem = {
  key: string
  chainId: number
  collection: Address
  collectionName?: string
  kind: 'miya1155' | 'erc721' | 'erc1155'
  tokenId: bigint
  music: ParsedMusic
  track: Track
  /** ERC1155Instance editions only. */
  edition?: { price: bigint; supply: bigint; minted: bigint; openTime: bigint }
}

const MAX_COLLECTIONS = 40
const MAX_EDITIONS = 24
const REGISTRY_SCAN = 60
const FETCH_TIMEOUT_MS = 12_000
const MAX_JSON_BYTES = 256 * 1024

function client(chainId: number): PublicClient {
  const c = getPublicClient(wagmiConfig, { chainId: chainId as (typeof wagmiConfig.chains)[number]['id'] })
  if (!c) throw new Error(`No RPC for chain ${chainId}`)
  return c as PublicClient
}

/** Fetches token metadata JSON from data:, ipfs://, ar:// or http(s):// only, with a timeout and size cap. */
export async function fetchMetadata(uri: string): Promise<unknown> {
  const inline = decodeDataJson(uri)
  if (inline !== undefined) return inline
  const safe = safeUri(uri)
  if (!safe) return undefined
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(resolveUri(safe), {
      signal: ctrl.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    if (!res.ok) return undefined
    const text = await res.text()
    if (text.length > MAX_JSON_BYTES) return undefined
    return JSON.parse(text)
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** Latest ERC1155Factory instances from MiyaRegistry (no indexer needed: the registry keeps an array). */
async function registryInstances(chainId: number): Promise<Address[]> {
  const { factory } = musicConfig(chainId)
  if (!factory) return []
  const c = client(chainId)
  const registry = await c.readContract({ address: factory, abi: erc1155FactoryAbi, functionName: 'registry' })
  const count = await c.readContract({ address: registry, abi: miyaRegistryAbi, functionName: 'instanceCount' })
  const from = count > BigInt(REGISTRY_SCAN) ? count - BigInt(REGISTRY_SCAN) : 0n
  const idx: bigint[] = []
  for (let i = count - 1n; i >= from && i >= 0n; i -= 1n) idx.push(i)
  const instances = await Promise.all(
    idx.map((i) => c.readContract({ address: registry, abi: miyaRegistryAbi, functionName: 'instances', args: [i] }))
  )
  const factories = await Promise.all(
    instances.map((inst) =>
      c.readContract({ address: registry, abi: miyaRegistryAbi, functionName: 'factoryOf', args: [inst] })
    )
  )
  return instances.filter((_, i) => factories[i]?.toLowerCase() === factory.toLowerCase())
}

function item(
  chainId: number,
  collection: Address,
  collectionName: string | undefined,
  kind: MusicItem['kind'],
  tokenId: bigint,
  music: ParsedMusic,
  edition?: MusicItem['edition']
): MusicItem {
  const track = musicTrack(music, { chainId, address: collection, tokenId: tokenId.toString() })
  return { key: track.id, chainId, collection, collectionName, kind, tokenId, music, track, edition }
}

async function loadMiya1155(c: PublicClient, chainId: number, address: Address): Promise<MusicItem[] | null> {
  let ids: readonly bigint[]
  try {
    ids = await c.readContract({ address, abi: erc1155InstanceAbi, functionName: 'getAllEditionIds' })
  } catch {
    return null // not an ERC1155Instance
  }

  const name = await c.readContract({ address, abi: erc1155InstanceAbi, functionName: 'name' }).catch(() => undefined)
  const recent = ids.slice(-MAX_EDITIONS).reverse()
  const items = await Promise.all(
    recent.map(async (id): Promise<MusicItem | null> => {
      try {
        const ed = await c.readContract({ address, abi: erc1155InstanceAbi, functionName: 'getEdition', args: [id] })
        const music = parseMusicMetadata(await fetchMetadata(ed.metadataURI))
        if (!music) return null
        const price = await c
          .readContract({ address, abi: erc1155InstanceAbi, functionName: 'getCurrentPrice', args: [id] })
          .catch(() => ed.basePrice)
        return item(chainId, address, name, 'miya1155', id, music, {
          price,
          supply: ed.supply,
          minted: ed.minted,
          openTime: ed.openTime,
        })
      } catch {
        return null
      }
    })
  )
  return items.filter((x): x is MusicItem => !!x)
}

/** Any other ERC-721 / ERC-1155: probe token 1 then 0 for audio metadata, one getter at a time. */
async function loadGeneric(c: PublicClient, chainId: number, address: Address): Promise<MusicItem[]> {
  const name = await c.readContract({ address, abi: tokenMetadataAbi, functionName: 'name' }).catch(() => undefined)
  const probes = [1n, 0n].flatMap((id) => (['tokenURI', 'uri'] as const).map((fn) => ({ id, fn })))
  const tryProbe = async (i: number): Promise<MusicItem[]> => {
    const probe = probes[i]
    if (!probe) return []
    const { id, fn } = probe
    try {
      const raw = await c.readContract({ address, abi: tokenMetadataAbi, functionName: fn, args: [id] })
      const uri = fn === 'uri' ? raw.replace(/\{id\}/g, id.toString(16).padStart(64, '0')) : raw
      const music = parseMusicMetadata(await fetchMetadata(uri))
      if (music) return [item(chainId, address, name, fn === 'uri' ? 'erc1155' : 'erc721', id, music)]
    } catch {
      // not this getter / id
    }

    return tryProbe(i + 1)
  }

  return tryProbe(0)
}

export async function loadCollection(chainId: number, address: Address): Promise<MusicItem[]> {
  const c = client(chainId)
  return (await loadMiya1155(c, chainId, address)) ?? loadGeneric(c, chainId, address)
}

/**
 * Every music token we can find on a chain: the factory's registry instances, collections launched or
 * pasted in this browser, plus `extra`. Non-music collections are silently skipped.
 */
export async function discoverMusic(chainId: number, extra: string[] = []): Promise<MusicItem[]> {
  const fromRegistry = await registryInstances(chainId).catch(() => [] as Address[])
  const all = [...extra, ...knownCollections(chainId), ...fromRegistry]
    .filter((a) => isAddress(a))
    .map((a) => getAddress(a))
  const unique = Array.from(new Set(all)).slice(0, MAX_COLLECTIONS)
  const results = await Promise.all(unique.map((a) => loadCollection(chainId, a).catch(() => [] as MusicItem[])))
  return results.flat()
}
