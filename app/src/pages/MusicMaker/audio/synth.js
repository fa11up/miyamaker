/** Harmonic sample generator. Offline render into a PCM buffer. */

export const SYNTH_SR = 44100

export function defaultPatch() {
  return {
    freq: 180,
    oscs: [
      { type: 'sine', ratio: 1, detune: 0, level: 0.8, duty: 0.5 },
      { type: 'saw', ratio: 2, detune: 4, level: 0.2, duty: 0.5 },
      { type: 'square', ratio: 3, detune: -6, level: 0.12, duty: 0.4 },
    ],
    fmFrom: 1,
    fmIndex: 0,
    fmA: 0.005,
    fmD: 0.2,
    fmS: 0.1,
    fmR: 0.1,
    partials: [0, 0, 0, 0, 0, 0, 0, 0],
    stretch: 0,
    fold: 0,
    foldEnv: 0,
    foldA: 0.005,
    foldD: 0.2,
    foldS: 0,
    foldR: 0.1,
    noise: 0,
    noiseColor: 0.2,
    pitchEnv: 0,
    pitchDecay: 0.12,
    vibRate: 0,
    vibDepth: 0,
    vibDelay: 0.05,
    unison: 1,
    unisonDetune: 8,
    filterType: 'lowpass',
    cutoff: 4000,
    q: 0.8,
    filterEnv: 0,
    fA: 0.005,
    fD: 0.18,
    fS: 0.25,
    fR: 0.15,
    filter2Type: 'off',
    cutoff2: 1200,
    q2: 1.2,
    filter2Env: 0,
    drive: 1,
    aA: 0.002,
    aD: 0.2,
    aS: 0,
    aR: 0.08,
    hold: 0,
    lfoRate: 0,
    lfoToPitch: 0,
    lfoToFilter: 0,
    repeat: 0,
  }
}

/** Keys a file must never set on a plain object: they reach the prototype. */
export const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** Own enumerable entries of a plain object, without prototype keys. */
export function safeEntries(obj) {
  if (!obj || typeof obj !== 'object') return []
  return Object.keys(obj).filter((key) => !BAD_KEYS.has(key)).map((key) => [key, obj[key]])
}

function assignSafe(target, src) {
  for (const [key, value] of safeEntries(src)) target[key] = value
}

function copyOscs(list, fallback) {
  // The renderer reads three oscillators. A short or junk list keeps the defaults for the missing ones.
  return fallback.map((base, i) => {
    const osc = { ...base }
    const src = Array.isArray(list) ? list[i] : null
    if (src && typeof src === 'object' && !Array.isArray(src)) assignSafe(osc, src)
    return osc
  })
}

export function mergePatch(base, over) {
  const p = defaultPatch()
  const oscs = p.oscs
  assignSafe(p, base)
  p.oscs = copyOscs(base?.oscs, oscs)
  p.partials = Array.isArray(base?.partials) ? base.partials.slice(0, MAX_PARTIALS) : defaultPatch().partials
  if (!over) return p
  const merged = p.oscs
  assignSafe(p, over)
  p.oscs = copyOscs(over.oscs, merged)
  const partials = Array.isArray(over.partials) ? over.partials : Array.isArray(base?.partials) ? base.partials : defaultPatch().partials
  p.partials = partials.slice(0, MAX_PARTIALS)
  return p
}

/** Partials past this are dropped: each one is a sine per sample per unison voice. */
export const MAX_PARTIALS = 16
export const MAX_UNISON = 4

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v))
}

function adsr(t, a, d, s, r, total) {
  if (t < 0) return 0
  const aa = Math.max(0, a)
  const dd = Math.max(0, d)
  const rr = Math.max(0, r)
  if (t < aa) return aa <= 0.00001 ? 1 : t / aa
  if (t < aa + dd) {
    const x = dd <= 0.00001 ? 1 : (t - aa) / dd
    return 1 + (s - 1) * x
  }
  const relStart = Math.max(aa + dd, total - rr)
  if (t < relStart) return s
  if (rr <= 0.00001) return 0
  const x = (t - relStart) / rr
  if (x >= 1) return 0
  return s * (1 - x)
}

