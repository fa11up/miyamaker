import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextSongCursor, samplePlayKind as playKindOf } from '../src/pages/MusicMaker/audio/playKind.js'

// The engine also passes `held`, which must not change the kind. The JS signature does not list it.
const samplePlayKind = playKindOf as (opts: Parameters<typeof playKindOf>[0] & { held?: boolean }) => string
import { clockBpm, launchStep, normalizeAuto, normalizeLaunch, valueAt, writeAuto } from '../src/pages/MusicMaker/audio/arrange.js'
import { downsample, parseClock, shapeSample, sliceSpan, urlSampleHint } from '../src/pages/MusicMaker/audio/sampleShape.js'

test('tracker notes and the tracker clock are one-shots', () => {
  assert.equal(samplePlayKind({ pattern: true, mode: 'loop', held: true }), 'oneshot')
  assert.equal(samplePlayKind({ trackerNote: true, mode: 'loop', held: true }), 'oneshot')
  assert.equal(samplePlayKind({ trackerNote: true, mode: 'gate' }), 'oneshot')
  assert.equal(samplePlayKind({ grain: true, pattern: true }), 'grain')
})

test('a one-shot stays a one-shot while held, and only loop mode cycles', () => {
  assert.equal(samplePlayKind({ held: true, mode: 'oneshot' }), 'oneshot')
  assert.equal(samplePlayKind({ held: true, mode: 'loop' }), 'loop')
  assert.equal(samplePlayKind({ mode: 'loop' }), 'loop')
  assert.equal(samplePlayKind({ held: true, mode: 'gate' }), 'gate')
  assert.equal(samplePlayKind({ mode: 'gate' }), 'gate')
  assert.equal(samplePlayKind({ mode: 'oneshot' }), 'oneshot')
  assert.equal(samplePlayKind({ held: false }), 'oneshot')
})

test('automation holds the last point and stays quiet before the first one', () => {
  const points = [{ s: 4, v: 1 }, { s: 8, v: 2 }]
  assert.equal(valueAt(points, 3), null)
  assert.equal(valueAt(points, 4), 1)
  assert.equal(valueAt(points, 9), 2)
  assert.equal(valueAt([], 0), null)
})

test('a pattern tempo sits between a BPM lane and the song tempo', () => {
  const seq = { bpm: 140, auto: [{ id: 'bpm', points: [{ s: 2, v: 180 }] }] }
  assert.equal(clockBpm({ bpm: 96 }, seq, 0), 140)
  assert.equal(clockBpm({ bpm: 96 }, seq, 2), 180)
  assert.equal(clockBpm({ bpm: 96 }, {}, 0), 96)
  assert.equal(clockBpm({}, {}, 0), 96)
})

test('launch waits, restarts, or keeps the step of the next pattern', () => {
  assert.equal(normalizeLaunch('soon'), 'end')
  assert.equal(normalizeLaunch('now'), 'now')
  assert.equal(normalizeLaunch(undefined), 'end')
  assert.deepEqual(launchStep({ mode: 'now', queued: true, atWrap: false, step: 5, nextLength: 16 }), { take: true, advance: false, step: 0 })
  assert.deepEqual(launchStep({ mode: 'end', queued: true, atWrap: false, step: 5, nextLength: 16 }), { take: false, advance: false, step: 5 })
  assert.deepEqual(launchStep({ mode: 'end', queued: true, atWrap: true, step: 0, nextLength: 16 }), { take: true, advance: false, step: 0 })
  assert.deepEqual(launchStep({ mode: 'grid', queued: true, atWrap: false, step: 14, nextLength: 12 }), { take: true, advance: false, step: 2 })
  assert.deepEqual(launchStep({ mode: 'grid', queued: true, atWrap: false, step: 5, nextLength: 16 }), { take: true, advance: false, step: 5 })
  assert.deepEqual(launchStep({ mode: 'now', queued: false, atWrap: true, step: 0, nextLength: 16 }), { take: false, advance: true, step: 0 })
  assert.deepEqual(launchStep({ mode: 'end', queued: false, atWrap: false, step: 3, nextLength: 16 }), { take: false, advance: false, step: 3 })
})

test('automation keeps an empty lane, drops an unknown one, and writes a mixer value once', () => {
  assert.deepEqual(normalizeAuto([
    { id: 'swing', points: [] },
    { id: 'nope', points: [{ s: 0, v: 1 }] },
    { id: 'bpm', points: [{ s: 1, v: 10 }, { s: 1, v: 80 }, { s: -4, v: 90 }] },
  ]), [
    { id: 'swing', points: [] },
    { id: 'bpm', points: [{ s: 0, v: 90 }, { s: 1, v: 80 }] },
  ])
  const live = {
    bpm: 96,
    master: 0.9,
    pads: [{ pitch: 0, filter: { cutoff: 1000 }, fx: { drive: 0 } }],
  }
  assert.equal(writeAuto(live, 'master', 0.4), true)
  assert.equal(live.master, 0.4)
  assert.equal(writeAuto(live, 'master', 0.4), false)
  assert.equal(writeAuto(live, 'pad:0:pitch', 12.4), false)
  assert.equal(live.pads[0]!.pitch, 12)
  assert.equal(writeAuto(live, 'nope', 1), false)
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
