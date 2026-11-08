// api/_lib/station.ts: per-client daily caps, single-use signatures, signed cover and length, and the cached listing.
// Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { verifyMessage } from 'viem'

import { memoryCache } from '../api/_lib/market.ts'
import {
  addMessage,
  capReached,
  clientTag,
  handleStationRequest,
  LIST_CACHE_MS,
  MAX_PER_CLIENT_PER_DAY,
  memoryStore,
  removeMessage,
  stationListKey,
} from '../api/_lib/station.ts'

const ORIGIN = 'https://www.miyamaker.com'
const IMAGE = 'i'.repeat(43)
const T = 1_800_000_000_000
const id = (i: number) => String(i).padStart(43, 'x')

function setup() {
  const store = memoryStore()
  let now = T
  let ip = '198.51.100.1'
  let reads = 0
  const deps = {
    store: {
      ...store,
      list: async (...a: Parameters<typeof store.list>) => {
        reads += 1
        return store.list(...a)
      },
    },
    admins: [],
    verify: (wallet: string, message: string, signature: string) =>
      verifyMessage({ address: wallet as `0x${string}`, message, signature: signature as `0x${string}` }).catch(() => false),
    contentType: async (txId: string) => (txId === IMAGE ? 'image/png' : 'audio/mpeg'),
    sameOrigin: () => true,
    clientKey: () => ip,
    limiter: () => true,
    listCache: memoryCache(() => now),
    now: () => now,
  }
  const post = async (path: string, body: unknown) => {
    const r = await handleStationRequest(
      { method: 'POST', url: `${ORIGIN}/api/station${path}`, headers: new Headers(), body: JSON.stringify(body) },
      deps
    )
    return { status: r.status, body: (await r.json()) as any }
  }
  const get = async (query = '') => {
    const r = await handleStationRequest({ method: 'GET', url: `${ORIGIN}/api/station${query}`, headers: new Headers() }, deps)
    return { status: r.status, body: (await r.json()) as any }
  }
  return {
    deps,
    post,
    get,
    reads: () => reads,
    advance: (ms: number) => (now += ms),
    setIp: (v: string) => (ip = v),
    now: () => now,
  }
}

test('a cap is reached per wallet, per client, or in all', () => {
  const caps = { wallet: 10, client: 20, all: 200 }
  assert.equal(capReached({ wallet: 9, client: 19, all: 199 }, caps), undefined)
  assert.equal(capReached({ wallet: 10, client: 0, all: 0 }, caps), 'wallet')
  assert.equal(capReached({ wallet: 0, client: 20, all: 0 }, caps), 'client')
  assert.equal(capReached({ wallet: 0, client: 0, all: 200 }, caps), 'all')
})

test('the client key is stored hashed, the same for the station and public access, and never for "unknown"', async () => {
  const a = await clientTag('198.51.100.1')
  assert.match(a!, /^[0-9a-f]{32}$/)
  assert.ok(!a!.includes('198'))
  assert.equal(await clientTag('198.51.100.1'), a)
  assert.notEqual(await clientTag('198.51.100.2'), a)
  assert.equal(await clientTag('unknown'), undefined)
})

test('one client with many wallets cannot take the whole day', async () => {
  const s = setup()
  const add = async (i: number) => {
    const who = privateKeyToAccount(generatePrivateKey())
    const fields = { txId: id(i), title: 't', artist: 'a', wallet: who.address, at: s.now() - i }
    return s.post('/add', { ...fields, signature: await who.signMessage({ message: addMessage(fields) }) })
  }
  for (let i = 0; i < MAX_PER_CLIENT_PER_DAY; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await add(i)).status, 200)
  }
  const over = await add(MAX_PER_CLIENT_PER_DAY)
  assert.equal(over.status, 429)
  assert.match(over.body.error, /one place/)
  s.setIp('203.0.113.5')
  assert.equal((await add(MAX_PER_CLIENT_PER_DAY + 1)).status, 200, 'another client is not held back')
})

test('a signature works once: sending the same request again is refused', async () => {
  const s = setup()
  const who = privateKeyToAccount(generatePrivateKey())
  const fields = { txId: id(1), title: 't', artist: 'a', wallet: who.address, at: T }
  const add = { ...fields, signature: await who.signMessage({ message: addMessage(fields) }) }
  assert.equal((await s.post('/add', add)).status, 200)
  const rm = { txId: id(1), wallet: who.address, at: T }
  const remove = { ...rm, signature: await who.signMessage({ message: removeMessage(rm) }) }
  assert.equal((await s.post('/remove', remove)).status, 200)
  // The track is free to add again, but not with the copied request.
  const again = await s.post('/add', add)
  assert.equal(again.status, 409)
  assert.match(again.body.error, /already used/)
})

test('the add signature covers the cover and the length', async () => {
  const s = setup()
  const who = privateKeyToAccount(generatePrivateKey())
  const fields = { txId: id(1), title: 't', artist: 'a', artworkId: IMAGE, duration: 183.25, wallet: who.address, at: T }
  const message = addMessage(fields)
  assert.match(message, /Cover: ar:\/\/i+\nLength: 183.25 seconds\n/)
  const signature = await who.signMessage({ message })
  assert.equal((await s.post('/add', { ...fields, duration: 99, signature })).status, 401, 'a changed length')
  const ok = await s.post('/add', { ...fields, signature })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.track.artworkId, IMAGE)
  assert.equal(ok.body.track.duration, 183.25)
})

test('a page that signs only the words still adds, but without the cover or length it did not sign', async () => {
  const s = setup()
  const who = privateKeyToAccount(generatePrivateKey())
  const words = { txId: id(1), title: 't', artist: 'a', wallet: who.address, at: T }
  const signature = await who.signMessage({ message: addMessage(words) })
  const r = await s.post('/add', { ...words, artworkId: IMAGE, duration: 60, signature })
  assert.equal(r.status, 200)
  assert.equal(r.body.track.artworkId, undefined)
  assert.equal(r.body.track.duration, undefined)
})

test('the listing is cached for a few seconds under a key made-up params cannot change, and a write clears it', async () => {
  assert.equal(stationListKey(new URL(`${ORIGIN}/api/station?x=1`)), stationListKey(new URL(`${ORIGIN}/api/station`)))
  assert.notEqual(
    stationListKey(new URL(`${ORIGIN}/api/station?before=1_${id(1)}`)),
    stationListKey(new URL(`${ORIGIN}/api/station`))
  )
  const s = setup()
  await s.get()
  await s.get('?x=1')
  assert.equal(s.reads(), 1)
  s.advance(LIST_CACHE_MS)
  await s.get()
  assert.equal(s.reads(), 2)

  const who = privateKeyToAccount(generatePrivateKey())
  const fields = { txId: id(1), title: 't', artist: 'a', wallet: who.address, at: s.now() }
  await s.post('/add', { ...fields, signature: await who.signMessage({ message: addMessage(fields) }) })
  assert.equal((await s.get()).body.tracks.length, 1, 'the new track shows at once')
})

test('GETs are rate limited too', async () => {
  const s = setup()
  const deps = { ...s.deps, readLimiter: () => false }
  const r = await handleStationRequest({ method: 'GET', url: `${ORIGIN}/api/station`, headers: new Headers() }, deps)
  assert.equal(r.status, 429)
})