function wave(type, phase, duty) {
  const p = phase - Math.floor(phase)
  switch (type) {
    case 'sine':
      return Math.sin(p * Math.PI * 2)
    case 'triangle':
      return 2 * Math.abs(2 * (p - 0.5)) - 1
    case 'saw':
      return 2 * p - 1
    case 'square':
    case 'pulse':
      return p < (duty || 0.5) ? 1 : -1
    case 'metal': {
      const a = Math.sin(p * Math.PI * 2)
      const b = Math.sin(p * Math.PI * 2 * 2.404)
      const c = Math.sin(p * Math.PI * 2 * 5.17)
      return (a * 0.6 + b * 0.3 + c * 0.25) * (0.7 + 0.3 * a)
    }
    default:
      return Math.sin(p * Math.PI * 2)
  }
}

function foldSample(x, amt) {
  if (amt <= 0.0001) return x
  const k = 1 + amt * 8
  let y = Math.sin(x * k)
  y = Math.sin(y * (1 + amt * 2))
  return y
}

function Biquad(sr) {
  this.sr = sr
  this.x1 = 0
  this.x2 = 0
  this.y1 = 0
  this.y2 = 0
  this.b0 = 1
  this.b1 = 0
  this.b2 = 0
  this.a1 = 0
  this.a2 = 0
  this.freq = -1
  this.q = -1
  this.type = ''
}

Biquad.prototype.set = function set(type, freq, q) {
  const f = clamp(freq, 30, this.sr * 0.45)
  const qq = clamp(q, 0.15, 18)
  if (type === this.type && Math.abs(f - this.freq) < 0.5 && Math.abs(qq - this.q) < 0.01) return
  this.type = type
  this.freq = f
  this.q = qq
  const w0 = (2 * Math.PI * f) / this.sr
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const alpha = sin / (2 * qq)
  let b0
  let b1
  let b2
  let a0
  let a1
  let a2
  if (type === 'highpass') {
    b0 = (1 + cos) / 2
    b1 = -(1 + cos)
    b2 = (1 + cos) / 2
  } else if (type === 'bandpass') {
    b0 = alpha
    b1 = 0
    b2 = -alpha
  } else {
    b0 = (1 - cos) / 2
    b1 = 1 - cos
    b2 = (1 - cos) / 2
  }
  a0 = 1 + alpha
  a1 = -2 * cos
  a2 = 1 - alpha
  this.b0 = b0 / a0
  this.b1 = b1 / a0
  this.b2 = b2 / a0
  this.a1 = a1 / a0
  this.a2 = a2 / a0
}

Biquad.prototype.tick = function tick(x) {
  const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
  this.x2 = this.x1
  this.x1 = x
  this.y2 = this.y1
  this.y1 = y
  if (!Number.isFinite(y)) {
    this.x1 = this.x2 = this.y1 = this.y2 = 0
    return 0
  }
  return y
}

function ampTotal(p) {
  const hold = p.aS > 0.02 ? Math.max(0, p.hold || 0) : 0
  return Math.max(0.05, p.aA + p.aD + hold + p.aR)
}

