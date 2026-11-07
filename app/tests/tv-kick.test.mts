// api/_lib/tvkick.ts: miyatv's Kick channel only offers streams that are on. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  chooseStreams,
  KICK_RECHECK_MS,
  KICK_STALE_LIMIT_MS,
  kickOnAir,
  LISTED_KICK,
  suitableStreams,
} from '../api/_lib/tvkick.ts'
import { CHANNELS } from '../src/pages/TV/channels.ts'

const memory = () => {
  const m = new Map<string, { at: number; body: unknown }>()
  return {
    get: async (k: string) => m.get(k),
    put: async (k: string, v: { at: number; body: unknown }) => {
      m.set(k, v)
    },
  }
}

const row = (slug: string, viewer_count: number, extra: Record<string, unknown> = {}) => ({
  is_live: true,
  is_mature: false,
  language: 'English',
  viewer_count,
  categories: [{ name: 'Just Chatting' }],
  channel: { slug, user: { username: slug.toUpperCase() } },
  ...extra,
})

const stream = (slug: string, viewers: number) => ({ slug, label: slug, viewers })

test('leaves out adult-flagged, gambling, trading, foreign-language and malformed streams', () => {
  const top = {
    data: [
      row('fine', 100),
      row('adult', 90, { is_mature: true }),
      row('slots', 80, { categories: [{ name: 'Slots & Casino' }] }),
      row('trading', 70, { categories: [{ name: 'Crypto & Trading' }] }),
      row('japanese', 60, { language: 'Japanese' }),
      row('over', 50, { is_live: false }),
      row('bad/slug', 40),
    ],
  }
  assert.deepEqual(
    suitableStreams(top).map((s) => s.slug),
    ['fine'],
  )
  assert.deepEqual(suitableStreams(undefined), [])
})

test('listed creators who are on come first, the most-watched fill the rest, biggest first', () => {
  const chosen = chooseStreams(
    [stream('chessbrah', 500)],
    [stream('a', 9000), stream('b', 8000), stream('c', 7000), stream('chessbrah', 500)],
  )
  assert.deepEqual(
    chosen.map((s) => s.slug),
    ['a', 'b', 'chessbrah'],
  )
})

test('with nobody listed on, still offers the top streams', () => {
  assert.equal(chooseStreams([], [stream('a', 3), stream('b', 2), stream('c', 1), stream('d', 0)]).length, 3)
})

const reader =
  (top: unknown, live: string[] = []) =>
  async (url: string) => {
    if (url.includes('/stream/livestreams/')) return top
    const slug = url.split('/').pop()!
    return { user: { username: slug }, livestream: live.includes(slug) ? { is_live: true, viewer_count: 5 } : null }
  }

const slugs = (a: { streams: { slug: string }[] }) => a.streams.map((s) => s.slug)
const down = async () => {
  throw new Error('Kick 403')
}

test('asks Kick once per check, and keeps the last answer when Kick fails or has nothing', async () => {
  const cache = memory()
  let calls = 0
  const good = async (url: string) => {
    calls++
    return reader({ data: [row('a', 10)] })(url)
  }
  const first = await kickOnAir({ read: good, cache, now: 0 })
  assert.deepEqual(first, { streams: [{ slug: 'a', label: 'A', viewers: 10 }], checked: true })
  const used = calls
  await kickOnAir({ read: good, cache, now: KICK_RECHECK_MS - 1 })
  assert.equal(calls, used, 'cached between checks')

  const failed = await kickOnAir({ read: down, cache, now: KICK_RECHECK_MS })
  assert.deepEqual(slugs(failed), ['a'])
  assert.equal(failed.checked, false)
  const empty = await kickOnAir({ read: reader({ data: [] }), cache, now: 2 * KICK_RECHECK_MS })
  assert.deepEqual(slugs(empty), ['a'])
  assert.equal(empty.checked, false)
})

