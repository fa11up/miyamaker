/**
 * Pure playlist queue for miya radio: ordering, next/prev, shuffle and repeat. No DOM, no React, so it is
 * unit tested with `node --test` (tests/radio-queue.test.mts). Every function returns a new state.
 *
 * `tracks` keeps insertion order (what the playlist pane shows). `order` is the play order: a permutation
 * of track indexes (identity when shuffle is off). `position` indexes into `order`; -1 means nothing loaded.
 */
import type { Track } from './types'

export type RepeatMode = 'off' | 'all' | 'one'

export type QueueState = {
  tracks: Track[]
  order: number[]
  position: number
  shuffle: boolean
  repeat: RepeatMode
}

export type Rng = () => number

const identity = (n: number) => Array.from({ length: n }, (_, i) => i)

/** Fisher–Yates with an injectable RNG (tests pass a seeded one). */
export function shuffled<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i] as T
    out[i] = out[j] as T
    out[j] = tmp
  }
  return out
}

export function createQueue(tracks: readonly Track[] = [], repeat: RepeatMode = 'off'): QueueState {
  const unique = dedupe(tracks)
  return {
    tracks: unique,
    order: identity(unique.length),
    position: unique.length ? 0 : -1,
    shuffle: false,
    repeat,
  }
}

function dedupe(tracks: readonly Track[], existing: readonly Track[] = []): Track[] {
  const seen = new Set(existing.map((t) => t.id))
  const out: Track[] = []
  tracks.forEach((t) => {
    if (seen.has(t.id)) return
    seen.add(t.id)
    out.push(t)
  })
  return out
}

/** Index into `tracks` of the loaded track, or -1. */
export function currentIndex(state: QueueState): number {
  if (state.position < 0) return -1
  return state.order[state.position] ?? -1
}

export function currentTrack(state: QueueState): Track | undefined {
  const i = currentIndex(state)
  return i < 0 ? undefined : state.tracks[i]
}

/** Append tracks (duplicates by id are ignored). Loads the first one if the queue was empty. */
export function enqueue(state: QueueState, incoming: readonly Track[]): QueueState {
  const added = dedupe(incoming, state.tracks)
  if (!added.length) return state
  const start = state.tracks.length
  const tracks = [...state.tracks, ...added]
  const newIdx = added.map((_, i) => start + i)
  return {
    ...state,
    tracks,
    // New tracks always queue after what is already there, shuffled among themselves when shuffle is on.
    order: [...state.order, ...(state.shuffle ? shuffled(newIdx) : newIdx)],
    position: state.position < 0 ? state.order.length : state.position,
  }
}

/** Jump to a track that is already in the queue (by index into `tracks`). */
export function jumpTo(state: QueueState, trackIndex: number): QueueState {
  const position = state.order.indexOf(trackIndex)
  if (position < 0) return state
  return { ...state, position }
}

/**
 * Play this track now: if it is queued, jump to it; otherwise insert it right after the current
 * track (in play order) and jump there.
 */
export function playNow(state: QueueState, track: Track): QueueState {
  const existing = state.tracks.findIndex((t) => t.id === track.id)
  if (existing >= 0) return jumpTo(state, existing)
  const idx = state.tracks.length
  const order = state.order.slice()
  const at = state.position < 0 ? order.length : state.position + 1
  order.splice(at, 0, idx)
  return { ...state, tracks: [...state.tracks, track], order, position: at }
}

/**
 * Advance. `auto` is true when the previous track ended on its own:
 *  - repeat 'one' + auto  → replay the same track
 *  - end of list + auto   → wrap if repeat 'all', otherwise stop (position stays on the last track)
 *  - end of list + manual → always wraps (like Winamp's next button)
 */
export function next(state: QueueState, opts: { auto?: boolean; rng?: Rng } = {}): { state: QueueState; stop: boolean } {
  if (state.position < 0 || !state.order.length) return { state, stop: true }
  if (opts.auto && state.repeat === 'one') return { state, stop: false }
  const last = state.position >= state.order.length - 1
  if (!last) return { state: { ...state, position: state.position + 1 }, stop: false }
  if (opts.auto && state.repeat === 'off') return { state, stop: true }
  if (state.shuffle && state.order.length > 2) {
    // New lap: reshuffle, but never replay the track that just finished first.
    const cur = currentIndex(state)
    const rest = shuffled(
      state.order.filter((i) => i !== cur),
      opts.rng
    )
    return { state: { ...state, order: [...rest, cur], position: 0 }, stop: false }
  }
  return { state: { ...state, position: 0 }, stop: false }
}

/** Seconds into a track after which "previous" restarts it instead of going back. */
export const PREV_RESTART_AFTER = 3

/** Go back. Returns `restart: true` when the caller should seek the current track to 0 instead. */
export function prev(state: QueueState, currentTime = 0): { state: QueueState; restart: boolean } {
  if (state.position < 0) return { state, restart: false }
  if (currentTime > PREV_RESTART_AFTER) return { state, restart: true }
  if (state.position > 0) return { state: { ...state, position: state.position - 1 }, restart: false }
  if (state.repeat === 'all' && state.order.length > 1) {
    return { state: { ...state, position: state.order.length - 1 }, restart: false }
  }
  return { state, restart: true }
}

/** Toggle shuffle. On: the current track stays loaded and plays first, the rest are shuffled after it. */
export function setShuffle(state: QueueState, on: boolean, rng: Rng = Math.random): QueueState {
  if (on === state.shuffle) return state
  const cur = currentIndex(state)
  if (on) {
    const rest = shuffled(
      identity(state.tracks.length).filter((i) => i !== cur),
      rng
    )
    const order = cur >= 0 ? [cur, ...rest] : rest
    return { ...state, shuffle: true, order, position: order.length ? 0 : -1 }
  }
  const order = identity(state.tracks.length)
  return { ...state, shuffle: false, order, position: cur >= 0 ? cur : order.length ? 0 : -1 }
}

const REPEAT_CYCLE: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' }

export function cycleRepeat(state: QueueState): QueueState {
  return { ...state, repeat: REPEAT_CYCLE[state.repeat] }
}

/** Remove a track (by index into `tracks`). If it was playing, the next one in play order is loaded. */
export function removeAt(state: QueueState, trackIndex: number): QueueState {
  if (trackIndex < 0 || trackIndex >= state.tracks.length) return state
  const removedPos = state.order.indexOf(trackIndex)
  const tracks = state.tracks.filter((_, i) => i !== trackIndex)
  const order = state.order.filter((i) => i !== trackIndex).map((i) => (i > trackIndex ? i - 1 : i))
  let { position } = state
  if (!order.length) position = -1
  else if (removedPos < position) position -= 1
  else if (removedPos === position) position = Math.min(position, order.length - 1)
  return { ...state, tracks, order, position }
}

export function clearQueue(state: QueueState): QueueState {
  return { ...state, tracks: [], order: [], position: -1 }
}

/** 1-based "3/12" style position label for the display. */
export function positionLabel(state: QueueState): string {
  if (state.position < 0) return '0/0'
  return `${state.position + 1}/${state.order.length}`
}
