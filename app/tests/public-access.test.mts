// api/_lib/publicaccess.ts: miyatv's public access channel, nothing airs unreviewed. Run: yarn test
import assert from 'node:assert/strict'
import { statSync } from 'node:fs'
import { test } from 'node:test'

import type { PublicAccessDeps } from '../api/_lib/publicaccess.ts'
import {
  airList,
  handlePublicAccessRequest,
  HOUSE_TAPES,
  memoryTapeStore,
  parseYouTubeId,
  PUBLIC_ACCESS_PATH,
  reviewMessage,
  submitMessage,
} from '../api/_lib/publicaccess.ts'

import { BREAK_EVERY_MS, COMMERCIALS, isBreakDue, nextSpotIndex } from '../src/pages/TV/commercials.ts'

const ADMIN = '0x5167D014a056E43883e1BBEa5530c3c0dC993281'
const ME = `0x${'a'.repeat(40)}`
const OTHER = `0x${'b'.repeat(40)}`
const ID = 'dQw4w9WgXcQ'
const NOW = 1_800_000_000_000

const setup = (extra: Partial<PublicAccessDeps> = {}) => {
  const deps: PublicAccessDeps = {
    store: memoryTapeStore(),
    admins: [ADMIN],
    // A signature is valid when it is literally the words it signs.
    verify: async (_w, message, signature) => message === signature,
    lookup: async () => ({ title: 'A‮ tape', author: 'someone' }),
    sameOrigin: () => true,
    clientKey: () => 'k',
    limiter: () => true,
    now: () => NOW,
    ...extra,
  }
  const call = async (path: string, body?: unknown) => {
    const res = await handlePublicAccessRequest(
      {
        method: body ? 'POST' : 'GET',
        url: `https://x.test${PUBLIC_ACCESS_PATH}${path}`,
        headers: new Headers(),
        body: body ? JSON.stringify(body) : undefined,
      },
      deps
    )
    return { status: res.status, json: (await res.json()) as any }
  }

  // Every signature is used once, so each one is made at its own millisecond, just before now.
  let signed = 0
  const submit = (wallet = ME, videoId = ID, at = NOW - (signed += 1)) =>
    call('/submit', { videoId, wallet, at, signature: submitMessage({ videoId, wallet, at }) })
  const review = (decision: string, wallet = ADMIN, videoId = ID, at = NOW - (signed += 1)) =>
    call('/review', {
      videoId,
      decision,
      wallet,
      at,
      signature: reviewMessage({ videoId, decision, wallet, at }),
    })
  return { call, submit, review, store: deps.store! }
}