test('the last answer stands only so long: failed checks do not make it any younger', async () => {
  const cache = memory()
  await kickOnAir({ read: reader({ data: [row('a', 10)] }), cache, now: 0 })
  let now = KICK_RECHECK_MS
  for (; now < KICK_STALE_LIMIT_MS; now += KICK_RECHECK_MS) {
    assert.deepEqual(slugs(await kickOnAir({ read: down, cache, now })), ['a'], `at ${now}`)
  }
  assert.deepEqual(await kickOnAir({ read: down, cache, now }), { streams: [], checked: false })
})

test('with nothing to fall back on, a failed check says it could not check', async () => {
  assert.deepEqual(await kickOnAir({ read: down, cache: memory(), now: 0 }), { streams: [], checked: false })
})

test('a real answer that nobody suitable is on says so, at once', async () => {
  const cache = memory()
  await kickOnAir({ read: reader({ data: [row('a', 10)] }), cache, now: 0 })
  const none = await kickOnAir({ read: reader({ data: [row('adult', 9, { is_mature: true })] }), cache, now: KICK_RECHECK_MS })
  assert.deepEqual(none, { streams: [], checked: true })
})

test('part of an answer does not replace a full list', async () => {
  const cache = memory()
  const full = await kickOnAir({
    read: reader({ data: [row('a', 30), row('b', 20), row(LISTED_KICK[1]!, 10)] }),
    cache,
    now: 0,
  })
  assert.equal(full.streams.length, 3)

  // The top list fails; one listed creator answers that they're on, and another that they're off.
  const listed0 = LISTED_KICK[0]!
  const read = async (url: string) => {
    if (url.includes('/stream/livestreams/')) throw new Error('Kick 403')
    return reader({}, [listed0])(url)
  }
  const partial = await kickOnAir({ read, cache, now: KICK_RECHECK_MS })
  assert.equal(partial.checked, false)
  assert.ok(slugs(partial).includes(listed0), 'known to be on')
  assert.ok(slugs(partial).includes('a'), 'kept from the last full list')
  assert.ok(!slugs(partial).includes(LISTED_KICK[1]!), 'known to be off')
})

test('nobody suitable while a listed creator could not be asked is not "nobody on"', async () => {
  const read = async (url: string) => {
    if (url.includes(LISTED_KICK[0]!)) throw new Error('Kick 500')
    return reader({ data: [row('adult', 9, { is_mature: true })] })(url)
  }
  assert.deepEqual(await kickOnAir({ read, cache: memory(), now: 0 }), { streams: [], checked: false })
})

test('a broken cache costs no calls to Kick and fails nothing', async () => {
  let calls = 0
  const cache = {
    get: async () => {
      throw new Error('cache down')
    },
    put: async () => {
      throw new Error('cache down')
    },
  }
  const read = async () => {
    calls++
    return {}
  }
  assert.deepEqual(await kickOnAir({ read, cache, now: 0 }), { streams: [], checked: false })
  assert.equal(calls, 0)
  const unsaved = { get: async () => undefined, put: cache.put }
  assert.deepEqual(slugs(await kickOnAir({ read: reader({ data: [row('a', 1)] }), cache: unsaved, now: 0 })), ['a'])
})

test('a listed creator who is on is found even when not in the top list', async () => {
  const slug = LISTED_KICK[0]!
  const answer = await kickOnAir({ read: reader({ data: [] }, [slug]), cache: memory(), now: 0 })
  assert.deepEqual(slugs(answer), [slug])
  assert.equal(answer.checked, false, 'the top list told us nothing')
})

test("the listed creators are the Kick channel's sources", () => {
  const sources = CHANNELS.flatMap((c) => (c.kind === 'iframe' ? c.sources : []))
  assert.deepEqual(
    LISTED_KICK,
    sources.flatMap((s) => (s.provider === 'kick' ? [s.slug] : [])),
  )
})

test('without a reader there is nothing to offer, and the page uses its own list', async () => {
  assert.deepEqual(await kickOnAir({ cache: memory(), now: 0 }), { streams: [], checked: false })
})
