/** On-screen piano: an 88-key window, chords, scales, and a few tunings. */

export const KEY_LO = 21
export const KEY_HI = 108
export const PIANO_FROM = 16
export const PIANO_WHITES = 15

const ET = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100]

function ratioCents(n, d) {
  return 1200 * Math.log2(n / d)
}

function offsetsFromRatios(ratios) {
  return ratios.map(([n, d], i) => ratioCents(n, d) - ET[i])
}

/** Quarter-comma meantone, cents from equal, C at the origin. */
function meantoneOffsets() {
  const fifth = ratioCents(3, 2) - ratioCents(81, 80) / 4
  const abs = new Array(12).fill(0)
  let cur = 0
  for (const pc of [7, 2, 9, 4, 11, 6, 1]) {
    cur += fifth
    abs[pc] = ((cur % 1200) + 1200) % 1200
  }
  cur = 0
  for (const pc of [5, 10, 3, 8]) {
    cur -= fifth
    abs[pc] = ((cur % 1200) + 1200) % 1200
  }
  return abs.map((v, i) => v - ET[i])
}

const RELATIVE = {
  just: offsetsFromRatios([
    [1, 1], [16, 15], [9, 8], [6, 5], [5, 4], [4, 3],
    [45, 32], [3, 2], [8, 5], [5, 3], [16, 9], [15, 8],
  ]),
  pyth: offsetsFromRatios([
    [1, 1], [256, 243], [9, 8], [32, 27], [81, 64], [4, 3],
    [729, 512], [3, 2], [128, 81], [27, 16], [16, 9], [243, 128],
  ]),
}

/** Werckmeister III, cents from equal. A is the zero, matching the usual piano-tech table. */
const WERCK = [11.73, 1.96, 3.91, 5.87, 1.96, 9.78, 0, 7.82, 3.91, 0, 7.82, 3.91]
const MEANTONE = meantoneOffsets()

export function isWhite(midi) {
  const pc = ((midi % 12) + 12) % 12
  return pc !== 1 && pc !== 3 && pc !== 6 && pc !== 8 && pc !== 10
}

export const WHITES = []
for (let n = KEY_LO; n <= KEY_HI; n++) if (isWhite(n)) WHITES.push(n)
export const WHITE_COUNT = WHITES.length

export const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const CHORDS = [
  { id: 'maj', name: 'Maj', steps: [0, 4, 7] },
  { id: 'min', name: 'min', steps: [0, 3, 7] },
  { id: '7', name: '7', steps: [0, 4, 7, 10] },
  { id: 'm7', name: 'm7', steps: [0, 3, 7, 10] },
  { id: 'sus4', name: 'sus', steps: [0, 5, 7] },
  { id: 'maj7', name: 'Maj7', steps: [0, 4, 7, 11] },
  { id: '6', name: '6', steps: [0, 4, 7, 9] },
  { id: '9', name: '9', steps: [0, 4, 7, 10, 14] },
  { id: 'add9', name: 'add9', steps: [0, 4, 7, 14] },
  { id: 'dim', name: 'dim', steps: [0, 3, 6] },
  { id: 'aug', name: 'aug', steps: [0, 4, 8] },
  { id: 'm7b5', name: 'm7b5', steps: [0, 3, 6, 10] },
  { id: 'sus2', name: 'sus2', steps: [0, 2, 7] },
  { id: 'dim7', name: 'dim7', steps: [0, 3, 6, 9] },
  { id: 'madd9', name: 'madd9', steps: [0, 3, 7, 14] },
]

export const FACE_CHORDS = ['maj', 'min', '7', 'm7', 'sus4']

