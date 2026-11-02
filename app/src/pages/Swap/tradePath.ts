/**
 * Trade window paths. No runtime imports, so `node --test` can load it (tests/trade.test.mts).
 *
 *   /trade                    Tokens (the 0x swap)
 *   /trade/nfts               NFTs: pools on the chosen chain
 *   /trade/nfts/<pool>        NFTs: one pool
 *   /trade/nfts/collection/<chainId>/<address>[/<tokenId>]
 *                             NFTs: one collection (or one NFT) and every place it trades
 *
 * The window used to be "miya swaps" at /swap. Old links (/swap, /swap/...) are moved to /trade before the router
 * reads them (main.tsx) and when the app navigates to them (OperatingSystem).
 */

export type TradeMode = 'tokens' | 'nfts'

export const TRADE_PATH = '/trade'

/** Old path prefix → new one. Longest match wins; the rest of the path and the query string are kept. */
export const PATH_ALIASES: Record<string, string> = {
  '/swap': TRADE_PATH,
}

/** The current path for a legacy one (/swap → /trade, /swap/x?y → /trade/x?y), or undefined when it is not legacy. */
export function canonicalPath(pathname: string): string | undefined {
  const [path = '', ...rest] = pathname.split(/(?=[?#])/)
  const from = Object.keys(PATH_ALIASES)
    .sort((a, b) => b.length - a.length)
    .find((p) => path === p || path.startsWith(`${p}/`))
  if (!from) return undefined
  return `${PATH_ALIASES[from]}${path.slice(from.length)}${rest.join('')}`
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

export type CollectionRef = { chainId: number; address: `0x${string}`; tokenId?: string }

const CHAIN_IDS = [1, 11155111, 4663]

/** Mode, pool or collection from a /trade path. Anything unknown falls back to Tokens. */
export function parseTradePath(pathname: string): {
  mode: TradeMode
  pool?: `0x${string}`
  collection?: CollectionRef
} {
  const parts = pathname.split(/[?#]/)[0]!.split('/').filter(Boolean)
  if (parts[0] !== TRADE_PATH.slice(1) || parts[1] !== 'nfts') return { mode: 'tokens' }
  if (parts[2] === 'collection') {
    const chainId = Number(parts[3])
    const address = parts[4]
    if (!CHAIN_IDS.includes(chainId) || !address || !ADDRESS.test(address)) return { mode: 'nfts' }
    const tokenId = parts[5] && /^[0-9]{1,78}$/.test(parts[5]) ? parts[5] : undefined
    const collection: CollectionRef = { chainId, address: address as `0x${string}` }
    if (tokenId) collection.tokenId = tokenId
    return { mode: 'nfts', collection }
  }
  const pool = parts[2] && ADDRESS.test(parts[2]) ? (parts[2] as `0x${string}`) : undefined
  return pool ? { mode: 'nfts', pool } : { mode: 'nfts' }
}

export function tradePath(mode: TradeMode, pool?: string, collection?: CollectionRef): string {
  if (mode === 'tokens') return TRADE_PATH
  if (collection) {
    const base = `${TRADE_PATH}/nfts/collection/${collection.chainId}/${collection.address}`
    return collection.tokenId ? `${base}/${collection.tokenId}` : base
  }
  return pool ? `${TRADE_PATH}/nfts/${pool}` : `${TRADE_PATH}/nfts`
}
