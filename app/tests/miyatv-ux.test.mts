// The small decisions behind miyaTV's screens: the focus timer, what a label says, who stays on. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { airList, HOUSE_TAPES, nextTapeId, NOT_SENT, TapeRefusal, tapeProblem } from '../api/_lib/publicaccess.ts'
import { CHANNELS, pinnedSource, plateLink, watchLabel } from '../src/pages/TV/channels.ts'
import { chatWaitLine, signInProblem } from '../src/pages/TV/chat/protocol.ts'
import {
  FOCUS_SECONDS,
  focusLabel,
  newFocusTimer,
  resetFocus,
  REST_SECONDS,
  tickFocus,
  toggleFocus,
} from '../src/pages/TV/focusTimer.ts'
import { headingLabel } from '../src/pages/TV/issMath.ts'
import { formatDistance } from '../src/pages/TV/squeek.ts'

const channel = (id: string) => CHANNELS.find((c) => c.id === id)!

test('the focus timer goes by the clock, however rarely it is looked at', () => {
  const started = toggleFocus(newFocusTimer, 0)
  assert.equal(tickFocus(started, 1000).left, FOCUS_SECONDS - 1)
  // A throttled tab that only ticked once in ten minutes has not lost those ten minutes.
  assert.equal(tickFocus(started, 600_000).left, FOCUS_SECONDS - 600)
  assert.equal(tickFocus(newFocusTimer, 600_000), newFocusTimer, 'a stopped timer stays put')
})

test('the same second hands back the same timer, so nothing redraws', () => {
  const t = tickFocus(toggleFocus(newFocusTimer, 0), 1000)
  assert.equal(tickFocus(t, 1400), t)
})

test('focus turns to rest and back, counting what was finished', () => {
  const started = toggleFocus(newFocusTimer, 0)
  const resting = tickFocus(started, FOCUS_SECONDS * 1000)
  assert.equal(resting.resting, true)
  assert.equal(resting.left, REST_SECONDS)
  assert.equal(resting.done, 1)
  assert.equal(resting.turns, 1)
  assert.equal(focusLabel(resting), 'Rest 05:00')
  const back = tickFocus(resting, (FOCUS_SECONDS + REST_SECONDS) * 1000)
  assert.equal(back.resting, false)
  assert.equal(back.done, 1)
  assert.equal(focusLabel(back), 'Focus 25:00')
})

test('a tab asleep through a whole cycle catches up', () => {
  const t = tickFocus(toggleFocus(newFocusTimer, 0), (FOCUS_SECONDS + REST_SECONDS + 60) * 1000)
  assert.equal(t.resting, false)
  assert.equal(t.left, FOCUS_SECONDS - 60)
  assert.equal(t.turns, 2)
})

test('pausing holds the time left, and starting again carries on from it', () => {
  const paused = toggleFocus(toggleFocus(newFocusTimer, 0), 60_000)
  assert.equal(paused.running, false)
  assert.equal(paused.left, FOCUS_SECONDS - 60)
  assert.equal(tickFocus(paused, 900_000).left, FOCUS_SECONDS - 60)
  assert.equal(tickFocus(toggleFocus(paused, 900_000), 901_000).left, FOCUS_SECONDS - 61)
})

test('reset is a fresh 25 minutes, keeps the count, and is not mistaken for a turn', () => {
  const resting = tickFocus(toggleFocus(newFocusTimer, 0), FOCUS_SECONDS * 1000)
  const fresh = resetFocus(resting)
  assert.deepEqual(
    [fresh.running, fresh.resting, fresh.left, fresh.done, fresh.turns],
    [false, false, FOCUS_SECONDS, 1, resting.turns],
  )
})

test('the plate says where its link goes', () => {
  assert.equal(watchLabel({ provider: 'youtube', videoId: 'rFZHOHl-L8A', label: 'x' }), 'Watch on YouTube ↗')
  assert.equal(watchLabel({ provider: 'kick', slug: 'x', label: 'x' }), 'Watch on Kick ↗')
  assert.deepEqual(plateLink(channel('squeekchain')), { href: 'https://squeekchain.com/', label: 'squeekchain.com ↗' })
  assert.equal(plateLink(channel('miya-radio')), undefined)
  assert.equal(plateLink(channel('kick-imdusd')), undefined, 'with nobody on, Kick has its own card and no link here')
})

test('a stream being watched stays on however the list reorders', () => {
  assert.deepEqual(pinnedSource(['a', 'b'], undefined), { label: 'a', ended: false })
  assert.deepEqual(pinnedSource(['b', 'a'], 'a'), { label: 'a', ended: false })
  assert.deepEqual(pinnedSource(['b', 'c'], 'a'), { label: 'b', ended: true })
  assert.deepEqual(pinnedSource([], 'a'), { label: 'a', ended: false }, 'no list is not the same as the stream ending')
})

test('tape failures come out in plain words', () => {
  assert.equal(tapeProblem(new Error('User rejected the request.')), 'You cancelled it in your wallet.')
  assert.equal(tapeProblem({ shortMessage: 'User denied message signature' }), 'You cancelled it in your wallet.')
  assert.equal(
    tapeProblem(new TapeRefusal('This video has already been sent in.')),
    'This video has already been sent in.',
  )
  assert.equal(tapeProblem(new Error('RPC Request failed.\nDetails: 0xabc')), NOT_SENT)
  assert.equal(tapeProblem(undefined), NOT_SENT)
})

test('the next tape comes round to the first', () => {
  const tapes = airList()
  assert.equal(nextTapeId(tapes), tapes[1]!.videoId, 'nothing picked means the first is on')
  assert.equal(nextTapeId(tapes, tapes[0]!.videoId), tapes[1]!.videoId)
  assert.equal(nextTapeId(tapes, HOUSE_TAPES[tapes.length - 1]!.videoId), tapes[0]!.videoId)
  assert.equal(nextTapeId([]), undefined)
})

test('chat says what it is doing, and failed sign-ins keep library text off the screen', () => {
  assert.equal(chatWaitLine('open'), 'No messages yet. Say hi.')
  assert.equal(chatWaitLine('connecting'), 'Joining chat…')
  assert.equal(chatWaitLine('reconnecting'), 'Chat dropped. Reconnecting…')
  assert.equal(chatWaitLine('off'), 'Chat is offline right now. The stream still works.')
  assert.equal(signInProblem(new Error('User rejected the request.')), 'Signature cancelled.')
  assert.equal(signInProblem(new Error('invalid nonce')), 'Could not sign you in. Try again.')
})

test('numbers are rounded, with units', () => {
  assert.equal(formatDistance(6348.818), '6.35 km')
  assert.equal(formatDistance(999.94), '999.9 m')
  assert.equal(headingLabel(134.4), 'Southeast · 134°')
  assert.equal(headingLabel(-1), 'North · 359°')
})
