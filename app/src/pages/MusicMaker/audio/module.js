/** Bounded MOD / XM readers. Notes become pad events. Tracker FX stay out. */

const MOD_CH = {
  'M.K.': 4,
  'M!K!': 4,
  'FLT4': 4,
  '4CHN': 4,
  '6CHN': 6,
  '8CHN': 8,
  FLT8: 8,
  '10CH': 10,
  '12CH': 12,
  '14CH': 14,
  '16CH': 16,
}

const MAX_BYTES = 8 * 1024 * 1024

function text(bytes, start, length) {
  let out = ''
  for (let i = 0; i < length && start + i < bytes.length; i++) {
    const code = bytes[start + i]
    if (!code) break
    out += String.fromCharCode(code)
  }
  return out.replace(/\s+$/g, '')
}

function clampPitch(semi) {
  return Math.max(-24, Math.min(24, semi))
}

function barsFor(rows) {
  const n = Math.max(1, Math.min(256, rows | 0))
  return Math.max(1, Math.min(16, Math.ceil(n / 16)))
}

function emptyLanes() {
  return Array.from({ length: 16 }, () => null)
}

/** Protracker period 428 is the root. */
export function periodToPitch(period) {
  if (!period) return 0
  return clampPitch(Math.round(12 * Math.log2(428 / period)))
}

export function modChannels(magic) {
  return MOD_CH[magic] || 0
}

export function parseMod(buffer) {
  if (buffer.byteLength < 1084 || buffer.byteLength > MAX_BYTES) {
    throw new Error('That MOD is not a small 31-sample module')
  }
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const magic = text(bytes, 1080, 4)
  const channels = modChannels(magic)
  if (!channels) throw new Error('That MOD needs a 4 to 16 channel header')
  const title = text(bytes, 0, 20) || 'Module'
  const instruments = []
  for (let i = 0; i < 31; i++) {
    const at = 20 + i * 30
    const words = view.getUint16(at + 22, false)
    const finetune = bytes[at + 24] & 0x0f
    const signed = finetune >= 8 ? finetune - 16 : finetune
    instruments.push({
      index: i,
      name: text(bytes, at, 22) || `Sample ${i + 1}`,
      length: words * 2,
      fine: Math.max(-100, Math.min(100, Math.round(signed * 12.5))),
      volume: Math.max(0, Math.min(1, bytes[at + 25] / 64)),
      loopStart: view.getUint16(at + 26, false) * 2,
      loopLen: view.getUint16(at + 28, false) * 2,
      pitch: 0,
    })
  }
  const songLen = bytes[950]
  if (!songLen) throw new Error('That MOD has an empty order')
  const order = []
  let patCount = 1
  for (let i = 0; i < songLen; i++) {
    const id = bytes[952 + i]
    order.push(id)
    if (id + 1 > patCount) patCount = id + 1
  }
  if (patCount > 256) throw new Error('That MOD has more patterns than this player holds')
  let off = 1084
  const patternBytes = 64 * channels * 4
  if (off + patCount * patternBytes > bytes.length) throw new Error('That MOD ended inside a pattern')
  let speed = 6
  let bpm = 125
  let tempoSet = false
  const patterns = []
  for (let p = 0; p < patCount; p++) {
    const steps = []
    const last = Array(channels).fill(0)
    for (let row = 0; row < 64; row++) {
      const lanes = emptyLanes()
      for (let ch = 0; ch < channels; ch++) {
        const b0 = bytes[off++]
        const b1 = bytes[off++]
        const b2 = bytes[off++]
        const b3 = bytes[off++]
        const period = ((b0 & 0x0f) << 8) | b1
        const sample = (b0 & 0xf0) | (b2 >> 4)
        const effect = b2 & 0x0f
        const param = b3
        if (effect === 0x0f && param >= 32 && !tempoSet) {
          bpm = param
          tempoSet = true
        } else if (effect === 0x0f && param > 0 && param < 32 && !tempoSet) {
          speed = param
        }
        if (sample) last[ch] = sample
        if (!period || !last[ch]) continue
        let vel = instruments[last[ch] - 1]?.volume || 0.9
        if (effect === 0x0c) vel = Math.max(0, Math.min(1, param / 64))
        lanes[ch] = { pad: last[ch] - 1, vel, pitch: periodToPitch(period), nudge: 0 }
      }
      steps.push(lanes)
    }
    patterns.push({ i: p, name: '', bars: 4, steps })
  }
  for (const inst of instruments) {
    if (!inst.length) {
      inst.pcm = null
      continue
    }
    if (off + inst.length > bytes.length) throw new Error('That MOD ended inside a sample')
    const pcm = new Float32Array(inst.length)
    for (let i = 0; i < inst.length; i++) {
      const v = bytes[off + i]
      pcm[i] = (v < 128 ? v : v - 256) / 128
    }
    off += inst.length
    inst.pcm = pcm
    inst.sr = 8363
    if (inst.loopLen > 2 && inst.length > 0) {
      const a = Math.min(1, inst.loopStart / inst.length)
      const b = Math.min(1, (inst.loopStart + inst.loopLen) / inst.length)
      inst.loop = b - a > 0.01 ? { a, b } : null
    } else inst.loop = null
  }
  const ourBpm = Math.max(40, Math.min(240, Math.round((bpm * 6) / Math.max(1, speed))))
  return { title, bpm: ourBpm, channels, order, patterns, instruments }
}

