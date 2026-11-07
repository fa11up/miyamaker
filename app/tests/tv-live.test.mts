// api/_lib/tvlive.ts: which stream each YouTube channel plays, within YouTube's daily quota. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { handleTvLiveRequest, LIVE_TARGETS, RECHECK_MS, REFUSED_PAUSE_MS, SEARCH_BACKOFF_MAX_MS } from '../api/_lib/tvlive.ts'
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

const ask = async (deps: Parameters<typeof handleTvLiveRequest>[1]) =>
  ((await (await handleTvLiveRequest({ method: 'GET' }, deps)).json()) as { ids: Record<string, string> }).ids

/** A pretend YouTube: `live` lists what is on air, and calls are counted by quota cost. */
const youtube = (live: string[], search: Record<string, string> = {}) => {
  const y = {
    cost: 0,
    down: false,
    read: async (path: string, q: Record<string, string>) => {
      if (y.down) throw new Error('YouTube 500')
      if (path === '/videos') {
        y.cost += 1
        return {
          items: q.id!.split(',').map((id) => ({
            id,
            snippet: { liveBroadcastContent: live.includes(id) ? 'live' : 'none' },
            status: { embeddable: true },
          })),
        }
      }

      y.cost += 100
      const hit = search[q.channelId!]
      return { items: hit ? [{ id: { videoId: hit } }] : [] }
    },
  }
  return y
}

test('the server and the channel list start from the same streams', () => {
  for (const t of LIVE_TARGETS) {
    const c = CHANNELS.find((x) => x.id === t.id)
    const s = c?.kind === 'iframe' ? c.sources[0] : undefined
    assert.equal(s?.provider === 'youtube' ? s.videoId : undefined, t.fallback, t.id)
  }
})

test('with no key the fixed streams stand', async () => {
  const ids = await ask({ cache: memory() })
  assert.equal(ids.lofi, 'rFZHOHl-L8A')
})

test('streams still on air cost one unit, and the answer is shared for 10 minutes', async () => {
  const y = youtube(LIVE_TARGETS.map((t) => t.fallback))
  let now = 1000
  const deps = { cache: memory(), youtube: y.read, now: () => now }
  await ask(deps)
  await ask(deps)
  assert.equal(y.cost, 1)
  now += RECHECK_MS
  await ask(deps)
  assert.equal(y.cost, 2)
})

test('a stream that stopped is replaced, and the new id is remembered so it is not searched again', async () => {
  const [lofi, monterey, iss] = LIVE_TARGETS
  const y = youtube([monterey!.fallback, iss!.fallback, 'newLofi1234'], { [lofi!.channelId]: 'newLofi1234' })
  let now = 1000
  const deps = { cache: memory(), youtube: y.read, now: () => now }
  assert.equal((await ask(deps)).lofi, 'newLofi1234')
  assert.equal(y.cost, 101)
  now += RECHECK_MS
  assert.equal((await ask(deps)).lofi, 'newLofi1234')
  assert.equal(y.cost, 102)
})

test('when YouTube is down or finds nothing, the last known ids stand', async () => {
  const y = youtube([])
  const deps = { cache: memory(), youtube: y.read, now: () => 1000 }
  assert.equal((await ask(deps)).iss, 'ROboUHfPUrU')
  const down = youtube([])
  down.down = true
  assert.equal((await ask({ cache: memory(), youtube: down.read })).iss, 'ROboUHfPUrU')
})

const body = async (deps: Parameters<typeof handleTvLiveRequest>[1]) => {
  const res = await handleTvLiveRequest({ method: 'GET' }, deps)
  assert.equal(res.status, 200)
  return (await res.json()) as { ids: Record<string, string>; kick: unknown[]; kickChecked: boolean }
}

test('a stopped stream that search cannot find waits longer each time, and the day stays inside the quota', async () => {
  const y = youtube([])
  let now = 1000
  const deps = { cache: memory(), youtube: y.read, now: () => now }
  await ask(deps)
  assert.equal(y.cost, 301, 'every stream searched once')
  now += RECHECK_MS
  await ask(deps)
  assert.equal(y.cost, 302, 'only the id check, the searches are waiting')
  now += RECHECK_MS
  await ask(deps)
  assert.equal(y.cost, 603, 'searched again after 20 minutes')
  now += RECHECK_MS
  await ask(deps)
  assert.equal(y.cost, 604, 'and now waiting 40')

  const day = youtube([])
  const dayDeps = { cache: memory(), youtube: day.read, now: () => now }
  for (let i = 0; i < 144; i += 1) {
    now += RECHECK_MS
    // eslint-disable-next-line no-await-in-loop
    await ask(dayDeps)
  }
  assert.ok(day.cost < 3000, `${day.cost} units in a day`)

  const steady = youtube([])
  const steadyDeps = { cache: memory(), youtube: steady.read, now: () => now }
  for (let i = 0; i < 144 * 3; i += 1) {
    now += RECHECK_MS
    // eslint-disable-next-line no-await-in-loop
    await ask(steadyDeps)
  }
  const before = steady.cost
  for (let i = 0; i < SEARCH_BACKOFF_MAX_MS / RECHECK_MS; i += 1) {
    now += RECHECK_MS
    // eslint-disable-next-line no-await-in-loop
    await ask(steadyDeps)
  }
  assert.equal(steady.cost - before, 336, 'at the cap: three searches and an id check each ten minutes')
})

