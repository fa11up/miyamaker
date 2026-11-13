// api/_lib/miyakeys.ts: miyakeys's gallery through the Worker (time and size caps, every build checked, CORS for the
// sandboxed frame, nothing of the visitor's request forwarded) and the headers its page is served with. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { memoryCache } from '../api/_lib/market.ts'
import {
  CLIENT_TAG_HEADER,
  clientTag,
  d1ShareCap,
  EMBED_CSP,
  embedResponse,
  GALLERY_CACHE_SECONDS,
  GALLERY_MAX_TEMPLATES,
  GALLERY_RESPONSE_LIMIT,
  handleMiyakeysGallery,
  isEmbedPath,
  MIYAKEYS_GALLERY_PATH,
  MIYAKEYS_UPSTREAM,
} from '../api/_lib/miyakeys.ts'
import type { D1Like } from '../api/_lib/station.ts'
import { clientKey, createRateLimiter } from '../api/_lib/zeroex.ts'

const SITE = 'https://www.miyamaker.com'
const URL_ = `${SITE}${MIYAKEYS_GALLERY_PATH}`
const open = { clientKey: () => 'k', readLimiter: () => true, writeLimiter: () => true }

const snap = { layout: '75', colorway: 'claude', light: { mode: 'static', color: '#cc785c', bright: 0.7 } }
const entry = (id: string, s: unknown = snap) => ({ id, name: `Build ${id}`, layout: '75', createdAt: '2026-11-12T04:21:49.249Z', snap: s })

type Seen = { url: string; init: RequestInit }
function upstream(make: () => Response | Promise<Response>, seen: Seen[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {} })
    return make()
  }) as typeof fetch
}

const get = (headers: Record<string, string> = {}) => ({ method: 'GET', url: URL_, headers: new Headers(headers) })
const post = (body: string | undefined, headers: Record<string, string> = { origin: 'null' }) => ({
  method: 'POST',
  url: URL_,
  headers: new Headers(headers),
  body,
})

test('GET: every entry is rebuilt, invalid ones are dropped, and the answer is readable from an opaque origin', async () => {
  const seen: Seen[] = []
  const body = {
    templates: [
      entry('good'),
      entry('"><img src=x onerror=alert(1)>'),
      entry('bad-snap', { layout: '__proto__' }),
      { ...entry('hostile'), snap: { ...snap, section: '<script>', theme: 'dark', perKeyOverrides: { __proto__: { glow: true }, '0-0': { bgColor: 'url(x)', glow: true } } } },
      'not an entry',
    ],
  }
  const res = await handleMiyakeysGallery(get({ cookie: 'session=secret', 'cf-connecting-ip': '1.2.3.4', 'user-agent': 'me' }), {
    ...open,
    fetchImpl: upstream(() => Response.json(body), seen),
  })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  const data = (await res.json()) as { templates: Array<Record<string, any>> }
  assert.deepEqual(data.templates.map((t) => t.id), ['good', 'hostile'])
  const hostile = data.templates[1]!
  assert.equal(hostile.snap.section, undefined)
  assert.equal(hostile.snap.theme, undefined)
  assert.deepEqual(hostile.snap.perKeyOverrides, { '0-0': { glow: true } })

  // Nothing of the visitor's request goes upstream: no cookie, no address, no user agent.
  assert.equal(seen.length, 1)
  assert.equal(seen[0]!.url, MIYAKEYS_UPSTREAM)
  const sent = new Headers(seen[0]!.init.headers)
  for (const h of ['cookie', 'cf-connecting-ip', 'x-forwarded-for', 'user-agent']) assert.equal(sent.get(h), null, h)
  assert.equal(sent.get('origin'), SITE)
  assert.ok(seen[0]!.init.signal, 'the upstream call has a deadline')
})

test('GET: a missing or wrong templates field is "unavailable", never an empty gallery', async () => {
  for (const body of [{}, { templates: 'x' }, { templates: null }, [], 'nope']) {
    const res = await handleMiyakeysGallery(get(), { ...open, fetchImpl: upstream(() => Response.json(body)) })
    assert.equal(res.status, 502, JSON.stringify(body))
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
  }
  const notJson = await handleMiyakeysGallery(get(), { ...open, fetchImpl: upstream(() => new Response('<html>')) })
  assert.equal(notJson.status, 502)
  const down = await handleMiyakeysGallery(get(), { ...open, fetchImpl: upstream(() => new Response('x', { status: 500 })) })
  assert.equal(down.status, 502)
  const empty = await handleMiyakeysGallery(get(), { ...open, fetchImpl: upstream(() => Response.json({ templates: [] })) })
  assert.deepEqual(await empty.json(), { templates: [] })
})

