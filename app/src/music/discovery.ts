import { getPublicClient } from '@wagmi/core'
import type { Address, PublicClient } from 'viem'
import { getAddress, isAddress } from 'viem'

import { wagmiConfig } from '@/config/wagmi'
import { isRevert } from '@/hooks/readFailure'
import { resolveUri } from '@/utils/resolveUri'

import { erc1155FactoryAbi, erc1155InstanceAbi, miyaRegistryAbi, tokenMetadataAbi } from './abi'
import type { ParsedMusic } from './audio'
import { decodeDataJson, musicTrack, parseMusicMetadata, safeUri } from './audio'
import { musicConfig } from './config'
import { knownCollections } from './known'
import type { ScanResult } from './scan'
import { combineScan } from './scan'
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
  /** ERC1155Instance editions only. `price` is undefined when getCurrentPrice couldn't be read. */
  edition?: { price?: bigint; supply: bigint; minted: bigint; openTime: bigint }
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

/**
 * Latest ERC1155Factory instances from MiyaRegistry (no indexer needed: the registry keeps an array). Throws when the
 * registry can't be read; `capped` when it holds more than REGISTRY_SCAN instances.
 */
async function registryInstances(chainId: number): Promise<{ instances: Address[]; capped: boolean }> {
  const { factory } = musicConfig(chainId)
  if (!factory) return { instances: [], capped: false }
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
  return {
    instances: instances.filter((_, i) => factories[i]?.toLowerCase() === factory.toLowerCase()),
    capped: from > 0n,
  }
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

/** One collection's music: what was found, whether some was left out (`capped`) or couldn't be read (`someFailed`). */
export type CollectionScan = { items: MusicItem[]; capped?: boolean; someFailed?: boolean }

async function loadMiya1155(c: PublicClient, chainId: number, address: Address): Promise<CollectionScan | null> {
  let ids: readonly bigint[]
  try {
    ids = await c.readContract({ address, abi: erc1155InstanceAbi, functionName: 'getAllEditionIds' })
  } catch (e) {
    if (isRevert(e)) return null // not an ERC1155Instance
    throw e // no answer: this collection failed, it is not "not music"
  }

  const name = await c.readContract({ address, abi: erc1155InstanceAbi, functionName: 'name' }).catch(() => undefined)
  const recent = ids.slice(-MAX_EDITIONS).reverse()
  let failed = 0
  const items = await Promise.all(
    recent.map(async (id): Promise<MusicItem | null> => {
      let ed
      try {
        ed = await c.readContract({ address, abi: erc1155InstanceAbi, functionName: 'getEdition', args: [id] })
      } catch {
        failed += 1
        return null
      }
      const music = parseMusicMetadata(await fetchMetadata(ed.metadataURI))
      if (!music) return null
      // An unread price stays unread: basePrice is not what a dynamic edition costs now.
      const price = await c
        .readContract({ address, abi: erc1155InstanceAbi, functionName: 'getCurrentPrice', args: [id] })
        .catch(() => undefined)
      return item(chainId, address, name, 'miya1155', id, music, {
        price,
        supply: ed.supply,
        minted: ed.minted,
        openTime: ed.openTime,
      })
    })
  )
  if (recent.length > 0 && failed === recent.length) throw new Error('No edition could be read')
  return {
    items: items.filter((x): x is MusicItem => !!x),
    capped: ids.length > recent.length,
    someFailed: failed > 0,
  }
}

/** Any other ERC-721 / ERC-1155: probe token 1 then 0 for audio metadata, one getter at a time. */
async function loadGeneric(c: PublicClient, chainId: number, address: Address): Promise<CollectionScan> {
  const name = await c.readContract({ address, abi: tokenMetadataAbi, functionName: 'name' }).catch(() => undefined)
  const probes = [1n, 0n].flatMap((id) => (['tokenURI', 'uri'] as const).map((fn) => ({ id, fn })))
  let unanswered: unknown
  for (const { id, fn } of probes) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one getter at a time, stopping at the first hit
      const raw = await c.readContract({ address, abi: tokenMetadataAbi, functionName: fn, args: [id] })
      const uri = fn === 'uri' ? raw.replace(/\{id\}/g, id.toString(16).padStart(64, '0')) : raw
      // eslint-disable-next-line no-await-in-loop
      const music = parseMusicMetadata(await fetchMetadata(uri))
      if (music) return { items: [item(chainId, address, name, fn === 'uri' ? 'erc1155' : 'erc721', id, music)] }
    } catch (e) {
      // A revert is "not this getter / id"; no answer at all means we can't say this isn't music.
      if (!isRevert(e)) unanswered = e
    }
  }

  if (unanswered) throw unanswered
  return { items: [] }
}

/** Throws when the collection couldn't be read at all (as opposed to "has no music"). */
export async function loadCollection(chainId: number, address: Address): Promise<CollectionScan> {
  const c = client(chainId)
  return (await loadMiya1155(c, chainId, address)) ?? loadGeneric(c, chainId, address)
}

export type MusicScan = ScanResult<MusicItem>

/**
 * Every music token we can find on a chain: the factory's registry instances, collections launched or
 * pasted in this browser, plus `extra`. Non-music collections are silently skipped. Throws when the registry or every
 * collection couldn't be read; otherwise `failed` and `capped` say what is missing from `items`.
 */
export async function discoverMusic(chainId: number, extra: string[] = []): Promise<MusicScan> {
  let registry: { instances: Address[]; capped: boolean } = { instances: [], capped: false }
  let registryFailed = false
  try {
    registry = await registryInstances(chainId)
  } catch {
    registryFailed = true
  }
  if (registryFailed) return combineScan<MusicItem>([], { registryFailed, capped: false })
  const all = [...extra, ...knownCollections(chainId), ...registry.instances]
    .filter((a) => isAddress(a))
    .map((a) => getAddress(a))
  const distinct = Array.from(new Set(all))
  const unique = distinct.slice(0, MAX_COLLECTIONS)
  const results = await Promise.all(
    unique.map((a) => loadCollection(chainId, a).catch((): CollectionScan | undefined => undefined))
  )
  return combineScan(results, { registryFailed: false, capped: registry.capped || distinct.length > unique.length })
}
