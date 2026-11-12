import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mixNote, quantizeSample, quantizeTake, takeMaxSamples, takeSeconds } from '../src/pages/MusicMaker/audio/synth.js'

test('a 64 KB synth take is longer at a lower bit depth', () => {
  assert.equal(takeMaxSamples(8), 65536)
  assert.equal(takeMaxSamples(16), 32768)
  assert.equal(takeMaxSamples(24), 21845)
  assert.equal(takeMaxSamples(32), 16384)
  assert.equal(takeMaxSamples(12), 32768)
  assert.ok(takeSeconds(8) > takeSeconds(16))
  assert.ok(takeSeconds(16) > takeSeconds(24))
  assert.ok(takeSeconds(24) > takeSeconds(32))
  assert.ok(Math.abs(takeSeconds(16, 44100) - 32768 / 44100) < 1e-9)
})

test('bit depth quantizes and a mix stays inside the take', () => {
  assert.equal(quantizeSample(0, 8), 0)
  assert.equal(quantizeSample(1, 16), 1)
  assert.equal(quantizeSample(0.5, 8), Math.round(0.5 * 127) / 127)
  const ramp = new Float32Array(1000)
  for (let i = 0; i < ramp.length; i++) ramp[i] = (i / (ramp.length - 1)) * 2 - 1
  const eight = quantizeTake(ramp, 8)
  assert.equal(eight.length, ramp.length)
  assert.ok(new Set(eight).size <= 256)
  const dest = new Float32Array(8)
  const src = new Float32Array([0.5, 0.5, 0.5, 0.5])
  assert.equal(mixNote(dest, src, { start: 6, rate: 1, vel: 1, until: 100 }), 8)
  assert.equal(dest[5], 0)
  assert.equal(dest[6], 0.5)
  assert.equal(dest[7], 0.5)
  mixNote(dest, src, { start: 6, rate: 1, vel: 1 })
  assert.equal(dest[6], 1)
  assert.equal(dest[7], 1)
})
