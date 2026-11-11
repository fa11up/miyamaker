// The radio's community station: api/_lib/station.ts, with real signatures. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { verifyMessage } from 'viem'

import {
  addMessage,
  handleStationRequest,
  LIST_LIMIT,
  MAX_PER_DAY,
  MAX_PER_WALLET_PER_DAY,
  memoryStore,
  removeMessage,
  restoreMessage,
} from '../api/_lib/station.ts'

const ORIGIN = 'https://www.miyamaker.com'
const AUDIO = 'a'.repeat(43)
const IMAGE = 'i'.repeat(43)
const NOT_AUDIO = 'n'.repeat(43)
const uploader = privateKeyToAccount(generatePrivateKey())
const admin = privateKeyToAccount(generatePrivateKey())
const stranger = privateKeyToAccount(generatePrivateKey())
const T = 1_800_000_000_000

function setup() {
  const store = memoryStore()
  let now = T
  const deps = {
    store,
    admins: [admin.address],
    verify: (wallet: string, message: string, signature: string) =>
      verifyMessage({ address: wallet as `0x${string}`, message, signature: signature as `0x${string}` }).catch(() => false),
    contentType: async (id: string) => (id === IMAGE ? 'image/png' : id === NOT_AUDIO ? 'text/html' : 'audio/mpeg'),
    sameOrigin: (h: Headers | undefined) => h?.get('origin') === ORIGIN,
    clientKey: () => 'ip',
    limiter: () => true,
    now: () => now,
  }
  const post = async (path: string, body: unknown, origin = ORIGIN) => {
    const r = await handleStationRequest(
      { method: 'POST', url: `${ORIGIN}/api/station${path}`, headers: new Headers({ origin }), body: JSON.stringify(body) },
      deps
    )
    return { status: r.status, body: (await r.json()) as any }
  }
  const list = async () =>
    (await (await handleStationRequest({ method: 'GET', url: `${ORIGIN}/api/station`, headers: new Headers() }, deps)).json()) as any
  // Every signature is used once, so each one is made at its own millisecond, just before now.
  let signed = 0
  const at = () => now - (signed += 1)
  const add = async (who = uploader, txId = AUDIO, extra: Record<string, unknown> = {}) => {
    const fields = { txId, title: 'Night Tone', artist: 'miya', wallet: who.address, at: at(), ...extra }
    return post('/add', { ...fields, signature: await who.signMessage({ message: addMessage(fields as any) }) })
  }
  const remove = async (who: typeof uploader, txId = AUDIO) => {
    const fields = { txId, wallet: who.address, at: at() }
    return post('/remove', { ...fields, signature: await who.signMessage({ message: removeMessage(fields) }) })
  }
  const restore = async (who: typeof uploader, txId = AUDIO) => {
    const fields = { txId, wallet: who.address, at: at() }
    return post('/restore', { ...fields, signature: await who.signMessage({ message: restoreMessage(fields) }) })
  }
  return { post, list, add, remove, restore, deps, advance: (ms: number) => { now += ms } }
}

test('a signed upload is live at once', async () => {
  const s = setup()
  const r = await s.add(uploader, AUDIO, { artworkId: IMAGE, duration: 183 })
  assert.equal(r.status, 200)
  const { tracks, admins } = await s.list()
  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].title, 'Night Tone')
  assert.equal(tracks[0].artworkId, IMAGE)
  assert.equal(tracks[0].uploader, uploader.address.toLowerCase())
  assert.deepEqual(admins, [admin.address.toLowerCase()])
})

test('the signature must be the wallet, over these exact words', async () => {
  const s = setup()
  const fields = { txId: AUDIO, title: 'Night Tone', artist: 'miya', wallet: uploader.address, at: T }
  const signature = await stranger.signMessage({ message: addMessage(fields) })
  assert.equal((await s.post('/add', { ...fields, signature })).status, 401)
  const good = await uploader.signMessage({ message: addMessage(fields) })
  assert.equal((await s.post('/add', { ...fields, title: 'Another title', signature: good })).status, 401)
  assert.equal((await s.post('/add', { ...fields, signature: '0x1234' })).status, 401)
  assert.equal((await s.list()).tracks.length, 0)
})

test('an old signature or another site is refused', async () => {
  const s = setup()
  const fields = { txId: AUDIO, title: 'Night Tone', artist: 'miya', wallet: uploader.address, at: T }
  const signature = await uploader.signMessage({ message: addMessage(fields) })
  s.advance(11 * 60_000)
  assert.equal((await s.post('/add', { ...fields, signature })).status, 400)
  assert.equal((await s.post('/add', { ...fields, signature }, 'https://evil.example')).status, 403)
})

test('only audio goes on, and a cover must be an image', async () => {
  const s = setup()
  assert.equal((await s.add(uploader, NOT_AUDIO)).status, 400)
  assert.equal((await s.add(uploader, AUDIO, { artworkId: NOT_AUDIO })).status, 400)
  assert.equal((await s.add(uploader, 'not-an-id')).status, 400)
  assert.equal((await s.list()).tracks.length, 0)
})

