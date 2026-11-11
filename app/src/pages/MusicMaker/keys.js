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
  ['Space', 'Play / stop, on every screen. A text field still takes the space.'],
  ['0', 'Record on / off'],
  ['M', 'Metronome on / off'],
  ['/', 'Cycle Off, Pads, and Keys. Off keeps the last map for a hardware keyboard and hides the on-screen pads and keys on a narrow window.'],
  ['Shift (hold)', 'Edit. Multi-select pads'],
  ['N (hold)', 'Solo the next pad'],
  ['B (hold)', 'Mute the next pad'],
  ['[ and ]', 'Previous / next sample bank'],
  ['{ and }', 'Pads page: previous / next sequence bank (8 patterns). Elsewhere: previous / next pattern'],
  ['= and -', 'Add / remove a bar'],
  ['_', 'Double up the sequence'],
  ['Tab / Shift+Tab', 'Next / previous screen'],
  ['Ctrl+Left / Ctrl+Up', 'Previous screen. Ctrl+Right / Ctrl+Down is the next screen. On a gamepad, R1 and the d-pad do the same. The d-pad alone is the arrow keys.'],
  ['Up / Down', 'Move the highlight across knobs, sliders, and menus. Left and Right change the highlighted one. Shift on a knob jumps by a larger step. On the tracker grid the arrows still move the cursor. With nothing highlighted, Left and Right change bank.'],
  ['Delete / Backspace', 'Delete the selection'],
  ['Pad', '1 2 3 4 / Q W E R / A S D F / Z X C V play the current bank. Y U I O / H J K L are sequence slots on the Pads page.'],
  ['Keys', 'Selected pad, in notation. Z is C of the octave (default 3). Q and comma are the next C. I is the C above that. A and Caps Lock are note off. Numpad / and *, or Ctrl+[ and Ctrl+], shift the octave. In this map M, N, and 0 are notes.'],
  ['Tracker', 'Rec arms edit. The marked cell is where edits land. The play row is the step being heard, and it can sit on a different row. Rec off does not change the pattern, stopped or playing. Esc toggles Rec. Arrows move the cursor. Shift and the arrows edit only while Rec is on. Shift+Alt and the arrows mark a block from the cursor. Cmd+C or Ctrl+C copies only those columns. Cmd+V or Ctrl+V pastes them at the cursor. Delete changes only those columns: NOTE removes the hit, VEL sets 0 and leaves the note. Shift and the arrows change every selected cell of those columns. A plain arrow drops the block. Notes play once from the trim start to the trim end, and the same lane chokes the previous note. SL and LP still loop a grain until the next note or OFF. On SL or LP, Left and Right walk each hex pair before leaving the column. Shift+Left/Right on NOTE is one semitone. Shift+Up/Down on NOTE is one octave. On every other column, Shift+Up/Down edits the left digit and Shift+Left/Right edits the right digit. Both wrap. Step, or Ctrl and 1–0, is how many rows a finished note or value skips. 0 stays. Pad mode writes the pad you press as C-4 at velocity 80, from any column. Keys mode uses the Renoise map on NOTE. A is note off. Delete on MOVE sets +00 and leaves the note. Shift+numpad 0–9 still holds a master FX slot. Right-click a column header and choose Show/hide SL/LP columns. Blank grain cells leave the sample alone. Hiding the columns keeps the values.'],
  ['Sample page', 'Drag the wave to set S and E. Drag inside a shorter span to slide it, and drag near an edge to resize it. The thin S, E, and LP handles do the same. Pinch, or ctrl-scroll, zooms in. The wheel pans once you are zoomed. Double-click, or Fit, shows the whole sample. A peach line marks each voice playing that pad. Chop copies the span onto the next empty pad and leaves the original.'],
  ['Copy a pad', 'Drag a row from the browser onto a pad. Right-click a pad, or hold it on a touch screen, then Copy pad. Paste on an empty pad. Paste & replace shows when that pad already has a sound.'],
  ['Browser', 'The top rail button hides the sample browser. The button under it opens the arranger in the same column. With both open they share the column, and the bar between them drags. Drag the outer divider to resize the column, or to the edge to close it. A new part waits until the one playing finishes. Play chooses Wait, Now, or Grid, and Order or Once. + pattern opens four banks, and each bank opens its patterns, named or empty. Right-click a section, or the menu button, to give it another slot, or Edit, Duplicate, and Delete. Edit sets the name, the length, and an optional tempo for that pattern. A pattern can automate the song, the buses, and the pads. Right-click a lane, or Clear, to remove that automation. Loop repeats that section. Removing a cell keeps the pattern.'],
  ['MIDI', 'Click MIDI once so the browser can see a controller. Pad mode: a Launchpad plays all 64 instruments, and MPC, MPD, and MPK pads play instruments from note 36. Keys mode plays the selected pad chromatically. Notes outside the pad map play the selected pad, so a keyboard can carry a melody. The computer keys work in every browser.'],
  ['FILE', 'Manual opens the book. Open and save. Wallet reads tokens for media. A video link from YouTube, Odysee, LBRY, or X opens a window to crop the in and out points, downsample, slice, and put the sample on a pad or in Cache. A start time in the link is the suggested in point. Image… turns a picture into a Cache sample.'],
  ['NEW / SAVE', 'New song, folder, kit, or slice. Save writes the current song. Save as stores a new .m1ya. Save as template keeps a starting point. On miyamaker.com, Publish song, kit, or bounce to Arweave (public and permanent, every sample included), or mint the song, the kit, or the audio file as an edition.'],
  ['Shift+numpad 0–9', 'Hold a master FX slot. Hold more than one and they run in the order you pressed them: a retrigger into chorus is not the same chain as chorus into a retrigger. On the FX page, holding an on-screen numpad key does the same, and a short tap selects that slot. Repeat locks one note value to the project tempo. Slice rearranges those notes, and Move walks the read on each step. Grain can stretch. Wander steps a filter’s resonance. Presets save with the song.'],
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
  if (el?.getAttribute?.('aria-label') === 'Edit step') {
    const key = e.key
    if (e.ctrlKey || e.metaKey || e.altKey || key === 'Escape' || (e.shiftKey && key?.startsWith('Arrow'))) {
      el.blur()
      return false
    }
    if (key === 'Enter') {
      el.blur()
      return true
    }
    if (/^[0-9]$/.test(key) || key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Backspace' || key === 'Delete' || key === 'Tab' || key === 'Home' || key === 'End') return true
    el.blur()
    return false
  }
  const tag = el?.tagName
  if (tag === 'INPUT') return !NOT_TEXT.has(String(el.type || 'text').toLowerCase())
  return tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable
}