export const SCALES = [
  { id: 'major', name: 'Major', group: 'Scales', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Natural minor', group: 'Scales', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'dorian', name: 'Dorian', group: 'Scales', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phryg', name: 'Phrygian', group: 'Scales', steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'mixo', name: 'Mixolydian', group: 'Scales', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'harm', name: 'Harmonic minor', group: 'Scales', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'penta', name: 'Pentatonic', group: 'Scales', steps: [0, 2, 4, 7, 9] },
  { id: 'mpenta', name: 'Minor pentatonic', group: 'Scales', steps: [0, 3, 5, 7, 10] },
  { id: 'blues', name: 'Blues', group: 'Scales', steps: [0, 3, 5, 6, 7, 10] },
  { id: 'yo', name: 'Yo', group: 'Japan', steps: [0, 2, 5, 7, 9] },
  { id: 'in', name: 'In', group: 'Japan', steps: [0, 1, 5, 7, 8] },
  { id: 'insen', name: 'In Sen', group: 'Japan', steps: [0, 1, 5, 7, 10] },
  { id: 'hirajoshi', name: 'Hirajoshi', group: 'Japan', steps: [0, 2, 3, 7, 8] },
  { id: 'iwato', name: 'Iwato', group: 'Japan', steps: [0, 1, 5, 6, 10] },
  { id: 'kumoi', name: 'Kumoi', group: 'Japan', steps: [0, 2, 3, 7, 9] },
  { id: 'gong', name: 'Gong', group: 'China', steps: [0, 2, 4, 7, 9] },
  { id: 'shang', name: 'Shang', group: 'China', steps: [0, 2, 5, 7, 10] },
  { id: 'jue', name: 'Jue', group: 'China', steps: [0, 3, 5, 8, 10] },
  { id: 'zhi', name: 'Zhi', group: 'China', steps: [0, 2, 5, 7, 9] },
  { id: 'yu', name: 'Yu', group: 'China', steps: [0, 3, 5, 7, 10] },
  { id: 'pelog', name: 'Pelog', group: 'More', steps: [0, 1, 3, 7, 8] },
  { id: 'slendro', name: 'Slendro', group: 'More', steps: [0, 2, 5, 7, 9] },
  { id: 'hijaz', name: 'Hijaz', group: 'More', steps: [0, 1, 4, 5, 7, 8, 11] },
  { id: 'whole', name: 'Whole tone', group: 'More', steps: [0, 2, 4, 6, 8, 10] },
  { id: 'hungarian', name: 'Hungarian', group: 'More', steps: [0, 2, 3, 6, 7, 8, 11] },
  { id: 'lydian', name: 'Lydian', group: 'Scales', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'locrian', name: 'Locrian', group: 'Scales', steps: [0, 1, 3, 5, 6, 8, 10] },
  { id: 'melodic', name: 'Melodic minor', group: 'Scales', steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'prometheus', name: 'Prometheus', group: 'More', steps: [0, 2, 4, 6, 9, 10] },
  { id: 'enigmatic', name: 'Enigmatic', group: 'More', steps: [0, 1, 4, 6, 8, 10, 11] },
]

export const TUNINGS = [
  { id: 'equal', name: 'Equal' },
  { id: 'just', name: 'Just' },
  { id: 'pyth', name: 'Pythagorean' },
  { id: 'meantone', name: 'Meantone' },
  { id: 'werck', name: 'Werckmeister' },
]

export function clampKeyFrom(from, whites) {
  const count = Math.max(7, Math.min(21, whites | 0 || PIANO_WHITES))
  const start = Math.max(0, Math.min(WHITE_COUNT - count, from | 0))
  return { from: start, whites: count }
}

/** Drag the 88-key window. `hit` is the white index under the pointer when jumping. */
export function slideKeys(from, whites, mode, delta, hit) {
  const cur = clampKeyFrom(from, whites)
  if (mode === 'jump') {
    const at = Math.max(0, Math.min(WHITE_COUNT - 1, hit | 0))
    return clampKeyFrom(at - Math.floor(cur.whites / 2), cur.whites)
  }
  if (mode === 'move') return clampKeyFrom(cur.from + (delta | 0), cur.whites)
  if (mode === 'end') return clampKeyFrom(cur.from, cur.whites + (delta | 0))
  let start = cur.from + (delta | 0)
  let count = cur.whites - (delta | 0)
  if (count < 7) {
    start = cur.from + cur.whites - 7
    count = 7
  }
  if (count > 21) {
    start = cur.from + cur.whites - 21
    count = 21
  }
  if (start < 0) {
    count += start
    start = 0
  }
  return clampKeyFrom(start, count)
}

export function visibleKeys(from, whites) {
  const cur = clampKeyFrom(from, whites)
  const shown = WHITES.slice(cur.from, cur.from + cur.whites)
  const start = shown[0]
  const end = shown[shown.length - 1]
  const keys = []
  for (let n = start; n <= end; n++) keys.push(n)
  return { ...cur, start, end, shown, keys }
}

export function blackAnchor(midi, from) {
  let before = 0
  const start = WHITES[from] ?? KEY_LO
  for (let n = start; n < midi; n++) if (isWhite(n)) before += 1
  return before
}

function rootMidi(rootPc, octave = 4) {
  return 12 * (octave + 1) + (((rootPc % 12) + 12) % 12)
}