export function renderSynth(patch, sampleRate = SYNTH_SR) {
  const p = mergePatch(patch)
  const sr = sampleRate
  const total = Math.min(4, ampTotal(p) + (p.repeat > 0 ? 0.4 : 0))
  const n = Math.max(8, Math.floor(total * sr))
  const pcm = new Float32Array(n)
  const unison = clamp(Math.round(Number(p.unison) || 1), 1, MAX_UNISON)
  const phases = []
  for (let u = 0; u < unison; u++) phases.push([0, 0, 0])
  const filters = []
  const filters2 = []
  for (let u = 0; u < unison; u++) {
    filters.push(new Biquad(sr))
    filters2.push(new Biquad(sr))
  }
  let noiseMem = 0
  let lfo = 0
  let vib = 0
  const fmFrom = p.fmFrom == null ? 1 : p.fmFrom

  for (let i = 0; i < n; i++) {
    const tAbs = i / sr
    const t = p.repeat > 0 ? tAbs % (1 / p.repeat) : tAbs
    const aEnv = adsr(t, p.aA, p.aD, p.aS, p.aR, p.repeat > 0 ? 1 / p.repeat : total)
    const fEnv = adsr(t, p.fA, p.fD, p.fS, p.fR, p.repeat > 0 ? 1 / p.repeat : total)
    const fmEnv = adsr(t, p.fmA, p.fmD, p.fmS, p.fmR, p.repeat > 0 ? 1 / p.repeat : total)
    const foldEnv = adsr(t, p.foldA, p.foldD, p.foldS, p.foldR, p.repeat > 0 ? 1 / p.repeat : total)
    const pEnv = Math.exp(-t / Math.max(0.004, p.pitchDecay || 0.1))
    lfo += (2 * Math.PI * (p.lfoRate || 0)) / sr
    vib += (2 * Math.PI * (p.vibRate || 0)) / sr
    const vibAmt = tAbs > (p.vibDelay || 0) ? Math.sin(vib) * (p.vibDepth || 0) : 0
    const lfoS = Math.sin(lfo)
    let freq =
      (p.freq || 110) *
      Math.pow(2, ((p.pitchEnv || 0) * pEnv + vibAmt + lfoS * (p.lfoToPitch || 0)) / 12)

    let mixed = 0
    for (let u = 0; u < unison; u++) {
      const spread = (u - (unison - 1) / 2) * (p.unisonDetune || 0)
      const detFreq = freq * Math.pow(2, spread / 1200)
      const ph = phases[u]
      const raw = [0, 0, 0]
      for (let o = 0; o < 3; o++) {
        const osc = p.oscs[o]
        const ratio = osc.ratio || 1
        const det = Math.pow(2, (osc.detune || 0) / 1200)
        ph[o] += (detFreq * ratio * det) / sr
        raw[o] = wave(osc.type, ph[o], osc.duty)
      }
      let carPhase = ph[0]
      if (fmFrom >= 0 && fmFrom < 3 && p.fmIndex) {
        carPhase += raw[fmFrom] * p.fmIndex * fmEnv
      }
      let sig = wave(p.oscs[0].type, carPhase, p.oscs[0].duty) * (p.oscs[0].level || 0)
      sig += raw[1] * (p.oscs[1].level || 0)
      sig += raw[2] * (p.oscs[2].level || 0)
      const partials = p.partials || []
      for (let h = 0; h < partials.length; h++) {
        const lvl = partials[h]
        if (!lvl) continue
        const harm = (h + 1) * (1 + (p.stretch || 0) * h)
        sig += Math.sin(ph[0] * harm * Math.PI * 2) * lvl
      }
      if (p.noise > 0) {
        const white = Math.random() * 2 - 1
        const color = clamp(p.noiseColor || 0, 0, 0.98)
        noiseMem += (white - noiseMem) * (1 - color * 0.96)
        sig += (color > 0.05 ? noiseMem : white) * p.noise
      }
      const foldAmt = clamp((p.fold || 0) + (p.foldEnv || 0) * foldEnv, 0, 1.4)
      sig = foldSample(sig, foldAmt)
      const drive = p.drive || 1
      if (drive !== 1) sig = Math.tanh(sig * drive)

      const cents = (p.filterEnv || 0) * fEnv + lfoS * (p.lfoToFilter || 0)
      const cut = clamp((p.cutoff || 2000) * Math.pow(2, cents / 12), 40, 18000)
      filters[u].set(p.filterType || 'lowpass', cut, p.q || 0.7)
      sig = filters[u].tick(sig)
      if (p.filter2Type && p.filter2Type !== 'off') {
        const cut2 = clamp((p.cutoff2 || 1200) * Math.pow(2, ((p.filter2Env || 0) * fEnv) / 12), 40, 18000)
        filters2[u].set(p.filter2Type, cut2, p.q2 || 1)
        sig = filters2[u].tick(sig)
      }
      mixed += sig
    }
    mixed /= unison
    mixed *= aEnv
    pcm[i] = Number.isFinite(mixed) ? mixed : 0
  }

  let peak = 0
  for (let i = 0; i < n; i++) {
    const a = Math.abs(pcm[i])
    if (a > peak) peak = a
  }
  if (peak > 0.0001) {
    const g = 0.89 / peak
    for (let i = 0; i < n; i++) pcm[i] *= g
  }
  return { pcm, sampleRate: sr, peak: 0.89, seconds: n / sr }
}

