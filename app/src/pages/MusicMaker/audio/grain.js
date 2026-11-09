/** Thrash Tracker grain units. SL and LP are fractions of the whole sample, denominator 65536. */

export const GRAIN_DENOM = 65536

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Where one tracker hit reads the sample.
 * A missing SL/LP leaves the pad trim alone (`null`).
 * SL is the start. LP length is the grain. LP move is signed and advances the window.
 * A negative move plays the grain backward.
 */
export function sampleWindow(length, pad, ev) {
  const n = Math.max(1, length | 0)
  const sl = finite(ev?.sl) ? Math.max(0, Math.min(65535, ev.sl | 0)) : null
  const len = finite(ev?.len) ? Math.max(0, Math.min(65535, ev.len | 0)) : null
  const move = finite(ev?.move) ? Math.max(-32768, Math.min(32767, ev.move | 0)) : null
  if (sl == null && len == null && move == null) return null
  const trimStart = Math.max(0, Math.min(0.98, pad?.trimStart ?? 0))
  const trimEnd = Math.max(trimStart + 0.01, Math.min(1, pad?.trimEnd ?? 1))
  const start = sl == null
    ? Math.min(n - 1, Math.floor(trimStart * n))
    : Math.min(n - 1, Math.floor((sl / GRAIN_DENOM) * n))
  let lenSamples
  if (len == null) {
    const end = sl == null ? Math.floor(trimEnd * n) : n
    lenSamples = Math.max(1, end - start)
  } else {
    lenSamples = Math.max(1, Math.round((len / GRAIN_DENOM) * n))
  }
  let moveSamples = 0
  if (move != null) {
    moveSamples = Math.round((move / GRAIN_DENOM) * n)
    if (move !== 0 && moveSamples === 0) moveSamples = move < 0 ? -1 : 1
  }
  return {
    start,
    lenSamples,
    moveSamples,
    loop: len != null || move != null,
    backward: move != null && move < 0,
  }
}

export function formatSl(value) {
  if (!finite(value)) return '----'
  return (value & 0xffff).toString(16).toUpperCase().padStart(4, '0')
}

export function formatLp(move, len) {
  if (!finite(move) || !finite(len)) return '--------'
  const head = (move & 0xffff).toString(16).toUpperCase().padStart(4, '0')
  const tail = (len & 0xffff).toString(16).toUpperCase().padStart(4, '0')
  return head + tail
}

/** High half of a 16-bit field steps backward. FFFF is −1. */
export function signed16(value) {
  const bits = value & 0xffff
  return bits >= 0x8000 ? bits - 0x10000 : bits
}

export function readGrain(pcm, pos, len, backward) {
  const n = pcm.length
  const out = new Float32Array(Math.max(0, len | 0))
  if (!n || !out.length) return out
  for (let i = 0; i < out.length; i++) {
    const at = backward ? pos - i : pos + i
    out[i] = pcm[((at % n) + n) % n]
  }
  return out
}

/** One grain, or several short ones stitched so the voice is not a click. */
export function stitchGrains(pcm, pos, lenSamples, moveSamples, backward, minSamples, loop) {
  const chunks = []
  let cursor = pos
  let total = 0
  let guard = 0
  const goal = loop ? Math.max(lenSamples, minSamples) : lenSamples
  while (total < goal && guard < 80) {
    const piece = readGrain(pcm, cursor, lenSamples, backward)
    chunks.push(piece)
    total += piece.length
    guard += 1
    if (!loop) break
    cursor += moveSamples
    if (lenSamples >= minSamples) break
  }
  const out = new Float32Array(total)
  let at = 0
  chunks.forEach((piece) => {
    out.set(piece, at)
    at += piece.length
  })
  return { pcm: out, pos: cursor }
}
