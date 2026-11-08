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

/** A film the way the asset store sends one: streamed in chunks, with its length, counting how much was read. */
const streamed = (size = 100, chunk = 7) => {
  const read = { bytes: 0, cancelled: false }
  let at = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= size) return controller.close()
      const n = Math.min(chunk, size - at)
      controller.enqueue(Uint8Array.from({ length: n }, (_, i) => (at + i) % 256))
      at += n
      read.bytes = at
    },
    cancel() {
      read.cancelled = true
    },
  })
  const res = new Response(body, { headers: { 'content-type': 'video/mp4', 'content-length': String(size) } })
  return { res, read }
}
const bytes = async (res: Response) => [...new Uint8Array(await res.arrayBuffer())]
const run = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

test('a streamed film: a range is cut as it flows, and the rest is never read', async () => {
  const { res: asset, read } = streamed()
  const res = await serveRange(ask('bytes=10-20'), asset)
  assert.equal(res.status, 206)
  assert.equal(res.headers.get('content-range'), 'bytes 10-20/100')
  assert.equal(res.headers.get('content-length'), '11')
  assert.equal(res.headers.get('accept-ranges'), 'bytes')
  assert.deepEqual(await bytes(res), run(10, 20))
  assert.ok(read.bytes < 100, `read ${read.bytes} of 100`)
  assert.ok(read.cancelled)
})

test('a streamed film: open-ended and suffix ranges', async () => {
  const open = await serveRange(ask('bytes=95-'), streamed().res)
  assert.equal(open.status, 206)
  assert.equal(open.headers.get('content-range'), 'bytes 95-99/100')
  assert.equal(open.headers.get('content-length'), '5')
  assert.deepEqual(await bytes(open), run(95, 99))

  const tail = await serveRange(ask('bytes=-3'), streamed().res)
  assert.equal(tail.status, 206)
  assert.equal(tail.headers.get('content-range'), 'bytes 97-99/100')
  assert.deepEqual(await bytes(tail), run(97, 99))

  const first = await serveRange(ask('bytes=0-0'), streamed().res)
  assert.deepEqual(await bytes(first), [0])
})

test('a streamed film: out of range is a 416, several ranges get the whole file', async () => {
  const { res: asset, read } = streamed()
  const bad = await serveRange(ask('bytes=100-'), asset)
  assert.equal(bad.status, 416)
  assert.equal(bad.headers.get('content-range'), 'bytes */100')
  assert.equal(bad.headers.get('content-length'), null)
  assert.equal(read.bytes, 0)

  const many = await serveRange(ask('bytes=0-1,5-6'), streamed().res)
  assert.equal(many.status, 200)
  assert.equal(many.headers.get('content-range'), null)
  assert.equal(many.headers.get('accept-ranges'), 'bytes')
  assert.deepEqual(await bytes(many), run(0, 99))
})