test('finding the stream or seeing it back on air ends the backoff', async () => {
  const [lofi] = LIVE_TARGETS
  const live: string[] = []
  const search: Record<string, string> = {}
  const y = youtube(live, search)
  let now = 1000
  const deps = { cache: memory(), youtube: y.read, now: () => now }
  await ask(deps)
  search[lofi!.channelId] = 'newLofi1234'
  live.push('newLofi1234')
  now += 2 * RECHECK_MS
  assert.equal((await ask(deps)).lofi, 'newLofi1234')

  // Off again: searched at once rather than still waiting from before.
  live.length = 0
  delete search[lofi!.channelId]
  const cost = y.cost
  now += 2 * RECHECK_MS
  await ask(deps)
  assert.equal(y.cost - cost, 101)
})

const refusing = (when: (path: string) => boolean) => {
  const y = youtube([])
  const read = y.read
  y.read = async (path, q) => {
    if (when(path)) {
      y.cost += 1
      throw Object.assign(new Error('YouTube 403'), { refused: true })
    }
    return read(path, q)
  }
  return y
}

test('a spent quota stops everything for a while, whichever call hears it', async () => {
  for (const when of [(p: string) => p === '/videos', (p: string) => p === '/search']) {
    const y = refusing(when)
    let now = 1000
    const deps = { cache: memory(), youtube: (p: string, q: Record<string, string>) => y.read(p, q), now: () => now }
    await ask(deps)
    const cost = y.cost
    now += RECHECK_MS
    assert.equal((await ask(deps)).iss, 'ROboUHfPUrU')
    assert.equal(y.cost, cost, 'nothing asked during the pause')
    now += REFUSED_PAUSE_MS
    await ask(deps)
    assert.ok(y.cost > cost, 'asks again afterwards')
  }
})

test('a refused search does not lengthen the wait for that stream', async () => {
  const y = refusing((p) => p === '/search')
  let now = 1000
  const deps = { cache: memory(), youtube: (p: string, q: Record<string, string>) => y.read(p, q), now: () => now }
  await ask(deps)
  now += REFUSED_PAUSE_MS
  const cost = y.cost
  await ask(deps)
  assert.equal(y.cost - cost, 4, 'the id check and all three searches')
})

test('a broken cache cannot break the route or spend the quota', async () => {
  const y = youtube([])
  const boom = async () => {
    throw new Error('cache down')
  }
  const r = await body({ cache: { get: boom, put: boom }, youtube: y.read, now: () => 1000 })
  assert.equal(r.ids.iss, 'ROboUHfPUrU')
  assert.equal(y.cost, 0)
  const unsaved = await body({ cache: { get: async () => undefined, put: boom }, youtube: y.read, now: () => 1000 })
  assert.equal(unsaved.ids.iss, 'ROboUHfPUrU')
})

test('kick: a failure leaves the youtube ids, and could-not-check differs from nobody-on', async () => {
  const failed = await body({
    cache: memory(),
    kick: async () => {
      throw new Error('kick down')
    },
  })
  assert.equal(failed.ids.lofi, 'rFZHOHl-L8A')
  assert.deepEqual(failed.kick, [])
  assert.equal(failed.kickChecked, false)

  const none = await body({ cache: memory(), kick: async () => ({ streams: [], checked: true }) })
  assert.deepEqual(none.kick, [])
  assert.equal(none.kickChecked, true)
  assert.equal((await body({ cache: memory() })).kickChecked, false)
})

test('the ids are kept for longer than any quiet spell', async () => {
  let kept = 0
  const cache = {
    get: async () => undefined,
    put: async (_k: string, _v: unknown, ttl?: number) => {
      kept = ttl ?? 0
    },
  }
  await ask({ cache, youtube: youtube([]).read, now: () => 1000 })
  assert.ok(kept >= 86_400, `${kept}s`)
})
