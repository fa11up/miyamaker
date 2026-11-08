// api/_lib/body.ts: how much of a POST the Worker will read. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BODY_LIMIT, jsonReply, noSniff, readCappedText } from '../api/_lib/body.ts'

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('https://www.miyamaker.com/api/station', { method: 'POST', body, headers, duplex: 'half' } as RequestInit)

/** An upload with no length that would go on forever, counting what was pulled from it. */
const endless = () => {
  const seen = { bytes: 0, cancelled: false }
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.bytes += 1000
      controller.enqueue(new TextEncoder().encode('a'.repeat(1000)))
    },
    cancel() {
      seen.cancelled = true
    },
  })
  return { stream, seen }
}

test('a small body is read whole', async () => {
  assert.equal(await readCappedText(post('{"a":1}')), '{"a":1}')
  assert.equal(await readCappedText(post('')), '')
  assert.equal(await readCappedText(post('x'.repeat(BODY_LIMIT))), 'x'.repeat(BODY_LIMIT))
})

test('a body that says it is too large is turned away unread', async () => {
  const { stream, seen } = endless()
  assert.equal(await readCappedText(post(stream, { 'content-length': String(BODY_LIMIT + 1) })), undefined)
  assert.equal(seen.bytes, 0)
})

test('a body without a length stops being read at the limit', async () => {
  const { stream, seen } = endless()
  const text = await readCappedText(post(stream))
  assert.equal(text?.length, BODY_LIMIT)
  assert.ok(seen.bytes <= BODY_LIMIT + 2000, `pulled ${seen.bytes}`)
  assert.ok(seen.cancelled)
})

test('JSON answers say nosniff; others are left alone', async () => {
  assert.equal(jsonReply(404, { error: 'Not found.' }).headers.get('x-content-type-options'), 'nosniff')
  assert.equal(jsonReply(404, {}).status, 404)
  const json = noSniff(new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } }))
  assert.equal(json.status, 201)
  assert.equal(json.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(await json.text(), '{}')
  const html = noSniff(new Response('<p>', { headers: { 'content-type': 'text/html' } }))
  assert.equal(html.headers.get('x-content-type-options'), null)
})
