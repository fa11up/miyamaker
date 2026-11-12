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

/** Straight snap divisions. A bar is 16 steps, so 16 is one step and 128 is an eighth of a step. */
export const GRID_DIVS = [4, 8, 16, 32, 64, 128]

export function gridDiv(value) {
  const n = Number(value)
  return GRID_DIVS.includes(n) ? n : 16
}

/** Steps per snap point. 1/16 is one step. Finer than that is a fraction of a step. */
export function gridUnit(div) {
  return 16 / gridDiv(div)
}

/**
 * Where a sequencer drag lands.
 * Snap sits on the division. Coarser than a step lands on that step and clears MOVE.
 * Finer than a step keeps the remainder as MOVE. Off keeps the fraction as MOVE.
 * `div` defaults to 16 so older callers still snap to a step.
 */
export function gridPlace(step, nudge, delta, snap, length, div) {
  const n = Math.max(1, length | 0)
  const micro = Math.max(-50, Math.min(50, Math.round(Number(nudge) || 0)))
  const from = (step | 0) + (snap ? 0 : micro / 100)
  let at = from + (Number(delta) || 0)
  const unit = gridUnit(div)
  if (snap) at = Math.round(Math.round(at / unit) * unit * 1000) / 1000
  const nearest = Math.round(at)
  let landed = nearest
  if (landed < 0) landed = 0
  if (landed > n - 1) landed = n - 1
  if ((snap && unit >= 1) || landed !== nearest) return { step: landed, nudge: 0 }
  const rest = Math.max(-50, Math.min(50, Math.round((at - nearest) * 100)))
  return { step: landed, nudge: rest }
}

/** Exclusive end of a note, in steps. Snap lands on the division. Off keeps hundredths of a step. */
export function gridEnd(edge, snap, length, div, minEdge) {
  const n = Math.max(1, length | 0)
  const unit = snap ? gridUnit(div) : 0.01
  let at = Number(edge)
  if (!Number.isFinite(at)) at = n
  if (snap) at = Math.round(Math.round(at / unit) * unit * 1000) / 1000
  else at = Math.round(at * 100) / 100
  const floor = Math.min(n, Math.max(unit, Number(minEdge) || 0))
  if (at < floor) at = floor
  if (at > n) at = n
  return at
}

/** Last step a note occupies, and how much of that step it fills (1–100). 100 is the whole step. */
export function edgeParts(edge, start) {
  const origin = Math.max(0, start | 0)
  let at = Number(edge)
  if (!Number.isFinite(at)) at = origin + 1
  const nearest = Math.round(at)
  let end
  let tail
  if (Math.abs(at - nearest) < 0.001) {
    end = nearest - 1
    tail = 100
  } else {
    end = Math.floor(at + 1e-6)
    tail = Math.round((at - end) * 100)
  }
  if (tail >= 100) tail = 100
  else if (tail <= 0) {
    end -= 1
    tail = 100
  }
  if (end < origin) {
    end = origin
    const into = Math.round((at - origin) * 100)
    tail = Math.max(1, Math.min(100, into || 1))
  }
  return { end, tail }
}

/**
 * Where a drawn sequencer note is stored.
 * `from` and `to` are the visual start and the exclusive visual end, in steps.
 * The start sits on the nearest step and MOVE pulls the bar back into place.
 * Length is the visual length, so a start stored on the next step does not collapse a short note.
 * Snap quantizes both edges. Off keeps hundredths of a step.
 */
export function chopParts(from, to, patternLength, snap, div) {
  const n = Math.max(1, patternLength | 0)
  const unit = snap ? gridUnit(div) : 0.01
  let start = Number(from)
  if (!Number.isFinite(start)) start = 0
  if (snap) start = Math.round(Math.round(start / unit) * unit * 1000) / 1000
  else start = Math.round(start * 100) / 100
  if (start < 0) start = 0
  const latest = Math.max(0, n - unit)
  if (start > latest) start = Math.round(latest * 1000) / 1000

  let end = Number(to)
  if (!Number.isFinite(end)) end = start + unit
  end = gridEnd(end, !!snap, n, div, Math.min(n, start + unit))
  let length = end - start
  if (!(length > 0)) length = Math.min(unit, Math.max(0.01, n - start))

  const placed = gridPlace(0, 0, start, !!snap, n, div)
  let parts = edgeParts(placed.step + length, placed.step)
  if (parts.end > n - 1) parts = { end: n - 1, tail: 100 }
  if (parts.end < placed.step) parts = { end: placed.step, tail: Math.max(1, Math.min(100, parts.tail)) }
  return { step: placed.step, nudge: placed.nudge, end: parts.end, tail: parts.tail }
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

/** Voices to fade so one more note fits under `cap` sounding voices: the oldest first. */
export function voicesToFade(list, cap) {
  const sounding = list.filter((v) => v && !v.dead && !v.dropped && !v.ended)
  const over = sounding.length - cap + 1
  if (over <= 0) return []
  return sounding.slice().sort((a, b) => a.startAt - b.startAt).slice(0, over)
}

/** Where a sample voice is in its pad's audio, 0-1 (flipped for a reversed pad). `play` is what playPad stored. */
export function playFraction(play, startAt, rate, now) {
  const dur = Math.max(0.0001, play.dur || 0.0001)
  const elapsed = Math.max(0, (now - startAt) * (rate || 1))
  let bufTime
  if (play.mode === 'held') {
    const first = Math.max(0.0001, play.end - play.offset)
    if (elapsed <= first) bufTime = play.offset + elapsed
    else {
      const loopLen = Math.max(0.0001, play.end - play.loopAt)
      bufTime = play.loopAt + ((elapsed - first) % loopLen)
    }
  } else if (play.mode === 'loop') {
    const loopLen = Math.max(0.0001, play.end - play.offset)
    bufTime = play.offset + (elapsed % loopLen)
  } else if (play.mode === 'gate') {
    bufTime = Math.min(dur, play.offset + elapsed)
  } else {
    bufTime = Math.min(play.end, play.offset + elapsed)
  }
  const buf = Math.max(0, Math.min(1, bufTime / dur))
  return play.reverse ? 1 - buf : buf
}
