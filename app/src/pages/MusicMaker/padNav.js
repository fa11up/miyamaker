// Page turns are Shift+Ctrl+arrow on a keyboard.
// On a pad the same turn is R1 plus the top face button, then a direction:
// Triangle on PlayStation, X on Switch, Y on Xbox. In the standard map that
// face button is index 3 and R1/RB/R is index 5. The d-pad is buttons 12–15.
// The left stick is axes 0 and 1 (up is negative).
// A PS1 or PS2 USB adapter the browser does not know keeps an empty mapping.
// Those often put Triangle on button 0 or 3 and R1 on button 5 or 7, the d-pad
// on the first two axes or a hat at axis 9, and sometimes the hat on buttons 16–19.

const DEAD = 0.5
const REPEAT_DELAY = 380
const REPEAT_EVERY = 70

function pressed(buttons, index) {
  const button = buttons?.[index]
  if (button == null) return false
  if (typeof button === 'number') return button > DEAD
  return !!(button.pressed || (typeof button.value === 'number' && button.value > DEAD))
}

function axis(axes, index) {
  const value = Number(axes?.[index])
  return Number.isFinite(value) ? value : 0
}

/** One hat axis, using the same bands as Chromium's DpadFromAxis. 0 is centered. */
export function hatKey(dir) {
  if (!Number.isFinite(dir) || dir === 0) return ''
  const up = (dir >= -1 && dir < -0.7) || (dir >= 0.95 && dir <= 1)
  const right = dir >= -0.75 && dir < -0.1
  const down = dir >= -0.2 && dir < 0.45
  const left = dir >= 0.4 && dir <= 1
  if (dir >= 0.95 && up) return 'ArrowUp'
  if (up && right) return 'ArrowRight'
  if (down && right) return 'ArrowRight'
  if (down && left) return 'ArrowLeft'
  if (up && left) return 'ArrowUp'
  if (up) return 'ArrowUp'
  if (down) return 'ArrowDown'
  if (left) return 'ArrowLeft'
  if (right) return 'ArrowRight'
  return ''
}

function stickKey(x, y) {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  if (ax < DEAD && ay < DEAD) return ''
  if (ay > ax) return y < 0 ? 'ArrowUp' : 'ArrowDown'
  return x < 0 ? 'ArrowLeft' : 'ArrowRight'
}

function buttonKey(buttons) {
  if (pressed(buttons, 12)) return 'ArrowUp'
  if (pressed(buttons, 13)) return 'ArrowDown'
  if (pressed(buttons, 14)) return 'ArrowLeft'
  if (pressed(buttons, 15)) return 'ArrowRight'
  if (pressed(buttons, 16)) return 'ArrowUp'
  if (pressed(buttons, 17)) return 'ArrowDown'
  if (pressed(buttons, 18)) return 'ArrowLeft'
  if (pressed(buttons, 19)) return 'ArrowRight'
  return ''
}

function pageChord(buttons, standard) {
  const shoulder = pressed(buttons, 5) || (!standard && pressed(buttons, 7))
  // Standard north button: Triangle, Switch X, Xbox Y.
  // An unmapped PS1 adapter often reports Triangle as button 0 instead.
  const face = pressed(buttons, 3) || (!standard && pressed(buttons, 0))
  return shoulder && face
}

/** `{ ctrl, key }` for one Gamepad snapshot. `ctrl` means R1 plus the top face button. `key` is one arrow, or empty. */
export function readPad(pad) {
  if (!pad) return { ctrl: false, key: '' }
  const buttons = pad.buttons || []
  const axes = pad.axes || []
  const ctrl = pageChord(buttons, pad.mapping === 'standard')
  const fromButtons = buttonKey(buttons)
  if (fromButtons) return { ctrl, key: fromButtons }
  const stick = stickKey(axis(axes, 0), axis(axes, 1))
  if (stick) return { ctrl, key: stick }
  return { ctrl, key: hatKey(axis(axes, 9)) }
}

/**
 * One poll of one pad. Mutates `state` (`{ key, at, paged }`).
 * A page turn (R1 and the top face button) fires once per press. A plain direction repeats.
 */
export function padStep(state, pad, now) {
  const prev = state || { key: '', at: 0, paged: false }
  const { ctrl, key } = readPad(pad)
  let fire = false
  if (key) {
    if (prev.key !== key) {
      fire = true
      prev.at = now + REPEAT_DELAY
      prev.paged = ctrl
    } else if (ctrl && !prev.paged) {
      fire = true
      prev.paged = true
    } else if (!ctrl && now >= prev.at) {
      fire = true
      prev.at = now + REPEAT_EVERY
    }
  } else {
    prev.paged = false
  }
  prev.key = key
  prev.ctrl = ctrl
  return { state: prev, fire, key, ctrl }
}
