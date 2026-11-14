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
