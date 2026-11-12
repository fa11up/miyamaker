// src/pages/MusicMaker: playback holds pattern tempos and automated levels on the song while it plays, and the
// song's own values come back on Stop and in every capture. A song load, kit load or undo replaces those values,
// so what playback kept from the song before is dropped, never written onto the new one. A hand edit while
// automation plays is the song's. Captures (save, undo, kit, copy, bounce) read the song's own values.
// Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { ensurePattern, loadFactoryKit, model as musicModel, touch } from '../src/pages/MusicMaker/model.js'
import { armHistory, undo } from '../src/pages/MusicMaker/history.js'
import { captureKit, loadSong } from '../src/pages/MusicMaker/audio/song.js'
import { playWrite, resetPlayValues, restorePlayValues, songValue, withSongValues } from '../src/pages/MusicMaker/audio/arrange.js'
import { stopTransport } from '../src/pages/MusicMaker/audio/engine.js'

// The sampler's state is plain JS; the tests poke at it freely, so it is typed loosely here.
const model = musicModel as unknown as { pads: any[]; buses: any[]; patterns: any[]; [key: string]: any }
const g = globalThis as any

const source = (path: string) => readFileSync(new URL(`../src/pages/MusicMaker/${path}`, import.meta.url), 'utf8')

/** The body of a top-level function in a source file, up to the next top-level declaration. */
function body(text: string, head: string): string {
  const at = text.indexOf(head)
  assert.ok(at >= 0, `${head} is still there`)
  const rest = text.slice(at + head.length)
  const end = rest.search(/\n(export |function |async function |const |let |\/\*\*)/)
  return end < 0 ? rest : rest.slice(0, end)
}

/** A fresh session, stopped, with nothing kept from an earlier test. */
function fresh() {
  model.playing = false
  resetPlayValues(model)
  loadFactoryKit()
}

/** A song with no kit, so the load touches no storage. */
function songDoc(name: string, bpm: number, patternBpm?: number) {
  const pattern: any = { i: 0, name, bars: 1, steps: [] }
  if (patternBpm != null) pattern.bpm = patternBpm
  return { type: 'm1ya', v: 2, name, bpm, order: [0], patterns: [pattern] }
}

test('a song loaded while another plays does not take the old song\'s tempo on Stop', async () => {
  fresh()
  armHistory()
  model.bpm = 120
  model.playing = true
  playWrite(model, 'bpm', 140) // A's pattern tempo, held while A plays
  assert.equal(await loadSong(songDoc('B', 140)), true)
  assert.equal(songValue(model, 'bpm'), 140, 'B\'s tempo is the song\'s, not A\'s 120')
  assert.equal(withSongValues(model, () => model.bpm), 140, 'a save while B plays keeps B\'s tempo')
  restorePlayValues(model)
  assert.equal(model.bpm, 140, 'Stop leaves B at its own tempo')

  // B\'s first pattern has its own tempo: playback takes it up, and Stop returns B\'s song tempo.
  model.playing = true
  playWrite(model, 'bpm', 90)
  assert.equal(await loadSong(songDoc('C', 100, 150)), true)
  assert.equal(model.bpm, 150, 'the playing pattern keeps its own tempo')
  assert.equal(songValue(model, 'bpm'), 100)
  restorePlayValues(model)
  assert.equal(model.bpm, 100)
  model.playing = false
})

test('undo while playing drops what playback kept; the playing pattern keeps its tempo', async () => {
  fresh()
  model.bpm = 140
  const first: any = ensurePattern(0)
  first.bpm = 140
  armHistory()
  model.bpm = 100 // a hand edit, one undo step
  touch(true)
  model.playing = true
  playWrite(model, 'bpm', 140) // the pattern tempo, held while playing
  assert.equal(await undo(), true)
  assert.equal(songValue(model, 'bpm'), 140, 'undo returned the song to 140')
  restorePlayValues(model)
  assert.equal(model.bpm, 140, 'Stop does not put back the 100 that was undone')

  // The undone song tempo differs from the pattern's: the clock keeps the pattern's, and so does the display.
  fresh()
  model.bpm = 120
  const second: any = ensurePattern(0)
  second.bpm = 140
  armHistory()
  model.swing = 0.2
  touch(true)
  model.playing = true
  playWrite(model, 'bpm', 140)
  assert.equal(await undo(), true)
  assert.equal(model.bpm, 140, 'the playing pattern\'s tempo, as the clock plays it')
  assert.equal(songValue(model, 'bpm'), 120)
  restorePlayValues(model)
  assert.equal(model.bpm, 120)
  model.playing = false
})

