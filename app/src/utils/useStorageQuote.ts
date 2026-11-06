import { useQuery } from '@tanstack/react-query'
import { formatEther } from 'viem'

import { FREE_BYTES, PRICE_MARGIN } from './fundAndUpload'

/** What storing this many bytes costs, from the storage service's public price list: no wallet or signature needed. */
export async function fetchStoragePrice(
  bytes: number,
  node: string = import.meta.env.VITE_IRYS_NODE || 'https://uploader.irys.xyz',
  token: string = import.meta.env.VITE_IRYS_TOKEN || 'ethereum'
): Promise<bigint> {
  const res = await fetch(`${node}/price/${token}/${Math.ceil(bytes)}`, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Storage price ${res.status}`)
  return BigInt((await res.text()).trim())
}

/** Rounded up, so the words never promise less than the wallet will ask for. */
export function storagePriceWords(wei: bigint): string {
  const eth = Number(formatEther((wei * BigInt(Math.round(PRICE_MARGIN * 100))) / 100n))
  if (eth < 0.0001) return 'under 0.0001 ETH'
  return `about ${(Math.ceil(eth * 10_000) / 10_000).toString()} ETH`
}

export type StorageQuote =
  | { state: 'none' }
  | { state: 'free' }
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'priced'; wei: bigint; words: string }

/**
 * The price to show before any wallet prompt. `bytes` is the total being stored, undefined until something is chosen.
 * A balance already on the storage service can make the real payment smaller, never larger, apart from price moves.
 */
export function useStorageQuote(bytes?: number): StorageQuote {
  const paid = !!bytes && bytes > FREE_BYTES
  const quote = useQuery({
    queryKey: ['storage-price', bytes],
    queryFn: () => fetchStoragePrice(bytes!),
    enabled: paid,
    staleTime: 60_000,
    retry: 1,
  })
  if (!bytes) return { state: 'none' }
  if (!paid) return { state: 'free' }
  if (quote.data !== undefined) return { state: 'priced', wei: quote.data, words: storagePriceWords(quote.data) }
  return { state: quote.isError ? 'failed' : 'loading' }
}
