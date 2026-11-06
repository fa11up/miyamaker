// api/_lib/tvlive.ts: which stream each YouTube channel plays, within YouTube's daily quota. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { handleTvLiveRequest, LIVE_TARGETS, RECHECK_MS } from '../api/_lib/tvlive.ts'
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
