// miyatv: channel registry, embed URLs, chat linkify and the client chat reducer. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Channel } from '../src/pages/TV/channels.ts'
import {
  CHANNELS,
  embedSrc,
  indexOfNumber,
  nativeChatFor,
  stepChannel,
  validateChannels,
  watchUrl,
} from '../src/pages/TV/channels.ts'
import { linkify, safeHref, shortAddress } from '../src/pages/TV/chat/linkify.ts'
import {
  cleanText,
  codePoints,
  initialRoomState,
  MAX_KEPT_MESSAGES,
  parseFrame,
  reduceRoom,
  roomSocketUrl,
} from '../src/pages/TV/chat/protocol.ts'

test('channel registry is valid', () => {
  assert.deepEqual(validateChannels(CHANNELS), [])
  assert.ok(CHANNELS.length >= 3)
})

test('registry validation catches bad entries', () => {
  const bad = [
    { ...CHANNELS[0], id: 'Bad Room!' },
    { ...CHANNELS[0], id: 'dup', number: 1 },
    { ...CHANNELS[0], id: 'dup', number: 1 },
    {
      id: 'k',
      number: 5,
      kind: 'iframe',
      name: 'k',
      tagline: '',
      description: '',
      links: [{ label: 'x', href: 'javascript:alert(1)' }],
      sources: [{ provider: 'kick', slug: '../evil', label: 'evil' }],
    },
  ] as Channel[]
  const problems = validateChannels(bad).join('\n')
  assert.match(problems, /not a valid chat room name/)
  assert.match(problems, /duplicate id/)
  assert.match(problems, /duplicate number/)
  assert.match(problems, /not https/)
  assert.match(problems, /bad kick slug/)
})

test('fish tank is external (it cannot be framed), squeekchain and kick are iframes', () => {
  const byId = Object.fromEntries(CHANNELS.map((c) => [c.id, c]))
  assert.equal(byId.fishtank?.kind, 'external')
  assert.equal(byId.squeekchain?.kind, 'iframe')
  assert.equal(byId['kick-imdusd']?.kind, 'iframe')
  assert.equal(byId['kick-imdusd']?.markets, true)
})

test('embed and watch URLs', () => {
  assert.equal(
    embedSrc({ provider: 'kick', slug: 'someone', label: 's' }),
    'https://player.kick.com/someone?autoplay=true&muted=false'
  )
  assert.equal(
    embedSrc({ provider: 'x-broadcast', broadcastId: '1qGoNYoyoRlKv', label: 'x' }),
    'https://studio.x.com/embed/broadcast/1qGoNYoyoRlKv?dnt=true&lang=en'
  )
  assert.equal(watchUrl({ provider: 'kick', slug: 'someone', label: 's' }), 'https://kick.com/someone')
  assert.equal(
    watchUrl({ provider: 'x-broadcast', broadcastId: '1qGoNYoyoRlKv', label: 'x' }),
    'https://x.com/i/broadcasts/1qGoNYoyoRlKv'
  )
})

test('native chat: kick frames, X and external sites link out', () => {
  const kick = CHANNELS.find((c) => c.id === 'kick-imdusd')!
  const kickSource = kick.kind === 'iframe' ? kick.sources[0] : undefined
  assert.deepEqual(nativeChatFor(kick, kickSource), {
    kind: 'iframe',
    src: 'https://kick.com/popout/xqc/chat',
    label: 'kick chat',
  })
  const sq = CHANNELS.find((c) => c.id === 'squeekchain')!
  assert.equal(nativeChatFor(sq, sq.kind === 'iframe' ? sq.sources[0] : undefined)?.kind, 'link')
  const fish = CHANNELS.find((c) => c.id === 'fishtank')!
  assert.deepEqual(nativeChatFor(fish), { kind: 'link', href: 'https://www.fishtank.live/', label: 'fishtank.live chat' })
})

test('channel dial wraps both ways; number lookup', () => {
  assert.equal(stepChannel(3, 0, -1), 2)
  assert.equal(stepChannel(3, 2, 1), 0)
  assert.equal(stepChannel(3, 1, 7), 2)
  assert.equal(stepChannel(0, 0, 1), 0)
  assert.equal(indexOfNumber(CHANNELS, 2), CHANNELS.findIndex((c) => c.number === 2))
  assert.equal(indexOfNumber(CHANNELS, 42), -1)
})

