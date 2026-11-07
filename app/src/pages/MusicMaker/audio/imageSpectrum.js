import { cachePcm } from '../media/library.js'
import { model, touch } from '../model.js'

const RATE = 44100
const MAX_SECONDS = 16

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function clampNum(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

/** Turn picture columns into a short spectrum. Bottom of the image is low. */
export function imageToPcm(image, settings = {}) {
  const width = image?.width | 0
  const height = image?.height | 0
  const data = image?.data
  if (!width || !height || !data) throw new Error('That image has no pixels')
  const columns = clampInt(settings.columns, 8, 256, 64)
  const bins = clampInt(settings.bins, 8, 96, 32)
  const octave = clampInt(settings.octave, 0, 8, 4)
  const octaves = clampInt(settings.octaves, 1, 8, 4)
  const speed = clampNum(settings.speed, 1, 64, 8)
  const grid = new Float32Array(columns * bins)
  const counts = new Float32Array(columns * bins)
  for (let y = 0; y < height; y++) {
    const bin = Math.min(bins - 1, Math.floor(((height - 1 - y) / height) * bins))
    for (let x = 0; x < width; x++) {
      const col = Math.min(columns - 1, Math.floor((x / width) * columns))
      const i = (y * width + x) * 4
      const lum = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255
      const alpha = (data[i + 3] ?? 255) / 255
      const at = col * bins + bin
      grid[at] += lum * alpha
      counts[at] += 1
    }
  }
  for (let i = 0; i < grid.length; i++) {
    if (counts[i]) grid[i] /= counts[i]
  }
  const used = Math.max(1, Math.min(columns, Math.floor(MAX_SECONDS * speed)))
  const frames = Math.max(1, Math.floor((used / speed) * RATE))
  const out = new Float32Array(frames)
  const baseMidi = 12 * (octave + 1)
  const baseHz = 440 * Math.pow(2, (baseMidi - 69) / 12)
  const span = octaves * 12
  const freq = new Float32Array(bins)
  const phase = new Float32Array(bins)
  const amp = new Float32Array(bins)
  for (let b = 0; b < bins; b++) {
    const semi = (b / Math.max(1, bins - 1)) * span
    freq[b] = baseHz * Math.pow(2, semi / 12)
  }
  const scale = 1 / Math.sqrt(bins)
  const hop = 128
  let peak = 0
  for (let i = 0; i < frames; i++) {
    if (i % hop === 0) {
      const pos = (i / frames) * used
      const c0 = Math.min(columns - 1, Math.floor(pos))
      const c1 = Math.min(columns - 1, c0 + 1)
      const frac = pos - Math.floor(pos)
      for (let b = 0; b < bins; b++) {
        const a0 = grid[c0 * bins + b]
        const a1 = grid[c1 * bins + b]
        amp[b] = (a0 + (a1 - a0) * frac) * scale
      }
    }
    let sample = 0
    for (let b = 0; b < bins; b++) {
      if (amp[b] >= 0.02) sample += Math.sin(phase[b]) * amp[b]
      phase[b] += (Math.PI * 2 * freq[b]) / RATE
      if (phase[b] > Math.PI * 2) phase[b] -= Math.PI * 2
    }
    out[i] = sample
    peak = Math.max(peak, Math.abs(sample))
  }
  if (peak > 0.0001) {
    const gain = 0.9 / peak
    for (let i = 0; i < frames; i++) out[i] *= gain
  }
  return { pcm: out, sr: RATE }
}

export async function importImageFile(file, settings) {
  if (!file) throw new Error('Choose an image first')
  const bmp = await createImageBitmap(file)
  const maxW = 480
  const scale = bmp.width > maxW ? maxW / bmp.width : 1
  const width = Math.max(1, Math.round(bmp.width * scale))
  const height = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d', { willReadFrequently: true })
  g.drawImage(bmp, 0, 0, width, height)
  bmp.close?.()
  const image = g.getImageData(0, 0, width, height)
  const { pcm, sr } = imageToPcm(image, settings)
  const title = String(file.name || 'image').replace(/\.[^.]+$/, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'image'
  await cachePcm('imports', title, pcm, sr, 'wav')
  model.browserNote = `${title} is in Cache. Load it onto a pad to keep it in a song.`
  touch(true)
}
