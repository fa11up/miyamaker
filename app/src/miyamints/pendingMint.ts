/**
 * The mint a wallet sent on a drop and that hasn't settled yet, kept in localStorage per chain + drop + wallet. The Mint
 * screen forgets its own transaction when it is closed or reloaded; this is how it still knows a claim is on its way and
 * doesn't offer a second one while the first may land. Cleared once the transaction settles (or the person starts over).
 *
 * Pure apart from the storage passed in (window.localStorage by default), so node:test can run it. Storage that can't
 * be read (private windows, blocked site data) just means nothing is remembered.
 */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const PREFIX = 'miya:pending-mint:'
/** Older than this, a remembered mint is let go: the screen's own wait gives up long before. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

const store = (s?: Store): Store | undefined => {
  if (s) return s
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

export const pendingMintKey = (chainId: number, drop: string, wallet: string) =>
  `${PREFIX}${chainId}:${drop.toLowerCase()}:${wallet.toLowerCase()}`

export function savePendingMint(key: string, hash: `0x${string}`, now = Date.now(), s?: Store) {
  try {
    store(s)?.setItem(key, JSON.stringify({ hash, at: now }))
  } catch {
    // Nothing remembered: the screen still waits for this mint while it stays open.
  }
}

export function readPendingMint(key: string, now = Date.now(), s?: Store): `0x${string}` | undefined {
  try {
    const raw = store(s)?.getItem(key)
    if (!raw) return undefined
    const v = JSON.parse(raw) as { hash?: unknown; at?: unknown }
    if (typeof v.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(v.hash)) return undefined
    if (typeof v.at !== 'number' || now - v.at > MAX_AGE_MS) return undefined
    return v.hash as `0x${string}`
  } catch {
    return undefined
  }
}

export function clearPendingMint(key: string, s?: Store) {
  try {
    store(s)?.removeItem(key)
  } catch {
    // Nothing to clear.
  }
}
