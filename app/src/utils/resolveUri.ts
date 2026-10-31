// Turns ipfs:// and ar:// URIs into HTTP URLs the browser can fetch.
//
// NFT.Storage's gateway (nftstorage.link) is gone and most public IPFS gateways now redirect, rate-limit or charge.
// Filebase still serves our pins with CORS, so it is the default; override with VITE_IPFS_GATEWAY (path-style,
// e.g. https://my-gateway.example/ipfs/).

function withSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`
}

const IPFS_GATEWAY = withSlash(import.meta.env.VITE_IPFS_GATEWAY || 'https://ipfs.filebase.io/ipfs/')
const AR_GATEWAY = withSlash(import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/')

export function resolveUri(uri?: string | null): string {
  if (!uri) return ''
  if (uri.startsWith('ipfs://')) {
    // Accept both ipfs://<cid>/path and the older ipfs://ipfs/<cid>/path form.
    return IPFS_GATEWAY + uri.slice('ipfs://'.length).replace(/^ipfs\//, '')
  }

  if (uri.startsWith('ar://')) return AR_GATEWAY + uri.slice('ar://'.length)
  return uri
}