test('reads the id out of the usual YouTube links, and nothing else', () => {
  for (const link of [
    `https://www.youtube.com/watch?v=${ID}&t=3`,
    `https://youtu.be/${ID}?si=x`,
    `https://youtube.com/live/${ID}`,
    `https://m.youtube.com/shorts/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ])
    assert.equal(parseYouTubeId(link), ID, link)
  for (const link of ['nope', `https://evil.example/watch?v=${ID}`, 'https://youtube.com/watch?v=short', 'https://youtube.com/@x'])
    assert.equal(parseYouTubeId(link), undefined, link)
})

test('a tape waits for review, and only an admin can put it on air', async () => {
  const { call, submit, review } = setup()
  assert.equal((await submit()).status, 200)
  let list = (await call('')).json
  assert.equal(list.tapes.length, 0)
  assert.equal(list.pending[0].title, 'A tape', 'control characters are stripped')
  assert.equal((await review('approve', OTHER)).status, 403)
  assert.equal((await review('approve')).status, 200)
  list = (await call('')).json
  assert.equal(list.tapes[0].videoId, ID)
  assert.equal(list.pending.length, 0)
})

test('whoever sent it or an admin can remove it; only an admin removal keeps it refused', async () => {
  const { submit, review, call } = setup()
  await submit()
  assert.equal((await review('remove', OTHER)).status, 403)
  assert.equal((await review('remove', ME)).status, 200)
  assert.equal((await call('')).json.pending.length, 0)

  // Anyone can send it again: no wallet can block a video by sending and removing it.
  assert.equal((await submit(OTHER)).status, 200)
  assert.equal((await call('')).json.pending[0].submitter, OTHER)
  assert.equal((await review('remove')).status, 200)
  const refused = await submit()
  assert.equal(refused.status, 409)
  assert.match(refused.json.error, /removed/)
})

test('an admin removing their own submission is still a block', async () => {
  const { submit, review } = setup()
  await submit(ADMIN)
  assert.equal((await review('remove', ADMIN)).status, 200)
  assert.equal((await submit()).status, 409)
})

test('a tape taken back and sent again goes through review again, and keeps its place', async () => {
  const { submit, review, call, store } = setup()
  await store.insert({ videoId: 'abcdefghij0', title: 't', author: 'a', submitter: OTHER, submittedAt: NOW - 1 })
  await store.insert({ videoId: ID, title: 't', author: 'a', submitter: ME, submittedAt: NOW - 2 })
  await store.approve(ID, NOW - 1)
  assert.equal((await call('')).json.tapes.length, 1)
  await review('remove', ME)
  assert.equal((await submit()).status, 200)
  const list = (await call('')).json
  assert.equal(list.tapes.length, 0, 'not back on air by itself')
  assert.deepEqual(
    list.pending.map((t: { videoId: string }) => t.videoId),
    ['abcdefghij0', ID]
  )
})

test('only an admin can restore, only a block, and it comes back where it was', async () => {
  const { submit, review, call } = setup()
  await submit()
  await review('approve')
  await review('remove')
  assert.equal((await review('restore', ME)).status, 403)
  assert.equal((await review('restore')).status, 200)
  assert.equal((await call('')).json.tapes[0].videoId, ID)
  assert.equal((await review('restore')).status, 404, 'nothing to restore')

  const taken = setup()
  await taken.submit()
  await taken.review('remove', ME)
  assert.equal((await taken.review('restore')).status, 404, 'taken back by its sender, so not put back on air')
  assert.equal((await taken.submit()).status, 200)
})

test('new submissions push nothing off the air or out of the queue', async () => {
  const { call, store } = setup()
  const tape = (i: number) => ({
    videoId: String(i).padStart(11, 'x'),
    title: 't',
    author: 'a',
    submitter: ME,
    submittedAt: NOW + i,
  })
  await store.insert(tape(0))
  await store.approve(tape(0).videoId, NOW)
  await store.insert(tape(1))
  for (let i = 2; i < 150; i += 1) await store.insert(tape(i))
  const list = (await call('')).json
  assert.equal(list.tapes[0].videoId, tape(0).videoId, 'the old approved tape is still on air')
  assert.equal(list.pending.length, 100)
  assert.equal(list.pending[99].videoId, tape(1).videoId, 'the longest waiting is still in the queue')
  assert.ok(list.pending[0].submittedAt > list.pending[99].submittedAt, 'newest first, as the page shows it')
})

test('refuses bad signatures, stale ones, duplicates and what YouTube will not embed', async () => {
  const { call, submit } = setup()
  assert.equal((await call('/submit', { videoId: ID, wallet: ME, at: NOW, signature: 'forged' })).status, 401)
  const old = NOW - 3_600_000
  assert.equal((await call('/submit', { videoId: ID, wallet: ME, at: old, signature: submitMessage({ videoId: ID, wallet: ME, at: old }) })).status, 400)
  assert.equal((await submit()).status, 200)
  assert.equal((await submit()).status, 409)
  const blocked = setup({ lookup: async () => undefined })
  assert.equal((await blocked.submit()).status, 400)
})

test('a wallet is held to its daily limit', async () => {
  const { submit } = setup()
  for (let i = 0; i < 5; i += 1) assert.equal((await submit(ME, `abcdefghij${i}`)).status, 200)
  assert.equal((await submit(ME, 'abcdefghij9')).status, 429)
})

test('the house tapes always air first, with no duplicates, and cannot be sent in again', async () => {
  assert.equal(airList()[0]?.title, 'Miyamaker and Milady Bootcamp')
  const mine = { ...HOUSE_TAPES[0]!, videoId: ID, title: 'mine' }
  assert.deepEqual(
    airList([HOUSE_TAPES[0]!, mine]).map((t) => t.videoId),
    [...HOUSE_TAPES.map((t) => t.videoId), ID]
  )
  const { submit } = setup()
  assert.equal((await submit(ME, HOUSE_TAPES[0]!.videoId)).status, 409)
})

test('commercials: at most every half hour, taking turns', () => {
  assert.equal(isBreakDue(NOW, undefined, 2), true)
  assert.equal(isBreakDue(NOW, { at: NOW - BREAK_EVERY_MS + 1, index: 0 }, 2), false)
  assert.equal(isBreakDue(NOW, { at: NOW - BREAK_EVERY_MS, index: 0 }, 2), true)
  assert.equal(isBreakDue(NOW, undefined, 0), false)
  assert.equal(nextSpotIndex(undefined, 2), 0)
  assert.equal(nextSpotIndex({ at: 0, index: 0 }, 2), 1)
  assert.equal(nextSpotIndex({ at: 0, index: 1 }, 2), 0)
})

test('every film is on the site and small enough for Cloudflare to serve', () => {
  for (const spot of COMMERCIALS) {
    if (spot.kind !== 'video') continue
    const { size } = statSync(new URL(`../public${spot.src}`, import.meta.url))
    assert.ok(size < 25 * 1024 * 1024, `${spot.src} is ${size} bytes`)
  }
})