test('GET: an upstream that never answers times out', async () => {
  const hang: typeof fetch = ((_: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
    })) as typeof fetch
  const started = Date.now()
  const res = await handleMiyakeysGallery(get(), { ...open, fetchImpl: hang, timeoutMs: 50 })
  assert.equal(res.status, 504)
  assert.ok(Date.now() - started < 2000)
  const refused = await handleMiyakeysGallery(get(), {
    ...open,
    fetchImpl: (async () => {
      throw new TypeError('connection refused')
    }) as typeof fetch,
  })
  assert.equal(refused.status, 502)
})

test('GET: an answer over the size cap is refused, whether it says so or not', async () => {
  const big = JSON.stringify({ templates: [], pad: 'x'.repeat(GALLERY_RESPONSE_LIMIT) })
  const declared = await handleMiyakeysGallery(get(), { ...open, fetchImpl: upstream(() => new Response(big, { headers: { 'content-length': String(big.length) } })) })
  assert.equal(declared.status, 502)
  const stream = () =>
    new Response(
      new ReadableStream({
        start(c) {
          const chunk = new TextEncoder().encode('x'.repeat(64 * 1024))
          for (let i = 0; i < GALLERY_RESPONSE_LIMIT / chunk.length + 2; i++) c.enqueue(chunk)
          c.close()
        },
      })
    )
  const undeclared = await handleMiyakeysGallery(get(), { ...open, fetchImpl: upstream(stream) })
  assert.equal(undeclared.status, 502)
})

test('rate limits and missing guards', async () => {
  const limiter = createRateLimiter({ capacity: 1, perSecond: 0.0001 })
  const env = { ...open, readLimiter: limiter, fetchImpl: upstream(() => Response.json({ templates: [] })) }
  assert.equal((await handleMiyakeysGallery(get(), env)).status, 200)
  const limited = await handleMiyakeysGallery(get(), env)
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('access-control-allow-origin'), '*')
  assert.equal((await handleMiyakeysGallery(get(), {})).status, 500)
})

test('OPTIONS answers the preflight a JSON POST from the frame makes', async () => {
  const res = await handleMiyakeysGallery({ method: 'OPTIONS', url: URL_, headers: new Headers({ origin: 'null' }) }, open)
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/)
  assert.match(res.headers.get('access-control-allow-headers') ?? '', /content-type/)
  assert.equal((await handleMiyakeysGallery({ method: 'DELETE', url: URL_ }, open)).status, 405)
})

