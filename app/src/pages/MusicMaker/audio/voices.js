/** Clock and voice bookkeeping for the engine. No Web Audio here, so it runs under node --test. */

export function finiteOr(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** One sixteenth at this tempo. A broken or negative bpm plays at 96 instead of hanging the scheduler. */
export function stepSeconds(bpm) {
  const n = finiteOr(bpm, 96)
  return 60 / Math.max(20, Math.min(300, n > 0 ? n : 96)) / 4
}

/** Voices still sounding. One that ended, or went quiet more than `grace` ago, is dropped. */
export function liveVoices(list, now, grace = 0.03) {
  return list.filter((v) => !v.ended && (v.quietAt == null || v.quietAt > now - grace))
}

/**
 * After a background tab, the clock can sit seconds behind. Missed steps are skipped, not fired
 * in one burst. Returns how many steps to skip (0 when the clock is less than a step late).
 */
export function stepsBehind(nextTime, now, step) {
  if (!(step > 0) || !Number.isFinite(nextTime) || !Number.isFinite(now)) return 0
  const late = now - nextTime
  if (late <= step) return 0
  return Math.floor(late / step)
}

/** Step and nudge for a live hit, from the last fired step and its time. Survives tempo changes. */
export function locateStep(time, anchor, step, n, natural) {
  if (!anchor || !(step > 0) || !(n > 0)) return null
  const exact = anchor.step + (time - anchor.time) / step
  if (!Number.isFinite(exact)) return null
  const at = Math.round(exact)
  const nudge = natural ? Math.max(-50, Math.min(50, Math.round((exact - at) * 100))) : 0
  return { step: ((at % n) + n) % n, nudge }
}

/** One decoded buffer per sample entry and direction. A new entry (or rev) makes a new buffer. */
export function createBufferCache() {
  let cache = new WeakMap()
  return {
    get(context, entry, reverse, make) {
      let slot = cache.get(entry)
      if (!slot || slot.context !== context || slot.rev !== entry.rev || slot.length !== entry.pcm.length) {
        slot = { context, rev: entry.rev, length: entry.pcm.length, fwd: null, back: null }
        cache.set(entry, slot)
      }
      const key = reverse ? 'back' : 'fwd'
      if (!slot[key]) slot[key] = make(context, entry, !!reverse)
      return slot[key]
    },
    clear() {
      cache = new WeakMap()
    },
  }
}

/** Held ids that belong to one MIDI port. */
export function heldForPort(ids, portId) {
  const prefix = `midi:${portId}:`
  return ids.filter((id) => String(id).startsWith(prefix))
}

/** Every finite sample, others replaced by 0. Returns how many were bad. */
export function scrubPcm(pcm) {
  let bad = 0
  for (let i = 0; i < pcm.length; i++) {
    if (!Number.isFinite(pcm[i])) {
      pcm[i] = 0
      bad += 1
    }
  }
  return bad
}
