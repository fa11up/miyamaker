/** Hosts the sample proxy is willing to read. Everything else stays a direct browser fetch. */

const HOSTS = new Set([
  'api.ravepigs.dev',
  'gateway.pinata.cloud',
  'ipfs.io',
  'cloudflare-ipfs.com',
  'dweb.link',
  'nftstorage.link',
  'w3s.link',
])

export const SAMPLE_MEDIA_LIMIT = 24 * 1024 * 1024

export function allowedMediaUrl(raw) {
  let url
  try {
    url = new URL(String(raw))
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  const suffix = host.endsWith('.ipfs.dweb.link') || host.endsWith('.ipfs.nftstorage.link')
  if (!HOSTS.has(host) && !suffix) return null
  return url
}