test('POST: the share is rebuilt (no images, no viewer state) and forwarded without the visitor', async () => {
  const seen: Seen[] = []
  const share = {
    name: '  My <b>build</b>\u0000 ',
    snap: {
      ...snap,
      theme: 'dark',
      section: 'x',
      perKeyOverrides: { '0-0': { imageData: 'data:image/png;base64,AAAA', customText: 'Hi' } },
    },
    extra: 'dropped',
  }
  const res = await handleMiyakeysGallery(post(JSON.stringify(share), { origin: 'null', cookie: 'a=b' }), {
    ...open,
    fetchImpl: upstream(() => Response.json({ id: 'new' }), seen),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
  assert.equal(seen[0]!.init.method, 'POST')
  const sent = JSON.parse(String(seen[0]!.init.body))
  assert.deepEqual(Object.keys(sent).sort(), ['name', 'snap'])
  assert.equal(sent.name, 'My <b>build</b>')
  assert.equal(sent.snap.theme, undefined)
  assert.equal(sent.snap.section, undefined)
  assert.deepEqual(sent.snap.perKeyOverrides, { '0-0': { customText: 'Hi' } })
  assert.equal(new Headers(seen[0]!.init.headers).get('cookie'), null)
})

test('POST: refused from other sites, too large, not a build, or without a name', async () => {
  let called = 0
  const env = { ...open, fetchImpl: upstream(() => { called++; return Response.json({}) }) }
  const body = JSON.stringify({ name: 'x', snap })
  assert.equal((await handleMiyakeysGallery(post(body, { origin: 'https://evil.example' }), env)).status, 403)
  assert.equal((await handleMiyakeysGallery(post(body, {}), env)).status, 403)
  assert.equal((await handleMiyakeysGallery(post(undefined), env)).status, 413)
  assert.equal((await handleMiyakeysGallery(post('not json'), env)).status, 400)
  assert.equal((await handleMiyakeysGallery(post(JSON.stringify({ name: 'x', snap: { layout: 'nope' } })), env)).status, 400)
  assert.equal((await handleMiyakeysGallery(post(JSON.stringify({ name: '   ', snap })), env)).status, 400)
  assert.equal(called, 0)
  // This site's own pages may share too.
  assert.equal((await handleMiyakeysGallery(post(body, { origin: SITE }), env)).status, 200)
})

test('POST: an upstream timeout is 504 (it may have been shared), a refusal is 502, a busy gallery is 429', async () => {
  const hang: typeof fetch = ((_: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch
  const body = JSON.stringify({ name: 'x', snap })
  assert.equal((await handleMiyakeysGallery(post(body), { ...open, fetchImpl: hang, timeoutMs: 50 })).status, 504)
  assert.equal((await handleMiyakeysGallery(post(body), { ...open, fetchImpl: upstream(() => new Response('', { status: 400 })) })).status, 502)
  assert.equal((await handleMiyakeysGallery(post(body), { ...open, fetchImpl: upstream(() => new Response('', { status: 429 })) })).status, 429)
  const limited = { ...open, writeLimiter: () => false, fetchImpl: upstream(() => Response.json({})) }
  assert.equal((await handleMiyakeysGallery(post(body), limited)).status, 429)
})

test("the embed's pages get the CSP; all its files get CORS and nosniff", async () => {
  assert.ok(isEmbedPath('/embed/miyakeys/'))
  assert.ok(isEmbedPath('/embed/miyakeys'))
  assert.ok(isEmbedPath('/embed/miyakeys/emoji/1f431.png'))
  assert.ok(!isEmbedPath('/embed/miyakeysx/'))
  assert.ok(!isEmbedPath('/miyakeys'))

  const page = embedResponse(new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }))
  assert.equal(page.headers.get('content-security-policy'), EMBED_CSP)
  assert.equal(page.headers.get('access-control-allow-origin'), '*')
  assert.equal(await page.text(), '<!doctype html>')
  for (const d of ["default-src 'none'", "script-src 'self'", "frame-ancestors 'self'", "base-uri 'none'", "form-action 'none'", "connect-src 'self'"])
    assert.ok(EMBED_CSP.includes(d), d)
  assert.doesNotMatch(EMBED_CSP, /script-src[^;]*unsafe/)
  assert.doesNotMatch(EMBED_CSP, /jsdelivr|https:/)

  const png = embedResponse(new Response('x', { headers: { 'content-type': 'image/png' } }))
  assert.equal(png.headers.get('content-security-policy'), null)
  assert.equal(png.headers.get('access-control-allow-origin'), '*')
  assert.equal(png.headers.get('x-content-type-options'), 'nosniff')
})

test('POST: Origin "null" (any site\'s sandboxed frame) still meets the per-visitor limit and the site-wide cap', async () => {
  const body = JSON.stringify({ name: 'x', snap })
  let called = 0
  const fetchImpl = upstream(() => {
    called++
    return Response.json({})
  })
  const limited = await handleMiyakeysGallery(post(body), { ...open, writeLimiter: () => false, fetchImpl })
  assert.equal(limited.status, 429)
  let taken = 0
  const capped = await handleMiyakeysGallery(post(body), {
    ...open,
    shareCap: async () => (++taken, false),
    fetchImpl,
  })
  assert.equal(capped.status, 429)
  assert.ok(Number(capped.headers.get('retry-after')) > 0)
  assert.equal(taken, 1)
  // A cap that cannot be read refuses the share (fail closed), it never lets it through.
  const broken = await handleMiyakeysGallery(post(body), {
    ...open,
    shareCap: async () => {
      throw new Error('D1_ERROR: no such table: shared_state')
    },
    fetchImpl,
  })
  assert.equal(broken.status, 503)
  assert.equal(called, 0)
  // A share the cap allows goes through; a refused build never spends the cap.
  let spent = 0
  const env = { ...open, shareCap: async () => (++spent, true), fetchImpl }
  assert.equal((await handleMiyakeysGallery(post(body), env)).status, 200)
  assert.equal((await handleMiyakeysGallery(post('not json'), env)).status, 400)
  assert.equal(spent, 1)
})

// node:sqlite stands in for D1 (as in reveal-worker.test.mts), with shared_state as migrations/0003 makes it.
const sqliteModule = 'node:sqlite'
type SqliteStmt = { run: (...a: unknown[]) => { changes: number | bigint }; get: (...a: unknown[]) => Record<string, unknown> | undefined }
const { DatabaseSync } = (await import(sqliteModule)) as {
  DatabaseSync: new (path: string) => { exec: (sql: string) => void; prepare: (sql: string) => SqliteStmt }
}
function sqliteD1() {
  const raw = new DatabaseSync(':memory:')
  const migration = readFileSync(new URL('../migrations/0003_hardening.sql', import.meta.url), 'utf8')
  raw.exec(migration.match(/CREATE TABLE IF NOT EXISTS shared_state[^;]*;/)![0])
  const stmt = (sql: string, args: unknown[] = []): ReturnType<D1Like['prepare']> => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: [] }),
    first: async () => raw.prepare(sql).get(...args) ?? null,
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }),
  })
  return { raw, db: { prepare: (sql: string) => stmt(sql) } as D1Like }
}

