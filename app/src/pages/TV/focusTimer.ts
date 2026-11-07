/**
 * Lofi Girl's focus timer. It counts against the clock rather than counting ticks, so a tab the browser has slowed down
 * can't run slow. No imports, so `node --test` can run it (tests/miyatv-panels.test.mts).
 */
export const FOCUS_SECONDS = 25 * 60
export const REST_SECONDS = 5 * 60

export type FocusTimer = {
  running: boolean
  resting: boolean
  /** Seconds left, for showing. While running, `endsAt` is what counts. */
  left: number
  endsAt?: number
  /** Focus sessions finished. */
  done: number
  /** How many times it has gone from one to the other by itself: a change here is the moment to say so. */
  turns: number
}

export const newFocusTimer: FocusTimer = { running: false, resting: false, left: FOCUS_SECONDS, done: 0, turns: 0 }

export const focusLength = ({ resting }: Pick<FocusTimer, 'resting'>) => (resting ? REST_SECONDS : FOCUS_SECONDS)

export const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

/** What the set says as a new stretch begins: "Rest 05:00". */
export const focusLabel = (t: Pick<FocusTimer, 'resting'>) => `${t.resting ? 'Rest' : 'Focus'} ${mmss(focusLength(t))}`

/** Catches up with the clock, through as many changes as it slept through. The same object back if nothing shows differently. */
export function tickFocus(t: FocusTimer, now: number): FocusTimer {
  if (!t.running || t.endsAt === undefined) return t
  let { resting, endsAt, done, turns } = t
  while (now >= endsAt) {
    if (!resting) done += 1
    resting = !resting
    turns += 1
    endsAt += focusLength({ resting }) * 1000
  }

  const left = Math.ceil((endsAt - now) / 1000)
  return left === t.left && turns === t.turns ? t : { ...t, resting, endsAt, done, turns, left }
}

/** Start, or pause holding the time left. */
export function toggleFocus(t: FocusTimer, now: number): FocusTimer {
  if (!t.running) return { ...t, running: true, endsAt: now + t.left * 1000 }
  return { ...tickFocus(t, now), running: false, endsAt: undefined }
}

/** Back to a fresh 25 minutes. The finished sessions stay counted. */
export const resetFocus = (t: FocusTimer): FocusTimer => ({ ...newFocusTimer, done: t.done, turns: t.turns })