export function spectralCentroid(pcm, sampleRate, start, length) {
  const N = 512
  const from = Math.max(0, start | 0)
  let re = 0
  let magSum = 0
  let weighted = 0
  const half = N / 2
  for (let k = 1; k < half; k++) {
    let rr = 0
    let ii = 0
    const w = (2 * Math.PI * k) / N
    for (let n = 0; n < N; n++) {
      const idx = from + n
      const s = idx < pcm.length ? pcm[idx] : 0
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1))
      const x = s * hann
      rr += x * Math.cos(w * n)
      ii -= x * Math.sin(w * n)
    }
    const mag = Math.sqrt(rr * rr + ii * ii)
    const freq = (k * sampleRate) / N
    magSum += mag
    weighted += mag * freq
    re += mag
  }
  if (magSum < 1e-8) return 0
  return weighted / magSum
}

/** A synth take is 64 KB of mono audio. The bit depth is both the crunch and the length. */
export const TAKE_BYTES = 65536

export function takeDepth(depth) {
  const n = depth | 0
  return n === 8 || n === 16 || n === 24 || n === 32 ? n : 16
}

export function takeMaxSamples(depth) {
  return Math.floor(TAKE_BYTES / (takeDepth(depth) / 8))
}

export function takeSeconds(depth, sampleRate = SYNTH_SR) {
  const rate = sampleRate > 0 ? sampleRate : SYNTH_SR
  return takeMaxSamples(depth) / rate
}

/** Step one sample onto that bit depth. 8-bit is the crunchiest and the longest take. */
export function quantizeSample(x, depth) {
  const bits = takeDepth(depth)
  const max = bits === 32 ? 2147483647 : (1 << (bits - 1)) - 1
  const n = Math.max(-1, Math.min(1, Number(x) || 0))
  const q = Math.max(-max, Math.min(max, Math.round(n * max)))
  return q / max
}

export function quantizeTake(pcm, depth) {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = quantizeSample(pcm[i], depth)
  return out
}

/**
 * Mix one rendered note into a take.
 * `rate` is source samples advanced per output sample.
 * `srcAt` is the source position at `start`.
 * Writing stops at the end of either buffer. The return is the first output index not written.
 */
export function mixNote(dest, src, { start = 0, rate = 1, vel = 1, until = dest.length, srcAt = 0 } = {}) {
  if (!dest?.length || !src?.length) return start | 0
  const step = Math.max(1 / 64, Math.min(64, Number(rate) || 1))
  const gain = Math.max(0, Math.min(1, Number(vel) || 0))
  const from = Math.max(0, start | 0)
  const end = Math.max(from, Math.min(dest.length, until | 0))
  let at = Number(srcAt) || 0
  for (let i = from; i < end; i++) {
    if (at >= src.length) return i
    const i0 = at | 0
    const frac = at - i0
    const a = src[i0] || 0
    const b = i0 + 1 < src.length ? src[i0 + 1] : a
    let sample = dest[i] + (a + (b - a) * frac) * gain
    if (sample > 1) sample = 1
    else if (sample < -1) sample = -1
    dest[i] = sample
    at += step
  }
  return end
}