test('the site-wide share cap counts in D1, across isolates, and starts again each hour', async () => {
  const { raw, db } = sqliteD1()
  // Two "isolates" with their own cap functions over one database.
  const a = d1ShareCap(db, 3)
  const b = d1ShareCap(db, 3)
  const hour = Date.UTC(2026, 10, 12, 10)
  const taken = [await a(hour + 1), await b(hour + 2), await a(hour + 3), await b(hour + 4), await a(hour + 5)]
  assert.deepEqual(taken, [true, true, true, false, false])
  assert.equal(raw.prepare("SELECT body FROM shared_state WHERE key = 'miyakeys:shares'").get()!.body, '3')
  // The next hour starts at 1; an isolate whose clock is behind counts in the new hour, it never resets it.
  assert.equal(await b(hour + 3_600_000), true)
  assert.equal(await a(hour + 10), true)
  assert.equal(raw.prepare("SELECT body, at FROM shared_state WHERE key = 'miyakeys:shares'").get()!.body, '2')
  assert.equal(raw.prepare("SELECT at FROM shared_state WHERE key = 'miyakeys:shares'").get()!.at, hour + 3_600_000)
  // Without the table it throws, and the handler turns that into a refusal (above).
  const bare = new DatabaseSync(':memory:')
  const none = d1ShareCap({ prepare: (sql: string) => ({ bind: () => ({ run: async () => ({ meta: { changes: Number(bare.prepare(sql).run().changes) } }) }) }) } as unknown as D1Like)
  await assert.rejects(none(hour))
})

test('POST: the per-visitor tag goes to nuroctane.xyz only with a secret, and is never the address', async () => {
  const body = JSON.stringify({ name: 'x', snap })
  const ip = '203.0.113.7'
  const send = async (clientSecret?: string, from = ip) => {
    const seen: Seen[] = []
    const res = await handleMiyakeysGallery(post(body, { origin: 'null', 'cf-connecting-ip': from, 'x-forwarded-for': from }), {
      ...open,
      clientKey,
      clientSecret,
      fetchImpl: upstream(() => Response.json({}), seen),
    })
    assert.equal(res.status, 200)
    return new Headers(seen[0]!.init.headers)
  }
  const without = await send()
  assert.equal(without.get(CLIENT_TAG_HEADER), null)
  const sent = await send('s3cret-s3cret-s3cret-s3cret-s3cret')
  const tag = sent.get(CLIENT_TAG_HEADER)!
  assert.match(tag, /^[0-9a-f]{32}$/)
  assert.equal(tag, await clientTag('s3cret-s3cret-s3cret-s3cret-s3cret', clientKey(new Headers({ 'cf-connecting-ip': ip }))))
  // Stable per visitor, different between visitors and secrets, and nothing of the address in any header.
  assert.equal((await send('s3cret-s3cret-s3cret-s3cret-s3cret')).get(CLIENT_TAG_HEADER), tag)
  assert.notEqual((await send('s3cret-s3cret-s3cret-s3cret-s3cret', '198.51.100.9')).get(CLIENT_TAG_HEADER), tag)
  assert.notEqual((await send('another-secret-another-secret')).get(CLIENT_TAG_HEADER), tag)
  for (const [k, v] of sent) assert.ok(!v.includes(ip) && !v.includes('203.0.113'), k)
  for (const h of ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'cookie']) assert.equal(sent.get(h), null, h)
})

