/** Master performance FX, matching thrashtracker MasterPrint: repeat, filter, chorus, flanger. */

export const NUMPAD_FX_COUNT = 10
export const REPEAT_NAMES = ['1/2', '1/4', '1/8', '1/16', '1/32', '1/64', '1/128']

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v))
}

export function defaultNumpadFx() {
  const types = ['repeat', 'repeat', 'repeat', 'repeat', 'filter', 'filter', 'filter', 'chorus', 'flange', 'filter']
  const divs = [1, 2, 3, 4, 2, 2, 2, 3, 3, 3]
  const a = [0x40, 0x60, 0x80, 0xa0, 0x30, 0x80, 0xc0, 0x60, 0x70, 0x90]
  const b = [0xff, 0xff, 0xc0, 0xa0, 0x40, 0x60, 0x50, 0x40, 0x80, 0xa0]
  return Array.from({ length: NUMPAD_FX_COUNT }, (_, i) => ({
    type: types[i],
    a: a[i],
    b: b[i],
    div: divs[i],
    mix: i < 4 ? 0xff : 0x80,
  }))
}

export function normalizeSlot(raw, index) {
  const base = defaultNumpadFx()[index] || defaultNumpadFx()[0]
  const type = ['repeat', 'filter', 'chorus', 'flange'].includes(raw?.type) ? raw.type : base.type
  return {
    type,
    a: clamp(raw?.a ?? base.a, 0, 255) | 0,
    b: clamp(raw?.b ?? base.b, 0, 255) | 0,
    div: clamp(raw?.div ?? base.div, 0, 6) | 0,
    mix: clamp(raw?.mix ?? base.mix, 0, 255) | 0,
  }
}

export function normalizeNumpadFx(raw) {
  const next = defaultNumpadFx()
  if (!Array.isArray(raw)) return next
  for (let i = 0; i < NUMPAD_FX_COUNT; i++) next[i] = normalizeSlot(raw[i], i)
  return next
}

