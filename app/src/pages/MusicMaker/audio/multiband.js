/** Four-band master compressor. Crossovers and per-band dynamics. No audio nodes here. */

export const BANDS = 4
const X_MIN = 40
const X_MAX = 16000
const MIN_RATIO = 1.4

function num(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

export function defaultBand() {
  return { threshold: -18, ratio: 2, knee: 6, attack: 0.01, release: 0.12, gain: 0, solo: false, mute: false }
}

/** Low, low-mid, and high crossover, in Hz. */
export function defaultCrossovers() {
  return [120, 800, 5000]
}

/** Keep three crossovers in order, each at least a small step above the last. */
export function clampCrossovers(raw) {
  const base = defaultCrossovers()
  const out = [0, 1, 2].map((i) => num(Array.isArray(raw) ? raw[i] : undefined, base[i], X_MIN, X_MAX))
  out[0] = Math.min(out[0], X_MAX / (MIN_RATIO * MIN_RATIO))
  out[1] = Math.max(out[1], out[0] * MIN_RATIO)
  out[2] = Math.max(out[2], out[1] * MIN_RATIO)
  out[2] = Math.min(out[2], X_MAX)
  out[1] = Math.min(out[1], out[2] / MIN_RATIO)
  out[0] = Math.min(Math.max(out[0], X_MIN), out[1] / MIN_RATIO)
  return out.map((freq) => Math.round(freq))
}

export function normalizeBands(raw) {
  const base = defaultBand()
  const list = Array.isArray(raw) ? raw : []
  return Array.from({ length: BANDS }, (_, i) => {
    const row = list[i]
    if (!row || typeof row !== 'object') return { ...base }
    return {
      threshold: num(row.threshold, base.threshold, -60, 0),
      ratio: num(row.ratio, base.ratio, 1, 20),
      knee: num(row.knee, base.knee, 0, 40),
      attack: num(row.attack, base.attack, 0.001, 0.5),
      release: num(row.release, base.release, 0.01, 1.2),
      gain: num(row.gain, base.gain, -24, 24),
      solo: !!row.solo,
      mute: !!row.mute,
    }
  })
}

export function dbToGain(db) {
  return 10 ** (num(db, 0, -24, 24) / 20)
}
