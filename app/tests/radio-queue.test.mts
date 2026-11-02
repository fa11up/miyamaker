// src/music/queue.ts: miya radio's playlist order, next/prev, shuffle and repeat. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  clearQueue,
  createQueue,
  currentTrack,
  cycleRepeat,
  enqueue,
  next,
  playNow,
  positionLabel,
  prev,
  removeAt,
  setShuffle,
  shuffled,
} from '../src/music/queue.ts'
import type { Track } from '../src/music/types.ts'

const t = (id: string): Track => ({ id, title: id.toUpperCase(), src: `ipfs://cid/${id}.mp3`, source: 'onchain' })
const abc = [t('a'), t('b'), t('c')]

/** Deterministic RNG (mulberry32) so shuffle tests are stable. */
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let r = Math.imul(s ^ (s >>> 15), 1 | s)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const ids = (q: ReturnType<typeof createQueue>) => q.order.map((i) => q.tracks[i]?.id).join('')

test('empty queue has nothing loaded and next/prev are no-ops', () => {
  const q = createQueue()
  assert.equal(q.position, -1)
  assert.equal(currentTrack(q), undefined)
  assert.equal(positionLabel(q), '0/0')
  assert.equal(next(q).stop, true)
  assert.equal(prev(q).restart, false)
})

test('enqueue appends, ignores duplicate ids and loads the first track into an empty queue', () => {
  let q = enqueue(createQueue(), [t('a'), t('b')])
  assert.equal(currentTrack(q)?.id, 'a')
  q = enqueue(q, [t('b'), t('c')])
  assert.equal(ids(q), 'abc')
  assert.equal(currentTrack(q)?.id, 'a', 'enqueue never changes what is playing')
  assert.equal(enqueue(q, [t('a')]), q, 'no-op returns the same state')
})

test('manual next walks forward and wraps at the end; auto-advance stops at the end with repeat off', () => {
  let q = createQueue(abc)
  q = next(q).state
  q = next(q).state
  assert.equal(currentTrack(q)?.id, 'c')
  const auto = next(q, { auto: true })
  assert.equal(auto.stop, true)
  assert.equal(currentTrack(auto.state)?.id, 'c')
  const manual = next(q)
  assert.equal(manual.stop, false)
  assert.equal(currentTrack(manual.state)?.id, 'a')
})

test('repeat all wraps on auto-advance; repeat one replays the same track on auto but not on manual next', () => {
  let q = cycleRepeat(createQueue(abc)) // off → all
  assert.equal(q.repeat, 'all')
  q = next(next(q).state).state
  const wrapped = next(q, { auto: true })
  assert.equal(wrapped.stop, false)
  assert.equal(currentTrack(wrapped.state)?.id, 'a')

  q = cycleRepeat(createQueue(abc, 'all')) // all → one
  assert.equal(q.repeat, 'one')
  assert.equal(currentTrack(next(q, { auto: true }).state)?.id, 'a')
  assert.equal(currentTrack(next(q).state)?.id, 'b')
  assert.equal(cycleRepeat(q).repeat, 'off')
})

test('prev restarts after 3 seconds, otherwise goes back; at the start it restarts unless repeat all', () => {
  let q = next(createQueue(abc)).state // b
  assert.deepEqual(prev(q, 10).restart, true)
  assert.equal(currentTrack(prev(q, 1).state)?.id, 'a')
  q = createQueue(abc)
  assert.equal(prev(q, 0).restart, true)
  assert.equal(currentTrack(prev(createQueue(abc, 'all'), 0).state)?.id, 'c')
})

test('shuffle keeps the current track first, is a permutation, and turning it off restores list order', () => {
  const many = 'abcdefgh'.split('').map(t)
  let q = next(createQueue(many)).state // b
  q = setShuffle(q, true, seeded(7))
  assert.equal(q.shuffle, true)
  assert.equal(currentTrack(q)?.id, 'b')
  assert.equal(q.position, 0)
  assert.deepEqual([...q.order].sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.notEqual(ids(q), 'bacdefgh', 'seeded shuffle actually reorders')

  q = next(next(q).state).state
  const playing = currentTrack(q)?.id
  q = setShuffle(q, false)
  assert.equal(ids(q), 'abcdefgh')
  assert.equal(currentTrack(q)?.id, playing, 'unshuffle keeps playing the same track')
})

test('shuffle + repeat all reshuffles on a new lap without replaying the finished track first', () => {
  let q = setShuffle(createQueue('abcde'.split('').map(t), 'all'), true, seeded(1))
  for (let i = 0; i < 4; i += 1) q = next(q, { auto: true }).state
  const last = currentTrack(q)?.id
  const lap = next(q, { auto: true, rng: seeded(2) })
  assert.equal(lap.stop, false)
  assert.equal(lap.state.position, 0)
  assert.notEqual(currentTrack(lap.state)?.id, last)
  assert.equal(lap.state.order.length, 5)
})

test('shuffled() is a permutation and does not mutate its input', () => {
  const input = [1, 2, 3, 4, 5]
  const out = shuffled(input, seeded(3))
  assert.deepEqual(input, [1, 2, 3, 4, 5])
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5])
})

test('playNow jumps to a queued track or inserts a new one right after the current track', () => {
  let q = createQueue(abc)
  q = playNow(q, t('c'))
  assert.equal(currentTrack(q)?.id, 'c')
  q = createQueue(abc)
  q = playNow(q, t('z'))
  assert.equal(ids(q), 'azbc')
  assert.equal(currentTrack(q)?.id, 'z')
  assert.equal(positionLabel(q), '2/4')
  assert.equal(currentTrack(playNow(createQueue(), t('z')))?.id, 'z')
})

test('removeAt keeps the right track loaded', () => {
  let q = next(createQueue(abc)).state // b
  q = removeAt(q, 0) // remove a (before current)
  assert.equal(currentTrack(q)?.id, 'b')
  q = removeAt(q, 0) // remove b (current) → c loads
  assert.equal(currentTrack(q)?.id, 'c')
  q = removeAt(q, 0)
  assert.equal(q.position, -1)
  assert.equal(removeAt(q, 5), q)
  assert.equal(clearQueue(createQueue(abc)).tracks.length, 0)
})
