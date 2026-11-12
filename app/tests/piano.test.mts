import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CHORD_BANKS,
  CHORDS,
  SCALES,
  WHITE_COUNT,
  WHITES,
  bankItemName,
  buildChord,
  clampBend,
  clampLead,
  harmonyAt,
  harpNotes,
  leadNotes,
  rootBoard,
  scaleNotes,
  slideKeys,
  strumSet,
  tunedPitch,
  visibleKeys,
} from '../src/pages/MusicMaker/audio/piano.js'

test('the piano window is 88 keys and slides without leaving the instrument', () => {
  assert.equal(WHITE_COUNT, 52)
  assert.equal(WHITES[0], 21)
  assert.equal(WHITES[16], 48)
  assert.equal(WHITES[WHITES.length - 1], 108)
  const home = visibleKeys(16, 15)
  assert.equal(home.start, 48)
  assert.equal(home.end, 72)
  assert.equal(home.shown.length, 15)
  const moved = slideKeys(16, 15, 'move', 4, 0)
  assert.equal(moved.from, 20)
  assert.equal(moved.whites, 15)
  const edge = slideKeys(16, 15, 'end', 3, 0)
  assert.equal(edge.from, 16)
  assert.equal(edge.whites, 18)
  const capped = slideKeys(40, 15, 'move', 20, 0)
  assert.equal(capped.from + capped.whites, 52)
  const shrunk = slideKeys(10, 15, 'start', 4, 0)
  assert.equal(shrunk.from, 14)
  assert.equal(shrunk.whites, 11)
})

test('chords invert, scales strum, and just intonation pulls the major third down', () => {
  assert.deepEqual(buildChord(0, 'maj', 0), [60, 64, 67])
  assert.deepEqual(buildChord(0, 'maj', 1), [64, 67, 72])
  assert.deepEqual(buildChord(0, 'maj', -1), [55, 60, 64])
  assert.deepEqual(scaleNotes(0, 'hirajoshi'), [60, 62, 63, 67, 68])
  assert.deepEqual(scaleNotes(2, 'insen'), [62, 63, 67, 69, 72])
  const harp = harpNotes([60, 64, 67], 6)
  assert.deepEqual(harp, [60, 64, 67, 72, 76, 79])
  assert.equal(strumSet({ root: 0 }).length, 12)
  assert.equal(strumSet({ root: 0, chord: 'maj' })[0], 60)
  assert.equal(strumSet({ root: 0, scale: 'yo' })[0], 60)
  const third = tunedPitch(64, 0, 'just')
  const pure = 4 + (1200 * Math.log2(5 / 4) - 400) / 100
  assert.ok(Math.abs(third - pure) < 1e-9)
  assert.equal(tunedPitch(60, 0, 'equal'), 0)
  assert.ok(tunedPitch(67, 0, 'meantone') < 7)
})

test('the lead strip is four octaves and the root piano plays the latched harmony', () => {
  const chrom = leadNotes({ root: 0, lo: -1, hi: 3 })
  assert.equal(chrom[0], 48)
  assert.equal(chrom[chrom.length - 1], 96)
  assert.equal(chrom.length, 49)
  const major = leadNotes({ root: 0, chordId: 'maj', lo: -1, hi: 3 })
  assert.equal(major.length, 29)
  assert.ok(major.every((note) => [0, 2, 4, 5, 7, 9, 11].includes(note % 12)))
  const dMajor = leadNotes({ root: 2, chordId: 'maj', lo: -1, hi: 3 })
  assert.equal(dMajor[0], 50)
  assert.ok(dMajor.includes(62))
  assert.ok(dMajor.every((note) => [2, 4, 6, 7, 9, 11, 1].includes(note % 12)))
  assert.notDeepEqual(dMajor, major)
  const dMinor = leadNotes({ root: 2, chordId: 'min', lo: -1, hi: 3 })
  assert.notDeepEqual(dMinor, dMajor)
  const yo = leadNotes({ root: 0, scaleId: 'yo', lo: -1, hi: 3 })
  assert.equal(yo.length, 21)
  assert.deepEqual(harmonyAt(60, { chord: 'maj' }), [60, 64, 67])
  assert.deepEqual(harmonyAt(62, { chord: 'maj' }), [62, 66, 69])
  assert.deepEqual(harmonyAt(60, { scale: 'major' }), [60, 64, 67])
  assert.deepEqual(harmonyAt(64, {}), [64, 68, 71])
  assert.equal(CHORD_BANKS.length, 3)
  for (const bank of CHORD_BANKS) {
    assert.equal(bank.items.length, 15)
    for (const item of bank.items) {
      if (item.kind === 'chord') assert.ok(CHORDS.some((chord) => chord.id === item.id))
      else assert.ok(SCALES.some((scale) => scale.id === item.id))
      assert.ok(bankItemName(item))
    }
  }
  assert.equal(clampBend(99), 24)
  assert.equal(clampBend(0), 1)
  assert.deepEqual(clampLead(-1, 3), { lo: -1, hi: 3 })
  assert.equal(clampLead(2, 2).hi, 3)
})

test('the root piano is one octave on a phone and two on a wider window', () => {
  const phone = rootBoard(1)
  const wide = rootBoard(2)
  assert.equal(phone.keys[0], 48)
  assert.equal(phone.keys[phone.keys.length - 1], 60)
  assert.equal(phone.shown.length, 8)
  assert.equal(wide.keys[0], 48)
  assert.equal(wide.keys[wide.keys.length - 1], 72)
  assert.equal(wide.shown.length, 15)
  assert.equal(rootBoard().keys.length, wide.keys.length)
})
