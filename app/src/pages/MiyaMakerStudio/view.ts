export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 8
export const ZOOM_STEP = 1.1

export function clampZoom(zoom: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom))
}

/**
 * Pan is how far the picture's center sits from the view's center, in screen pixels.
 * Scaling it with the zoom keeps the picture point under the view center in place.
 */
export function panForZoom(pan: number, oldZoom: number, newZoom: number): number {
  if (oldZoom === 0) return pan
  return (pan * newZoom) / oldZoom
}

/** Picture coordinate under the center of the view. */
export function canvasPointAtViewCenter(pan: number, zoom: number, canvasSize: number): number {
  if (zoom === 0) return canvasSize / 2
  return canvasSize / 2 - pan / zoom
}
