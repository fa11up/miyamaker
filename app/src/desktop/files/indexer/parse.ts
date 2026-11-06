/* eslint-disable no-restricted-syntax, no-continue, no-await-in-loop, no-plusplus -- bounded, sequential RPC/parse loops read clearer as loops */
/**
 * Pure parsing for the wallet indexers: Alchemy v3 responses, Transfer-log replay and ownerOf
 * sweeps. No imports besides types so `node --test` can exercise it.
 */
import type { CleanMetadata, Resolve } from '../sanitize'
import type { OwnedNft } from './types'

type SanitizeFn = (raw: unknown, resolve?: Resolve) => CleanMetadata
type CleanTextFn = (value: unknown, max?: number) => string

/** Alchemy NFT API v3 getNFTsForOwner → OwnedNft[]. Never trusts shapes. */
export function parseAlchemyOwnedNfts(
  json: unknown,
  chainId: number,
  deps: { sanitize: SanitizeFn; cleanText: CleanTextFn; resolve?: Resolve },
): { nfts: OwnedNft[]; pageKey?: string } {
  const root = json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
  const list = Array.isArray(root.ownedNfts) ? root.ownedNfts : []
  const nfts: OwnedNft[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const n = item as Record<string, any>
    const contract = n.contract && typeof n.contract === 'object' ? n.contract : {}
    const address = typeof contract.address === 'string' ? contract.address : ''
    const tokenId = typeof n.tokenId === 'string' ? n.tokenId : ''
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !/^\d+$/.test(tokenId)) continue
    const tokenType = typeof n.tokenType === 'string' ? n.tokenType : ''
    if (tokenType && tokenType !== 'ERC721' && tokenType !== 'ERC1155') continue
    const raw = n.raw && typeof n.raw === 'object' ? n.raw.metadata : undefined
    const meta = deps.sanitize(raw, deps.resolve)
    const image = n.image && typeof n.image === 'object' ? n.image : {}
    // Prefer Alchemy's cached copies (already http), then the raw metadata image.
    const cached = deps.sanitize({ image: image.thumbnailUrl || image.cachedUrl || image.pngUrl }, deps.resolve).image
    const hostedThumb = cached || undefined
    const hostedFull = deps.sanitize({ image: image.cachedUrl || image.pngUrl }, deps.resolve).image || undefined
    nfts.push({
      chainId,
      contract: address.toLowerCase(),
      collectionName:
        deps.cleanText(contract.name, 80) ||
        deps.cleanText(contract.openSeaMetadata?.collectionName, 80) ||
        `${address.slice(0, 6)}…${address.slice(-4)}`,
      tokenId,
      name: deps.cleanText(n.name, 120) || meta.name || `#${tokenId}`,
      description: deps.cleanText(n.description, 600) || meta.description,
      image: cached || meta.image,
      externalUrl: meta.externalUrl,
      fullImage: hostedFull || meta.image || cached,
      spam:
        contract.isSpam === true ||
        (Array.isArray(contract.spamClassifications) && contract.spamClassifications.length > 0),
      hostedThumb,
      hostedFull,
    })
  }

  const pageKey = typeof root.pageKey === 'string' && root.pageKey ? root.pageKey : undefined
  return { nfts, pageKey }
}

export interface TransferLike {
  from?: string
  to?: string
  tokenId?: bigint | string | number
  blockNumber?: bigint | null
  logIndex?: number | null
}

/**
 * Replays Transfer logs in chain order and returns the token ids `owner` still holds.
 * Callers should confirm with ownerOf when the scan was partial.
 */
export function heldFromTransfers(transfers: TransferLike[], owner: string): string[] {
  const me = owner.toLowerCase()
  const sorted = [...transfers].sort((a, b) => {
    const ba = a.blockNumber ?? 0n
    const bb = b.blockNumber ?? 0n
    if (ba !== bb) return ba < bb ? -1 : 1
    return (a.logIndex ?? 0) - (b.logIndex ?? 0)
  })
  const held = new Set<string>()
  for (const t of sorted) {
    if (t.tokenId === undefined || t.tokenId === null) continue
    const id = BigInt(t.tokenId).toString()
    if (t.to?.toLowerCase() === me) held.add(id)
    else if (t.from?.toLowerCase() === me) held.delete(id)
  }

  return [...held].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
}

/** ownerOf sweep: keep ids whose call succeeded and returned `owner`. */
export function heldFromOwnerSweep(
  ids: (bigint | number)[],
  results: { status: 'success' | 'failure'; result?: unknown }[],
  owner: string,
): string[] {
  const me = owner.toLowerCase()
  const out: string[] = []
  ids.forEach((id, i) => {
    const r = results[i]
    if (r?.status === 'success' && typeof r.result === 'string' && r.result.toLowerCase() === me) out.push(String(id))
  })
  return out
}

/** Bounded block chunks for a log scan, newest first. */
export function logChunks(
  fromBlock: bigint,
  toBlock: bigint,
  chunk: bigint,
  maxChunks: number,
): { chunks: { fromBlock: bigint; toBlock: bigint }[]; partial: boolean } {
  const chunks: { fromBlock: bigint; toBlock: bigint }[] = []
  let hi = toBlock
  while (hi >= fromBlock && chunks.length < maxChunks) {
    const lo = hi - chunk + 1n > fromBlock ? hi - chunk + 1n : fromBlock
    chunks.push({ fromBlock: lo, toBlock: hi })
    hi = lo - 1n
  }

  return { chunks, partial: hi >= fromBlock }
}

/** Folders: one per collection, sorted by name; files sorted by numeric token id. */
export function groupByCollection(nfts: OwnedNft[]) {
  const map = new Map<string, { key: string; chainId: number; contract: string; name: string; items: OwnedNft[] }>()
  for (const n of nfts) {
    const key = `${n.chainId}:${n.contract}`
    let folder = map.get(key)
    if (!folder) {
      folder = { key, chainId: n.chainId, contract: n.contract, name: n.collectionName, items: [] }
      map.set(key, folder)
    }

    folder.items.push(n)
  }

  const folders = [...map.values()]
  for (const f of folders) {
    f.items.sort((a, b) => {
      try {
        const d = BigInt(a.tokenId) - BigInt(b.tokenId)
        return d < 0n ? -1 : d > 0n ? 1 : 0
      } catch {
        return a.tokenId.localeCompare(b.tokenId)
      }
    })
  }

  return folders.sort((a, b) => a.name.localeCompare(b.name))
}