test('GET: an upstream 429 is "busy, try again in a minute", as for a share', async () => {
  const res = await handleMiyakeysGallery(get(), { ...open, fetchImpl: upstream(() => new Response('', { status: 429 })) })
  assert.equal(res.status, 429)
  assert.equal(res.headers.get('retry-after'), '60')
  assert.match(((await res.json()) as { error: string }).error, /busy.*minute/i)
  const share = await handleMiyakeysGallery(post(JSON.stringify({ name: 'x', snap })), { ...open, fetchImpl: upstream(() => new Response('', { status: 429 })) })
  assert.equal(share.status, 429)
})

test(`GET: at most ${GALLERY_MAX_TEMPLATES} builds, the newest, and the reply says there are more`, async () => {
  const many = Array.from({ length: GALLERY_MAX_TEMPLATES + 20 }, (_, i) => ({
    ...entry(`b${i}`),
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
  }))
  const res = await handleMiyakeysGallery(get(), { ...open, fetchImpl: upstream(() => Response.json({ templates: many })) })
  const data = (await res.json()) as { templates: Array<{ id: string }>; more?: boolean }
  assert.equal(data.templates.length, GALLERY_MAX_TEMPLATES)
  assert.equal(data.more, true)
  assert.equal(data.templates[0]!.id, 'b20', 'the oldest 20 are the ones left out, order kept')
  assert.equal(data.templates.at(-1)!.id, String(`b${GALLERY_MAX_TEMPLATES + 19}`))
  const few = await handleMiyakeysGallery(get(), { ...open, fetchImpl: upstream(() => Response.json({ templates: many.slice(0, 3) })) })
  assert.equal(((await few.json()) as { more?: boolean }).more, undefined)
})

test('GET: the cleaned gallery is kept for a short while; a share here clears it', async () => {
  let now = 1_000_000
  const clock = () => now
  let reads = 0
  const env = {
    ...open,
    now: clock,
    cache: memoryCache(clock),
    fetchImpl: upstream(() => {
      reads++
      return Response.json({ templates: [entry(`v${reads}`)] })
    }),
  }
  const ids = async () => ((await (await handleMiyakeysGallery(get(), env)).json()) as { templates: Array<{ id: string }> }).templates.map((t) => t.id)
  assert.deepEqual(await ids(), ['v1'])
  now += 1000
  assert.deepEqual(await ids(), ['v1'], 'served from the cache')
  assert.equal(reads, 1)
  now += GALLERY_CACHE_SECONDS * 1000
  assert.deepEqual(await ids(), ['v2'], 'read again once it is old')
  assert.equal((await handleMiyakeysGallery(post(JSON.stringify({ name: 'x', snap })), env)).status, 200)
  assert.deepEqual(await ids(), ['v4'], 'read again after a share (the POST was read 3)')
  // Failures are never cached.
  const bad = { ...open, now: clock, cache: memoryCache(clock), fetchImpl: upstream(() => new Response('', { status: 500 })) }
  assert.equal((await handleMiyakeysGallery(get(), bad)).status, 502)
  assert.equal(await bad.cache.get('miyakeys-gallery'), undefined)
})

test("a wrong path under the embed is a 404, not the desktop's page under the embed's CSP", async () => {
  const spa = () => new Response('<!doctype html><title>desktop</title>', { headers: { 'content-type': 'text/html' } })
  for (const p of ['/embed/miyakeys/nope', '/embed/miyakeys/js/missing.js', '/embed/miyakeys/emoji/0000.png', '/embed/miyakeys/x/']) {
    const res = embedResponse(spa(), p)
    assert.equal(res.status, 404, p)
    assert.doesNotMatch(await res.text(), /desktop/)
  }
  for (const p of ['/embed/miyakeys/', '/embed/miyakeys', '/embed/miyakeys/index.html']) {
    const res = embedResponse(spa(), p)
    assert.equal(res.status, 200, p)
    assert.equal(res.headers.get('content-security-policy'), EMBED_CSP)
  }
  const png = embedResponse(new Response('x', { headers: { 'content-type': 'image/png' } }), '/embed/miyakeys/emoji/1f431.png')
  assert.equal(png.status, 200)
  assert.equal(png.headers.get('access-control-allow-origin'), '*')
})
