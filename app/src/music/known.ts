import { getAddress, isAddress } from 'viem'

/**
 * Music collections this browser knows about (launched here, or pasted into the Music listing).
 * A per-viewer convenience only: storage can be unavailable, so every access is guarded.
 */
const KEY = 'miya-music:collections:v1'
const EVENT = 'miya-music:collections'

type Store = Record<string, string[]>

function read(): Store {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

function write(store: Store) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // storage blocked: the list just won't survive a reload
  }

  window.dispatchEvent(new Event(EVENT))
}

export function knownCollections(chainId: number): `0x${string}`[] {
  const list = read()[String(chainId)]
  return Array.isArray(list) ? list.filter((a) => isAddress(a)).map((a) => getAddress(a)) : []
}

export function addKnownCollection(chainId: number, address: string) {
  if (!isAddress(address)) return
  const store = read()
  const list = new Set(knownCollections(chainId))
  list.add(getAddress(address))
  store[String(chainId)] = Array.from(list).slice(-50)
  write(store)
}

export function removeKnownCollection(chainId: number, address: string) {
  const store = read()
  store[String(chainId)] = knownCollections(chainId).filter((a) => a.toLowerCase() !== address.toLowerCase())
  write(store)
}

export function onKnownCollectionsChange(cb: () => void) {
  window.addEventListener(EVENT, cb)
  return () => window.removeEventListener(EVENT, cb)
}
