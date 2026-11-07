// src/pages/MusicMaker/media/videoaudio.js: the video-to-audio route never serves what a claim says it is. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { handleVideoAudioRequest, pickOdyseeAudio, VIDEO_AUDIO_PATH, videoPage } from '../src/pages/MusicMaker/media/videoaudio.js'

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
  const res = await handleVideoAudioRequest(ask('lbry://clip'), { fetchImpl: odysee('text/html', '<script>x</script>') })
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
    fetchImpl: async () => {
      throw new Error('no fetch expected')
    },
  })
  assert.equal(res.status, 400)
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8')
})

test('a title with a broken surrogate still answers, with a safe name', async () => {
  const res = await handleVideoAudioRequest(ask('lbry://clip'), { fetchImpl: odysee('video/mp4', new Uint8Array([1, 2]), 'bad \uD800 title') })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('x-sample-name'), 'video')
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2])
})

test('an empty stream is a 502', async () => {
  const res = await handleVideoAudioRequest(ask('lbry://clip'), { fetchImpl: odysee('video/mp4', null) })
  assert.equal(res.status, 502)
})