test('linkify: only http(s) become links, trailing punctuation stays text', () => {
  assert.deepEqual(linkify('see https://miyamaker.com/tv.'), [
    { kind: 'text', text: 'see ' },
    { kind: 'link', text: 'https://miyamaker.com/tv', href: 'https://miyamaker.com/tv' },
    { kind: 'text', text: '.' },
  ])
  assert.deepEqual(linkify('javascript:alert(1) data:text/html,<b>x</b> miyamaker.com'), [
    { kind: 'text', text: 'javascript:alert(1) data:text/html,<b>x</b> miyamaker.com' },
  ])
  const wiki = linkify('(https://en.wikipedia.org/wiki/Foo_(bar))')
  assert.equal(wiki[1]?.kind, 'link')
  assert.equal(wiki[1]?.text, 'https://en.wikipedia.org/wiki/Foo_(bar)')
  // credentials in URLs are a phishing trick: not linked
  assert.equal(safeHref('https://user:pw@evil.example'), undefined)
  assert.equal(safeHref('HTTPS://Miyamaker.com'), 'https://miyamaker.com/')
  assert.equal(linkify('<img src=x onerror=alert(1)>')[0]?.kind, 'text')
  assert.equal(shortAddress('0x5167d014a056e43883e1bbea5530c3c0dc993281'), '0x5167…3281')
})

test('client sanitizer mirrors the server: control/bidi/zero-width stripped, newlines become spaces', () => {
  const cp = (...n: number[]) => String.fromCodePoint(...n)
  assert.equal(cleanText(`  hi${cp(0)}${cp(0x202e)}there${cp(0x200b)}\nyo\t `), 'hithere yo')
  assert.equal(cleanText(`a${cp(0xfeff, 0x2066, 0x9f)}b`), 'ab')
  assert.equal(codePoints('🐹🐹'), 2)
})

test('chat frames: malformed frames are dropped, reducer dedupes, caps and deletes', () => {
  assert.equal(parseFrame('not json'), undefined)
  assert.equal(parseFrame(JSON.stringify({ t: 'msg', msg: { id: 1 } })), undefined)
  assert.equal(parseFrame(JSON.stringify({ t: 'nope' })), undefined)
  const msg = (id: string) => ({ id, at: 1, from: '0xabc', badges: [], text: `m${id}` })
  let s = reduceRoom(initialRoomState, parseFrame(JSON.stringify({ t: 'hello', room: 'r', slowMode: 5, viewers: 2, history: [msg('a'), { bad: 1 }] }))!)
  assert.equal(s.room, 'r')
  assert.equal(s.slowMode, 5)
  assert.equal(s.messages.length, 1)
  s = reduceRoom(s, { t: 'msg', msg: msg('a') })
  assert.equal(s.messages.length, 1, 'duplicate id ignored')
  s = reduceRoom(s, { t: 'msg', msg: msg('b') })
  s = reduceRoom(s, { t: 'del', id: 'a' })
  assert.deepEqual(s.messages.map((m) => m.id), ['b'])
  for (let i = 0; i < MAX_KEPT_MESSAGES + 10; i++) s = reduceRoom(s, { t: 'msg', msg: msg(`x${i}`) })
  assert.equal(s.messages.length, MAX_KEPT_MESSAGES)
  s = reduceRoom(s, parseFrame(JSON.stringify({ t: 'err', code: 'rate', message: 'slow down', retryAfter: 3 }))!, 99)
  assert.deepEqual(s.error, { code: 'rate', message: 'slow down', retryAfter: 3, at: 99 })
})

test('room socket URL from VITE_CHAT_URL', () => {
  assert.equal(roomSocketUrl('https://chat.miyamaker.com', 'fishtank'), 'wss://chat.miyamaker.com/rooms/fishtank')
  assert.equal(roomSocketUrl('http://localhost:8787/', 'kick-imdusd'), 'ws://localhost:8787/rooms/kick-imdusd')
  assert.equal(roomSocketUrl('ftp://x', 'a'), undefined)
  assert.equal(roomSocketUrl('not a url', 'a'), undefined)
})
