// api/_lib/publicaccess.ts: per-client daily cap, single-use signatures and the cached listing. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { memoryCache } from '../api/_lib/market.ts'
import type { PublicAccessDeps } from '../api/_lib/publicaccess.ts'
import {
  handlePublicAccessRequest,
  LIST_CACHE_MS,
  MAX_PER_CLIENT_PER_DAY,
  memoryTapeStore,
  submitMessage,
} from '../api/_lib/publicaccess.ts'

const NOW = 1_800_000_000_000
const wallet = (i: number) => `0x${String(i).padStart(40, '0')}`
const video = (i: number) => `vid${String(i).padStart(8, '0')}`

function setup(over: Partial<PublicAccessDeps> = {}) {
  let now = NOW
  let ip = '198.51.100.1'
  const store = memoryTapeStore()
  let reads = 0
  const deps: PublicAccessDeps = {
    store: {
      ...store,
      listApproved: (n) => {
        reads += 1
        return store.listApproved(n)
      },
    },
    admins: [],
    verify: async (_w, message, signature) => message === signature,
    lookup: async () => ({ title: 'tape', author: 'someone' }),
    sameOrigin: () => true,
    clientKey: () => ip,
    limiter: () => true,
    listCache: memoryCache(() => now),
    now: () => now,
    ...over,
  }
  const call = async (path: string, body?: unknown) => {
    const res = await handlePublicAccessRequest(
      {
        method: body ? 'POST' : 'GET',
        url: `https://x.test/api/public-access${path}${body ? '' : '?bust=' + Math.random()}`,
        headers: new Headers(),
        body: body ? JSON.stringify(body) : undefined,
      },
      deps
    )
    return { status: res.status, json: (await res.json()) as any }
  }
  const submit = (i: number, w = wallet(i), at = now - i) =>
    call('/submit', { videoId: video(i), wallet: w, at, signature: submitMessage({ videoId: video(i), wallet: w, at }) })
  return { call, submit, reads: () => reads, setIp: (v: string) => (ip = v), advance: (ms: number) => (now += ms) }
}

test('one client with many wallets has a daily cap', async () => {
  const s = setup()
  for (let i = 0; i < MAX_PER_CLIENT_PER_DAY; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await s.submit(i)).status, 200)
  }
  const over = await s.submit(MAX_PER_CLIENT_PER_DAY)
  assert.equal(over.status, 429)
  assert.match(over.json.error, /one place/)
  s.setIp('203.0.113.5')
  assert.equal((await s.submit(MAX_PER_CLIENT_PER_DAY + 1)).status, 200)
})

test('a signature works once', async () => {
  const s = setup()
  const body = { videoId: video(1), wallet: wallet(1), at: NOW, signature: submitMessage({ videoId: video(1), wallet: wallet(1), at: NOW }) }
  assert.equal((await s.call('/submit', body)).status, 200)
  const again = await s.call('/submit', body)
  assert.equal(again.status, 409)
  assert.match(again.json.error, /already used/)
})

test('the listing is cached whatever the query, cleared by a write, and rate limited', async () => {
  const s = setup()
  await s.call('')
  await s.call('')
  assert.equal(s.reads(), 1)
  s.advance(LIST_CACHE_MS)
  await s.call('')
  assert.equal(s.reads(), 2)
  await s.submit(1)
  await s.call('')
  assert.equal(s.reads(), 3, 'read fresh after a send')
  assert.equal((await setup({ readLimiter: () => false }).call('')).status, 429)
})
