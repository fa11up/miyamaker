/** Master performance FX. Repeat and Slice lock to the project tempo. Grain is a separate spray. */

export const NUMPAD_FX_COUNT = 10
export const REPEAT_NAMES = ['1/2', '1/4', '1/8', '1/16', '1/32', '1/64', '1/128']
export const SLICE_PATTERNS = ['Forward', 'Reverse', 'Doubles', 'Swap', 'Stutter', 'Outsides', 'Shuffle', 'Glitch']
export const SLICE_FILLS = ['Repeat', 'Up', 'Down', 'Hard', 'Pong', 'Soft']
export const GRAIN_DIRS = ['Forward', 'Back', 'Ping pong']
/** Byte that the old division dropdown reads back as this note value. */
export function repeatAmount(div) {
  return [18, 55, 91, 128, 164, 201, 237][clamp(div | 0, 0, 6)]
}
const TYPES = ['repeat', 'slice', 'grain', 'filter', 'chorus', 'flange']

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
  const type = TYPES.includes(raw?.type) ? raw.type : base.type
  const a = clamp(raw?.a ?? base.a, 0, 255) | 0
  // Older repeat slots stored the note value in `a` only. The dropdown writes both now.
  const div = type === 'repeat'
    ? clamp((a * 7 / 256) | 0, 0, 6)
    : clamp(raw?.div ?? base.div, 0, 6) | 0
  return {
    type,
    a,
    b: clamp(raw?.b ?? base.b, 0, 255) | 0,
    div,
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
  // Eight steps. Same order as SLICE_PATTERNS.
  const PAT = new Uint8Array([
    0, 1, 2, 3, 4, 5, 6, 7,
    7, 6, 5, 4, 3, 2, 1, 0,
    0, 0, 1, 1, 2, 2, 3, 3,
    0, 2, 1, 3, 4, 6, 5, 7,
    0, 0, 0, 0, 4, 4, 6, 7,
    0, 7, 1, 6, 2, 5, 3, 4,
    0, 4, 2, 6, 1, 5, 3, 7,
    3, 3, 0, 0, 7, 7, 4, 4,
  ])
  const chorusN = 2048
  const bufL = new Float32Array(chorusN)
  const bufR = new Float32Array(chorusN)
  let write = 0
  let phase = 0
  let lowL = 0
  let bandL = 0
  let lowR = 0
  let bandR = 0
  // Reused by the sample loop. A new object per sample on the audio thread is what cuts the sound out.
  let holdL = 0
  let holdR = 0
  // 0 wait for the grid, 1 record one note (or eight slices), 2 play that recording.
  let loopMode = 0
  let loopPos = 0
  let prevPhase = -1
  let latchedDiv = -1
  let latchedBpm = 0
  let latchedType = ''
  let histWrite = 0
  let histFill = 0
  let armed = 0
  let gPos = 0
  let gStart = 0
  let gLen = 1
  let gLeft = 0
  let gDir = 0
  let hOn = 0
  let hPos = 0
  let hStart = 0
  let hLen = 1
  let hDir = 0
  let flip = 0

  /** Fresh buffers, so a press never replays audio from an old one. */
  function reset() {
    repeatL.fill(0)
    repeatR.fill(0)
    bufL.fill(0)
    bufR.fill(0)
    write = 0
    phase = 0
    lowL = 0
    bandL = 0
    lowR = 0
    bandR = 0
    loopMode = 0
    loopPos = 0
    prevPhase = -1
    latchedDiv = -1
    latchedBpm = 0
    latchedType = ''
    histWrite = 0
    histFill = 0
    armed = 0
    gPos = 0
    gLen = 0
    gLeft = 0
    hOn = 0
    flip = 0
  }

  function noteLen(div, tempo) {
    const quarter = sr * 60 / tempo
    let n = Math.round(quarter * 2 / (1 << div))
    if (!(n > 0)) n = 1
    if (n > cap) n = cap
    return n
  }

  function slotDiv(slot, type) {
    const raw = slot.div
    if (raw === 0 || ((raw | 0) === raw && raw >= 0 && raw <= 6)) return raw | 0
    if (type === 'repeat') return clamp(((slot.a | 0) * 7 / 256) | 0, 0, 6)
    return 0
  }

  function fillAt(kind, pos, len) {
    if (len <= 1) return 0
    if (kind === 1) return (pos * 2) % len
    if (kind === 2) return pos >> 1
    if (kind === 3) return pos % Math.max(1, len >> 3)
    if (kind === 4) {
      const h = len >> 1
      if (h < 1) return 0
      if (pos < h) return Math.min(len - 1, pos << 1)
      return Math.max(0, (len - 1) - ((pos - h) << 1))
    }
    if (kind === 0) {
      const mid = len >> 1
      const q = Math.max(1, len >> 2)
      if (pos < mid) return pos
      const looped = mid + ((pos - mid) % q)
      return looped < len ? looped : len - 1
    }
    return pos < len ? pos : len - 1
  }

  function wrapRead(start, offset) {
    let read = start + offset
    if (read >= cap) read -= cap
    if (read < 0) read += cap
    return read
  }

  function readGrain(start, len, pos, dir) {
    const offset = dir === 1 ? len - 1 - pos : pos
    const read = wrapRead(start, offset)
    const env = len > 1 ? 1 - Math.abs((2 * pos) / len - 1) : 1
    holdL = repeatL[read] * env
    holdR = repeatR[read] * env
  }

  function filter(a, b, left, right) {
    const t = clamp(a, 0, 255) / 255
    const hz = clamp(40 * Math.pow(200, t), 40, sr * 0.45)
    const q = 0.6 + (clamp(b, 0, 255) / 255) * 3.4
    const f = Math.min(1, 2 * Math.sin(Math.PI * hz / sr))
    const nextLowL = lowL + f * bandL
    const highL = left - nextLowL - q * bandL
    const nextBandL = bandL + f * highL
    const nextLowR = lowR + f * bandR
    const highR = right - nextLowR - q * bandR
    const nextBandR = bandR + f * highR
    lowL = clamp(nextLowL, -2, 2)
    bandL = clamp(nextBandL, -2, 2)
    lowR = clamp(nextLowR, -2, 2)
    bandR = clamp(nextBandR, -2, 2)
    holdL = nextLowL
    holdR = nextLowR
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
    const delayL = base + depth * (0.5 + 0.5 * lfo)
    const delayR = base + depth * (0.5 + 0.5 * lfoR)
    const samplesL = clamp(delayL * sr, 1, n - 2)
    const samplesR = clamp(delayR * sr, 1, n - 2)
    let wrappedL = write - samplesL
    let wrappedR = write - samplesR
    while (wrappedL < 0) wrappedL += n
    while (wrappedR < 0) wrappedR += n
    const i0L = wrappedL % n | 0
    const i0R = wrappedR % n | 0
    const fracL = wrappedL - Math.floor(wrappedL)
    const fracR = wrappedR - Math.floor(wrappedR)
    const wetL = bufL[i0L] * (1 - fracL) + bufL[(i0L + 1) % n] * fracL
    const wetR = bufR[i0R] * (1 - fracR) + bufR[(i0R + 1) % n] * fracR
    const fb = flange ? 0.45 : 0
    bufL[write] = clamp(left + wetL * fb, -1.5, 1.5)
    bufR[write] = clamp(right + wetR * fb, -1.5, 1.5)
    write = write + 1 >= n ? 0 : write + 1
    const mix = flange ? 0.55 : 0.45
    holdL = left * (1 - mix) + wetL * mix
    holdR = right * (1 - mix) + wetR * mix
  }

  function process(inL, inR, outL, outR, slot, bpm, time, origin) {
    const n = inL.length
    const type = slot && slot.type && slot.type !== 'off' ? slot.type : ''
    const tempo = bpm >= 20 && bpm <= 300 ? bpm : 96
    const div = type ? slotDiv(slot, type) : 0
    const synced = Number.isFinite(time) && Number.isFinite(origin)
    if (type && type !== latchedType) {
      latchedType = type
      loopMode = 0
      loopPos = 0
      prevPhase = -1
      armed = 0
      gLeft = 0
      gLen = 0
      hOn = 0
      histFill = 0
      histWrite = 0
    }
    if ((type === 'repeat' || type === 'slice') && (div !== latchedDiv || tempo !== latchedBpm)) {
      latchedDiv = div
      latchedBpm = tempo
      loopMode = 0
      loopPos = 0
      prevPhase = -1
    }
    const slice = noteLen(div, tempo)
    let slices = type === 'slice' ? 8 : 1
    while (slices > 1 && slice * slices > cap) slices >>= 1
    const record = slice * slices
    const mixByte = type === 'repeat' ? (slot.b | 0) : (slot.mix | 0)
    const mix = clamp(mixByte, 0, 255) / 255
    const pattern = (slot && (slot.a | 0) <= 7) ? (slot.a | 0) : clamp(Math.round(((slot && slot.a) | 0) * 7 / 255), 0, 7)
    const fill = (slot && (slot.b | 0) <= 5) ? (slot.b | 0) : clamp(((slot && slot.b) | 0) * 6 / 256, 0, 5)
    const grainDir = div % 3
    const grainSize = clamp(Math.round(sr * (0.006 + (clamp(slot ? slot.a | 0 : 0, 0, 255) / 255) * 0.09)), 8, 4000)
    const grainHop = clamp(Math.round(grainSize * (0.25 + (clamp(slot ? slot.b | 0 : 0, 0, 255) / 255) * 0.75)), 1, grainSize)
    const startSample = synced ? Math.round((time - origin) * sr) : 0
    for (let i = 0; i < n; i++) {
      let l = inL[i]
      let r = inR[i]
      if (!(l > -Infinity && l < Infinity)) l = 0
      if (!(r > -Infinity && r < Infinity)) r = 0
      if (type === 'repeat' || type === 'slice') {
        let phase = 0
        if (synced) {
          const elapsed = startSample + i
          phase = elapsed % slice
          if (phase < 0) phase += slice
        }
        const boundary = phase === 0 || (prevPhase >= 0 && phase < prevPhase)
        if (loopMode === 0 && synced && !boundary) {
          prevPhase = phase
          holdL = l
          holdR = r
        } else if (loopMode === 0 || loopMode === 1) {
          if (loopMode === 0) {
            loopMode = 1
            loopPos = 0
          }
          if (synced) prevPhase = phase
          if (loopPos < cap) {
            repeatL[loopPos] = l
            repeatR[loopPos] = r
          }
          loopPos += 1
          if (loopPos >= record) {
            loopMode = 2
            loopPos = 0
          }
          holdL = l
          holdR = r
        } else {
          let wetL = 0
          let wetR = 0
          if (type === 'repeat') {
            wetL = repeatL[loopPos]
            wetR = repeatR[loopPos]
          } else {
            const step = (loopPos / slice) | 0
            const within = loopPos - step * slice
            const which = PAT[(pattern * 8 + (step % 8)) | 0] % slices
            const off = fillAt(fill, within, slice)
            const at = which * slice + off
            if (at >= 0 && at < cap) {
              wetL = repeatL[at]
              wetR = repeatR[at]
            }
            if (fill === 5) {
              const edge = Math.max(1, (slice * 0.1) | 0)
              let env = 1
              if (within < edge) env = within / edge
              else if (within > slice - edge) env = (slice - within) / edge
              wetL *= env
              wetR *= env
            }
          }
          loopPos = loopPos + 1 >= record ? 0 : loopPos + 1
          holdL = l * (1 - mix) + wetL * mix
          holdR = r * (1 - mix) + wetR * mix
        }
        l = holdL
        r = holdR
      } else if (type === 'grain') {
        const at = histWrite
        if (at < cap) {
          repeatL[at] = l
          repeatR[at] = r
        }
        histWrite = at + 1 >= cap ? 0 : at + 1
        if (histFill < cap) histFill += 1
        if (!armed) {
          if (histFill >= grainSize) armed = 1
          else {
            holdL = l
            holdR = r
            l = holdL
            r = holdR
          }
        }
        if (armed) {
          if (gLeft <= 0) {
            if (gLen > 0 && gPos < gLen) {
              hOn = 1
              hPos = gPos
              hStart = gStart
              hLen = gLen
              hDir = gDir
            }
            gLen = grainSize
            gStart = at - (gLen - 1)
            if (gStart < 0) gStart += cap
            gPos = 0
            gLeft = grainHop
            flip ^= 1
            gDir = grainDir === 2 ? flip : grainDir
          }
          const gAt = gPos < gLen ? gPos : gLen - 1
          readGrain(gStart, gLen, gAt, gDir)
          let wetL = holdL
          let wetR = holdR
          gPos += 1
          gLeft -= 1
          if (hOn) {
            const hAt = hPos < hLen ? hPos : hLen - 1
            readGrain(hStart, hLen, hAt, hDir)
            wetL += holdL
            wetR += holdR
            hPos += 1
            if (hPos >= hLen) hOn = 0
          }
          holdL = l * (1 - mix) + wetL * mix
          holdR = r * (1 - mix) + wetR * mix
          l = holdL
          r = holdR
        }
      } else if (type === 'filter') {
        filter(slot.a | 0, slot.b | 0, l, r)
        l = holdL
        r = holdR
      } else if (type === 'chorus' || type === 'flange') {
        modulate(slot.a | 0, slot.b | 0, type === 'flange', l, r)
        l = holdL
        r = holdR
      }
      if (!(l > -Infinity && l < Infinity) || !(r > -Infinity && r < Infinity)) {
        reset()
        l = 0
        r = 0
      }
      outL[i] = l
      outR[i] = r
    }
  }

  return { process, reset }
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
        this.origin = null
        this.port.onmessage = (event) => {
          const data = event.data || {}
          if (data.slots) this.slots = data.slots
          if (typeof data.bpm === 'number' && data.bpm >= 20 && data.bpm <= 300) this.bpm = data.bpm
          if ('origin' in data) this.origin = typeof data.origin === 'number' && isFinite(data.origin) ? data.origin : null
          if (typeof data.held === 'number') {
            if (data.held >= 0 && data.held !== this.held) this.fx.reset()
            this.held = data.held
          }
        }
      }
      process(inputs, outputs) {
        const input = inputs[0]
        const output = outputs[0]
        if (!input || !input[0] || !output || !output[0]) return true
        const slot = this.held >= 0 ? this.slots[this.held] : null
        this.fx.process(input[0], input[1] || input[0], output[0], output[1] || output[0], slot, this.bpm, currentTime, this.origin)
        return true
      }
    }
    registerProcessor('miya-numpad-fx', MiyaNumpadFx)
  `
}
