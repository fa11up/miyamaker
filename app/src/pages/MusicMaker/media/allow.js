/**
 * Hosts the sample proxy is willing to read. Everything else stays a direct browser fetch.
 * The proxy itself (api/_lib/samplemedia.ts) checks against this same list. No imports, so the Worker and
 * `node --test` load it too.
 */

const HOSTS = new Set([
  'api.ravepigs.dev',
  'gateway.pinata.cloud',
  'ipfs.io',
  'dweb.link',
  'nftstorage.link',
  'w3s.link',
])

export const SAMPLE_MEDIA_LIMIT = 24 * 1024 * 1024
/** Where the same-origin sample proxy answers. api/_lib/samplemedia.ts serves this path. */
export const SAMPLE_MEDIA_PATH = '/api/sample-media'

/** A host on the list, or a subdomain gateway under one that serves a CID per subdomain. */
export function isMediaHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  return HOSTS.has(host) || host.endsWith('.ipfs.dweb.link') || host.endsWith('.ipfs.nftstorage.link')
}

export function allowedMediaUrl(raw) {
  let url
  try {
    url = new URL(String(raw))
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (!isMediaHost(url.hostname)) return null
  return url
}
