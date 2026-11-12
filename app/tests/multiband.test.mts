import assert from 'node:assert/strict'
import test from 'node:test'
import { clampCrossovers, dbToGain, defaultCrossovers, normalizeBands } from '../src/pages/MusicMaker/audio/multiband.js'

test('crossovers stay in order and a saved song without bands still has four', () => {
  const messy = clampCrossovers([5000, 100, 800])
  assert.ok(messy[0] < messy[1] && messy[1] < messy[2])
  assert.deepEqual(clampCrossovers([120, 800, 5000]), [120, 800, 5000])
  const ordered = clampCrossovers([900, 1000, 1100])
  assert.ok(ordered[0] < ordered[1] && ordered[1] < ordered[2])
  assert.deepEqual(defaultCrossovers(), [120, 800, 5000])
  const bands = normalizeBands(null)
  assert.equal(bands.length, 4)
  assert.equal(bands[0].threshold, -18)
  assert.equal(bands[0].solo, false)
  assert.equal(normalizeBands([{ threshold: 9, gain: 80, mute: 1 }])[0].threshold, 0)
  assert.equal(normalizeBands([{ threshold: 9, gain: 80, mute: 1 }])[0].gain, 24)
  assert.equal(normalizeBands([{ threshold: 9, gain: 80, mute: 1 }])[0].mute, true)
  assert.ok(Math.abs(dbToGain(0) - 1) < 1e-9)
})
