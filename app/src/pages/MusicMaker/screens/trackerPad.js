/** Cursor cross on the tracker. A tap is one arrow step. A drag repeats, faster farther from the center. The lift is not a destination. */

export const PAD_TAP_MS = 150
export const PAD_DRAG_PX = 7
export const TRACK_ZOOM_MIN = 0.75
export const TRACK_ZOOM_MAX = 2.6

export function clampTrackZoom(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.min(TRACK_ZOOM_MAX, Math.max(TRACK_ZOOM_MIN, n))
}

export function zoomBy(current, factor) {
  const next = clampTrackZoom(clampTrackZoom(current) * factor)
  return Math.round(next * 100) / 100
}

/** Direction from the pad center. The center nub is a dead zone. */
export function padAim(dx, dy, radius) {
  const dist = Math.hypot(dx, dy)
  const dead = Math.max(10, radius * 0.28)
  if (dist <= dead) return { key: '', span: 0 }
  const key = Math.abs(dx) >= Math.abs(dy)
    ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft')
    : (dy > 0 ? 'ArrowDown' : 'ArrowUp')
  const span = Math.min(1, (dist - dead) / Math.max(1, radius - dead))
  return { key, span }
}

/** Steps per second. Holding still repeats slowly. Dragging away speeds up. */
export function padRate(span, dragging) {
  const s = Math.max(0, Math.min(1, span))
  if (!dragging) return 5
  return 8 + s * 26
}

export function freshPad() {
  return {
    on: false,
    id: 0,
    downAt: 0,
    then: 0,
    dragging: false,
    ox: 0,
    oy: 0,
    x: 0,
    y: 0,
    acc: 0,
    cx: 0,
    cy: 0,
    radius: 1,
    key: '',
    raf: 0,
  }
}

export function padPointerDown(pad, event) {
  const cx = event.rect.left + event.rect.width / 2
  const cy = event.rect.top + event.rect.height / 2
  const radius = Math.min(event.rect.width, event.rect.height) / 2
  const aim = padAim(event.x - cx, event.y - cy, radius)
  return {
    pad: {
      ...pad,
      on: true,
      id: event.id,
      downAt: event.now,
      then: event.now,
      dragging: false,
      ox: event.x,
      oy: event.y,
      x: event.x,
      y: event.y,
      acc: 0,
      cx,
      cy,
      radius,
      key: aim.key,
    },
    steps: aim.key ? 1 : 0,
  }
}

export function padPointerMove(pad, event) {
  if (!pad.on || event.id !== pad.id) return pad
  const dragging = pad.dragging || Math.hypot(event.x - pad.ox, event.y - pad.oy) >= PAD_DRAG_PX
  const aim = padAim(event.x - pad.cx, event.y - pad.cy, pad.radius)
  return { ...pad, x: event.x, y: event.y, dragging, key: aim.key }
}

/** Release stops the repeat. It does not add a step and it does not carry a cell. */
export function padPointerUp(pad, event) {
  if (!pad.on || (event.id != null && event.id !== pad.id)) return pad
  return { ...freshPad(), raf: pad.raf }
}

export function padTick(pad, now) {
  if (!pad.on || !pad.key) return { pad: { ...pad, then: now }, steps: 0 }
  const dt = Math.min(0.05, Math.max(0, (now - pad.then) / 1000))
  const aim = padAim(pad.x - pad.cx, pad.y - pad.cy, pad.radius)
  const next = { ...pad, then: now, key: aim.key }
  if (!aim.key) return { pad: { ...next, acc: 0 }, steps: 0 }
  if (!pad.dragging && now - pad.downAt < PAD_TAP_MS) return { pad: next, steps: 0 }
  const rate = padRate(aim.span, pad.dragging)
  let acc = pad.acc + rate * dt
  let steps = 0
  while (acc >= 1 && steps < 4) {
    acc -= 1
    steps += 1
  }
  return { pad: { ...next, acc }, steps }
}

/**
 * Where a grid drag lands when the finger lifts.
 * A drag keeps the walked cursor. A tap uses the pressed cell. The cell under the lift is never used.
 */
export function stickRelease(stick) {
  const tap = !stick.moved && stick.tapRow >= 0 && stick.tapCol >= 0
  return {
    place: tap,
    row: stick.tapRow,
    col: stick.tapCol,
    swallowClick: true,
  }
}
