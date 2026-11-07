/** Master insert: stock DynamicsCompressor, or the four-knob knee processor. */

export const PITCH_SNAPS = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]

export function snapOctave(value, enabled) {
  const v = Math.max(-2, Math.min(2, Number(value) || 0))
  if (!enabled) return v
  let best = PITCH_SNAPS[0]
  let dist = Math.abs(v - best)
  for (let i = 1; i < PITCH_SNAPS.length; i++) {
    const d = Math.abs(v - PITCH_SNAPS[i])
    if (d < dist) {
      best = PITCH_SNAPS[i]
      dist = d
    }
  }
  return best
}

/** 0 is chunky and short. 1 is headroom with a 1.8 s release. */
export function kneeLaw(amount) {
  const k = Math.max(0, Math.min(1, Number(amount) || 0))
  return {
    threshold: -42 + k * 36,
    ratio: 18 - k * 16,
    knee: k * 24,
    attack: 0.001 + k * 0.008,
    release: 0.028 + k * (1.8 - 0.028),
    gain: 0.48 + (1 - k) * 0.9,
  }
}

export function createKnee(sampleRate) {
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v
  }
  const sr = sampleRate > 1000 ? sampleRate : 44100
  const chorusN = 8192
  const cMask = chorusN - 1
  const cL = new Float32Array(chorusN)
  const cR = new Float32Array(chorusN)
  let cw = 0
  let cPhase = 0
  let pPhase = 0
  const apL = new Float32Array(4)
  const apR = new Float32Array(4)
  let env = 0
  let pdL = 0
  let pdR = 1.3
  const pitchN = Math.max(256, Math.ceil(sr * 0.35))
  const pL = new Float32Array(pitchN)
  const pR = new Float32Array(pitchN)
  let pw = 0
  let grainPhase = 0
  const grainLen = Math.max(32, Math.floor(sr * 0.045))
  const grainBase = grainLen * 3

  let kneeT = 0.2
  let policeT = 0
  let foldT = 0
  let pitchT = 0
  let knee = 0.2
  let police = 0
  let fold = 0
  let pitch = 0
  let policeLfo = 0
  let foldLfo = 0
  let policeHz = 1
  let foldHz = 1
  let policeDepth = 0
  let foldDepth = 0
  let policePhase = 0
  let foldPhase = 0
  let grDb = 0
  let report = 0

  function glide(cur, target) {
    return cur + (target - cur) * 0.004
  }

  function readDelay(buf, write, delay) {
    let idx = write - delay
    while (idx < 0) idx += pitchN
    while (idx >= pitchN) idx -= pitchN
    const i0 = idx | 0
    const frac = idx - i0
    const i1 = i0 + 1 >= pitchN ? 0 : i0 + 1
    return buf[i0] * (1 - frac) + buf[i1] * frac
  }

  function chorusRead(buf, write, delay) {
    let idx = write - delay
    while (idx < 0) idx += chorusN
    const i0 = idx | 0
    const frac = idx - i0
    const i1 = (i0 + 1) & cMask
    return buf[i0 & cMask] * (1 - frac) + buf[i1] * frac
  }

  function allpass(x, state, stage, coeff) {
    const z = state[stage]
    const y = -coeff * x + z
    state[stage] = x + coeff * y
    return y
  }

  function apCoeff(fc) {
    const t = Math.tan(Math.PI * clamp(fc, 40, sr * 0.45) / sr)
    const c = (1 - t) / (1 + t)
    return clamp(c, -0.98, 0.98)
  }

  function tube(x, seed, drive) {
    const bias = (seed - 0.5) * 0.45
    const y = Math.tanh((x + bias) * drive)
    const norm = Math.tanh(drive)
    return norm > 0.001 ? y / norm : y
  }

  function foldUnit(v) {
    let x = v
    if (x > 1) x = 2 - x
    else if (x < -1) x = -2 - x
    if (x > 1) x = 2 - x
    else if (x < -1) x = -2 - x
    if (x > 1) x = 2 - x
    else if (x < -1) x = -2 - x
    if (x > 1) x = 1
    else if (x < -1) x = -1
    return x
  }

  let foldY = 0
  function colorFold(x, amt, phase) {
    const drive1 = 1 + amt * (6 + amt * 4)
    const f1 = foldUnit(x * drive1)
    const f2 = foldUnit(Math.sin(x * (1.2 + amt * 7) * Math.PI))
    let p = phase + 0.012 + amt * 0.28 + f1 * amt * 2.4
    if (p > 24) p -= 24
    const pm = Math.sin(p + f2 * amt * 3.1)
    const layered = f1 * (0.62 - amt * 0.15) + f2 * (0.2 + amt * 0.45) + pm * amt * 0.5
    foldY = x * (1 - amt) + layered * amt
    return p
  }

  function ok(v) {
    return typeof v === 'number' && Number.isFinite(v)
  }

  /** Clear every bit of state. One NaN in a feedback path would otherwise stay there for good. */
  function reset() {
    cL.fill(0)
    cR.fill(0)
    apL.fill(0)
    apR.fill(0)
    pL.fill(0)
    pR.fill(0)
    env = 0
    pdL = 0
    pdR = 1.3
    foldY = 0
    grDb = 0
    if (!ok(knee)) knee = kneeT
    if (!ok(police)) police = policeT
    if (!ok(fold)) fold = foldT
    if (!ok(pitch)) pitch = pitchT
  }

  function set(p) {
    if (!p) return
    if (ok(p.knee)) kneeT = clamp(p.knee, 0, 1)
    if (ok(p.police)) policeT = clamp(p.police, 0, 1)
    if (ok(p.fold)) foldT = clamp(p.fold, 0, 1)
    if (ok(p.pitch)) pitchT = clamp(p.pitch, -2, 2)
    if (p.policeLfo) {
      policeLfo = p.policeLfo.on ? 1 : 0
      if (ok(p.policeLfo.rate)) policeHz = clamp(p.policeLfo.rate, 0.05, 12)
      if (ok(p.policeLfo.depth)) policeDepth = clamp(p.policeLfo.depth, 0, 1)
    }
    if (p.foldLfo) {
      foldLfo = p.foldLfo.on ? 1 : 0
      if (ok(p.foldLfo.rate)) foldHz = clamp(p.foldLfo.rate, 0.05, 12)
      if (ok(p.foldLfo.depth)) foldDepth = clamp(p.foldLfo.depth, 0, 1)
    }
  }

  function process(inL, inR, outL, outR) {
    const n = inL.length
    for (let i = 0; i < n; i++) {
      knee = glide(knee, kneeT)
      police = glide(police, policeT)
      fold = glide(fold, foldT)
      pitch = glide(pitch, pitchT)
      policePhase += (2 * Math.PI * policeHz) / sr
      if (policePhase > 6.283185) policePhase -= 6.283185
      foldPhase += (2 * Math.PI * foldHz) / sr
      if (foldPhase > 6.283185) foldPhase -= 6.283185
      const policeHeard = policeLfo ? clamp(police + Math.sin(policePhase) * policeDepth, 0, 1) : police
      const foldHeard = foldLfo ? clamp(fold + Math.sin(foldPhase) * foldDepth, 0, 1) : fold

      let l = inL[i]
      let r = inR[i]
      if (!(l > -Infinity && l < Infinity)) l = 0
      if (!(r > -Infinity && r < Infinity)) r = 0

      cL[cw] = l
      cR[cw] = r
      cPhase += (2 * Math.PI * 0.65) / sr
      if (cPhase > 6.283185) cPhase -= 6.283185
      pPhase += (2 * Math.PI * 0.18) / sr
      if (pPhase > 6.283185) pPhase -= 6.283185
      const modL = Math.sin(cPhase)
      const modR = Math.sin(cPhase + 2.15)
      const dCL = (0.014 + 0.007 * modL) * sr
      const dCR = (0.017 + 0.007 * modR) * sr
      let chL = chorusRead(cL, cw, dCL)
      let chR = chorusRead(cR, cw, dCR)
      cw = (cw + 1) & cMask
      const fcL = 280 + 2200 * (0.5 + 0.5 * Math.sin(pPhase))
      const fcR = 280 + 2200 * (0.5 + 0.5 * Math.sin(pPhase + 1.9))
      const cApL = apCoeff(fcL)
      const cApR = apCoeff(fcR)
      chL = allpass(chL, apL, 0, cApL)
      chL = allpass(chL, apL, 1, cApL * 0.92)
      chL = allpass(chL, apL, 2, cApL * 0.84)
      chL = allpass(chL, apL, 3, cApL * 0.76)
      chR = allpass(chR, apR, 0, cApR)
      chR = allpass(chR, apR, 1, cApR * 0.9)
      chR = allpass(chR, apR, 2, cApR * 0.8)
      chR = allpass(chR, apR, 3, cApR * 0.7)
      const drive = 1 + policeHeard * 7
      const tubeL = tube(chL, 0.18, drive)
      const tubeR = tube(chR, 0.84, drive)
      l = l * (1 - policeHeard) + tubeL * policeHeard
      r = r * (1 - policeHeard) + tubeR * policeHeard

      pdL = colorFold(l, foldHeard, pdL)
      l = foldY
      pdR = colorFold(r, foldHeard * (0.92 + 0.16 * foldHeard), pdR)
      r = foldY

      const rate = Math.pow(2, pitch)
      pL[pw] = l
      pR[pw] = r
      grainPhase += 1 / grainLen
      if (grainPhase >= 1) grainPhase -= 1
      const phaseB = grainPhase + 0.5 >= 1 ? grainPhase - 0.5 : grainPhase + 0.5
      const w1 = 0.5 - 0.5 * Math.cos(2 * Math.PI * grainPhase)
      const w2 = 0.5 + 0.5 * Math.cos(2 * Math.PI * grainPhase)
      const d1 = clamp(grainBase - (rate - 1) * grainPhase * grainLen, 2, pitchN - 2)
      const d2 = clamp(grainBase - (rate - 1) * phaseB * grainLen, 2, pitchN - 2)
      const wetL = readDelay(pL, pw, d1) * w1 + readDelay(pL, pw, d2) * w2
      const wetR = readDelay(pR, pw, d1) * w1 + readDelay(pR, pw, d2) * w2
      pw = pw + 1 >= pitchN ? 0 : pw + 1
      const pitchMix = clamp(Math.abs(pitch) / 0.04, 0, 1)
      l = l * (1 - pitchMix) + wetL * pitchMix
      r = r * (1 - pitchMix) + wetR * pitchMix

      const threshold = -42 + knee * 36
      const ratio = 18 - knee * 16
      const kneeW = knee * 24
      const attack = 0.001 + knee * 0.008
      const release = 0.028 + knee * (1.8 - 0.028)
      const outGain = 0.48 + (1 - knee) * 0.9
      const attC = Math.exp(-1 / (attack * sr))
      const relC = Math.exp(-1 / (release * sr))
      const peak = Math.max(Math.abs(l), Math.abs(r))
      const coeff = peak > env ? attC : relC
      env = peak + coeff * (env - peak)
      const db = 20 * Math.log10(env + 1e-8)
      const half = kneeW * 0.5
      let over = 0
      if (half > 0 && db > threshold - half && db < threshold + half) {
        const x = db - threshold + half
        over = (x * x) / (2 * kneeW)
      } else if (db > threshold) over = db - threshold
      const reduce = over * (1 - 1 / ratio)
      grDb = -reduce
      const g = Math.pow(10, -reduce / 20) * outGain
      l *= g
      r *= g
      if (l > 1.8) l = 1.8
      else if (l < -1.8) l = -1.8
      if (r > 1.8) r = 1.8
      else if (r < -1.8) r = -1.8
      if (!(l > -Infinity && l < Infinity) || !(r > -Infinity && r < Infinity) || !(env > -Infinity && env < Infinity)) {
        reset()
        l = 0
        r = 0
      }
      outL[i] = l
      outR[i] = r
    }
    report += n
  }

  function takeGr() {
    if (report < sr * 0.05) return null
    report = 0
    return grDb
  }

  return { process, set, takeGr, reset }
}

export function kneeWorkletSource() {
  return `
    const createKnee = ${createKnee.toString()}
    class MiyaKnee extends AudioWorkletProcessor {
      constructor() {
        super()
        this.knee = createKnee(sampleRate)
        this.port.onmessage = (event) => {
          this.knee.set(event.data || {})
        }
      }
      process(inputs, outputs) {
        const input = inputs[0]
        const output = outputs[0]
        if (!input || !input[0] || !output || !output[0]) return true
        this.knee.process(input[0], input[1] || input[0], output[0], output[1] || output[0])
        const gr = this.knee.takeGr()
        if (gr != null) this.port.postMessage({ gr })
        return true
      }
    }
    registerProcessor('miya-knee', MiyaKnee)
  `
}
