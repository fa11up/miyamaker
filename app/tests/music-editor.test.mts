// src/pages/MusicMaker: the sample editor's pure parts. The voice cap fades the oldest notes, playheads land where
// the sample is, a chop copies the trimmed span onto the next empty pad, and a handle drag always ends (lift or a
// cancelled touch) and never reacts to another finger.
// Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { playFraction, voicesToFade } from '../src/pages/MusicMaker/audio/voices.js'
import { chopRange, nextEmptyPad } from '../src/pages/MusicMaker/audio/slice.js'
import { startHandleDrag } from '../src/pages/MusicMaker/dragSession.js'

test('the voice cap fades just enough of the oldest sounding notes for one more', () => {
  const voices: any[] = Array.from({ length: 30 }, (_, i) => ({ id: i, startAt: 100 - i }))
  voices[29].dead = true // already ending: not counted, not picked
  voices[28].ended = true
  // 28 still sounding at a cap of 28: one must fade so the new note fits (28 - 28 + 1).
  const fade = voicesToFade(voices, 28)
  assert.equal(fade.length, 1)
  assert.equal(fade[0].id, 27, 'the oldest still sounding')
  assert.deepEqual(voicesToFade(voices.slice(0, 10), 28), [], 'under the cap nothing fades')
  const over = voicesToFade(voices.slice(0, 28).concat(voices.slice(0, 3).map((v) => ({ ...v, id: 100 + v.id }))), 28)
  assert.equal(over.length, 4)
})

test('a playhead follows a one-shot, wraps a loop, and flips for a reversed pad', () => {
  const play = { dur: 2, offset: 0.5, end: 1.5, loopAt: 1, mode: 'oneshot', reverse: false }
  assert.equal(playFraction(play, 10, 1, 10), 0.25)
  assert.equal(playFraction(play, 10, 1, 10.5), 0.5)
  assert.equal(playFraction(play, 10, 1, 20), 0.75, 'a one-shot stops at its end')
  assert.equal(playFraction({ ...play, mode: 'loop' }, 10, 1, 11.25), 0.375, 'a loop wraps back to its start')
  assert.equal(playFraction({ ...play, mode: 'held' }, 10, 1, 11.25), 0.625, 'a held note loops from loopAt')
  assert.equal(playFraction({ ...play, reverse: true }, 10, 1, 10), 0.75)
  assert.equal(playFraction(play, 10, 2, 10.25), 0.5, 'pitch (rate) speeds the head')
  assert.equal(playFraction(play, 10, 1, 9), 0.25, 'before its start it sits at the offset')
})

test('a chop takes the trimmed span, at least one sample, inside the sample', () => {
  assert.deepEqual(chopRange(1000, 0.25, 0.5), [250, 500])
  assert.deepEqual(chopRange(1000, 0.5, 0.5), [500, 501], 'an empty trim still copies one sample')
  assert.deepEqual(chopRange(1000, 1, 1), [999, 1000])
  assert.deepEqual(chopRange(1000, -1, 7), [0, 1000])
  assert.deepEqual(chopRange(1000, NaN, undefined), [0, 1000])
})

test('the chop goes to the next empty pad, wrapping, never onto its own pad', () => {
  const pads: any[] = Array.from({ length: 64 }, () => ({ source: 'sample' }))
  assert.equal(nextEmptyPad(pads, 5), -1)
  pads[3].source = 'empty'
  assert.equal(nextEmptyPad(pads, 5), 3, 'wraps past 63')
  pads[9].source = 'empty'
  assert.equal(nextEmptyPad(pads, 5), 9)
  pads[5].source = 'empty'
  assert.equal(nextEmptyPad(pads, 5), 9, 'skips itself')
})

function pointer(type: string, pointerId: number, clientX: number) {
  return Object.assign(new Event(type), { pointerId, clientX })
}

test('a handle drag ends on lift or on a cancelled touch, and ignores other fingers', () => {
  const at = (x: number) => x / 100
  for (const endType of ['pointerup', 'pointercancel']) {
    const target = new EventTarget()
    const calls: Array<[number, boolean]> = []
    startHandleDrag(target, { pointerId: 1, clientX: 10 }, at, (v: number, done: boolean) => calls.push([v, done]))
    target.dispatchEvent(pointer('pointermove', 1, 30))
    target.dispatchEvent(pointer('pointermove', 2, 90)) // another finger: ignored
    target.dispatchEvent(pointer(endType, 2, 95)) // another finger lifting: ignored
    target.dispatchEvent(pointer(endType, 1, 40))
    const commit = endType === 'pointerup' ? 0.4 : 0.3 // a cancel commits the last real spot
    assert.deepEqual(calls, [[0.1, false], [0.3, false], [commit, true]], endType)
    target.dispatchEvent(pointer('pointermove', 1, 70))
    assert.equal(calls.length, 3, `${endType}: no listener is left behind`)
  }
})

test('stopping a drag (editor closed mid-drag) drops its listeners without committing', () => {
  const target = new EventTarget()
  const calls: Array<[number, boolean]> = []
  const stop = startHandleDrag(target, { pointerId: 1, clientX: 0 }, (x: number) => x, (v: number, d: boolean) => calls.push([v, d]))
  stop()
  target.dispatchEvent(pointer('pointermove', 1, 5))
  target.dispatchEvent(pointer('pointerup', 1, 5))
  assert.deepEqual(calls, [[0, false]])
})
