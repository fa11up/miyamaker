// Media and long-running hardening: chat frame shapes, one owner of sound, dead-tape backoff, outside data shapes,
// waveform caps and capped metadata reads. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { onSoundTaken, ownerOf, ownerPlaying, setPlaying } from '../src/desktop/screensaver/playing.ts'
import { WAVEFORM_MAX_BYTES, WAVEFORM_MAX_SECONDS, waveformPlan } from '../src/music/audio.ts'
import { readCappedJson } from '../src/music/cappedJson.ts'
import { cleanBadges, parseFrame } from '../src/pages/TV/chat/protocol.ts'
import { DEAD_MAX_MS, readTapeList, readTvLive, tapeDied, tapePlayed } from '../src/pages/TV/feeds.ts'
import { readIssPosition, readIssPositions } from '../src/pages/TV/issMath.ts'

/* ---------- chat frames ---------- */

const msg = (badges: unknown) => JSON.stringify({ t: 'msg', msg: { id: 'a', at: 1, from: '0xabc', text: 'hi', badges } })

test('chat: badges that are not strings are dropped, never thrown on', () => {
  const f = parseFrame(msg(['mod', { evil: 1 }, 7, null, ['x'], 'miyamini']))
  assert.equal(f?.t, 'msg')
  assert.deepEqual(f?.t === 'msg' && f.msg.badges, ['mod', 'miyamini'])
})

test('chat: duplicate and empty badges go, and the list is capped', () => {
  assert.deepEqual(cleanBadges(['mod', 'mod', '', 'infer']), ['mod', 'infer'])
  assert.equal(cleanBadges(Array.from({ length: 50 }, (_, i) => `b${i}`)).length, 8)
  assert.deepEqual(cleanBadges('mod'), [])
})

test('chat: a message still needs its own fields', () => {
  assert.equal(parseFrame(msg('mod')), undefined)
  assert.equal(parseFrame(JSON.stringify({ t: 'msg', msg: { id: 1, at: 1, from: 'x', text: 'y', badges: [] } })), undefined)
})

test('chat: hello history is cleaned message by message', () => {
  const f = parseFrame(
    JSON.stringify({
      t: 'hello',
      room: 'r',
      history: [
        { id: 'a', at: 1, from: 'x', text: 'ok', badges: [{}] },
        { id: 'b', at: 'no', from: 'x', text: 'bad', badges: [] },
      ],
    }),
  )
  assert.equal(f?.t, 'hello')
  if (f?.t !== 'hello') return
  assert.equal(f.history.length, 1)
  assert.deepEqual(f.history[0]?.badges, [])
})

test('chat: me gets string badges and a real boolean mod', () => {
  const f = parseFrame(JSON.stringify({ t: 'me', me: { address: '0xa', badges: [{ x: 1 }, 'mod'], mod: 'yes' } }))
  assert.deepEqual(f, { t: 'me', me: { address: '0xa', badges: ['mod'], mod: false } })
  const g = parseFrame(JSON.stringify({ t: 'me', me: { address: '0xa', mod: true } }))
  assert.deepEqual(g, { t: 'me', me: { address: '0xa', badges: [], mod: true } })
  assert.equal(parseFrame(JSON.stringify({ t: 'me', me: { address: 5 } })), undefined)
})

test('chat: counts never go negative', () => {
  assert.deepEqual(parseFrame(JSON.stringify({ t: 'viewers', count: -4 })), { t: 'viewers', count: 0 })
  assert.deepEqual(parseFrame(JSON.stringify({ t: 'slow', seconds: 'x' })), { t: 'slow', seconds: 0 })
})

/* ---------- one owner of sound ---------- */

test('sound: one source starting pauses the other apps, not its own parts', () => {
  const hushed: string[] = []
  const off = [
    onSoundTaken('radio', () => hushed.push('radio')),
    onSoundTaken('tv', () => hushed.push('tv')),
    onSoundTaken('studio', () => hushed.push('studio')),
  ]
  try {
    setPlaying('tv-youtube', true)
    assert.deepEqual(hushed.sort(), ['radio', 'studio'])
    assert.equal(ownerPlaying('tv'), true)

    // Still playing (buffering, then playing again): no second round of pauses.
    hushed.length = 0
    setPlaying('tv-youtube', true)
    assert.deepEqual(hushed, [])

    // Another part of the same app never pauses the app.
    setPlaying('tv-embed', true)
    assert.deepEqual(hushed.sort(), ['radio', 'studio'])

    hushed.length = 0
    setPlaying('radio', true)
    assert.deepEqual(hushed.sort(), ['studio', 'tv'])
  } finally {
    off.forEach((f) => f())
    setPlaying('tv-youtube', false)
    setPlaying('tv-embed', false)
    setPlaying('radio', false)
  }
  assert.equal(ownerPlaying('tv'), false)
})

test('sound: stopping pauses nobody, and nothing resumes by itself', () => {
  let calls = 0
  const off = onSoundTaken('radio', () => {
    calls += 1
  })
  try {
    setPlaying('studio', true)
    setPlaying('studio', false)
    assert.equal(calls, 1)
  } finally {
    off()
  }
})

test('sound: a hush that throws does not stop the others being asked', () => {
  let asked = false
  const off = [
    onSoundTaken('radio', () => {
      throw new Error('boom')
    }),
    onSoundTaken('studio', () => {
      asked = true
    }),
  ]
  try {
    setPlaying('tv-spot', true)
    assert.equal(asked, true)
  } finally {
    off.forEach((f) => f())
    setPlaying('tv-spot', false)
  }
})

