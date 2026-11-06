// api/_lib/samplemedia.ts: the closed list of hosts a pad can read through the site. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { allowedMediaUrl, handleSampleMediaRequest, SAMPLE_MEDIA_PATH } from '../api/_lib/samplemedia.ts'
import { clientKey, sameOrigin } from '../api/_lib/zeroex.ts'

const open = { sameOrigin, clientKey, limiter: () => true }

const rave = 'https://api.ravepigs.dev/animations/3455.mp4'

test('only https hosts on the list are readable', () => {
  assert.equal(allowedMediaUrl(rave)?.hostname, 'api.ravepigs.dev')
  assert.equal(allowedMediaUrl('https://gateway.pinata.cloud/ipfs/abc')?.hostname, 'gateway.pinata.cloud')
  assert.equal(allowedMediaUrl('https://bafy.ipfs.dweb.link/a.wav')?.hostname, 'bafy.ipfs.dweb.link')
  assert.equal(allowedMediaUrl('https://example.com/a.mp4'), null)
  assert.equal(allowedMediaUrl('http://api.ravepigs.dev/a.mp4'), null)
  assert.equal(allowedMediaUrl('https://user:pass@api.ravepigs.dev/a.mp4'), null)
  assert.equal(allowedMediaUrl('not a url'), null)
})

test('a relative redirect stays on the host it came from', () => {
  const next = allowedMediaUrl('/ipfs/abc.mp3', 'https://gateway.pinata.cloud/file')
  assert.equal(next?.href, 'https://gateway.pinata.cloud/ipfs/abc.mp3')
  assert.equal(allowedMediaUrl('https://example.com/nope.mp4', 'https://gateway.pinata.cloud/file'), null)
})

const ask = (url: string, headers?: Record<string, string>) => ({
  method: 'GET',
  url: `http://localhost${SAMPLE_MEDIA_PATH}?url=${encodeURIComponent(url)}`,
  headers: new Headers({ 'sec-fetch-site': 'same-origin', ...headers }),
})

test('a cross-site call and an off-list host are refused before any fetch', async () => {
  let called = false
  const fetchImpl: typeof fetch = async () => {
    called = true
    return new Response('no')
  }
  const cross = await handleSampleMediaRequest(
    { method: 'GET', url: `http://localhost${SAMPLE_MEDIA_PATH}?url=${encodeURIComponent(rave)}`, headers: new Headers({ origin: 'https://evil.example' }) },
    { ...open, fetchImpl }
  )
  assert.equal(cross.status, 403)
  const off = await handleSampleMediaRequest(ask('https://example.com/a.mp4'), { ...open, fetchImpl })
  assert.equal(off.status, 400)
  assert.equal(called, false)
})

test('one allowlisted redirect is followed and the bytes come back', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4])
  const fetchImpl: typeof fetch = async (input) => {
    const href = String(input)
    if (href === rave) return new Response(null, { status: 302, headers: { location: 'https://gateway.pinata.cloud/ipfs/pig.mp4' } })
    assert.equal(href, 'https://gateway.pinata.cloud/ipfs/pig.mp4')
    return new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp4' } })
  }
  const res = await handleSampleMediaRequest(ask(rave), { ...open, fetchImpl })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'video/mp4')
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3, 4])
})

test('a redirect off the list is refused', async () => {
  const fetchImpl: typeof fetch = async () => new Response(null, { status: 302, headers: { location: 'https://example.com/a.mp4' } })
  const res = await handleSampleMediaRequest(ask(rave), { ...open, fetchImpl })
  assert.equal(res.status, 400)
})

test('a file over 24 MB is refused from its length', async () => {
  const fetchImpl: typeof fetch = async () => new Response(new Uint8Array(8), { status: 200, headers: { 'content-length': String(25 * 1024 * 1024) } })
  const res = await handleSampleMediaRequest(ask(rave), { ...open, fetchImpl })
  assert.equal(res.status, 413)
})
