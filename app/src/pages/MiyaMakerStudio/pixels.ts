import { blankPixels, type Pixels } from './brush'
import { CANVAS, letterbox } from './model'

export async function blobToPixels(blob: Blob, fit: 'letterbox' | 'stretch'): Promise<Pixels> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS
    canvas.height = CANVAS
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser has no canvas.')
    ctx.imageSmoothingEnabled = false
    if (fit === 'stretch') {
      ctx.drawImage(bitmap, 0, 0, CANVAS, CANVAS)
    } else {
      const box = letterbox(bitmap.width, bitmap.height)
      ctx.drawImage(bitmap, box.x, box.y, box.w, box.h)
    }
    const image = ctx.getImageData(0, 0, CANVAS, CANVAS)
    return { width: CANVAS, height: CANVAS, data: image.data }
  } finally {
    bitmap.close()
  }
}

export function pixelsToPng(pixels: Pixels): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = pixels.width
  canvas.height = pixels.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('This browser has no canvas.'))
  const copy = new Uint8ClampedArray(pixels.data)
  ctx.putImageData(new ImageData(copy, pixels.width, pixels.height), 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not write a PNG.'))), 'image/png')
  })
}

export { blankPixels }
