// Turns ipfs:// and ar:// URIs into HTTP URLs the browser can fetch, and drops every other scheme.
//
// NFT.Storage's gateway (nftstorage.link) is gone and most public IPFS gateways now redirect, rate-limit or charge.
// Filebase still serves our pins with CORS, so it is the default; override with VITE_IPFS_GATEWAY (path-style,
// e.g. https://my-gateway.example/ipfs/).
//
// URIs come from arbitrary on-chain contracts, so only an allowlist of schemes is passed through: http(s), ipfs and
// ar (rewritten to gateways), and data: URIs of the expected media type (images for resolveUri, JSON for
// resolveMetadataUri). Anything else (javascript:, blob:, file:, data:text/html, ...) resolves to ''.

function withSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`
}

const IPFS_GATEWAY = withSlash(import.meta.env.VITE_IPFS_GATEWAY || 'https://ipfs.filebase.io/ipfs/')
const AR_GATEWAY = withSlash(import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/')

function resolveWith(uri: string | null | undefined, dataPrefix: RegExp): string {
  const trimmed = uri?.trim()
  if (!trimmed) return ''
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('ipfs://')) {
    // Accept both ipfs://<cid>/path and the older ipfs://ipfs/<cid>/path form.
    return IPFS_GATEWAY + trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '')
  }

  if (lower.startsWith('ar://')) return AR_GATEWAY + trimmed.slice('ar://'.length)
  if (lower.startsWith('https://') || lower.startsWith('http://')) return trimmed
  if (dataPrefix.test(lower)) return trimmed
  return ''
}

/** Resolves an image URI (NFT `image` fields): http(s), ipfs, ar or data:image/*. */
export function resolveUri(uri?: string | null): string {
  return resolveWith(uri, /^data:image\//)
}

/** Resolves a metadata URI fetched as JSON (contractURI / tokenURI): http(s), ipfs, ar or data:application/json. */
export function resolveMetadataUri(uri?: string | null): string {
  return resolveWith(uri, /^data:application\/json[;,]/)
}

/** http(s) only, for links rendered as <a href>. Returns undefined for anything else. */
export function safeHttpUrl(url?: string | null): string | undefined {
  const trimmed = url?.trim()
  if (!trimmed) return undefined
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

/**
 * Decodes a data:application/json URI (`;utf8,`, `;charset=utf-8,`, percent-encoded or `;base64,`).
 * Returns undefined instead of throwing on anything malformed.
 */
export function parseJsonDataUri<T = unknown>(uri: string): T | undefined {
  const match = /^data:application\/json([^,]*),([\s\S]*)$/i.exec(uri.trim())
  if (!match) return undefined
  const params = (match[1] || '').toLowerCase()
  const body = match[2] || ''
  try {
    let text: string
    if (params.includes(';base64')) {
      const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
      text = new TextDecoder().decode(bytes)
    } else {
      // Older launches stored raw JSON without percent-encoding; fall back to the raw text when decoding fails.
      try {
        text = decodeURIComponent(body)
      } catch {
        text = body
      }
    }

    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}
