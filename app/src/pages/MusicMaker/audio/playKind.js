/**
 * How a sample voice plays. One-shot stays one-shot while a pad is held, so a
 * drum roll cannot leave the end cycling. Loop mode is the opt-in for that.
 * Tracker clock and tracker keys are one-shots. Grain follows the caller.
 */
export function samplePlayKind({ grain = false, pattern = false, trackerNote = false, mode = 'oneshot' } = {}) {
  if (grain) return 'grain'
  if (pattern || trackerNote) return 'oneshot'
  if (mode === 'loop') return 'loop'
  if (mode === 'gate') return 'gate'
  return 'oneshot'
}

/**
 * Next arranger cell. `section` stays. `once` returns -1 at the end (stop).
 * Anything else wraps to the first cell.
 */
export function nextSongCursor(cursor, length, loop) {
  const n = length | 0
  const at = cursor | 0
  if (n <= 0) return 0
  if (loop === 'section') return Math.max(0, Math.min(n - 1, at))
  const next = at + 1
  if (next < n) return next
  if (loop === 'once') return -1
  return 0
}
