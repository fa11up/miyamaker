/**
 * Wave pictures from thrashtracker.
 * Ink is drawWaveform: one min/max column per pixel.
 * RGB is the Mixxx split (below 600 Hz, below 4000 Hz, above).
 * Spec is the log-frequency film, coloured with the same stops.
 */

const FFT = 512

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v))
}

function fft512(re, im) {
  const n = FFT
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wlenRe = Math.cos(ang)
    const wlenIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let wRe = 1
      let wIm = 0
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k]
        const uIm = im[i + k]
        const vRe = re[i + k + len / 2] * wRe - im[i + k + len / 2] * wIm
        const vIm = re[i + k + len / 2] * wIm + im[i + k + len / 2] * wRe
        re[i + k] = uRe + vRe
        im[i + k] = uIm + vIm
        re[i + k + len / 2] = uRe - vRe
        im[i + k + len / 2] = uIm - vIm
        const nextRe = wRe * wlenRe - wIm * wlenIm
        wIm = wRe * wlenIm + wIm * wlenRe
        wRe = nextRe
      }
    }
  }
}

function analyse(data, i0, i1, rate) {
  const re = new Float32Array(FFT)
  const im = new Float32Array(FFT)
  i0 = clamp(i0, 0, data.length)
  i1 = clamp(i1, i0, data.length)
  const n = i1 - i0
  const mag = new Float32Array(FFT / 2 + 1)
  if (n <= 0 || rate < 1000) return { mag, low: 0, mid: 0, high: 0 }
  const take = Math.min(FFT, n)
  const step = n <= FFT ? 1 : n / FFT
  let windowSum = 0
  for (let k = 0; k < take; k++) {
    const sample = data[i0 + Math.floor(k * step)] || 0
    const w = take < 2 ? 1 : 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (take - 1))
    re[k] = sample * w
    windowSum += w
  }
  if (windowSum < 1) windowSum = 1
  fft512(re, im)
  const lowBin = clamp(Math.round((600 * FFT) / rate), 1, FFT / 2)
  const highBin = clamp(Math.round((4000 * FFT) / rate), lowBin + 1, FFT / 2)
  let low = 0
  let mid = 0
  let high = 0
  for (let bin = 1; bin <= FFT / 2; bin++) {
    const m = (2 * Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin])) / windowSum
    mag[bin] = m
    if (bin < lowBin) low += m
    else if (bin < highBin) mid += m
    else high += m
  }
  return { mag, low, mid, high }
}

function rxColour(t) {
  const u = clamp(t, 0, 1) ** 0.55
  const stops = [
    [0, 0, 0, 0],
    [0.18, 0, 16, 80],
    [0.36, 0, 70, 190],
    [0.52, 0, 190, 200],
    [0.68, 210, 30, 140],
    [0.84, 255, 170, 20],
    [1, 255, 255, 255],
  ]
  for (let i = 1; i < stops.length; i++) {
    if (u > stops[i][0]) continue
    const span = stops[i][0] - stops[i - 1][0]
    const f = span <= 0 ? 0 : (u - stops[i - 1][0]) / span
    const mix = (a, b) => Math.round((1 - f) * a + f * b)
    return [mix(stops[i - 1][1], stops[i][1]), mix(stops[i - 1][2], stops[i][2]), mix(stops[i - 1][3], stops[i][3])]
  }
  return [255, 255, 255]
}

/** Min and max of each horizontal column. This is drawWaveform. */
export function waveColumns(pcm, width, from = 0, to = 1) {
  const count = pcm?.length || 0
  const cols = []
  if (!count || width < 1) return cols
  const a = clamp(Math.floor(Math.min(from, to) * count), 0, count)
  const b = clamp(Math.ceil(Math.max(from, to) * count), a + 1, count)
  const span = b - a
  for (let x = 0; x < width; x++) {
    let i0 = a + Math.floor((x * span) / width)
    let i1 = a + Math.floor(((x + 1) * span) / width)
    if (i1 <= i0) i1 = i0 + 1
    let lo = 0
    let hi = 0
    for (let i = i0; i < i1 && i < count; i++) {
      const s = pcm[i]
      if (s < lo) lo = s
      if (s > hi) hi = s
    }
    cols.push({ lo: clamp(lo, -1, 1), hi: clamp(hi, -1, 1) })
  }
  return cols
}

