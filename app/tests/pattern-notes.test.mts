import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as music from '../src/pages/MusicMaker/model.js'

// model.js is JSDoc-typed for the app's own calls; the test pokes at its state directly.
const { currentPattern, noteRuns } = music
const model = music.model as any
const commitTrackerNote = music.commitTrackerNote as (note: Record<string, unknown>) => void
const ensurePattern = music.ensurePattern as (index: number) => any

test('a recorded chord keeps every note, and the sequence lists each one', () => {
  const prev = model.pattern
  const prevEdit = model.tracker.edit
  const prevRow = model.tracker.row
  const prevCol = model.tracker.col
  const prevPlay = model.playing
  model.pattern = 7
  model.patterns[7] = null
  model.tracker.edit = true
  model.tracker.row = 0
  model.tracker.col = 0
  model.playing = false
  const seq = ensurePattern(7)
  commitTrackerNote({ pad: 0, vel: 0.8, pitch: -12, row: 0, live: false })
  commitTrackerNote({ pad: 0, vel: 0.8, pitch: -8, row: 0, live: false })
  commitTrackerNote({ pad: 0, vel: 0.8, pitch: -5, row: 0, live: false })
  const lanes = seq.steps[0].filter((ev: any) => ev && ev.pad === 0).map((ev: any) => ev.pitch)
  assert.deepEqual(lanes, [-12, -8, -5])
  assert.deepEqual(noteRuns(seq.steps, 0).map((run) => run.pitch), [-12, -8, -5])

  model.tracker.edit = false
  const before = JSON.stringify(seq.steps[2])
  commitTrackerNote({ pad: 0, vel: 0.8, pitch: 7, row: 2, live: false })
  assert.equal(JSON.stringify(seq.steps[2]), before)

  const lane = (events) => {
    const cell = Array.from({ length: 16 }, () => null)
    events.forEach((ev, i) => { cell[i] = ev })
    return cell
  }
  const held = [
    lane([{ pad: 0, pitch: 0, vel: 1, nudge: 0 }]),
    lane([{ pad: 0, pitch: 0, vel: 1, nudge: 0 }]),
  ]
  assert.equal(noteRuns(held, 0).length, 1)
  const chops = [
    lane([{ pad: 0, pitch: 0, vel: 1, nudge: 0, tail: 50, cut: true }]),
    lane([{ pad: 0, pitch: 0, vel: 1, nudge: -50, tail: 50, cut: true }]),
  ]
  assert.deepEqual(noteRuns(chops, 0).map((run) => [run.start, run.end, run.lane]), [[0, 0, 0], [1, 1, 0]])
  const pair = [
    lane([
      { pad: 0, pitch: 3, vel: 1, nudge: 0, tail: 25, cut: true },
      { pad: 0, pitch: 3, vel: 1, nudge: 25, tail: 25, cut: true },
    ]),
  ]
  assert.equal(noteRuns(pair, 0).length, 2)

  model.patterns[7] = null
  model.pattern = prev
  model.tracker.edit = prevEdit
  model.tracker.row = prevRow
  model.tracker.col = prevCol
  model.playing = prevPlay
  currentPattern()
})
