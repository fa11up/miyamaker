// api/_lib/videoaudio.ts: the video-to-audio route never serves what a claim says it is. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  allowedStream,
  handleVideoAudioRequest,
  pickOdyseeAudio,
  VIDEO_AUDIO_COST,
  VIDEO_AUDIO_PATH,
  VIDEO_AUDIO_RATE,
  videoPage,
} from '../api/_lib/videoaudio.ts'
import { videoPage as appVideoPage } from '../src/pages/MusicMaker/media/videoaudio.js'
import { clientKey, createRateLimiter, sameOrigin } from '../api/_lib/zeroex.ts'

const open = { sameOrigin, clientKey, limiter: () => true }

const ask = (url: string) => ({
  method: 'GET',
  url: `http://localhost${VIDEO_AUDIO_PATH}?url=${encodeURIComponent(url)}`,
  headers: new Headers({ 'sec-fetch-site': 'same-origin' }),
})

const claim = (mediaType: string, title = 'Clip') => ({
  name: 'clip',
  claim_id: 'abc123',
  value: { title, source: { sd_hash: 'deadbeef00', media_type: mediaType } },
})

/** Odysee answers resolve with the claim, get with a stream on odycdn, and the stream with the given bytes. */
function odysee(mediaType: string, bytes: BodyInit | null, title?: string): typeof fetch {
  return async (input) => {
    const href = String(input)
    if (href.includes('m=resolve')) return Response.json({ result: { 'lbry://clip': claim(mediaType, title) } })
    if (href.includes('m=get')) return Response.json({ result: { streaming_url: 'https://player.odycdn.com/api/v4/streams/clip.mp4' } })
    assert.match(href, /odycdn\.com/)
    return new Response(bytes, { status: 206, headers: { 'content-type': 'text/html' } })
  }
}

test('a claim that calls itself text/html is still served as the video type this route picked', async () => {
  const res = await handleVideoAudioRequest(ask('lbry://clip'), { ...open, fetchImpl: odysee('text/html', '<script>x</script>') })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'video/mp4')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.match(res.headers.get('content-security-policy') || '', /sandbox/)
  assert.equal(res.headers.get('content-disposition'), 'attachment')
})

test('the claim type only picks a container from a fixed set', () => {
  assert.equal(pickOdyseeAudio(claim('video/webm')).mime, 'video/webm')
  assert.equal(pickOdyseeAudio(claim('audio/ogg')).mime, 'audio/ogg')
  assert.equal(pickOdyseeAudio(claim('text/html; x=video/webm')).mime, 'video/webm')
  assert.equal(pickOdyseeAudio(claim('application/xhtml+xml')).mime, 'video/mp4')
})

test('a malformed odysee path is a 400, not a crash', async () => {
  assert.equal(videoPage('https://odysee.com/@a/%E0%A4%A'), null)
  const res = await handleVideoAudioRequest(ask('https://odysee.com/@a/%E0%A4%A'), {
    ...open,
    fetchImpl: async () => {
      throw new Error('no fetch expected')
    },
  })
  assert.equal(res.status, 400)
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8')
})

test('a title with a broken surrogate still answers, with a safe name', async () => {
  const res = await handleVideoAudioRequest(ask('lbry://clip'), { ...open, fetchImpl: odysee('video/mp4', new Uint8Array([1, 2]), 'bad \uD800 title') })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('x-sample-name'), 'video')
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2])
})

test('an empty stream is a 502', async () => {
  const res = await handleVideoAudioRequest(ask('lbry://clip'), { ...open, fetchImpl: odysee('video/mp4', null) })
  assert.equal(res.status, 502)
})

const never: typeof fetch = async () => {
  throw new Error('no fetch expected')
}

test('the app and the server check links with the same code', () => {
  assert.equal(videoPage, appVideoPage)
})

test('a missing guard refuses every request instead of skipping the check', async () => {
  for (const env of [{}, { sameOrigin, clientKey }, { clientKey, limiter: () => true }, { sameOrigin, limiter: () => true }]) {
    const res = await handleVideoAudioRequest(ask('lbry://clip'), { ...env, fetchImpl: never })
    assert.equal(res.status, 500)
    assert.match(await res.text(), /not configured/)
  }
})

