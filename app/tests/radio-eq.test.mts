// src/music/eq.ts: miya radio's equalizer bands, presets and state helpers. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bandLabel,
  clampBalance,
  clampDb,
  dbToGain,
  defaultEq,
  effectiveGains,
  EQ_BANDS,
  EQ_MAX_DB,
  EQ_MIN_DB,
  EQ_PRESETS,
  matchPreset,
  sanitizeEq,
} from '../src/music/eq.ts'

test('presets cover every band and stay in range', () => {
  for (const p of EQ_PRESETS) {
    assert.equal(p.bands.length, EQ_BANDS.length, p.id)
    for (const b of [p.preamp, ...p.bands]) assert.ok(b >= EQ_MIN_DB && b <= EQ_MAX_DB, `${p.id} ${b}`)
  }
  assert.equal(new Set(EQ_PRESETS.map((p) => p.id)).size, EQ_PRESETS.length)
})

test('clampDb bounds, rounds to half steps and rejects junk', () => {
  assert.equal(clampDb(40), EQ_MAX_DB)
  assert.equal(clampDb(-40), EQ_MIN_DB)
  assert.equal(clampDb(3.3), 3.5)
  assert.equal(clampDb(NaN), 0)
})

test('sanitizeEq repairs stored values', () => {
  assert.deepEqual(sanitizeEq(null), defaultEq())
  assert.deepEqual(sanitizeEq('nope'), defaultEq())
  const eq = sanitizeEq({ enabled: false, preamp: 99, bands: [1, 'x', -50] })
  assert.equal(eq.enabled, false)
  assert.equal(eq.preamp, EQ_MAX_DB)
  assert.equal(eq.bands.length, EQ_BANDS.length)
  assert.deepEqual(eq.bands.slice(0, 4), [1, 0, EQ_MIN_DB, 0])
})

test('effectiveGains is flat while the EQ is off', () => {
  const club = EQ_PRESETS.find((p) => p.id === 'club')
  assert.ok(club)
  const on = effectiveGains({ enabled: true, preamp: club.preamp, bands: club.bands })
  assert.deepEqual(on.bands, club.bands)
  const off = effectiveGains({ enabled: false, preamp: club.preamp, bands: club.bands })
  assert.equal(off.preamp, 0)
  assert.ok(off.bands.every((b) => b === 0))
})

test('matchPreset, balance, dB and labels', () => {
  assert.equal(matchPreset(defaultEq())?.id, 'flat')
  assert.equal(matchPreset({ ...defaultEq(), preamp: 1 }), undefined)
  assert.equal(clampBalance(3), 1)
  assert.equal(clampBalance(-3), -1)
  assert.equal(clampBalance(NaN), 0)
  assert.equal(dbToGain(0), 1)
  assert.ok(Math.abs(dbToGain(-6) - 0.501) < 0.01)
  assert.equal(bandLabel(60), '60')
  assert.equal(bandLabel(12000), '12K')
})
