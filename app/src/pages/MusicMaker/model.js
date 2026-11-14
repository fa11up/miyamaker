import { formatLp, formatSl } from './audio/grain.js'
import { PAD_KEYS } from './keys.js'
import { FACTORY, KIT_LAYOUT } from './audio/presets.js'
import { defaultNumpadFx, normalizeFxPresets, normalizeNumpadFx } from './audio/numpadFx.js'
import { CHORDS, PIANO_FROM, PIANO_WHITES, SCALES, TUNINGS, clampAxis, clampBank, clampBend, clampLead } from './audio/piano.js'
import { autoTarget, normalizeAuto, normalizeLaunch, withSongValues } from './audio/arrange.js'
import { snapOctave } from './audio/knee.js'
import { defaultEq, normalizeEq } from './audio/eq.js'
import { clampCrossovers, defaultBand, defaultCrossovers, normalizeBands } from './audio/multiband.js'
import { defaultPatch, MAX_PARTIALS, MAX_UNISON, renderSynth, safeEntries, SYNTH_SR } from './audio/synth.js'
import { SongChanged, bumpSong, exclusive, sameSong, songId } from './jobs.js'

export const BANKS = ['A', 'B', 'C', 'D']
export const BUS_COUNT = 16
export const MAX_PADS = 64
export const FX_TYPES = ['none', 'filter', 'drive', 'delay', 'reverb', 'chorus', 'crush', 'comp']
/** Tracker columns and pattern lanes. Storage can grow; the page starts at the default. */
export const MAX_LANES = 256
export const DEFAULT_LANES = 16
export const LANES = DEFAULT_LANES
export const MAX_POLYPHONY = 256
export const MAX_STEPS = 256
export const TRACK_FIELDS = 4
export const TRACK_VEL = 128 / 255

/** NOTE INST VEL MOVE, plus SL and LP when the grain columns are open. */
export function trackerFields() {
  return TRACK_FIELDS + (model.tracker.grains ? 2 : 0)
}

export { formatLp, formatSl }

const SAVE_KEY = 'miya-music-maker-v1'
export const BACKUP_KEY = 'miya-music-maker-v1-backup'
/** Later unreadable saves go to `${BACKUP_KEY}-<time>`, newest few only. The first backup is never replaced. */
export const BACKUP_EXTRA = 3

export const audioBank = new Map()

let version = 0
const listeners = new Set()
let saveTimer = 0

export const model = {
  screen: 'pads',
  bank: 0,
  selected: 0,
  selection: [],
  hold: null,
  keyboard: false,
  /** Off hides the on-screen pads and keys on a narrow window. The hardware map stays. */
  playSurface: 'pads',
  keyMap: 'koala',
  octave: 4,
  renoiseOct: 3,
  playing: false,
  recording: false,
  metro: false,
  metroVol: 0.55,
  bpm: 96,
  swing: 0,
  pattern: 0,
  patterns: [],
  recNatural: false,
  /** Sequencer drags land on the grid. Off lets the note sit between steps, stored as MOVE. */
  seqSnap: true,
  /** Straight snap division: 4, 8, 16, 32, 64, or 128. A bar is 16 steps, so 16 is one step. */
  seqDiv: 16,
  seqHit: null,
  playhead: 0,
  pads: [],
  buses: [],
  master: 0.9,
  settings: { autoTrim: true, autoNorm: true, midiOffset: 36, velocity: true },
  browser: false,
  dockOpen: true,
  arrangeOpen: false,
  /** Share of the dock column given to the browser when the arranger is open too. */
  dockSplit: 0.5,
  /** Right-hand numpad column. Wide windows only. Not a phone page. */
  fxOpen: false,
  fxWidth: 280,
  /** Share of that column given to the numpad when the editor sits under it. */
  fxSplit: 0.55,
  /** Bytes per second while − or + bends the slots held with Shift. */
  porta: 72,
  /** Runtime. True when the music window's content box is wider than a phone. Not saved. */
  fxWide: false,
  /** Runtime. A phone, including landscape. The chord piano is one octave. Not saved. */
  chordHand: true,
  /** First white key of the on-screen piano, counted from A0, and how many whites show. */
  pianoFrom: PIANO_FROM,
  pianoWhites: PIANO_WHITES,
  pianoRoot: 0,
  pianoChord: '',
  pianoInv: 0,
  pianoScale: '',
  pianoTuning: 'equal',
  /** Pitch-wheel range in semitones. 24 is two octaves. */
  pianoBend: 24,
  /** Lead strip, in octaves relative to the root. */
  pianoLeadLo: -1,
  pianoLeadHi: 3,
  /** What the vertical position of a tap changes. */
  pianoAxis: 'velocity',
  /** Which page of the 15 harmony buttons is showing. */
  pianoBank: 0,
  /** Height of the on-screen Keys, Chords, or Strum palette. */
  pianoHeight: 240,
  help: false,
  about: false,
  tracker: { row: 0, col: 0, pair: 0, focus: false, hex: '', sign: 1, edit: false, step: 1, follow: true, grains: false, zoom: 1 },
  library: null,
  wallet: '',
  fileWindow: '',
  /** Which ? card is open. Empty means none. Not saved with the song. */
  coachTopic: '',
  keysHelp: false,
  dirTick: 0,
  sessionFiles: [],
  nftPacks: [],
  nftLocked: [],
  numpadFx: defaultNumpadFx(),
  fxPresets: [],
  fxHeld: -1,
  /** Digits held, oldest first. That order is the master FX chain. */
  fxStack: [],
  fxEdit: 0,
  browserNote: '',
  waveView: 2,
  mixPage: 0,
  compFocus: false,
  comp: defaultComp(),
  songOrder: null,
  songCursor: 0,
  /** wrap plays the order and repeats it. section repeats one cell. once plays through and stops. */
  songLoop: 'wrap',
  /** end waits until the part finishes. now takes a tap on the next step. grid keeps the step. */
  songLaunch: 'end',
  /** Cell queued by a tap, or null. */
  launchCursor: null,
  songName: '',
  songFile: '',
  songPlay: false,
  sliceView: null,
  k3: false,
  saveError: '',
  /** Why the saved session did not open (shown with Restore backup), or ''. */
  bootNotice: '',
  /** The name of the kit last loaded, for Save kit. */
  kitName: '',
}

/** Set or clear the "not saved" line. Only redraws when it changes. */
export function setSaveError(message) {
  const next = message || ''
  if (model.saveError === next) return
  model.saveError = next
  touch(false)
}