export function buildChord(rootPc, chordId, inversion, octave = 4) {
  const chord = CHORDS.find((item) => item.id === chordId)
  if (!chord) return []
  const notes = chord.steps.map((step) => rootMidi(rootPc, octave) + step)
  let inv = inversion | 0
  while (inv > 0) {
    notes.push(notes.shift() + 12)
    inv -= 1
  }
  while (inv < 0) {
    notes.unshift(notes.pop() - 12)
    inv += 1
  }
  return notes
}

export function scaleNotes(rootPc, scaleId, octave = 4) {
  const scale = SCALES.find((item) => item.id === scaleId)
  if (!scale) return []
  const root = rootMidi(rootPc, octave)
  return scale.steps.map((step) => root + step)
}

export function harpNotes(notes, stripes = 12) {
  if (!notes.length) return []
  const out = []
  for (let span = 0; span < 6 && out.length < stripes; span++) {
    for (const note of notes) {
      const next = note + span * 12
      if (next > 127) return out
      out.push(next)
      if (out.length >= stripes) return out
    }
  }
  return out
}

/** Strum tones. A latched chord wins. A scale is next. Otherwise the twelve notes from the root. */
export function strumSet({ root = 0, chord = '', scale = '', inversion = 0 } = {}) {
  if (chord) return harpNotes(buildChord(root, chord, inversion), 12)
  if (scale) return harpNotes(scaleNotes(root, scale), 12)
  const base = rootMidi(root, 4)
  return Array.from({ length: 12 }, (_, i) => base + i)
}

/** Semitone offset from C4, plus the tuning's cents. Just and Pythagorean follow the root. The others are fixed to the pitch class. */
export function tunedPitch(midi, rootPc, tuning) {
  const pc = ((midi % 12) + 12) % 12
  let cents = 0
  if (tuning === 'just' || tuning === 'pyth') {
    const degree = (pc - (rootPc | 0) + 12) % 12
    cents = RELATIVE[tuning][degree] || 0
  } else if (tuning === 'meantone') cents = MEANTONE[pc] || 0
  else if (tuning === 'werck') cents = WERCK[pc] || 0
  return (midi - 60) + cents / 100
}

/** Lead-strip scale that belongs to a chord button. Semitone offsets from the root. */
const PAIRED = {
  maj: [0, 2, 4, 5, 7, 9, 11],
  min: [0, 2, 3, 5, 7, 8, 10],
  7: [0, 2, 4, 5, 7, 9, 10],
  m7: [0, 2, 3, 5, 7, 9, 10],
  sus4: [0, 2, 4, 5, 7, 9, 10],
  sus2: [0, 2, 4, 5, 7, 9, 11],
  maj7: [0, 2, 4, 6, 7, 9, 11],
  6: [0, 2, 4, 5, 7, 9, 11],
  9: [0, 2, 4, 5, 7, 9, 10],
  add9: [0, 2, 4, 5, 7, 9, 11],
  dim: [0, 1, 3, 5, 6, 8, 10],
  aug: [0, 2, 4, 6, 8, 10],
  m7b5: [0, 1, 3, 5, 6, 8, 10],
  dim7: [0, 2, 3, 5, 6, 8, 9, 11],
  madd9: [0, 2, 3, 5, 7, 8, 10],
}

/** One page of the chord grid. Buttons set the harmony. They do not play. */
export const CHORD_BANKS = [
  {
    id: 'chords',
    name: 'A',
    label: 'Chord types',
    items: ['maj', 'min', '7', 'm7', 'sus4', 'maj7', '6', '9', 'add9', 'dim', 'aug', 'm7b5', 'sus2', 'dim7', 'madd9']
      .map((id) => ({ id, kind: 'chord' })),
  },
  {
    id: 'modes',
    name: 'B',
    label: 'Modes',
    items: ['major', 'minor', 'dorian', 'phryg', 'lydian', 'mixo', 'locrian', 'harm', 'melodic', 'penta', 'mpenta', 'blues', 'whole', 'hungarian', 'hijaz']
      .map((id) => ({ id, kind: 'scale' })),
  },
  {
    id: 'far',
    name: 'C',
    label: 'Other scales',
    items: ['yo', 'in', 'insen', 'hirajoshi', 'iwato', 'kumoi', 'gong', 'shang', 'jue', 'zhi', 'yu', 'pelog', 'slendro', 'prometheus', 'enigmatic']
      .map((id) => ({ id, kind: 'scale' })),
  },
]

