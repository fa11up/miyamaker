import { ipfsPath } from '@/utils/ipfsGateways'

/**
 * Small bundled thumbnails (480px webp, 20-45 KB) for known IPFS artwork, so lists and placeholders never wait on a
 * multi-megabyte original. The Miya Auction Q1 '24 originals are 0.6-3.3 MB JPEGs (12.3 MB for one screen).
 *
 * File name = `<cid>__<path with "/" as "__">.webp`, e.g. `bafy…__1.jpg.webp` for ipfs://bafy…/1.jpg.
 * To add more: generate with sharp (resize inside 480x480, webp q70) into src/assets/auction-thumbs/.
 */
const files = import.meta.glob('../assets/auction-thumbs/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const THUMBS: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => {
    const name = path
      .split('/')
      .pop()!
      .replace(/\.webp$/, '')
    return [name.split('__').join('/'), url]
  })
)

/** Bundled thumbnail URL for an IPFS image (any gateway spelling), or undefined. */
export function thumbFor(uri: string | null | undefined): string | undefined {
  const path = ipfsPath(uri)
  return path ? THUMBS[path.replace(/\?.*$/, '')] : undefined
}
