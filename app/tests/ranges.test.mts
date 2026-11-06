// api/_lib/ranges.ts: the pieces of a film a video player asks for. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseRange, serveRange } from '../api/_lib/ranges.ts'

test('reads the usual range forms, and refuses what cannot be served', () => {
  assert.deepEqual(parseRange('bytes=0-1', 10), { start: 0, end: 1 })
  assert.deepEqual(parseRange('bytes=4-', 10), { start: 4, end: 9 })
  assert.deepEqual(parseRange('bytes=8-99', 10), { start: 8, end: 9 })
  assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 })
  for (const bad of ['bytes=10-', 'bytes=5-2', 'bytes=-', 'bytes=-0', 'items=0-1', 'bytes=0-1,3-4', null])
    assert.equal(parseRange(bad, 10), undefined, String(bad))
})

const film = () => new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), { headers: { 'content-type': 'video/mp4' } })
const ask = (range?: string) =>
  new Request('https://x.test/commercials/a.mp4', { headers: range ? { range } : {} })

test('a range gets exactly its bytes with a 206', async () => {
  const res = await serveRange(ask('bytes=2-4'), film())
  assert.equal(res.status, 206)
  assert.equal(res.headers.get('content-range'), 'bytes 2-4/10')
  assert.equal(res.headers.get('content-length'), '3')
  assert.equal(res.headers.get('content-type'), 'video/mp4')
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [2, 3, 4])
})

test('no range gets the whole file and says ranges are fine; an impossible one gets a 416', async () => {
  const whole = await serveRange(ask(), film())
  assert.equal(whole.status, 200)
  assert.equal(whole.headers.get('accept-ranges'), 'bytes')
  assert.equal((await whole.arrayBuffer()).byteLength, 10)
  const bad = await serveRange(ask('bytes=50-60'), film())
  assert.equal(bad.status, 416)
  assert.equal(bad.headers.get('content-range'), 'bytes */10')
})

test('a missing film stays missing', async () => {
  const res = await serveRange(ask('bytes=0-1'), new Response('no', { status: 404 }))
  assert.equal(res.status, 404)
})
