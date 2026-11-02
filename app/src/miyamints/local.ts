import { getAddress, isAddress } from 'viem'

import type { LaunchKind } from './collections'

/**
 * Collections this browser launched (shown in "My launches" right away, before the registry scan catches up)
 * and legacy MiyaMints v1 collections opened in Manage. A per-viewer convenience: storage may be unavailable,
 * so every access is guarded and the on-chain owner check still decides what is listed.
 */
const KEY = 'miya-launches:v1'
export const LAUNCHES_EVENT = 'miya-launches:changed'

export type LocalLaunch = { chainId: number; address: `0x${string}`; kind: LaunchKind; at: number }

function read(): LocalLaunch[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((r) => r && typeof r.chainId === 'number' && typeof r.address === 'string' && isAddress(r.address))
      .map((r) => ({ ...r, address: getAddress(r.address) }))
  } catch {
    return []
  }
}

export function localLaunches(): LocalLaunch[] {
  return read()
}

export function rememberLaunch(chainId: number, address: string, kind: LaunchKind) {
  if (!isAddress(address)) return
  const list = read().filter((r) => !(r.chainId === chainId && r.address.toLowerCase() === address.toLowerCase()))
  list.push({ chainId, address: getAddress(address), kind, at: Date.now() })
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(-100)))
  } catch {
    // storage blocked: the registry scan still finds it
  }

  window.dispatchEvent(new Event(LAUNCHES_EVENT))
}

export function onLaunchesChange(cb: () => void) {
  window.addEventListener(LAUNCHES_EVENT, cb)
  return () => window.removeEventListener(LAUNCHES_EVENT, cb)
}
