import type { IconLayout } from './layout'

/** Saved icon cells, per device. Storage can throw (private mode, blocked site data): every access is guarded. */
const KEY = 'miyaos.icons.v1'

export function loadIconLayout(): unknown {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

export function saveIconLayout(layout: IconLayout | undefined) {
  try {
    if (layout) window.localStorage.setItem(KEY, JSON.stringify(layout))
    else window.localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: the layout lasts for this session only */
  }
}
