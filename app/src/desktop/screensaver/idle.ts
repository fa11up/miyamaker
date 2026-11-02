/**
 * Screensaver idle gate. Pure so it can be unit tested; the hook in useScreensaverGate.ts
 * feeds it real timestamps and DOM state.
 */

export const DELAY_CHOICES_MIN = [1, 2, 3, 5, 10, 15, 30] as const
export const DEFAULT_DELAY_MIN = 3

export function clampDelayMinutes(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DELAY_MIN
  return Math.min(120, Math.max(0.25, n))
}

export interface IdleGateInput {
  now: number
  lastActivity: number
  delayMs: number
  enabled: boolean
  /** something important is going on: a wallet prompt, a pending tx, a focused text field */
  blocked: boolean
}

/** ms until the screensaver may start; Infinity when it never should right now. */
export function idleRemaining({ now, lastActivity, delayMs, enabled, blocked }: IdleGateInput): number {
  if (!enabled || blocked || !(delayMs > 0)) return Infinity
  return Math.max(0, lastActivity + delayMs - now)
}

export function shouldStartScreensaver(input: IdleGateInput): boolean {
  return idleRemaining(input) === 0
}

/** Is this element one the user types into? (focus there blocks the screensaver) */
export function isTextEntry(el: { tagName?: string; isContentEditable?: boolean; type?: string } | null): boolean {
  if (!el || !el.tagName) return false
  const tag = el.tagName.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  if (tag !== 'INPUT') return false
  const type = (el.type || 'text').toLowerCase()
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(type)
}

/**
 * A pointer move only counts as "wake up" once it travelled a few px from where the screensaver
 * started, so a jittery mouse or the preview button's own click doesn't dismiss it instantly.
 */
export function movedEnough(from: { x: number; y: number } | undefined, to: { x: number; y: number }, px = 12) {
  if (!from) return false
  return Math.hypot(to.x - from.x, to.y - from.y) >= px
}
