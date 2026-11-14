// The sound check's reading. It must tell a dropped tap apart from a silent switch, a frozen clock,
// and a tone the instrument's own chain ate — without starting audio.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { beepWavBlob, classifyHear, deviceFacts, formatHearReport, gestureFacts, signalPresent, withHeard } from '../src/pages/MusicMaker/audio/hearReport.js'

const press = (over = {}) => ({
  id: 'press-tone',
  kind: 'webaudio',
  awaited: false,
  stateBefore: 'suspended',
  stateAfter: 'running',
  clockMoved: true,
  rms: 0.12,
  gesture: { type: 'pointerdown', pointerType: 'touch', isTrusted: true, activation: { isActive: true, hasBeenActive: true } },
  userHeard: null,
  ...over,
})

test('a tone in the tap and silence after the chain loads names the dropped tap, not the mute switch', () => {
  const notes = classifyHear({
    probes: [
      press({ userHeard: true }),
      press({ id: 'worklet-tone', awaited: true, stateAfter: 'suspended', clockMoved: false, rms: 0, userHeard: false }),
    ],
  })
  assert.match(notes.join('\n'), /same moment as the tap/)
  assert.match(notes.join('\n'), /has not been changed/)
  assert.doesNotMatch(notes.join('\n'), /silent switch/)
})

test('a chain load that fails once and works once is the sporadic case', () => {
  const notes = classifyHear({
    probes: [
      press({ id: 'worklet-tone', awaited: true, stateAfter: 'suspended', clockMoved: false, rms: 0 }),
      press({ id: 'worklet-tone', awaited: true, userHeard: true }),
    ],
  })
  assert.match(notes.join('\n'), /failed once and worked once/)
})

test('a music file that plays and a generated tone the speaker never plays is the silent switch', () => {
  const notes = classifyHear({
    probes: [
      { id: 'html', kind: 'html', mediaMoved: true, userHeard: true },
      press({ userHeard: false }),
    ],
  })
  assert.match(notes.join('\n'), /silent switch/)
  assert.match(notes.join('\n'), /not the mute button inside the app/)
})

test('a running clock that does not move is an interrupted speaker, not a broken kit', () => {
  const notes = classifyHear({
    probes: [press({ clockMoved: false, rms: 0, stateAfter: 'running' })],
  })
  assert.match(notes.join('\n'), /clock is frozen/)
})

test('a tone around the instrument that is heard, and one through it that is not, is the output chain', () => {
  const notes = classifyHear({
    probes: [
      press({ id: 'engine-direct', awaited: true, userHeard: true }),
      press({ id: 'engine-graph', awaited: true, userHeard: false, master: 0.9 }),
    ],
  })
  assert.match(notes.join('\n'), /output chain is dropping it/)
})

test('a finger that was heard and a mouse that was generated but not heard stays on those two rows', () => {
  const notes = classifyHear({
    probes: [
      press({ userHeard: true }),
      press({ userHeard: false, gesture: { type: 'click', pointerType: 'mouse', isTrusted: true, activation: { isActive: true } } }),
    ],
  })
  assert.match(notes.join('\n'), /finger was heard and a mouse click was not/)
})

test('an untrusted press is not a user gesture', () => {
  const notes = classifyHear({
    probes: [press({ stateAfter: 'suspended', clockMoved: false, rms: 0, gesture: { type: 'click', pointerType: 'mouse', isTrusted: false, activation: { isActive: false } } })],
  })
  assert.match(notes.join('\n'), /not accepted as a press/)
})

test('a frame whose tones never start says so', () => {
  const notes = classifyHear({
    device: { iframe: true },
    probes: [press({ stateAfter: 'suspended', clockMoved: false, rms: 0 })],
  })
  assert.match(notes.join('\n'), /inside another page/)
})

test('every answered test being heard does not invent a fault', () => {
  const notes = classifyHear({ probes: [press({ userHeard: true })] })
  assert.match(notes.join('\n'), /not happening in this browser right now/)
})

test('hearing is recorded on the last test only', () => {
  const probes = withHeard([press(), press({ id: 'micro-tone' })], 1, false)
  assert.equal(probes[0].userHeard, null)
  assert.equal(probes[1].userHeard, false)
})

test('the report is one block and does not claim the instrument changed', () => {
  const text = formatHearReport({
    device: deviceFacts(),
    engine: { built: false },
    probes: [press()],
    inputs: [gestureFacts({ type: 'pointerdown', pointerType: 'touch', isTrusted: true })],
  })
  assert.match(text, /instrument was not changed/)
  assert.match(text, /press-tone/)
  assert.match(text, /pointerdown touch/)
})

test('the music-file beep is a wav a browser can play', async () => {
  const blob = beepWavBlob(440, 0.2, 8000)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF')
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), 'WAVE')
  assert.equal(bytes.length, 44 + Math.floor(8000 * 0.2) * 2)
  assert.equal(signalPresent(0.02), true)
  assert.equal(signalPresent(0), false)
})
