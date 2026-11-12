import { glideSlot, portaFields } from '../audio/numpadFx.js'
import { pushNumpadFx } from '../audio/engine.js'
import { model, touch } from '../model.js'
import { finger } from './Tracker.jsx'

let dir = 0
let raf = 0
let at = 0
const carry = new Map()

const request = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame
  : (fn) => setTimeout(() => fn(Date.now()), 16)
const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout

export function portaArmed() {
  const stack = Array.isArray(model.fxStack) ? model.fxStack : []
  return stack.length > 0 && !!(finger.shift || finger.kbShift)
}

function tick(now) {
  raf = 0
  if (!dir) return
  const dt = Math.min(0.05, Math.max(0, (now - at) / 1000))
  at = now
  const stack = Array.isArray(model.fxStack) ? model.fxStack : []
  if (portaArmed() && dt > 0) {
    const rate = Math.max(1, Math.min(255, model.porta | 0 || 72))
    const amount = rate * dt
    let moved = false
    const next = model.numpadFx.map((slot, index) => {
      if (!stack.includes(index)) return slot
      const bag = carry.get(index) || {}
      for (const key of portaFields(slot.type)) {
        if (bag[key] == null || Math.abs(Math.round(bag[key]) - (slot[key] | 0)) > 1) bag[key] = slot[key] | 0
      }
      const stepped = glideSlot(slot, dir, amount, bag)
      carry.set(index, bag)
      if (portaFields(slot.type).some((key) => stepped[key] !== slot[key])) moved = true
      return stepped
    })
    if (moved) {
      model.numpadFx = next
      pushNumpadFx()
      touch(false)
    }
  }
  raf = request(tick)
}

export function startPorta(next) {
  if (dir === next) return
  dir = next
  at = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (!raf) raf = request(tick)
}

export function stopPorta(which) {
  if (which != null && dir !== which) return
  const was = dir
  dir = 0
  if (raf) cancel(raf)
  raf = 0
  carry.clear()
  if (was) touch(true)
}