test('the admin and the uploader can remove; nobody else can', async () => {
  const s = setup()
  await s.add()
  assert.equal((await s.remove(stranger)).status, 403)
  assert.equal((await s.list()).tracks.length, 1)
  assert.equal((await s.remove(admin)).status, 200)
  assert.equal((await s.list()).tracks.length, 0)
  assert.equal((await s.remove(admin)).status, 404)

  const other = 'b'.repeat(43)
  await s.add(uploader, other)
  assert.equal((await s.remove(uploader, other)).status, 200)
})

test('a removed track cannot be added back, and a live one not twice', async () => {
  const s = setup()
  await s.add()
  assert.equal((await s.add(stranger)).status, 409)
  await s.remove(admin)
  const again = await s.add()
  assert.equal(again.status, 409)
  assert.match(again.body.error, /removed/)
})

test('taking your own track off leaves it free to be added again, so nobody can block a track', async () => {
  const s = setup()
  await s.add(uploader)
  s.advance(1000)
  assert.equal((await s.remove(uploader)).status, 200)
  assert.equal((await s.add(uploader)).status, 200)
  const [back] = (await s.list()).tracks
  assert.equal(back.addedAt, T, 'no way up the list')
  await s.remove(uploader)

  const again = await s.add(stranger)
  assert.equal(again.status, 200)
  const [taken] = (await s.list()).tracks
  assert.equal(taken.uploader, stranger.address.toLowerCase())
  assert.equal(taken.addedAt, T + 1000)
  assert.equal(taken.removedAt, undefined)
})

test('an admin taking their own track off still blocks it', async () => {
  const s = setup()
  await s.add(admin)
  await s.remove(admin)
  assert.equal((await s.add(uploader)).status, 409)
})

test('only an admin can restore a blocked track, and only a blocked one', async () => {
  const s = setup()
  await s.add()
  assert.equal((await s.restore(admin)).status, 404, 'live, so nothing to restore')
  await s.remove(admin)
  const fields = { txId: AUDIO, wallet: admin.address, at: T }
  const forged = await stranger.signMessage({ message: restoreMessage(fields) })
  assert.equal((await s.post('/restore', { ...fields, signature: forged })).status, 401)
  assert.equal((await s.restore(stranger)).status, 403)
  assert.equal((await s.restore(admin)).status, 200)
  assert.equal((await s.list()).tracks.length, 1)
  await s.remove(uploader)
  assert.equal((await s.restore(admin)).status, 404, 'taken off by its uploader, so not put back')
})

test('a busy day pushes no live track out of the listing, and older pages can be reached', async () => {
  assert.ok(LIST_LIMIT >= 5 * MAX_PER_DAY)
  const s = setup()
  const id = (i: number) => String(i).padStart(43, 'x')
  // All in the same millisecond, the hard case for a cursor.
  for (let i = 0; i < LIST_LIMIT + 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await s.deps.store.insert({ txId: id(i), title: 't', artist: 'a', uploader: 'u', addedAt: T })
  }
  const first = await s.list()
  assert.equal(first.tracks.length, LIST_LIMIT)
  assert.ok(first.nextBefore)
  const page = async (before: string) =>
    (await handleStationRequest(
      { method: 'GET', url: `${ORIGIN}/api/station?before=${before}`, headers: new Headers() },
      s.deps
    ))
  const second = (await (await page(first.nextBefore)).json()) as any
  assert.equal(second.tracks.length, 5)
  assert.equal(second.nextBefore, undefined)
  const seen = new Set([...first.tracks, ...second.tracks].map((t: { txId: string }) => t.txId))
  assert.equal(seen.size, LIST_LIMIT + 5)
  assert.equal((await page('nope')).status, 400)
})

test('a wallet has a daily limit', async () => {
  const s = setup()
  for (let i = 0; i < MAX_PER_WALLET_PER_DAY; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await s.add(uploader, String(i).padStart(43, 'x'))).status, 200)
  }
  assert.equal((await s.add(uploader, 'y'.repeat(43))).status, 429)
  s.advance(86_400_000 + 1)
  assert.equal((await s.add(uploader, 'y'.repeat(43))).status, 200)
})

test('text is reduced to one plain line, and that is what must be signed', async () => {
  const s = setup()
  const title = 'Night Tone'
  const fields = { txId: AUDIO, title, artist: 'miya', wallet: uploader.address, at: T }
  const signature = await uploader.signMessage({ message: addMessage(fields) })
  const r = await s.post('/add', { ...fields, title: `  Night\n\u202eTone `, signature })
  assert.equal(r.status, 200)
  assert.equal((await s.list()).tracks[0].title, 'Night Tone')
})

test('without a database the station says it opens soon', async () => {
  const s = setup()
  const r = await handleStationRequest(
    { method: 'GET', url: `${ORIGIN}/api/station`, headers: new Headers() },
    { ...s.deps, store: undefined }
  )
  assert.equal(r.status, 503)
})