test('a pad that a kit load, paste or undo replaced does not get the old pad\'s level back', () => {
  const song: any = { bpm: 120, pads: [{ volume: 0.8 }, { volume: 0.5 }] }
  resetPlayValues(song)
  playWrite(song, 'pad:0:volume', 0.5)
  song.pads = [{ volume: 0.5 }, { volume: 0.2 }] // the new pad 0 happens to sit at playback's value
  assert.equal(songValue(song, 'pad:0:volume'), 0.5)
  restorePlayValues(song)
  assert.equal(song.pads[0].volume, 0.5)
})

test('a hand edit while automation plays is the song\'s value on Stop', () => {
  const song: any = { bpm: 120, pads: [{ volume: 0.8 }] }
  resetPlayValues(song)
  playWrite(song, 'pad:0:volume', 0.5)
  song.pads[0].volume = 0.3 // the user moves the pad level
  playWrite(song, 'pad:0:volume', 0.5) // the next step's automation
  assert.equal(song.pads[0].volume, 0.5, 'playback still hears the lane')
  assert.equal(songValue(song, 'pad:0:volume'), 0.3)
  assert.equal(withSongValues(song, () => song.pads[0].volume), 0.3, 'a save keeps the hand edit')
  restorePlayValues(song)
  assert.equal(song.pads[0].volume, 0.3)
})

test('a kit saved or published while automation plays keeps the pads\' own levels', async () => {
  fresh()
  const own = model.pads[0].volume
  const ownCutoff = model.pads[0].filter.cutoff
  model.playing = true
  playWrite(model, 'pad:0:volume', 0.1)
  playWrite(model, 'pad:0:cutoff', 300)
  const doc: any = await captureKit('Kit')
  assert.equal(doc.pads[0].volume, own)
  assert.equal(doc.pads[0].filter.cutoff, ownCutoff)
  assert.equal(model.pads[0].volume, 0.1, 'playback values return after the capture')
  restorePlayValues(model)
  model.playing = false
  assert.equal(model.pads[0].volume, own)
  // Copy pad takes the same care (padEdit imports the engine's browser parts, so this one is read from source).
  assert.match(body(source('padEdit.js'), 'export async function copyPad('), /withSongValues\(model, \(\) => clonePad\(/)
})

test('Stop puts the song\'s own values back', () => {
  fresh()
  const was = g.window
  g.window = { clearInterval() {}, clearTimeout() {}, setTimeout, setInterval }
  try {
    model.bpm = 120
    model.playing = true
    playWrite(model, 'bpm', 150)
    playWrite(model, 'pad:0:volume', 0.05)
    stopTransport()
    assert.equal(model.bpm, 120)
    assert.notEqual(model.pads[0].volume, 0.05)
  } finally {
    g.window = was
  }
  const engine = source('audio/engine.js')
  // Play-once ending and the other halts go through haltClock: it must restore too.
  assert.match(body(engine, 'function haltClock() {'), /restoreSongValues\(\)/)
  assert.match(body(engine, 'function restoreSongValues() {'), /restorePlayValues\(model\)/)
  assert.match(body(engine, 'export function stopTransport() {'), /restoreSongValues\(\)/)
  assert.match(body(engine, 'export async function renderBounce() {'), /withSongValues\(model, /)
})

test('the pitch wheel retunes only its own notes in the pattern they were written to, as an undo step', () => {
  const engine = source('audio/engine.js')
  const bend = body(engine, 'export function setPerformBend(')
  assert.match(bend, /take\.pattern !== /, 'a take in another pattern is skipped')
  assert.match(bend, /ev\.pad !== take\.pad/, 'a cell now holding another pad is skipped')
  assert.match(bend, /patchTrackerEvent\(/, 'the write goes through the tracker\'s undo batch')
  assert.doesNotMatch(bend, /ev\.pitch = /)
  assert.match(source('model.js'), /return \{ row: writeRow, lane, pattern: model\.pattern \|\| 0, pad: ev\.pad \}/)
})

test('focus loss releases the on-screen piano and chord notes too', () => {
  const release = body(source('audio/engine.js'), 'export function releaseKeyboardNotes() {')
  for (const prefix of ['key:', 'touch:', 'piano:']) assert.ok(release.includes(`'${prefix}'`), `${prefix} notes are released`)
})