export function paintWave(ctx, width, height, pcm, sr, view) {
  ctx.clearRect(0, 0, width, height)
  if (!pcm || pcm.length < 2 || width < 4 || height < 4) return
  const rate = sr > 1000 ? sr : 44100
  if (view === 2) {
    paintSpectrum(ctx, width, height, pcm, rate)
    return
  }
  const cols = waveColumns(pcm, width)
  const mid = height / 2
  const half = Math.max(1, height / 2 - 1)
  if (view === 1) {
    const bucket = Math.max(1, Math.floor(pcm.length / Math.min(width, 96)))
    for (let x = 0; x < width; x++) {
      const i0 = Math.floor((x * pcm.length) / width)
      const i1 = Math.min(pcm.length, i0 + bucket)
      const band = analyse(pcm, i0, i1, rate)
      const peak = Math.max(band.low, band.mid, band.high, 1e-8)
      const amp = Math.max(Math.abs(cols[x].lo), Math.abs(cols[x].hi))
      const bright = amp >= 0.999 ? 1 : clamp(amp, 0, 1)
      ctx.fillStyle = `rgb(${Math.round((band.low / peak) * bright * 255)}, ${Math.round((band.mid / peak) * bright * 255)}, ${Math.round((band.high / peak) * bright * 255)})`
      const yHi = mid - cols[x].hi * half
      const yLo = mid - cols[x].lo * half
      const top = Math.min(yHi, yLo)
      const bottom = Math.max(yHi, yLo)
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top))
    }
    return
  }
  ctx.fillStyle = '#1b1530'
  for (let x = 0; x < width; x++) {
    const yHi = mid - cols[x].hi * half
    const yLo = mid - cols[x].lo * half
    const top = Math.min(yHi, yLo)
    const bottom = Math.max(yHi, yLo)
    ctx.fillRect(x, top, 1, Math.max(1, bottom - top))
  }
}

function paintSpectrum(ctx, width, height, pcm, rate) {
  const fMin = 40
  const fMax = Math.min(20000, rate * 0.5)
  const logSpan = Math.log(fMax / fMin)
  const columns = Math.min(width, 160)
  for (let x = 0; x < width; x++) {
    const cx = Math.floor((x * columns) / width)
    const centre = Math.floor(((cx + 0.5) * pcm.length) / columns)
    let i0 = Math.max(0, centre - FFT / 2)
    let i1 = Math.min(pcm.length, i0 + FFT)
    if (i1 - i0 < 32) {
      i0 = 0
      i1 = pcm.length
    }
    const { mag } = analyse(pcm, i0, i1, rate)
    const column = new Float32Array(height)
    for (let bin = 1; bin < FFT / 2; bin++) {
      const f0 = Math.max(fMin, (bin - 0.5) * rate / FFT)
      const f1 = Math.min(fMax, (bin + 0.5) * rate / FFT)
      if (f1 <= fMin || f0 >= fMax || f1 <= f0) continue
      const u0 = Math.log(f0 / fMin) / logSpan
      const u1 = Math.log(f1 / fMin) / logSpan
      const y0 = clamp(Math.floor((1 - u1) * (height - 1)), 0, height - 1)
      const y1 = clamp(Math.ceil((1 - u0) * (height - 1)), y0, height - 1)
      for (let y = y0; y <= y1; y++) column[y] = Math.max(column[y], mag[bin])
    }
    for (let y = 1; y < height; y++) if (column[y] <= 0) column[y] = column[y - 1]
    for (let y = height - 2; y >= 0; y--) if (column[y] <= 0) column[y] = column[y + 1]
    for (let y = 0; y < height; y++) {
      const db = 20 * Math.log10(column[y] + 1e-10)
      const [r, g, b] = rxColour((db + 78) / 78)
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
      ctx.fillRect(x, y, 1, 1)
    }
  }
}

export const WAVE_VIEWS = ['INK', 'RGB', 'SPEC']
