/** Even slices, the way a tracker chops one file into equal pad regions. */

export function sliceCount(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n < 2 || n > 64) return null
  return n
}

/** Boundaries from 0 to 1, one more point than there are slices. */
export function evenPoints(count) {
  const n = sliceCount(count)
  if (!n) return []
  const points = []
  for (let i = 0; i <= n; i++) points.push(i / n)
  return points
}

/** Equal lengths. A remainder shorter than one slice is left off the end. */
export function evenSlices(pcm, count) {
  const n = sliceCount(count)
  if (!n) throw new Error('Slice count is 2 to 64')
  const len = Math.floor(pcm.length / n)
  if (len < 1) throw new Error('That sample is shorter than the slice count')
  const out = []
  for (let i = 0; i < n; i++) out.push(new Float32Array(pcm.subarray(i * len, (i + 1) * len)))
  return out
}

/** Sample indexes [a, b) of a pad's trim, at least one sample, inside `n`. */
export function chopRange(n, trimStart, trimEnd) {
  const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
  let a = Math.floor(clamp01(trimStart || 0) * n)
  let b = Math.ceil(clamp01(trimEnd ?? 1) * n)
  a = Math.max(0, Math.min(n - 1, a))
  b = Math.max(a + 1, Math.min(n, b))
  return [a, b]
}

/** The next empty pad after `from`, wrapping, never `from` itself; -1 if every other pad is used. */
export function nextEmptyPad(pads, from, count = 64) {
  for (let i = 1; i < count; i++) {
    const at = (from + i) % count
    if (pads[at]?.source === 'empty') return at
  }
  return -1
}
