// src/music/audio.ts: audio file validation, the music metadata builder and the metadata → track parser.
// Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildMusicMetadata,
  decodeDataJson,
  formatDuration,
  isAudio,
  MAX_AUDIO_BYTES,
  parseMusicMetadata,
  safeUri,
  trackFromMetadata,
  validateAudioFile,
  validateImageFile,
} from '../src/music/audio.ts'

const MB = 1024 * 1024

test('accepts mp3/ogg/wav/m4a/flac by extension and browser-reported MIME', () => {
  const ok: [string, string][] = [
    ['song.mp3', 'audio/mpeg'],
    ['song.MP3', ''],
    ['song.ogg', 'audio/ogg'],
    ['song.wav', 'audio/x-wav'],
    ['song.wav', 'audio/wav'],
    ['song.m4a', 'audio/x-m4a'],
    ['song.m4a', 'audio/mp4'],
    ['song.flac', 'audio/flac'],
    ['song.flac', 'application/octet-stream'],
  ]
  for (const [name, type] of ok) {
    const r = validateAudioFile({ name, type, size: 3 * MB })
    assert.equal(r.ok, true, `${name} ${type}`)
  }
  const mp3 = validateAudioFile({ name: 'a.mp3', type: '', size: 1 })
  assert.deepEqual(mp3, { ok: true, ext: 'mp3', mime: 'audio/mpeg' })
})

test('rejects other types, mismatched MIME, empty and >50MB files', () => {
  assert.equal(validateAudioFile({ name: 'x.exe', type: 'application/x-msdownload', size: 10 }).ok, false)
  assert.equal(validateAudioFile({ name: 'x.mp4', type: 'video/mp4', size: 10 }).ok, false)
  assert.equal(validateAudioFile({ name: 'noext', type: 'audio/mpeg', size: 10 }).ok, false)
  assert.equal(validateAudioFile({ name: 'x.mp3', type: 'text/html', size: 10 }).ok, false)
  assert.equal(validateAudioFile({ name: 'x.mp3', type: 'audio/mpeg', size: 0 }).ok, false)
  assert.equal(validateAudioFile({ name: 'x.mp3', type: 'audio/mpeg', size: MAX_AUDIO_BYTES }).ok, true)
  const big = validateAudioFile({ name: 'x.mp3', type: 'audio/mpeg', size: MAX_AUDIO_BYTES + 1 })
  assert.equal(big.ok, false)
  assert.match((big as { error: string }).error, /50 MB/)
  assert.equal(validateImageFile({ name: 'c.png', type: 'image/png', size: 100 }).ok, true)
  assert.equal(validateImageFile({ name: 'c.svg', type: 'image/svg+xml', size: 100 }).ok, false)
})

test('safeUri only allows http(s), ipfs and ar', () => {
  assert.equal(safeUri(' ipfs://bafy/track.mp3 '), 'ipfs://bafy/track.mp3')
  assert.equal(safeUri('ar://abc'), 'ar://abc')
  assert.equal(safeUri('https://x.example/a.mp3'), 'https://x.example/a.mp3')
  for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'blob:https://x/1', 'ipfs://', 'https://a b', 'file:///etc/passwd', 'https://x/"onerror', 42, null]) {
    assert.equal(safeUri(bad), undefined, String(bad))
  }
})

const form = {
  title: 'Night Bus',
  artist: 'miya',
  description: 'late\nnight',
  image: 'ar://cover',
  audio: 'ar://audio',
  mime: 'audio/mpeg',
  duration: 201.37,
  genre: 'ambient',
  bpm: '92',
}

test('buildMusicMetadata produces image + animation_url + properties {artist, duration, genre, bpm}', () => {
  const r = buildMusicMetadata(form)
  assert.equal(r.ok, true)
  const m = (r as Extract<typeof r, { ok: true }>).metadata
  assert.equal(m.name, 'Night Bus')
  assert.equal(m.image, 'ar://cover')
  assert.equal(m.animation_url, 'ar://audio')
  assert.deepEqual(m.content, { mime: 'audio/mpeg', uri: 'ar://audio' })
  assert.deepEqual(m.properties, { artist: 'miya', duration: 201.4, genre: 'ambient', bpm: 92, mime_type: 'audio/mpeg' })
  assert.deepEqual(m.attributes, [
    { trait_type: 'Artist', value: 'miya' },
    { trait_type: 'Duration', value: '3:21' },
    { trait_type: 'Genre', value: 'ambient' },
    { trait_type: 'BPM', value: 92, display_type: 'number' },
  ])
  assert.equal(m.description, 'late\nnight')
  assert.equal('external_url' in m, false)
})

