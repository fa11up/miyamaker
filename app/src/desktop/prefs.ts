import { useEffect, useState, useSyncExternalStore } from 'react'

import { clampDelayMinutes, DEFAULT_DELAY_MIN } from './screensaver/idle'

/**
 * Desktop preferences (pet, screensaver). Kept in their own localStorage key rather than the redux
 * store so the desktop extras stay self-contained. Storage can throw (private mode, blocked
 * cookies); every access is guarded and the defaults apply.
 */
export interface DesktopPrefs {
  petEnabled: boolean
  petId: string
  /** look of a pet with variants (fren pets); empty = a random one each visit */
  petVariant: string
  screensaverEnabled: boolean
  /** minutes */
  screensaverDelay: number
  mintFeedEnabled: boolean
}

export const DEFAULT_PREFS: DesktopPrefs = {
  petEnabled: false,
  petId: 'fumo',
  petVariant: '',
  screensaverEnabled: true,
  screensaverDelay: DEFAULT_DELAY_MIN,
  mintFeedEnabled: true,
}

const KEY = 'miyaos.desktop.v1'

function read(): DesktopPrefs {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<DesktopPrefs>
    return {
      petEnabled: typeof parsed.petEnabled === 'boolean' ? parsed.petEnabled : DEFAULT_PREFS.petEnabled,
      petId: typeof parsed.petId === 'string' ? parsed.petId : DEFAULT_PREFS.petId,
      petVariant: typeof parsed.petVariant === 'string' ? parsed.petVariant : DEFAULT_PREFS.petVariant,
      screensaverEnabled:
        typeof parsed.screensaverEnabled === 'boolean' ? parsed.screensaverEnabled : DEFAULT_PREFS.screensaverEnabled,
      screensaverDelay: clampDelayMinutes(parsed.screensaverDelay ?? DEFAULT_PREFS.screensaverDelay),
      mintFeedEnabled:
        typeof parsed.mintFeedEnabled === 'boolean' ? parsed.mintFeedEnabled : DEFAULT_PREFS.mintFeedEnabled,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

let current: DesktopPrefs | undefined
const listeners = new Set<() => void>()

function get(): DesktopPrefs {
  if (!current) current = read()
  return current
}

export function setPrefs(patch: Partial<DesktopPrefs>) {
  current = { ...get(), ...patch }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* storage unavailable: keep the in-memory value for this session */
  }

  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    current = read()
    listener()
  }

  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useDesktopPrefs(): DesktopPrefs {
  return useSyncExternalStore(subscribe, get, () => DEFAULT_PREFS)
}

/* ---------- tiny event bus between the desktop extras ---------- */

export const DESKTOP_EVENTS = {
  screensaverPreview: 'miyaos:screensaver-preview',
  /** desktop icons moved (drag, keyboard, arrange): anything measuring them should re-read rects */
  iconsMoved: 'miyaos:icons-moved',
  /** context menu "Arrange icons": back to the default grid */
  arrangeIcons: 'miyaos:arrange-icons',
} as const

export function startScreensaverPreview() {
  window.dispatchEvent(new CustomEvent(DESKTOP_EVENTS.screensaverPreview))
}

/* ---------- prefers-reduced-motion ---------- */

const RM_QUERY = '(prefers-reduced-motion: reduce)'

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia(RM_QUERY).matches
    } catch {
      return false
    }
  })
  useEffect(() => {
    let mq: MediaQueryList
    try {
      mq = window.matchMedia(RM_QUERY)
    } catch {
      return undefined
    }

    const onChange = () => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}
