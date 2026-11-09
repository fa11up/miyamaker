/**
 * Turn a MIDI note into a pad hit or a chromatic pitch.
 * Launchpad Session grids, Akai pad maps, and plain keyboards share one path.
 * The computer keyboard does not come through here.
 */

const MPK8 = {}
// Top row of an 8-pad MPK, then the bottom row. MK2 used 44–47 for that bottom row.
;[48, 49, 50, 51].forEach((note, i) => {
  MPK8[note] = i
})
;[36, 37, 38, 39, 44, 45, 46, 47].forEach((note, i) => {
  MPK8[note] = 4 + (i % 4)
})

export function midiLayout(name = '') {
  const n = String(name).toLowerCase()
  if (isLaunchpad(n)) return 'launchpad'
  if (/mpk/.test(n)) return /mini|play|\bplus\b/.test(n) ? 'mpk8' : 'mpk16'
  if (/mpc|mpd/.test(n)) return 'mpc'
  return 'pads'
}

function isLaunchpad(n) {
  if (/launchkey|launch[\s-]?control/.test(n)) return false
  return /launchpad|launch[\s-]?pad|\blpx\b|lpmini|lp[\s-]?mini|lp[\s-]?x\b|lp[\s-]?pro|lp[\s-]?mk/.test(n)
}

/** Right-hand scene column and the top round buttons. They are not the 8×8. */
function launchpadChrome(note) {
  if (note >= 19 && note <= 89 && note % 10 === 9) return true
  return note >= 91 && note <= 98
}

/** Session / Programmer pad, or null. Bottom-left is note 11, top-left is 81. */
export function sessionCell(note) {
  if (note < 11 || note > 88) return null
  const col = (note % 10) - 1
  const rowFromBottom = Math.floor(note / 10) - 1
  if (col < 0 || col > 7 || rowFromBottom < 0 || rowFromBottom > 7) return null
  return { col, rowFromBottom }
}

/** Screen order: bank A top-left, B top-right, C bottom-left, D bottom-right. */
export function launchpadPad(cell) {
  const rowFromTop = 7 - cell.rowFromBottom
  const bank = (rowFromTop < 4 ? 0 : 2) + (cell.col < 4 ? 0 : 1)
  const local = (rowFromTop % 4) * 4 + (cell.col % 4)
  return bank * 16 + local
}

/** Bottom-left pad is C3. Each step right is one semitone. The next row up continues. */
export function launchpadPitch(cell) {
  return 48 + cell.rowFromBottom * 8 + cell.col - 60
}

/**
 * @returns {{pad:number}|{pitch:number}|null}
 * `pad` selects that instrument. `pitch` is semitones from C4 on the selected pad.
 */
export function midiAction({ note, layout, keys, offset = 36 }) {
  if (!Number.isInteger(note) || note < 0 || note > 127) return null
  if (layout === 'launchpad' && launchpadChrome(note)) return null
  const cell = layout === 'launchpad' ? sessionCell(note) : null
  if (keys) {
    if (cell) return { pitch: launchpadPitch(cell) }
    return { pitch: note - 60 }
  }
  if (cell) return { pad: launchpadPad(cell) }
  if (layout === 'mpk8') {
    if (note in MPK8) return { pad: MPK8[note] }
    return { pitch: note - 60 }
  }
  if (layout === 'mpk16') {
    const index = note - 36
    if (index >= 0 && index < 16) return { pad: index }
    return { pitch: note - 60 }
  }
  const base = layout === 'mpc' ? 36 : (Number.isFinite(offset) ? offset : 36)
  const index = note - base
  if (index >= 0 && index < 64) return { pad: index }
  return { pitch: note - 60 }
}

function layoutBlurb(layout) {
  if (layout === 'launchpad') {
    return 'Pad mode plays all 64 instruments. Keys mode is chromatic, with C3 at the bottom-left pad.'
  }
  if (layout === 'mpk8') {
    return 'The eight pads play the first instruments. The keys play the selected pad. Keys mode plays every note chromatically.'
  }
  if (layout === 'mpk16') {
    return 'The pads play bank A. The keys play the selected pad. Keys mode plays every note chromatically.'
  }
  if (layout === 'mpc') {
    return 'Notes 36 to 99 play the 64 instruments. Any other note plays the selected pad.'
  }
  return 'Notes 36 to 99 play the 64 instruments. Any other note plays the selected pad. Keys mode plays the selected pad chromatically.'
}

/** Short label and tooltip for the MIDI button. */
export function midiSummary(state) {
  const where = 'Chrome, Edge, Brave, Arc, or Opera on Mac, Windows, Linux, or ChromeOS. The computer keyboard plays in every browser.'
  if (!state || state.supported === false) {
    return {
      short: 'No MIDI',
      title: `This browser cannot see MIDI controllers. Use ${where}`,
    }
  }
  if (state.denied) {
    return {
      short: 'MIDI blocked',
      title: 'The browser blocked MIDI. Allow it in the site settings, then click here again.',
    }
  }
  if (!state.ready) {
    return {
      short: 'MIDI',
      title: `Click to allow a controller. ${where} Plug it in before or after you start.`,
    }
  }
  if (!state.inputs?.length) {
    return {
      short: 'MIDI · none',
      title: 'MIDI is allowed. Plug in a Launchpad, MPC, MPD, MPK, or any other USB MIDI controller.',
    }
  }
  const names = state.inputs.map((input) => input.name || 'MIDI in')
  const head = names[0].length > 18 ? `${names[0].slice(0, 16)}…` : names[0]
  const extra = names.length > 1 ? ` +${names.length - 1}` : ''
  return {
    short: `MIDI · ${head}${extra}`,
    title: state.inputs.map((input) => `${input.name}: ${layoutBlurb(input.layout)}`).join('\n'),
  }
}
