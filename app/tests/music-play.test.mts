import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextSongCursor, samplePlayKind } from '../src/pages/MusicMaker/audio/playKind.js'
import { downsample, parseClock, shapeSample, sliceSpan, urlSampleHint } from '../src/pages/MusicMaker/audio/sampleShape.js'

test('tracker notes and the tracker clock are one-shots', () => {
  assert.equal(samplePlayKind({ pattern: true, mode: 'loop', held: true }), 'oneshot')
  assert.equal(samplePlayKind({ trackerNote: true, mode: 'loop', held: true }), 'oneshot')
  assert.equal(samplePlayKind({ trackerNote: true, mode: 'gate' }), 'oneshot')
  assert.equal(samplePlayKind({ grain: true, pattern: true }), 'grain')
})

test('pad holds and loop mode keep looping', () => {
  assert.equal(samplePlayKind({ held: true, mode: 'oneshot' }), 'loop')
  assert.equal(samplePlayKind({ mode: 'loop' }), 'loop')
  assert.equal(samplePlayKind({ mode: 'gate' }), 'gate')
  assert.equal(samplePlayKind({ mode: 'oneshot' }), 'oneshot')
})

test('song order wraps, repeats a section, or stops', () => {
  assert.equal(nextSongCursor(0, 3, 'wrap'), 1)
  assert.equal(nextSongCursor(2, 3, 'wrap'), 0)
  assert.equal(nextSongCursor(1, 1, 'wrap'), 0)
  assert.equal(nextSongCursor(2, 4, 'section'), 2)
  assert.equal(nextSongCursor(0, 1, 'section'), 0)
  assert.equal(nextSongCursor(1, 3, 'once'), 2)
  assert.equal(nextSongCursor(2, 3, 'once'), -1)
  assert.equal(nextSongCursor(0, 1, 'once'), -1)
  assert.equal(nextSongCursor(0, 0, 'wrap'), 0)
})

test('a video link suggests a start and a name', () => {
  assert.equal(urlSampleHint('https://youtu.be/abcdefghijk?t=90').startSec, 90)
  assert.equal(urlSampleHint('https://www.youtube.com/watch?v=abcdefghijk&t=1m30s').startSec, 90)
  assert.equal(urlSampleHint('https://www.youtube.com/watch?v=abcdefghijk&start=1h2m3s').startSec, 3723)
  assert.equal(urlSampleHint('https://odysee.com/@chan:1/my-cool-track:a').name, 'my cool track')
  assert.equal(urlSampleHint('https://www.youtube.com/watch?v=abcdefghijk').startSec, null)
  assert.equal(parseClock('90s'), 90)
})

test('a crop keeps the in and out points and can downsample', () => {
  const pcm = new Float32Array(44100)
  for (let i = 0; i < pcm.length; i++) pcm[i] = i < 22050 ? 0 : 1
  const shaped = shapeSample(pcm, 44100, { inSec: 0.5, outSec: 0.75, rate: 22050 })
  assert.equal(shaped.sr, 22050)
  assert.ok(Math.abs(shaped.seconds - 0.25) < 0.02)
  assert.equal(shaped.clipped, false)
  const capped = shapeSample(pcm, 44100, { inSec: 0, outSec: 1, cap: 0.4 })
  assert.equal(capped.clipped, true)
  assert.ok(capped.seconds <= 0.41)
  const half = downsample(pcm, 44100, 22050)
  assert.equal(half.length, 22050)
})

test('slices split a long crop and cap each piece', () => {
  const pcm = new Float32Array(44100 * 4)
  pcm.fill(0.2)
  const cut = sliceSpan(pcm, 44100, { inSec: 0, outSec: 4, count: 4, cap: 1 })
  assert.equal(cut.count, 4)
  assert.equal(cut.clipped, false)
  assert.ok(cut.pieces.every((piece) => piece.seconds <= 1.02))
  const long = sliceSpan(pcm, 44100, { inSec: 0, outSec: 4, count: 2, cap: 1 })
  assert.equal(long.count, 4)
})