test('only GET is answered, with an Allow header', async () => {
  const res = await handleVideoAudioRequest({ ...ask('lbry://clip'), method: 'POST' }, { ...open, fetchImpl: never })
  assert.equal(res.status, 405)
  assert.equal(res.headers.get('allow'), 'GET')
})

test('the exact path only, like the Worker', async () => {
  const slash = { ...ask('lbry://clip'), url: `http://localhost${VIDEO_AUDIO_PATH}/?url=lbry%3A%2F%2Fclip` }
  const res = await handleVideoAudioRequest(slash, { ...open, fetchImpl: never })
  assert.equal(res.status, 404)
})

test('a cross-site call is refused before any fetch', async () => {
  const res = await handleVideoAudioRequest(
    { ...ask('lbry://clip'), headers: new Headers({ origin: 'https://evil.example' }) },
    { ...open, fetchImpl: never }
  )
  assert.equal(res.status, 403)
})

test('one link costs several tokens, and the limit answers 429 before any fetch', async () => {
  assert.ok(VIDEO_AUDIO_COST > 1)
  const limiter = createRateLimiter(VIDEO_AUDIO_RATE)
  const env = { sameOrigin, clientKey, limiter, cost: VIDEO_AUDIO_COST }
  const burst = Math.floor(VIDEO_AUDIO_RATE.capacity / VIDEO_AUDIO_COST)
  let fetches = 0
  const counted: typeof fetch = async (input, init) => {
    fetches += 1
    return odysee('video/mp4', new Uint8Array([1]))(input, init)
  }
  for (let i = 0; i < burst; i += 1) assert.equal((await handleVideoAudioRequest(ask('lbry://clip'), { ...env, fetchImpl: counted })).status, 200)
  const before = fetches
  const res = await handleVideoAudioRequest(ask('lbry://clip'), { ...env, fetchImpl: counted })
  assert.equal(res.status, 429)
  assert.equal(fetches, before)
})

test('a stream that redirects twice is refused', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const href = String(input)
    if (href.includes('m=resolve')) return Response.json({ result: { 'lbry://clip': claim('video/mp4') } })
    if (href.includes('m=get')) return Response.json({ result: { streaming_url: 'https://player.odycdn.com/a.mp4' } })
    if (href === 'https://player.odycdn.com/a.mp4') return new Response(null, { status: 302, headers: { location: 'https://cdn.odycdn.com/b.mp4' } })
    if (href === 'https://cdn.odycdn.com/b.mp4') return new Response(null, { status: 302, headers: { location: 'https://cdn.odycdn.com/c.mp4' } })
    throw new Error(`unexpected fetch ${href}`)
  }
  const res = await handleVideoAudioRequest(ask('lbry://clip'), { ...open, fetchImpl })
  assert.equal(res.status, 422)
})

test('a stream redirect off the three stream hosts is refused', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const href = String(input)
    if (href.includes('m=resolve')) return Response.json({ result: { 'lbry://clip': claim('video/mp4') } })
    if (href.includes('m=get')) return Response.json({ result: { streaming_url: 'https://player.odycdn.com/a.mp4' } })
    if (href === 'https://player.odycdn.com/a.mp4') return new Response(null, { status: 302, headers: { location: 'https://evil.example/a.mp4' } })
    throw new Error(`unexpected fetch ${href}`)
  }
  const res = await handleVideoAudioRequest(ask('lbry://clip'), { ...open, fetchImpl })
  assert.equal(res.status, 422)
})

test('stream hosts: googlevideo, odycdn and twimg over https, nothing else', () => {
  for (const ok of [
    'https://rr1---sn-abc.googlevideo.com/videoplayback?x=1',
    'https://googlevideo.com/a',
    'https://player.odycdn.com/api/v4/streams/a.mp4',
    'https://video.twimg.com/ext_tw_video/1/a.mp4',
  ]) {
    assert.ok(allowedStream(ok), ok)
  }
  for (const bad of [
    'http://video.twimg.com/a.mp4',
    'https://user:pass@video.twimg.com/a.mp4',
    'https://evilgooglevideo.com/a',
    'https://googlevideo.com.evil.example/a',
    'https://odycdn.com.example/a',
    'https://youtube.com/watch?v=abc',
    'javascript:alert(1)',
    'not a url',
    '',
    null,
    undefined,
  ]) {
    assert.equal(allowedStream(bad), null, String(bad))
  }
})
