// api/_lib/samplemedia.ts: the closed list of hosts a pad can read through the site. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { allowedMediaUrl, handleSampleMediaRequest, SAMPLE_MEDIA_LIMIT, SAMPLE_MEDIA_PATH, SAMPLE_MEDIA_RATE } from '../api/_lib/samplemedia.ts'
import { allowedMediaUrl as appAllowedMediaUrl } from '../src/pages/MusicMaker/media/allow.js'
import { cappedStream, mediaType } from '../src/pages/MusicMaker/media/serve.js'
import { clientKey, createRateLimiter, sameOrigin } from '../api/_lib/zeroex.ts'

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
  assert.equal(allowedMediaUrl('https://cloudflare-ipfs.com/ipfs/abc'), null, 'the retired gateway is off the list')
})

test('the app and the proxy agree on every host', () => {
  const cases = [
    rave,
    'https://gateway.pinata.cloud/ipfs/abc',
    'https://ipfs.io/ipfs/abc',
    'https://ipfs.filebase.io/ipfs/bafy/a.png',
    'https://dweb.link/ipfs/abc',
    'https://bafy.ipfs.dweb.link/a.wav',
    'https://bafy.ipfs.nftstorage.link/a.wav',
    'https://nftstorage.link/ipfs/abc',
    'https://w3s.link/ipfs/abc',
    'https://www.miladymaker.net/milady/1.png',
    'https://miladymaker.net/banners/nft/1.png',
    'https://remilio.org/remilio/1.png',
    'https://bonklerimg.remilia.org/cgi-bin/bonklercgi?name=1',
    'https://yayo.fund/yayo_nft/1.png',
    'https://arweave.net/abcdefghijklmnopqrstuvwxyz0123456789abc',
    'https://not.miladymaker.net/milady/1.png',
    'https://cloudflare-ipfs.com/ipfs/abc',
    'https://example.com/a.mp4',
    'https://evil.ipfs.io.example.com/a.mp4',
    'http://ipfs.io/ipfs/abc',
  ]
  for (const href of cases) assert.equal(allowedMediaUrl(href)?.href ?? null, appAllowedMediaUrl(href)?.href ?? null, href)
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

const page = 'https://ipfs.io/ipfs/bafyhtml'

test('an html file comes back as plain bytes that cannot run as a page', async () => {
  const html = '<script>alert(document.domain)</script>'
  const fetchImpl: typeof fetch = async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  const res = await handleSampleMediaRequest(ask(page), { ...open, fetchImpl })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/octet-stream')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.match(res.headers.get('content-security-policy') || '', /default-src 'none'; sandbox/)
  assert.equal(res.headers.get('content-disposition'), 'attachment')
  assert.equal(await res.text(), html)
})

test('svg, xml and a missing type are plain bytes too', async () => {
  for (const type of ['image/svg+xml', 'application/xhtml+xml', 'text/xml', '', 'audio/x-<script>', 'video/']) {
    const fetchImpl: typeof fetch = async () => new Response('x', { status: 200, headers: type ? { 'content-type': type } : {} })
    const res = await handleSampleMediaRequest(ask(page), { ...open, fetchImpl })
    assert.equal(res.headers.get('content-type'), 'application/octet-stream', type)
  }
})

test('audio/mpeg passes through, without its parameters, still as an attachment', async () => {
  const fetchImpl: typeof fetch = async () => new Response(new Uint8Array([9, 9]), { status: 200, headers: { 'content-type': 'Audio/MPEG; foo=bar' } })
  const res = await handleSampleMediaRequest(ask('https://ipfs.io/ipfs/bafy/a.mp3'), { ...open, fetchImpl })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'audio/mpeg')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.headers.get('content-disposition'), 'attachment')
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [9, 9])
})

test('media types: only audio/* and video/* get through', () => {
  assert.equal(mediaType('video/mp4'), 'video/mp4')
  assert.equal(mediaType('audio/ogg; codecs=opus'), 'audio/ogg')
  assert.equal(mediaType('text/html'), 'application/octet-stream')
  assert.equal(mediaType(undefined), 'application/octet-stream')
})

function chunks(sizes: number[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const n of sizes) controller.enqueue(new Uint8Array(n))
      controller.close()
    },
  })
}

test('a stream with no length that runs past the cap fails instead of passing on', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(chunks([SAMPLE_MEDIA_LIMIT - 1, 2]), { status: 200, headers: { 'content-type': 'audio/wav' } })
  const res = await handleSampleMediaRequest(ask(rave), { ...open, fetchImpl })
  assert.equal(res.status, 200)
  await assert.rejects(res.arrayBuffer())
})

test('the capped stream cuts at the limit when asked to truncate', async () => {
  const out = new Response(cappedStream(chunks([3, 0, 4, 5]), 6, { truncate: true }))
  assert.equal((await out.arrayBuffer()).byteLength, 6)
  const whole = new Response(cappedStream(chunks([3, 3]), 6))
  assert.equal((await whole.arrayBuffer()).byteLength, 6)
})

const never: typeof fetch = async () => {
  throw new Error('no fetch expected')
}

test('a missing guard refuses every request instead of skipping the check', async () => {
  for (const env of [{}, { sameOrigin, clientKey }, { clientKey, limiter: () => true }, { sameOrigin, limiter: () => true }]) {
    const res = await handleSampleMediaRequest(ask(rave), { ...env, fetchImpl: never })
    assert.equal(res.status, 500)
    assert.match(await res.text(), /not configured/)
  }
})

test('only GET is answered, with an Allow header', async () => {
  const res = await handleSampleMediaRequest({ ...ask(rave), method: 'POST' }, { ...open, fetchImpl: never })
  assert.equal(res.status, 405)
  assert.equal(res.headers.get('allow'), 'GET')
})

test('the exact path only, like the Worker', async () => {
  const slash = { ...ask(rave), url: `http://localhost${SAMPLE_MEDIA_PATH}/?url=${encodeURIComponent(rave)}` }
  assert.equal((await handleSampleMediaRequest(slash, { ...open, fetchImpl: never })).status, 404)
})

test('a whole 64-pad kit loads in one burst, and the next read is a 429 before any fetch', async () => {
  assert.ok(SAMPLE_MEDIA_RATE.capacity >= 64)
  const limiter = createRateLimiter(SAMPLE_MEDIA_RATE)
  let fetches = 0
  const fetchImpl: typeof fetch = async () => {
    fetches += 1
    return new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'audio/wav' } })
  }
  const env = { sameOrigin, clientKey, limiter, fetchImpl }
  for (let i = 0; i < SAMPLE_MEDIA_RATE.capacity; i += 1) assert.equal((await handleSampleMediaRequest(ask(rave), env)).status, 200)
  const res = await handleSampleMediaRequest(ask(rave), env)
  assert.equal(res.status, 429)
  assert.ok(res.headers.get('retry-after'))
  assert.equal(fetches, SAMPLE_MEDIA_RATE.capacity)
})

test('a second redirect is refused, even on the list', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const href = String(input)
    if (href === rave) return new Response(null, { status: 302, headers: { location: 'https://gateway.pinata.cloud/ipfs/one' } })
    return new Response(null, { status: 302, headers: { location: 'https://ipfs.io/ipfs/two' } })
  }
  const res = await handleSampleMediaRequest(ask(rave), { ...open, fetchImpl })
  assert.equal(res.status, 400)
})