test('bpm and genre are optional; bad input is reported per field', () => {
  const r = buildMusicMetadata({ ...form, bpm: '', genre: '' })
  assert.equal(r.ok, true)
  const m = (r as Extract<typeof r, { ok: true }>).metadata
  assert.equal('bpm' in m.properties, false)
  assert.equal('genre' in m.properties, false)

  const bad = buildMusicMetadata({
    ...form,
    title: '  ',
    image: 'javascript:alert(1)',
    audio: 'data:audio/mp3;base64,AAAA',
    bpm: '92.5',
    duration: NaN,
    mime: 'text/html',
    externalUrl: 'javascript:x',
  })
  assert.equal(bad.ok, false)
  assert.deepEqual(Object.keys((bad as { errors: object }).errors).sort(), [
    'audio',
    'bpm',
    'duration',
    'externalUrl',
    'image',
    'mime',
    'title',
  ])
})

test('parseMusicMetadata finds audio by extension or declared MIME and returns plain text only', () => {
  const built = buildMusicMetadata(form)
  assert.equal(built.ok, true)
  const parsed = parseMusicMetadata((built as Extract<typeof built, { ok: true }>).metadata)
  assert.equal(parsed?.audio, 'ar://audio', 'extensionless ar:// is detected through content.mime')
  assert.equal(parsed?.artist, 'miya')
  assert.equal(parsed?.duration, 201.4)
  assert.equal(parsed?.bpm, 92)

  const ext = parseMusicMetadata({ name: 'x', animation_url: 'ipfs://cid/song.ogg', image: 'ipfs://cid/c.png' })
  assert.equal(ext?.audio, 'ipfs://cid/song.ogg')
  assert.equal(parseMusicMetadata({ name: 'video', animation_url: 'ipfs://cid/clip.mp4' }), null)
  assert.equal(parseMusicMetadata({ name: 'html', animation_url: 'https://x/page.html' }), null)
  assert.equal(parseMusicMetadata({ name: 'js', animation_url: 'javascript:alert(1)//.mp3' }), null)
  assert.equal(parseMusicMetadata('nope'), null)

  const hostile = parseMusicMetadata({
    name: '<img src=x onerror=alert(1)>\u0000' + 'x'.repeat(500),
    animation_url: 'https://cdn.example/a.mp3',
    image: 'data:image/svg+xml,<svg onload=alert(1)>',
    attributes: [{ trait_type: 'Artist', value: 'from attrs' }],
  })
  assert.ok(hostile)
  assert.equal(hostile.title.length, 120)
  assert.equal(hostile.image, undefined, 'data: images are dropped')
  assert.equal(hostile.artist, 'from attrs')
})

test('trackFromMetadata builds a stable on-chain track id', () => {
  const track = trackFromMetadata(
    { name: 'Song', animation_url: 'ipfs://cid/a.wav', properties: { artist: 'A', duration: 12 } },
    { chainId: 1, address: '0xABCDEF0000000000000000000000000000000001', tokenId: '3' }
  )
  assert.deepEqual(track, {
    id: 'onchain:1:0xabcdef0000000000000000000000000000000001:3',
    title: 'Song',
    artist: 'A',
    src: 'ipfs://cid/a.wav',
    artwork: undefined,
    duration: 12,
    source: 'onchain',
    token: { chainId: 1, address: '0xABCDEF0000000000000000000000000000000001', tokenId: '3' },
  })
})

test('decodeDataJson reads utf8 and base64 data: JSON, ignores everything else', () => {
  assert.deepEqual(decodeDataJson('data:application/json;utf8,{"name":"a"}'), { name: 'a' })
  assert.deepEqual(decodeDataJson(`data:application/json;base64,${btoa('{"name":"b"}')}`), { name: 'b' })
  assert.deepEqual(decodeDataJson('data:application/json,%7B%22name%22%3A%22c%22%7D'), { name: 'c' })
  assert.equal(decodeDataJson('ipfs://cid/1.json'), undefined)
  assert.equal(decodeDataJson('data:application/json,{broken'), undefined)
})

test('isAudio and formatDuration', () => {
  assert.equal(isAudio('https://x/a.MP3?download=1'), true)
  assert.equal(isAudio('ar://abc'), false)
  assert.equal(isAudio('ar://abc', 'audio/flac'), true)
  assert.equal(formatDuration(0), '0:00')
  assert.equal(formatDuration(65.9), '1:05')
  assert.equal(formatDuration(3725), '1:02:05')
  assert.equal(formatDuration(undefined), '--:--')
})
