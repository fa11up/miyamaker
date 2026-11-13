import { CANVAS, letterbox, type Trait } from './model'
import { traitImage } from './remote'

const PLATE_MAX = 24
const plates = new Map<string, HTMLCanvasElement>()

export function plateKey(trait: Pick<Trait, 'id' | 'draft' | 'file' | 'sourceUrl'>): string {
  return `${trait.id}:${trait.draft?.size ?? 0}:${trait.file?.size ?? 0}:${trait.sourceUrl ?? ''}`
}

export function plateCanvas(trait: Trait): HTMLCanvasElement | null {
  const key = plateKey(trait)
  const hit = plates.get(key)
  if (!hit) return null
  plates.delete(key)
  plates.set(key, hit)
  return hit
}

/** Decode one worn picture to the 1024 plate so the stack can paint without fetching again. */
export async function preparePlate(trait: Trait, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || plateCanvas(trait)) return
  const blob = await traitImage(trait, 'now', signal).catch(() => null)
  if (!blob || signal?.aborted) return
  const bitmap = await createImageBitmap(blob)
  if (signal?.aborted) {
    bitmap.close()
    return
  }
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS
  canvas.height = CANVAS
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return
  }
  ctx.imageSmoothingEnabled = false
  const box = letterbox(bitmap.width, bitmap.height)
  ctx.drawImage(bitmap, box.x, box.y, box.w, box.h)
  bitmap.close()
  const key = plateKey(trait)
  plates.set(key, canvas)
  while (plates.size > PLATE_MAX) {
    const oldest = plates.keys().next().value
    if (oldest === undefined) break
    plates.delete(oldest)
  }
}
