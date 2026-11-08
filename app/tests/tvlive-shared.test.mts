// api/_lib/sharedstate.ts with tvlive.ts / tvkick.ts: one copy and one refresh for every data centre, and the plain
// per-data-centre cache while the D1 table is missing. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { memoryCache } from '../api/_lib/market.ts'
import { memorySharedState, sharedCache, SHARED_RETRY_MS } from '../api/_lib/sharedstate.ts'
import type { SharedState } from '../api/_lib/sharedstate.ts'
import { KICK_RECHECK_MS, kickOnAir } from '../api/_lib/tvkick.ts'
import { handleTvLiveRequest, LIVE_TARGETS, RECHECK_MS } from '../api/_lib/tvlive.ts'

/** A YouTube where nothing is on air, so every refresh searches: cost counted in quota units. */
const youtube = () => {
  const y = {
    cost: 0,
    read: async (path: string) => {
      y.cost += path === '/videos' ? 1 : 100
      return { items: [] }
    },
  }
  return y
}
const ask = (cache: ReturnType<typeof sharedCache>, read: (p: string) => Promise<unknown>, now: number) =>
  handleTvLiveRequest({ method: 'GET' }, { cache, youtube: read as never, now: () => now })

test('two data centres share one copy: the second does not search again', async () => {
  const d1 = memorySharedState()
  let now = 1_000
  const clock = () => now
  const lisbon = sharedCache(d1, memoryCache(clock), clock)
  const tokyo = sharedCache(d1, memoryCache(clock), clock)
  const y = youtube()
  await ask(lisbon, y.read, now)
  assert.equal(y.cost, 1 + 100 * LIVE_TARGETS.length)
  await ask(tokyo, y.read, now)
  assert.equal(y.cost, 1 + 100 * LIVE_TARGETS.length, 'tokyo read the shared copy')
  now += RECHECK_MS
  await ask(tokyo, y.read, now)
  assert.equal(y.cost, 2 + 100 * LIVE_TARGETS.length, 'one id check after ten minutes, the searches back off')
})

test('while one data centre holds the lock, another answers the known ids without asking YouTube', async () => {
  const d1 = memorySharedState()
  const now = 1_000
  const clock = () => now
  assert.equal(await d1.claim('tv-live:v2', now, 60_000, now), true)
  const y = youtube()
  const res = await ask(sharedCache(d1, memoryCache(clock), clock), y.read, now)
  assert.equal(res.status, 200)
  assert.equal(y.cost, 0)
  assert.equal(((await res.json()) as { ids: Record<string, string> }).ids.lofi, LIVE_TARGETS[0]!.fallback)
})

test('a lock is not taken over an entry someone saved since it was read, and it expires', async () => {
  const d1 = memorySharedState()
  await d1.put('k', { at: 5_000, body: 1 }, 1e12)
  assert.equal(await d1.claim('k', 6_000, 1_000, 5_000), false, 'saved at 5000: fresh for this reader')
  assert.equal(await d1.claim('k', 6_000, 1_000, 5_001), true)
  assert.equal(await d1.claim('k', 6_500, 1_000, 5_001), false, 'held')
  assert.equal(await d1.claim('k', 7_000, 1_000, 5_001), true, 'held for 1000 ms only')
})

test('requests at once in one isolate share one refresh', async () => {
  const cache = memoryCache(() => 1_000)
  const y = youtube()
  await Promise.all([1, 2, 3, 4].map(() => ask(cache, y.read, 1_000)))
  assert.equal(y.cost, 1 + 100 * LIVE_TARGETS.length)
})

test('without the table (deploy before the migration) it works from the per-data-centre cache', async () => {
  const missing = Object.fromEntries(
    ['get', 'claim', 'put'].map((m) => [m, async () => Promise.reject(new Error('D1_ERROR: no such table: shared_state'))])
  ) as unknown as SharedState
  let now = 1_000
  const clock = () => now
  const cache = sharedCache(missing, memoryCache(clock), clock)
  const y = youtube()
  const warn = console.warn
  const said: string[] = []
  console.warn = (m: string) => void said.push(m)
  try {
    assert.equal((await ask(cache, y.read, now)).status, 200)
    await ask(cache, y.read, now)
  } finally {
    console.warn = warn
  }
  assert.equal(y.cost, 1 + 100 * LIVE_TARGETS.length, 'the fallback cache kept the answer')
  assert.equal(said.filter((m) => /shared_state table missing/.test(m)).length, 1, 'said once')

  // Once the migration has run, D1 is used again after a while.
  const d1 = memorySharedState()
  const real: SharedState = d1
  Object.assign(missing, { get: real.get, claim: real.claim, put: real.put })
  now += SHARED_RETRY_MS
  await cache.put('x', { at: now, body: 1 }, 60)
  assert.ok(d1.rows.has('x'))
})

test('Kick: one check for every data centre too', async () => {
  const d1 = memorySharedState()
  const now = 1_000
  const clock = () => now
  let calls = 0
  const read = async () => {
    calls += 1
    return { data: [] }
  }
  await kickOnAir({ read, cache: sharedCache(d1, memoryCache(clock), clock), now })
  const first = calls
  await kickOnAir({ read, cache: sharedCache(d1, memoryCache(clock), clock), now: now + KICK_RECHECK_MS - 1 })
  assert.equal(calls, first)
})
