/** Koala Sampler default QWERTY map. Character keys, not physical codes. */

export const PAD_KEYS = ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v']

export const SEQ_KEYS = ['y', 'u', 'i', 'o', 'h', 'j', 'k', 'l']

export const SCREENS = [
  { id: 'pads', label: 'Pads' },
  { id: 'edit', label: 'Sample' },
  { id: 'seq', label: 'Sequence' },
  { id: 'mix', label: 'Mixer' },
  { id: 'track', label: 'Tracker' },
  { id: 'synth', label: 'Synth' },
  { id: 'fx', label: 'FX' },
]

const WHITE = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"]
const WHITE_SEMI = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17]
const BLACK = { w: 1, e: 3, t: 6, y: 8, u: 10, o: 13, p: 15 }

/** Musical typing. Octave 4 means the A key is C4 (MIDI 60). */
export function pianoNote(key, octave) {
  const k = key.length === 1 ? key.toLowerCase() : key
  const base = 12 * ((octave || 4) + 1)
  const wi = WHITE.indexOf(k)
  if (wi >= 0) return base + WHITE_SEMI[wi]
  if (k in BLACK) return base + BLACK[k]
  return null
}

// Renoise computer keyboard. Octave N (default 3): Z is C of that octave.
// Q and comma are C one octave higher. I is C an octave above that.
// A and Caps Lock are note-off, so they are absent here.
const RENOISE_LOWER = { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11 }
const RENOISE_UPPER = {
  q: 0, 2: 1, w: 2, 3: 3, e: 4, r: 5, 5: 6, t: 7, 6: 8, y: 9, 7: 10, u: 11,
  ',': 0, l: 1, '.': 2, ';': 3,
}
const RENOISE_TOP = { i: 0, 9: 1, o: 2, 0: 3, p: 4 }

const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-']

/** Pattern note for a pitch offset from C-4, the tracker's root. */
export function noteName(pitch = 0) {
  const midi = 60 + (pitch | 0)
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  const oct = Math.floor(midi / 12) - 1
  return `${name}${oct}`
}

/** MIDI note for the Renoise layout, or null when the key is not a note. */
export function renoiseNote(key, octave = 3) {
  const k = key.length === 1 ? key.toLowerCase() : key
  const oct = Number.isFinite(octave) ? octave : 3
  const base = 12 * (oct + 1)
  if (k in RENOISE_LOWER) return base + RENOISE_LOWER[k]
  if (k in RENOISE_UPPER) return base + 12 + RENOISE_UPPER[k]
  if (k in RENOISE_TOP) return base + 24 + RENOISE_TOP[k]
  return null
}

export const SHORTCUTS = [
  ['1 2 3 4 / Q W E R / A S D F / Z X C V', 'Pads 1 to 16 of the current bank'],
  ['Y U I O / H J K L', 'Pads page: sequence slots 1 to 8. Off in keyboard mode'],
  ['Space', 'Play / stop'],
  ['0', 'Record on / off'],
  ['M', 'Metronome on / off'],
  ['/', 'Toggle Pad and Keys.'],
  ['Shift (hold)', 'Edit. Multi-select pads'],
  ['N (hold)', 'Solo the next pad'],
  ['B (hold)', 'Mute the next pad'],
  ['[ and ]', 'Previous / next sample bank'],
  ['{ and }', 'Pads page: previous / next sequence bank (8 patterns). Elsewhere: previous / next pattern'],
  ['= and -', 'Add / remove a bar'],
  ['_', 'Double up the sequence'],
  ['Tab / Shift+Tab', 'Next / previous screen'],
  ['Left / Right', 'Previous / next pad page'],
  ['Down', 'Sample browser'],
  ['Delete / Backspace', 'Delete the selection'],
  ['Pad', '1 2 3 4 / Q W E R / A S D F / Z X C V play the current bank. Y U I O / H J K L are sequence slots on the Pads page.'],
  ['Keys', 'Selected pad, in notation. Z is C of the octave (default 3). Q and comma are the next C. I is the C above that. A and Caps Lock are note off. Numpad / and *, or Ctrl+[ and Ctrl+], shift the octave. In this map M, N, and 0 are notes.'],
  ['Tracker', 'Esc or Rec arms edit. On NOTE, Z is C and Q is the next C. A is note off. INST is the pad in hex. Ctrl and 1–0 sets the step. Tab moves a track. MIDI pads write the armed track. Right-click a column header and choose Show/hide SL/LP columns. SL is the play offset, four hex digits. LP is move then length, eight hex digits. Blank leaves the sample alone. Hiding the columns keeps the values.'],
  ['MIDI', 'Click MIDI once so the browser can see a controller. Pad mode: a Launchpad plays all 64 instruments, and MPC, MPD, and MPK pads play instruments from note 36. Keys mode plays the selected pad chromatically. Notes outside the pad map play the selected pad, so a keyboard can carry a melody. The computer keys work in every browser.'],
  ['FILE', 'Open and save. Wallet reads tokens for media. A video link from YouTube, Odysee, LBRY, or X becomes a Cache sample until it is loaded onto a pad and the song is saved. Image… turns a picture into a Cache sample.'],
  ['NEW / SAVE', 'New song, folder, kit, or slice. Save writes the current song. Save as stores a new .m1ya. Save as template keeps a starting point. On miyamaker.com, Save song or kit to Arweave, upload a bounce, or mint either as an edition.'],
  ['Shift+numpad 0–9', 'Hold a master FX slot. It retriggers the output, then runs that slot’s filter, chorus, flanger, or repeat. Edit the ten slots on the FX page.'],
]

/**
 * The maker lives in an open shadow root, so a window listener sees the host as e.target.
 * The first node of the composed path is the element that really has the key.
 */
export function eventSource(e) {
  return (typeof e?.composedPath === 'function' && e.composedPath()[0]) || e?.target
}

/** Inputs that take typed text. A focused slider, checkbox or file button still lets the pads play. */
const NOT_TEXT = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'image'])

/** The key went to a text field, a select, or editable text: shortcuts (Tab too) leave it alone. */
export function typing(e) {
  const el = eventSource(e)
  const tag = el?.tagName
  if (tag === 'INPUT') return !NOT_TEXT.has(String(el.type || 'text').toLowerCase())
  return tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable
}