test('sound: an old undo does not remove a newer hush', () => {
  let newer = 0
  const old = onSoundTaken('studio', () => undefined)
  const off = onSoundTaken('studio', () => {
    newer += 1
  })
  old()
  try {
    setPlaying('radio', true)
    assert.equal(newer, 1)
  } finally {
    off()
    setPlaying('radio', false)
  }
  assert.equal(ownerOf('tv-youtube'), 'tv')
  assert.equal(ownerOf('radio'), 'radio')
})

/* ---------- dead tapes ---------- */

test('tapes: dead tapes back off, then stop once the whole list has failed', () => {
  let run = tapePlayed()
  const waits: number[] = []
  for (;;) {
    const r = tapeDied(run, 6)
    run = r.run
    if (r.step.give === 'up') break
    waits.push(r.step.afterMs)
  }
  assert.deepEqual(waits, [0, 3000, 6000, 12000, 24000])
  assert.equal(run.streak, 6)
})

test('tapes: the wait is capped, a playing tape resets the run, and one tape gives up at once', () => {
  const r = tapeDied({ streak: 40 }, 100)
  assert.equal(r.step.give === 'next' && r.step.afterMs, DEAD_MAX_MS)
  assert.deepEqual(tapePlayed(), { streak: 0 })
  assert.equal(tapeDied(tapePlayed(), 1).step.give, 'up')
  assert.equal(tapeDied(tapePlayed(), 0).step.give, 'up')
})

/* ---------- outside data shapes ---------- */

test('tv live: kick that is not a list is no streams; broken entries go', () => {
  assert.deepEqual(readTvLive({ ids: { a: 'x' }, kick: { slug: 'n' } }).kick, [])
  assert.deepEqual(readTvLive(null), { ids: {}, kick: [], kickChecked: undefined })
  const live = readTvLive({
    ids: { lofi: 'abc', bad: 5 },
    kick: [{ slug: 'miya', label: 'Miya', viewers: 3 }, { slug: 4 }, null, { slug: 'b' }],
    kickChecked: true,
  })
  assert.deepEqual(live.ids, { lofi: 'abc' })
  assert.deepEqual(live.kick, [
    { slug: 'miya', label: 'Miya', viewers: 3 },
    { slug: 'b', label: 'b', viewers: 0 },
  ])
  assert.equal(live.kickChecked, true)
})

test('tapes list: non-lists are empty, and only well-formed tapes stay', () => {
  assert.deepEqual(readTapeList({ tapes: 'x', pending: {}, admins: 'y' }), { tapes: [], pending: [], admins: [] })
  const l = readTapeList({
    tapes: [{ videoId: 'CpcTEPjrWpo', title: { x: 1 }, author: 'a' }, { videoId: '<script>' }, 3],
    admins: ['0xABC', 7],
  })
  assert.equal(l.tapes.length, 1)
  assert.equal(l.tapes[0]?.title, '')
  assert.deepEqual(l.admins, ['0xabc'])
})

test('iss: a reading without real numbers is no reading', () => {
  const good = { latitude: 1.5, longitude: -20, altitude: 410, velocity: 27000, footprint: 4500, timestamp: 1 }
  assert.equal(readIssPosition({ ...good, latitude: '12' }), undefined)
  assert.equal(readIssPosition(null), undefined)
  assert.equal(readIssPosition({ ...good, velocity: null }), undefined)
  const p = readIssPosition({ ...good, visibility: 3 })
  assert.equal(p?.latitude.toFixed(2), '1.50')
  assert.equal(p?.visibility, '')
  assert.deepEqual(readIssPositions({ not: 'a list' }), [])
  assert.equal(readIssPositions([good, { latitude: 1 }]).length, 1)
})

/* ---------- waveform caps ---------- */

test('waveform: big or long files are skipped, short ones wait for their length', () => {
  assert.equal(waveformPlan(WAVEFORM_MAX_BYTES + 1, 60), 'skip')
  assert.equal(waveformPlan(5_000_000, WAVEFORM_MAX_SECONDS + 1), 'skip')
  assert.equal(waveformPlan(5_000_000, undefined), 'wait')
  assert.equal(waveformPlan(5_000_000, 180), 'decode')
  assert.equal(waveformPlan(5_000_000, Number.NaN), 'skip')
})

/* ---------- capped metadata reads ---------- */

test('metadata: a declared size over the cap is refused before reading', async () => {
  let pulled = false
  const body = new ReadableStream<Uint8Array>({
    pull() {
      pulled = true
    },
  })
  const res = new Response(body, { headers: { 'content-length': '999999' } })
  assert.equal(await readCappedJson(res, 1000), undefined)
  assert.equal(pulled, false)
})

test('metadata: an endless body stops at the cap', async () => {
  let bytes = 0
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      bytes += 500
      c.enqueue(new Uint8Array(500).fill(32))
    },
  })
  assert.equal(await readCappedJson(new Response(body), 2000), undefined)
  assert.ok(bytes <= 3000, `read ${bytes} bytes`)
})

test('metadata: small JSON reads, junk is undefined', async () => {
  assert.deepEqual(await readCappedJson(new Response('{"name":"x"}'), 1000), { name: 'x' })
  assert.equal(await readCappedJson(new Response('not json'), 1000), undefined)
})