/** One private chain. Sample-accurate, no allocations in process(). */
export function createFx(sampleRate) {
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v))
  }
  const sr = sampleRate > 1000 ? sampleRate : 44100
  const cap = Math.max(8, Math.ceil(sr * 2))
  const repeatL = new Float32Array(cap)
  const repeatR = new Float32Array(cap)
  let repeatWrite = 0
  let repeatPhase = 0
  const chorusN = 2048
  const bufL = new Float32Array(chorusN)
  const bufR = new Float32Array(chorusN)
  let write = 0
  let phase = 0
  let lowL = 0
  let bandL = 0
  let lowR = 0
  let bandR = 0

  function beatRepeat(amount, mixByte, bpm, left, right) {
    const beat = sr * 60 / Math.max(20, bpm || 96)
    const divisor = 2 << clamp((amount * 7 / 256) | 0, 0, 6)
    const loop = clamp(Math.round(beat / divisor), 1, cap - 1)
    const mix = clamp(mixByte, 0, 255) / 255
    const age = loop - repeatPhase
    let read = repeatWrite - age
    while (read < 0) read += cap
    read %= cap
    const wetL = repeatL[read]
    const wetR = repeatR[read]
    repeatL[repeatWrite] = left
    repeatR[repeatWrite] = right
    repeatWrite = repeatWrite + 1 >= cap ? 0 : repeatWrite + 1
    repeatPhase = repeatPhase + 1 >= loop ? 0 : repeatPhase + 1
    return {
      l: left * (1 - mix) + wetL * mix,
      r: right * (1 - mix) + wetR * mix,
    }
  }

  function beatRepeatIndex(div, mixByte, bpm, left, right) {
    const amount = clamp(div, 0, 6) * 256 / 7
    return beatRepeat(amount, mixByte, bpm, left, right)
  }

  function filter(a, b, left, right) {
    const t = clamp(a, 0, 255) / 255
    const hz = clamp(40 * Math.pow(200, t), 40, sr * 0.45)
    const q = 0.6 + (clamp(b, 0, 255) / 255) * 3.4
    const f = Math.min(1, 2 * Math.sin(Math.PI * hz / sr))
    function one(input, low, band) {
      const nextLow = low + f * band
      const high = input - nextLow - q * band
      const nextBand = band + f * high
      return { low: nextLow, band: nextBand, out: nextLow }
    }
    const L = one(left, lowL, bandL)
    const R = one(right, lowR, bandR)
    lowL = clamp(L.low, -2, 2)
    bandL = clamp(L.band, -2, 2)
    lowR = clamp(R.low, -2, 2)
    bandR = clamp(R.band, -2, 2)
    return { l: L.out, r: R.out }
  }

  function modulate(a, b, flange, left, right) {
    const n = chorusN
    const rate = 0.08 + (clamp(b, 0, 255) / 255) * (flange ? 2.5 : 3.5)
    phase += rate / sr
    if (phase >= 1) phase -= 1
    const lfo = Math.sin(2 * Math.PI * phase)
    const lfoR = Math.sin(2 * Math.PI * (phase + 0.27))
    const depth = flange ? 0.0004 + 0.004 * (clamp(a, 0, 255) / 255) : 0.002 + 0.012 * (clamp(a, 0, 255) / 255)
    const base = flange ? 0.002 : 0.018
    function read(buf, delaySec) {
      const samples = clamp(delaySec * sr, 1, n - 2)
      let wrapped = write - samples
      while (wrapped < 0) wrapped += n
      const i0 = wrapped % n | 0
      const i1 = (i0 + 1) % n
      const frac = wrapped - Math.floor(wrapped)
      return buf[i0] * (1 - frac) + buf[i1] * frac
    }
    const wetL = read(bufL, base + depth * (0.5 + 0.5 * lfo))
    const wetR = read(bufR, base + depth * (0.5 + 0.5 * lfoR))
    const fb = flange ? 0.45 : 0
    bufL[write] = clamp(left + wetL * fb, -1.5, 1.5)
    bufR[write] = clamp(right + wetR * fb, -1.5, 1.5)
    write = write + 1 >= n ? 0 : write + 1
    const mix = flange ? 0.55 : 0.45
    return { l: left * (1 - mix) + wetL * mix, r: right * (1 - mix) + wetR * mix }
  }

  function process(inL, inR, outL, outR, slot, bpm) {
    const n = inL.length
    for (let i = 0; i < n; i++) {
      let l = inL[i] || 0
      let r = inR[i] || 0
      if (slot && slot.type && slot.type !== 'off') {
        if (slot.type === 'repeat') {
          const wet = beatRepeat(slot.a, slot.b, bpm, l, r)
          l = wet.l
          r = wet.r
        } else {
          const wet = beatRepeatIndex(slot.div ?? 2, slot.mix ?? 128, bpm, l, r)
          l = wet.l
          r = wet.r
          if (slot.type === 'filter') {
            const y = filter(slot.a, slot.b, l, r)
            l = y.l
            r = y.r
          } else if (slot.type === 'chorus' || slot.type === 'flange') {
            const y = modulate(slot.a, slot.b, slot.type === 'flange', l, r)
            l = y.l
            r = y.r
          }
        }
      }
      outL[i] = l
      outR[i] = r
    }
  }

  return { process }
}

export function workletSource() {
  return `
    const createFx = ${createFx.toString()}
    class MiyaNumpadFx extends AudioWorkletProcessor {
      constructor() {
        super()
        this.fx = createFx(sampleRate)
        this.held = -1
        this.slots = []
        this.bpm = 96
        this.port.onmessage = (event) => {
          const data = event.data || {}
          if (data.slots) this.slots = data.slots
          if (typeof data.bpm === 'number') this.bpm = data.bpm
          if (typeof data.held === 'number') this.held = data.held
        }
      }
      process(inputs, outputs) {
        const input = inputs[0]
        const output = outputs[0]
        if (!input || !input[0] || !output || !output[0]) return true
        const slot = this.held >= 0 ? this.slots[this.held] : null
        this.fx.process(input[0], input[1] || input[0], output[0], output[1] || output[0], slot, this.bpm)
        return true
      }
    }
    registerProcessor('miya-numpad-fx', MiyaNumpadFx)
  `
}
