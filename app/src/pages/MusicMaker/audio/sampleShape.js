/** Bytes the video route returns at most. Matches the server cap. */
export const VIDEO_FETCH_CAP = 8 * 1024 * 1024

/** A pad in a saved song keeps this much of one sample. */
export const SAMPLE_SECONDS = 16

export const SAMPLE_RATES = [22050, 16000, 11025]

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}

/** `90`, `90s`, `1m30s`, `1h2m3s`. Null when it is not a time. */
export function parseClock(value) {
  if (value == null) return null
  const text = String(value).trim()
  if (!text) return null
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  const match = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/i)
  if (!match || (match[1] == null && match[2] == null && match[3] == null)) return null
  return (Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0)
}

function slugName(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (part === 'watch' || part === 'shorts' || part === 'embed' || part === 'live' || part === 'v') continue
    if (/^[a-zA-Z0-9_-]{11}$/.test(part)) continue
    let name = part
    try { name = decodeURIComponent(part) } catch { /* keep the raw segment */ }
    name = name.replace(/:[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (name && name.length > 1) return name.slice(0, 80)
  }
  return ''
}

/**
 * A start time and a name read from the link itself, before the host answers.
 * YouTube `t` / `start`, a hash `t`, and the last path word.
 */
export function urlSampleHint(raw) {
  const text = String(raw || '').trim()
  /** @type {number | null} */
  let startSec = null
  let name = ''
  if (/^lbry:\/\//i.test(text)) {
    name = slugName(text.replace(/^lbry:\/\//i, ''))
    return { startSec, name }
  }
  try {
    const url = new URL(text)
    startSec = parseClock(url.searchParams.get('t') || url.searchParams.get('start') || url.searchParams.get('time_continue'))
    if (url.hash) {
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
      const fromHash = parseClock(hash.get('t') || hash.get('start'))
      if (fromHash != null) startSec = fromHash
    }
    name = slugName(url.pathname)
  } catch {
    name = ''
  }
  return { startSec, name }
}

/** Box-filter to `to` Hz. The same rate, or a faster one, is returned as-is. */
export function downsample(pcm, from, to) {
  const srcRate = from || 44100
  const dstRate = to || srcRate
  if (!(dstRate > 0) || dstRate >= srcRate - 1 || !pcm?.length) return pcm
  const n = Math.max(1, Math.round(pcm.length * dstRate / srcRate))
  const out = new Float32Array(n)
  const ratio = pcm.length / n
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(pcm.length, Math.max(start + 1, Math.floor((i + 1) * ratio)))
    let sum = 0
    for (let j = start; j < end; j++) sum += pcm[j]
    out[i] = sum / (end - start)
  }
  return out
}

/**
 * Crop to seconds, then downsample. Longer than `cap` seconds is cut and `clipped` is set.
 * The source buffer is left alone.
 * @param {Float32Array} pcm
 * @param {number} sr
 * @param {{ inSec?: number, outSec?: number | null, rate?: number, cap?: number }} [opts]
 */
export function shapeSample(pcm, sr, { inSec = 0, outSec = null, rate = 0, cap = SAMPLE_SECONDS } = {}) {
  const inputRate = sr || 44100
  const total = pcm?.length ? pcm.length / inputRate : 0
  let aSec = clamp(Number(inSec) || 0, 0, total)
  let bSec = outSec == null ? total : clamp(Number(outSec) || 0, 0, total)
  if (bSec < aSec) {
    const swap = aSec
    aSec = bSec
    bSec = swap
  }
  let clipped = false
  const limit = Number(cap) > 0 ? Number(cap) : SAMPLE_SECONDS
  if (bSec - aSec > limit) {
    bSec = aSec + limit
    clipped = true
  }
  const a = Math.max(0, Math.floor(aSec * inputRate))
  const b = Math.min(pcm.length, Math.max(a + (pcm.length ? 1 : 0), Math.ceil(bSec * inputRate)))
  const cut = new Float32Array(Math.max(0, b - a))
  if (cut.length) cut.set(pcm.subarray(a, b))
  const target = rate > 0 && rate < inputRate - 1 ? rate : inputRate
  const shaped = downsample(cut, inputRate, target)
  return {
    pcm: shaped,
    sr: target,
    clipped,
    seconds: shaped.length / target,
  }
}

/**
 * Equal slices of the crop. Count is at least 1 and at most 16, and rises so each
 * slice can fit in `cap` seconds when that is possible.
 */
export function sliceSpan(pcm, sr, opts = {}) {
  const inputRate = sr || 44100
  const total = pcm?.length ? pcm.length / inputRate : 0
  let aSec = clamp(Number(opts.inSec) || 0, 0, total)
  let bSec = opts.outSec == null ? total : clamp(Number(opts.outSec) || 0, 0, total)
  if (bSec < aSec) {
    const swap = aSec
    aSec = bSec
    bSec = swap
  }
  const span = Math.max(0, bSec - aSec)
  const asked = Math.max(1, Math.min(16, opts.count | 0 || 1))
  const cap = Number(opts.cap) > 0 ? Number(opts.cap) : SAMPLE_SECONDS
  const need = Math.max(1, Math.ceil(span / cap - 1e-6))
  const count = Math.min(16, Math.max(asked, need))
  const pieces = []
  let clipped = false
  for (let i = 0; i < count; i++) {
    const shaped = shapeSample(pcm, inputRate, {
      inSec: aSec + (span * i) / count,
      outSec: aSec + (span * (i + 1)) / count,
      rate: opts.rate || 0,
      cap,
    })
    if (shaped.clipped) clipped = true
    pieces.push(shaped)
  }
  return { pieces, count, clipped, span }
}

export function formatClock(sec) {
  const s = Math.max(0, Number(sec) || 0)
  const m = Math.floor(s / 60)
  const r = s - m * 60
  const whole = r.toFixed(r >= 10 ? 1 : 1)
  return `${m}:${whole.padStart(4, '0')}`
}
