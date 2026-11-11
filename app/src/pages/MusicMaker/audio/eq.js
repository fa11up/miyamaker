/** Five-band channel EQ. Pure data and the curve the graph draws. No audio nodes here. */

export const EQ_TYPES = ['low', 'bell', 'high']
export const EQ_BANDS = 5

const FREQ_MIN = 20
const FREQ_MAX = 20000

function num(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function band(type, freq, gain, q) {
  return { type, freq, gain, q, dyn: false, range: 8, thresh: -18 }
}

export function defaultEq() {
  return [
    band('low', 40, 0, 0.71),
    band('bell', 180, 0, 1),
    band('bell', 1000, 0, 1),
    band('bell', 4500, 0, 1),
    band('high', 16000, 0, 0.71),
  ]
}

function normalizeBand(raw, base) {
  if (!raw || typeof raw !== 'object') return { ...base }
  return {
    type: EQ_TYPES.includes(raw.type) ? raw.type : base.type,
    freq: num(raw.freq, base.freq, FREQ_MIN, FREQ_MAX),
    gain: num(raw.gain, base.gain, -18, 18),
    q: num(raw.q, base.q, 0.2, 12),
    dyn: !!raw.dyn,
    range: num(raw.range, base.range, 0, 18),
    thresh: num(raw.thresh, base.thresh, -60, 0),
  }
}

export function normalizeEq(raw) {
  const base = defaultEq()
  const list = Array.isArray(raw) ? raw : []
  return base.map((row, i) => normalizeBand(list[i], row))
}

export function freqToX(freq, width) {
  const min = Math.log(FREQ_MIN)
  const max = Math.log(FREQ_MAX)
  const f = Math.max(FREQ_MIN, Math.min(FREQ_MAX, freq))
  return ((Math.log(f) - min) / (max - min)) * width
}

export function xToFreq(x, width) {
  const min = Math.log(FREQ_MIN)
  const max = Math.log(FREQ_MAX)
  const t = width > 0 ? Math.max(0, Math.min(1, x / width)) : 0
  return Math.exp(min + t * (max - min))
}

export function dbToY(db, height) {
  return ((18 - Math.max(-24, Math.min(18, db))) / 42) * height
}

export function yToDb(y, height) {
  const t = height > 0 ? Math.max(0, Math.min(1, y / height)) : 0
  return 18 - t * 42
}

/** Magnitude in dB of one Web Audio biquad at `freq`. */
function biquadDb(kind, freq, sampleRate, f0, q, gainDb) {
  const fs = sampleRate > 1000 ? sampleRate : 48000
  const A = 10 ** (gainDb / 40)
  const w0 = (2 * Math.PI * Math.max(1, f0)) / fs
  const cos0 = Math.cos(w0)
  const sin0 = Math.sin(w0)
  const alpha = sin0 / (2 * Math.max(0.05, q))
  let b0
  let b1
  let b2
  let a0
  let a1
  let a2
  if (kind === 'highpass') {
    b0 = (1 + cos0) / 2
    b1 = -(1 + cos0)
    b2 = (1 + cos0) / 2
    a0 = 1 + alpha
    a1 = -2 * cos0
    a2 = 1 - alpha
  } else if (kind === 'lowpass') {
    b0 = (1 - cos0) / 2
    b1 = 1 - cos0
    b2 = (1 - cos0) / 2
    a0 = 1 + alpha
    a1 = -2 * cos0
    a2 = 1 - alpha
  } else {
    b0 = 1 + alpha * A
    b1 = -2 * cos0
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * cos0
    a2 = 1 - alpha / A
  }
  const w = (2 * Math.PI * Math.max(1, freq)) / fs
  const c1 = Math.cos(w)
  const s1 = Math.sin(w)
  const c2 = Math.cos(2 * w)
  const s2 = Math.sin(2 * w)
  const nr = b0 + b1 * c1 + b2 * c2
  const ni = -(b1 * s1 + b2 * s2)
  const dr = a0 + a1 * c1 + a2 * c2
  const di = -(a1 * s1 + a2 * s2)
  const mag = Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di + 1e-20))
  return 20 * Math.log10(mag + 1e-12)
}

function kindOf(type) {
  if (type === 'low') return 'highpass'
  if (type === 'high') return 'lowpass'
  return 'peaking'
}

/** Sum of the five bands plus each dynamic dip (`env` is dB already taken off). */
export function responseAt(freq, bands, sampleRate, env) {
  let db = 0
  const list = Array.isArray(bands) ? bands : []
  for (let i = 0; i < list.length; i++) {
    const row = list[i]
    if (!row) continue
    const kind = kindOf(row.type)
    db += biquadDb(kind, freq, sampleRate, row.freq, row.q, kind === 'peaking' ? row.gain : 0)
    const dip = env && env[i] > 0.05 ? env[i] : 0
    if (dip) db += biquadDb('peaking', freq, sampleRate, row.freq, Math.max(0.5, row.q), -dip)
  }
  return db
}

export function responsePath(bands, width, height, sampleRate, env) {
  const steps = 96
  let d = ''
  for (let i = 0; i < steps; i++) {
    const freq = xToFreq((i / (steps - 1)) * width, width)
    const db = responseAt(freq, bands, sampleRate, env)
    const x = freqToX(freq, width)
    const y = Math.max(0, Math.min(height, dbToY(db, height)))
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}
