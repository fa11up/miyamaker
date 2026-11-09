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

const IMAGE_BYTES = 20 * 1024 * 1024
export const IMAGE_PIXELS = 40_000_000

/** Width and height from a PNG, GIF, BMP, WebP or JPEG header, or null when the format is not one of those. */
export function imageSize(b) {
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
  const le16 = (i) => b[i] | (b[i + 1] << 8)
  const le32 = (i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: u32(16), height: u32(20) }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { width: le16(6), height: le16(8) }
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) return { width: le32(18), height: Math.abs(le32(22) | 0) }
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (kind === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
    if (kind === 'VP8L') {
      const bits = le32(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (kind === 'VP8 ') return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const marker = b[i + 1]
      const len = (b[i + 2] << 8) | b[i + 3]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: (b[i + 7] << 8) | b[i + 8], height: (b[i + 5] << 8) | b[i + 6] }
      }
      i += 2 + len
    }
  }
  return null
}

export async function importImageFile(file, settings) {
  if (!file) throw new Error('Choose an image first')
  if (file.size > IMAGE_BYTES) throw new Error('That image is over 20 MB. Use a smaller one.')
  // A small file can still decode to a huge bitmap. The size in its header is checked before decoding.
  const size = imageSize(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()))
  if (size && size.width * size.height > IMAGE_PIXELS) {
    throw new Error(`That image is ${size.width}×${size.height}. Use one under ${Math.round(IMAGE_PIXELS / 1e6)} megapixels.`)
  }
  const bmp = await createImageBitmap(file)
  if (bmp.width * bmp.height > IMAGE_PIXELS) {
    bmp.close?.()
    throw new Error(`That image is ${bmp.width}×${bmp.height}. Use one under ${Math.round(IMAGE_PIXELS / 1e6)} megapixels.`)
  }
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
