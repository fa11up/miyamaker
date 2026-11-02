import { useQuery } from '@tanstack/react-query'

import { DEFAULT_IPFS_GATEWAYS, gatewayUrls, ipfsPath, raceJson } from '@/utils/ipfsGateways'
import { parseJsonDataUri } from '@/utils/resolveUri'

/** Gateways in priority order: VITE_IPFS_GATEWAY (if set) first, then the measured defaults. */
export const IPFS_GATEWAYS: string[] = [
  ...new Set([
    ...(import.meta.env.VITE_IPFS_GATEWAY ? [import.meta.env.VITE_IPFS_GATEWAY as string] : []),
    ...DEFAULT_IPFS_GATEWAYS,
  ]),
].map((g) => (g.endsWith('/') ? g : `${g}/`))

/**
 * Fetches NFT/contract metadata JSON from a tokenURI/contractURI: data: JSON is decoded in place, IPFS is raced across
 * gateways (primary first, fallbacks join after a head start), plain http(s) is fetched once.
 */
export async function fetchMetadataJson<T = unknown>(uri: string): Promise<T | undefined> {
  const s = uri.trim()
  if (!s) return undefined
  if (/^data:application\/json/i.test(s)) return parseJsonDataUri<T>(s)
  const urls = ipfsPath(s) ? gatewayUrls(s, IPFS_GATEWAYS) : /^https?:\/\//i.test(s) ? [s] : []
  if (urls.length === 0) return undefined
  return raceJson<T>(urls)
}

/**
 * Metadata as a react-query: IPFS metadata is content-addressed, so it never goes stale; http metadata is refreshed
 * after an hour. Shared across every component that asks for the same URI (one request per URI per session).
 */
export function useMetadata<T = unknown>(uri: string | undefined, enabled = true) {
  const immutable = !!uri && (!!ipfsPath(uri) || /^data:/i.test(uri) || /^ar:\/\//i.test(uri))
  return useQuery({
    queryKey: ['nft-metadata', uri],
    queryFn: () => fetchMetadataJson<T>(uri as string),
    enabled: enabled && !!uri,
    staleTime: immutable ? Infinity : 60 * 60_000,
    gcTime: immutable ? Infinity : 24 * 60 * 60_000,
    retry: 1,
  })
}
