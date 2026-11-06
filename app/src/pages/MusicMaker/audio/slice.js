/** Even slices, the way a tracker chops one file into equal pad regions. */

export function sliceCount(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n < 2 || n > 64) return null
  return n
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