export function bankItemName(item) {
  if (!item) return ''
  if (item.kind === 'chord') return CHORDS.find((chord) => chord.id === item.id)?.name || item.id
  return SCALES.find((scale) => scale.id === item.id)?.name || item.id
}

export function clampBend(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 24
  return Math.max(1, Math.min(24, Math.round(n)))
}

/** Lead strip, in octaves relative to the root. Default is −1 through +3. */
export function clampLead(lo, hi) {
  let low = Number(lo)
  let high = Number(hi)
  if (!Number.isFinite(low)) low = -1
  if (!Number.isFinite(high)) high = 3
  low = Math.max(-3, Math.min(2, Math.round(low)))
  high = Math.max(low + 1, Math.min(6, Math.round(high)))
  return { lo: low, hi: high }
}

export function clampBank(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(CHORD_BANKS.length - 1, n | 0))
}

export const TOUCH_AXES = [
  { id: 'velocity', name: 'Velocity' },
  { id: 'filter', name: 'Filter' },
  { id: 'pan', name: 'Pan' },
]

export function clampAxis(value) {
  return TOUCH_AXES.some((item) => item.id === value) ? value : 'velocity'
}

/** Higher on a key is quieter. Filter and pan keep a plain velocity. */
export function fingerVelocity(y, axis = 'velocity') {
  if (axis !== 'velocity') return 128 / 255
  const t = Math.max(0, Math.min(1, Number(y) || 0))
  return 0.12 + t * 0.88
}

function leadSteps(chordId, scaleId) {
  if (scaleId) {
    const scale = SCALES.find((item) => item.id === scaleId)
    return scale ? scale.steps : null
  }
  if (chordId && PAIRED[chordId]) return PAIRED[chordId]
  return null
}

/**
 * Notes on the lead strip.
 * 0% is `lo` octaves from the root (default −1). 25% is the root when the span is −1 to +3.
 * 50%, 75%, and 100% are the next three octaves. No chord and no scale is chromatic.
 */
export function leadNotes({ root = 0, chordId = '', scaleId = '', lo = -1, hi = 3 } = {}) {
  const span = clampLead(lo, hi)
  const rootNote = rootMidi(root, 4)
  const start = rootNote + span.lo * 12
  const end = rootNote + span.hi * 12
  const steps = leadSteps(chordId, scaleId)
  const out = []
  for (let midi = start; midi <= end; midi++) {
    if (midi < 0 || midi > 127) continue
    if (!steps) {
      out.push(midi)
      continue
    }
    const pc = ((midi - rootNote) % 12 + 12) % 12
    if (steps.includes(pc)) out.push(midi)
  }
  return out
}

/** Triad stacked from scale degrees 1, 3, and 5. */
export function scaleChord(rootPc, scaleId, octave = 4) {
  const scale = SCALES.find((item) => item.id === scaleId)
  if (!scale || !scale.steps.length) return [rootMidi(rootPc, octave)]
  const steps = scale.steps
  return [0, 2, 4].map((degree) => {
    const extra = Math.floor(degree / steps.length) * 12
    return rootMidi(rootPc, octave) + steps[degree % steps.length] + extra
  })
}

/**
 * What a root-piano key sounds. The keys are chords, not single notes.
 * A chord button plays that chord. A scale stacks degrees 1, 3, and 5.
 * Nothing chosen is a major triad. The lead strip is where a single note is played.
 */
export function harmonyAt(midi, { chord = '', scale = '', inversion = 0 } = {}) {
  const note = midi | 0
  const pc = ((note % 12) + 12) % 12
  const octave = Math.floor(note / 12) - 1
  if (chord) return buildChord(pc, chord, inversion, octave)
  if (scale) return scaleChord(pc, scale, octave)
  return buildChord(pc, 'maj', inversion, octave)
}

/** Chromatic root piano. The key you touch is the root. */
export const ROOT_LO = 48
/** Two octaves, C3 through C5. A wide window and a large tablet. */
export const ROOT_HI = 72
/** One octave, C3 through C4. A phone. */
export const ROOT_PHONE_HI = 60

export function rootBoard(octaves = 2) {
  const hi = octaves <= 1 ? ROOT_PHONE_HI : ROOT_HI
  const keys = []
  for (let n = ROOT_LO; n <= hi; n++) keys.push(n)
  return { keys, shown: keys.filter(isWhite) }
}

export function rootBlackLeft(midi, shown) {
  let before = 0
  const start = shown[0] ?? ROOT_LO
  for (let n = start; n < midi; n++) if (isWhite(n)) before += 1
  return before
}
