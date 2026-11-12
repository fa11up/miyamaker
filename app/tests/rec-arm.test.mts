import assert from 'node:assert/strict'
import { test } from 'node:test'
import { model, setScreen } from '../src/pages/MusicMaker/model.js'

test('opening the tracker leaves rec off and keeps that arm across pages', () => {
  model.screen = 'pads'
  model.tracker.edit = false
  model.recording = false
  setScreen('track')
  assert.equal(model.screen, 'track')
  assert.equal(model.tracker.focus, true)
  assert.equal(model.tracker.edit, false)
  assert.equal(model.recording, false)

  model.tracker.edit = true
  model.recording = true
  setScreen('edit')
  assert.equal(model.tracker.focus, false)
  assert.equal(model.tracker.edit, true)
  assert.equal(model.recording, true)

  setScreen('track')
  assert.equal(model.tracker.edit, true)
  assert.equal(model.recording, true)
  model.tracker.edit = false
  model.recording = false
})
