import type { EditionLaunch } from './launchEdition'
import type { LaunchProgress } from './mintPlan'

/**
 * A release under way, kept in the browser so closing the dialog or the window loses nothing: what has gone to the
 * chain, exactly what it was built from, and what is already uploaded. Reopening carries on from it instead of
 * deploying a second collection. Needs no wallet, so `node --test` loads it (tests/music-maker-release.test.mts).
 */

export type SavedRelease = {
  account: string
  chainId: number
  /** The song or kit's bytes, so the same thing is never released twice while one is still out. */
  content: string
  intent: string
  launch: EditionLaunch
  links: string[]
  /** Upload content key to its ar:// link. */
  uploads: Record<string, string>
  progress: LaunchProgress
  savedAt: number
}

/** The part of Storage this needs, so a test can hand in a map. */
export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

const PREFIX = 'miya-music-release:v1:'

function scope(account: string, chainId: number) {
  return `${PREFIX}${account.toLowerCase()}:${chainId}:`
}

export function releaseKey(account: string, chainId: number, content: string) {
  return `${scope(account, chainId)}${content}`
}

/** The browser's storage, or nothing when it is blocked (a private window, cleared site data). */
export function browserStore(): KeyStore | undefined {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    return undefined
  }
}

// JSON has no bigint: each one is written as {"$bigint":"123"} and read back.
const BIG = '$bigint'

export function serializeRelease(release: SavedRelease): string {
  return JSON.stringify(release, (_, value) => (typeof value === 'bigint' ? { [BIG]: value.toString() } : value))
}

export function parseRelease(raw: string | null | undefined): SavedRelease | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw, (_, value) =>
      value && typeof value === 'object' && typeof value[BIG] === 'string' && Object.keys(value).length === 1
        ? BigInt(value[BIG])
        : value
    ) as SavedRelease
    if (!parsed || typeof parsed.account !== 'string' || !parsed.launch || !parsed.progress) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function saveRelease(store: KeyStore | undefined, release: SavedRelease) {
  try {
    store?.setItem(releaseKey(release.account, release.chainId, release.content), serializeRelease(release))
    return true
  } catch {
    return false
  }
}

export function loadRelease(store: KeyStore | undefined, account: string, chainId: number, content: string) {
  try {
    return parseRelease(store?.getItem(releaseKey(account, chainId, content)))
  } catch {
    return undefined
  }
}

/** Every release this wallet has under way on this chain, the latest first. */
export function findReleases(store: KeyStore | undefined, account: string, chainId: number): SavedRelease[] {
  if (!store) return []
  const at = scope(account, chainId)
  try {
    return Array.from({ length: store.length }, (_, i) => store.key(i))
      .filter((key): key is string => !!key?.startsWith(at))
      .map((key) => parseRelease(store.getItem(key)))
      .filter((release): release is SavedRelease => !!release)
      .sort((a, b) => b.savedAt - a.savedAt)
  } catch {
    return []
  }
}

/** Forgets a release: when it finished, or when the person drops it after a clear failure. */
export function clearRelease(store: KeyStore | undefined, account: string, chainId: number, content: string) {
  try {
    store?.removeItem(releaseKey(account, chainId, content))
  } catch {
    // Nothing to do: it stays until storage works again.
  }
}

/**
 * A progress that calls `onChange` after every field set on it, so each step is saved the moment it lands, even
 * while the dialog is closed and the wallet is still answering.
 */
export function watchProgress(progress: LaunchProgress, onChange: () => void): LaunchProgress {
  return new Proxy(progress, {
    set(target, field, value) {
      ;(target as Record<string | symbol, unknown>)[field] = value
      onChange()
      return true
    },
    deleteProperty(target, field) {
      delete (target as Record<string | symbol, unknown>)[field]
      onChange()
      return true
    },
  })
}