function decodeDelta(bytes, view, off, byteLength, wide) {
  if (wide) {
    const n = byteLength >> 1
    const pcm = new Float32Array(n)
    let acc = 0
    for (let i = 0; i < n; i++) {
      acc += view.getInt16(off + i * 2, true)
      acc = (acc << 16) >> 16
      pcm[i] = acc / 32768
    }
    return pcm
  }
  const pcm = new Float32Array(byteLength)
  let acc = 0
  for (let i = 0; i < byteLength; i++) {
    let delta = bytes[off + i]
    if (delta > 127) delta -= 256
    acc = ((acc + delta) << 24) >> 24
    pcm[i] = acc / 128
  }
  return pcm
}

export function parseXm(buffer) {
  if (buffer.byteLength < 336 || buffer.byteLength > MAX_BYTES) {
    throw new Error('That XM is not a small module')
  }
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const id = text(bytes, 0, 17)
  if (id !== 'Extended Module:') throw new Error('That file is not an XM module')
  const title = text(bytes, 17, 20) || 'Module'
  const head = 60
  const headerSize = view.getUint32(head, true)
  if (headerSize < 20 || head + headerSize > bytes.length) throw new Error('That XM header is cut off')
  const songLen = view.getUint16(head + 4, true)
  const channels = view.getUint16(head + 8, true)
  const nPatterns = view.getUint16(head + 10, true)
  const nInst = view.getUint16(head + 12, true)
  let speed = view.getUint16(head + 16, true) || 6
  let bpm = view.getUint16(head + 18, true) || 125
  if (!songLen || !channels || channels > 16) throw new Error('That XM needs 1 to 16 channels')
  if (nPatterns > 256 || nInst > 128) throw new Error('That XM is larger than this player holds')
  const order = []
  for (let i = 0; i < songLen && 20 + i < headerSize; i++) order.push(bytes[head + 20 + i])
  let off = head + headerSize
  let tempoSet = false
  const patterns = []
  for (let p = 0; p < nPatterns; p++) {
    if (off + 4 > bytes.length) throw new Error('That XM ended inside a pattern')
    const size = view.getUint32(off, true)
    if (size < 4 || off + size > bytes.length) throw new Error('That XM pattern header is cut off')
    const rows = size >= 7 ? view.getUint16(off + 5, true) || 64 : 64
    const dataSize = size >= 9 ? view.getUint16(off + 7, true) : 0
    const data = off + size
    if (data + dataSize > bytes.length) throw new Error('That XM ended inside a pattern')
    const bars = barsFor(rows)
    const steps = Array.from({ length: bars * 16 }, emptyLanes)
    const last = Array(channels).fill(0)
    let cursor = data
    const end = data + dataSize
    for (let row = 0; row < rows; row++) {
      for (let ch = 0; ch < channels; ch++) {
        if (cursor >= end) break
        let note = 0
        let inst = 0
        let vol = 0
        let effect = 0
        let param = 0
        const flag = bytes[cursor++]
        if (flag & 0x80) {
          if (flag & 1) note = bytes[cursor++]
          if (flag & 2) inst = bytes[cursor++]
          if (flag & 4) vol = bytes[cursor++]
          if (flag & 8) effect = bytes[cursor++]
          if (flag & 16) param = bytes[cursor++]
        } else {
          note = flag
          inst = bytes[cursor++]
          vol = bytes[cursor++]
          effect = bytes[cursor++]
          param = bytes[cursor++]
        }
        if (effect === 0x0f && param >= 32 && !tempoSet) {
          bpm = param
          tempoSet = true
        } else if (effect === 0x0f && param > 0 && param < 32 && !tempoSet) {
          speed = param
        }
        if (inst) last[ch] = inst
        if (!note || note >= 97 || !last[ch] || last[ch] > 64) continue
        let vel = 0.9
        if (vol >= 0x10 && vol <= 0x50) vel = (vol - 0x10) / 64
        if (effect === 0x0c) vel = Math.max(0, Math.min(1, param / 64))
        const pitch = clampPitch(note - 49)
        steps[row][ch] = { pad: last[ch] - 1, vel, pitch, nudge: 0 }
      }
    }
    patterns.push({ i: p, name: '', bars, steps })
    off = end
  }
  const instruments = []
  for (let i = 0; i < nInst; i++) {
    if (off + 4 > bytes.length) throw new Error('That XM ended inside an instrument')
    const size = view.getUint32(off, true)
    if (size < 4 || off + size > bytes.length) throw new Error('That XM instrument header is cut off')
    const name = text(bytes, off + 4, 22) || `Sample ${i + 1}`
    const numSamples = size >= 29 ? view.getUint16(off + 27, true) : 0
    const sampleHeaderSize = numSamples > 0 && size >= 33 ? view.getUint32(off + 29, true) : 0
    off += size
    const headers = []
    for (let s = 0; s < numSamples; s++) {
      if (sampleHeaderSize < 18 || off + sampleHeaderSize > bytes.length) {
        throw new Error('That XM sample header is cut off')
      }
      const length = view.getUint32(off, true)
      const loopStart = view.getUint32(off + 4, true)
      const loopLen = view.getUint32(off + 8, true)
      const volume = bytes[off + 12]
      let finetune = bytes[off + 13]
      if (finetune > 127) finetune -= 256
      const type = bytes[off + 14]
      let rel = bytes[off + 16]
      if (rel > 127) rel -= 256
      const sampleName = text(bytes, off + 18, Math.min(22, Math.max(0, sampleHeaderSize - 18)))
      headers.push({ length, loopStart, loopLen, volume, finetune, type, rel, name: sampleName })
      off += sampleHeaderSize
    }
    headers.forEach((header, s) => {
      if (off + header.length > bytes.length) throw new Error('That XM ended inside a sample')
      const wide = (header.type & 16) !== 0
      const pcm = header.length ? decodeDelta(bytes, view, off, header.length, wide) : null
      off += header.length
      if (s !== 0 || i > 63 || !pcm) return
      const frames = pcm.length
      let loop = null
      if ((header.type & 3) && header.loopLen > 0 && frames > 0) {
        const unit = wide ? 2 : 1
        const a = Math.min(1, header.loopStart / unit / frames)
        const b = Math.min(1, (header.loopStart + header.loopLen) / unit / frames)
        if (b - a > 0.01) loop = { a, b }
      }
      instruments.push({
        index: i,
        name: header.name || name,
        volume: Math.max(0, Math.min(1, header.volume / 64)),
        fine: Math.max(-100, Math.min(100, Math.round(header.finetune * 12.5))),
        pitch: clampPitch(header.rel),
        pcm,
        sr: 8363,
        loop,
      })
    })
  }
  const ourBpm = Math.max(40, Math.min(240, Math.round((bpm * 6) / Math.max(1, speed))))
  return { title, bpm: ourBpm, channels, order, patterns, instruments }
}
