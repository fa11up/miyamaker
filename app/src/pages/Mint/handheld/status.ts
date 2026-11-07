import type { LiveMintStatus } from '../liveMints'

export type LampTone = 'ok' | 'warn' | 'off'

const LABEL: Record<LiveMintStatus, string> = {
  open: 'Mint open',
  closed: 'Mint closed',
  soldout: 'Sold out',
  soon: 'Coming soon',
  unknown: 'Checking…',
}
const TONE: Record<LiveMintStatus, LampTone> = {
  open: 'ok',
  closed: 'warn',
  soldout: 'off',
  soon: 'off',
  unknown: 'off',
}

/** `loading` false with an unknown status means the chain could not be read, so say so instead of "Checking…". */
export const statusLamp = (status: LiveMintStatus, loading: boolean): { tone: LampTone; label: string } =>
  status === 'unknown' && !loading
    ? { tone: 'warn', label: 'Can’t reach chain' }
    : { tone: TONE[status], label: LABEL[status] }

/** Where the D-pad lands: wraps round `count` choices, `step` places away. */
export const wrapIndex = (count: number, index: number, step: number): number =>
  count <= 0 ? 0 : (((index + step) % count) + count) % count

/** The next quantity from ▲▼, kept between 1 and the most that can be minted now. */
export const stepQuantity = (quantity: number, step: number, max: number): number =>
  Math.min(Math.max(1, max), Math.max(1, quantity + step))

/** Fits the device on a screen: never bigger than it was drawn, floored to two places so it does not blur. */
export const deviceZoom = (w: number, h: number, deviceW: number, deviceH: number): number =>
  w > 0 && h > 0 ? Math.min(1, Math.floor(Math.min(w / deviceW, h / deviceH) * 100) / 100) : 1

/** The hologram's zoom: how big, and where the image's top left sits inside its square frame. */
export type ZoomView = { zoom: number; x: number; y: number }
export const MAX_ZOOM = 6

const clampPan = (v: number, zoom: number, size: number) => Math.min(0, Math.max(size - size * zoom, v))

/** Zooms by `factor`, keeping the point under (cx, cy) in place and never showing past the image's edges. */
export function zoomAt(view: ZoomView, factor: number, cx: number, cy: number, size: number): ZoomView {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom * factor))
  const ratio = zoom / view.zoom
  return {
    zoom,
    x: clampPan(cx - (cx - view.x) * ratio, zoom, size),
    y: clampPan(cy - (cy - view.y) * ratio, zoom, size),
  }
}

export const panBy = (view: ZoomView, dx: number, dy: number, size: number): ZoomView => ({
  zoom: view.zoom,
  x: clampPan(view.x + dx, view.zoom, size),
  y: clampPan(view.y + dy, view.zoom, size),
})
