/**
 * One pointer drag on a sample-editor handle. Moves call `apply(at, false)`; the lift, or a cancelled touch (system
 * gesture, call, scroll takeover), ends it with `apply(last, true)`. Only the pointer that started it counts.
 * Returns `stop`, which drops the listeners without committing (for closing the editor mid-drag).
 */
export function startHandleDrag(target, event, toFraction, apply) {
  const id = event.pointerId
  let last = toFraction(event.clientX)
  const move = (ev) => {
    if (ev.pointerId !== id) return
    last = toFraction(ev.clientX)
    apply(last, false)
  }
  const stop = () => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', end)
    target.removeEventListener('pointercancel', end)
  }
  const end = (ev) => {
    if (ev.pointerId !== id) return
    if (ev.type === 'pointerup') last = toFraction(ev.clientX)
    stop()
    apply(last, true)
  }
  apply(last, false)
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', end)
  target.addEventListener('pointercancel', end)
  return stop
}
