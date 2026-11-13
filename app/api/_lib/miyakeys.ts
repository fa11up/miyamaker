/**
 * miyakeys (embed/miyakeys): its community gallery, read and written through this site, and the headers its page is
 * served with.
 *
 * The gallery is MODKEYS's on nuroctane.xyz. The page runs in a sandboxed frame with an opaque origin, so it asks
 * /api/miyakeys/gallery here rather than nuroctane.xyz: visitors' addresses and cookies never reach nuroctane.xyz
 * (a fresh request goes out, with none of the visitor's headers), every build that comes back is rebuilt from the
 * page's own allowlist (validBuild.js) and anything invalid is dropped, and both directions are capped in size and time.
 * Answers carry `Access-Control-Allow-Origin: *`: the frame's origin is "null", and the gallery is public anyway.
 *
 * Every share reaches nuroctane.xyz from Cloudflare's addresses, so it cannot tell one visitor from another. Two
 * things keep one abuser from getting everyone turned away: caps on shares per visitor and for the whole site
 * (`shareCap`, held in D1 so they count across isolates, see d1ShareCap; one visitor alone can never use up the site's
 * hour), and, when MIYAKEYS_CLIENT_SECRET is set, an opaque per-visitor tag
 * (`x-miyakeys-client`, see clientTag) nuroctane.xyz can throttle on without ever seeing an address.
 *
 * Guards are passed in (see zeroex.ts) so `node --test` loads this with only the import-free validator.
 */
import type { MarketCache } from './market'
import type { D1Like } from './station'
import { MAX_NAME, cleanText, validBuild, validGalleryEntry } from '../../embed/miyakeys/js/core/validBuild.js'

export const MIYAKEYS_GALLERY_PATH = '/api/miyakeys/gallery'
export const MIYAKEYS_UPSTREAM = 'https://www.nuroctane.xyz/api/modkeys/gallery'
/** A shared build without images is a few KB (a whole board of per-key edits, ~15 KB). */
export const GALLERY_BODY_LIMIT = 32 * 1024
/** The whole gallery (today ~27 KB for 24 builds). Larger is refused, never cut short and passed on as complete. */
export const GALLERY_RESPONSE_LIMIT = 2 * 1024 * 1024
export const GALLERY_TIMEOUT_MS = 8_000
/** Reads: a Gallery open or two a minute per visitor. Writes: a share now and then. */
export const GALLERY_READ_RATE = { capacity: 30, perSecond: 0.5 }
export const GALLERY_WRITE_RATE = { capacity: 5, perSecond: 0.05 }
/** Shares from the whole site per clock hour, in every isolate together (d1ShareCap). */
export const GALLERY_SITE_SHARES_PER_HOUR = 100
/**
 * Shares from one visitor per clock hour, in every isolate together (d1ShareCap). A visitor is an IPv4 address or an
 * IPv6 /48 (shareBucket): a /64 or more is often one person's, so a /64 would let one person take ten.
 */
export const GALLERY_CLIENT_SHARES_PER_HOUR = 10
/**
 * The per-visitor counts live in this many fixed rows (a hash of the visitor picks one), so the table never grows with
 * visitors; two visitors that land on one row share its count, which at this site's traffic is rare and harmless.
 */
export const GALLERY_CLIENT_SLOTS = 1024
/** A secret shorter than this is ignored (miyakeysSecret): a short one could be guessed, and tags then unmasked. */
export const MIN_CLIENT_SECRET = 32
/** At most this many builds are passed on (the newest, when there are more); the reply then says `more: true`. */
export const GALLERY_MAX_TEMPLATES = 500
/** One gallery read upstream per data centre per this long; a share here clears it, so the sharer sees their build. */
export const GALLERY_CACHE_SECONDS = 45
const GALLERY_CACHE_KEY = 'miyakeys-gallery'
/** When a share here last went through: a gallery read that began before it never caches what it read (see GET). */
const GALLERY_SHARED_KEY = 'miyakeys-gallery-shared'
/** The header nuroctane.xyz can throttle one visitor on (clientTag). */
export const CLIENT_TAG_HEADER = 'x-miyakeys-client'
/** Upstream 429, on reads and shares alike. */
const BUSY = 'The gallery is busy just now. Try again in a minute.'

export const EMBED_PREFIX = '/embed/miyakeys'

/**
 * The frame's page may load its own scripts, styles, images and fonts from this site and talk to this site's API, and
 * nothing else; only this site may frame it. Vite emits no inline script (the entry is js/boot.js); styles stay
 * 'unsafe-inline' for the style attributes in its markup. data:/blob: images are thumbnails and key images; blob:
 * workers and data: connects are jsPDF / svg2pdf reading images while making a PDF.
 */
export const EMBED_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  'worker-src blob:',
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export const isEmbedPath = (pathname: string) => pathname === EMBED_PREFIX || pathname.startsWith(`${EMBED_PREFIX}/`)

/** The embed's one page. Any other path the asset store answers with HTML is its single-page fallback: the desktop. */
const EMBED_PAGES = new Set([EMBED_PREFIX, `${EMBED_PREFIX}/`, `${EMBED_PREFIX}/index.html`])

/**
 * The embed's files as the asset store answered, plus: the CSP on its pages, nosniff, and CORS for all of them (an
 * opaque-origin page loads its emoji with crossOrigin, so the textures it draws them into stay readable). With
 * `pathname`, HTML anywhere but the embed's page is a missing file (the store's fallback is the desktop's index.html,
 * with a 200): a plain 404.
 */
export function embedResponse(response: Response, pathname?: string): Response {
  const headers = new Headers(response.headers)
  const html = /text\/html/i.test(headers.get('content-type') ?? '')
  if (html && pathname !== undefined && !EMBED_PAGES.has(pathname)) {
    void response.body?.cancel().catch(() => undefined)
    return new Response('Not found.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' },
    })
  }
  if (html) {
    headers.set('content-security-policy', EMBED_CSP)
    headers.set('referrer-policy', 'no-referrer')
  }
  headers.set('x-content-type-options', 'nosniff')
  headers.set('access-control-allow-origin', '*')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '600',
}

const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...CORS,
      ...extra,
    },
  })

type Guard = {
  clientKey?: (headers: Headers | undefined) => string
  readLimiter?: (key: string, now?: number) => boolean
  writeLimiter?: (key: string, now?: number) => boolean
  /**
   * The per-visitor and site-wide share caps (d1ShareCap). A throw (D1 down, table missing) refuses the share: once a
   * cap is configured, sharing never runs without it.
   */
  shareCap?: ShareCap
  /** MIYAKEYS_CLIENT_SECRET: when set, shares carry clientTag's opaque per-visitor header. Unset, no header. */
  clientSecret?: string
  /** Where the cleaned gallery is kept for GALLERY_CACHE_SECONDS (the Worker's edge cache). Unset, no caching. */
  cache?: MarketCache
  now?: () => number
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * The visitor as nuroctane.xyz sees them: HMAC-SHA256 of the client key (the address, IPv6 by /64) under a secret only
 * this site holds, 32 hex characters. The same visitor always gets the same tag; the tag says nothing of the address.
 */
export async function clientTag(secret: string, key: string): Promise<string> {
  const enc = new TextEncoder()
  const hmac = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', hmac, enc.encode(`miyakeys-client:${key}`))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

let warnedSecret = false
/**
 * MIYAKEYS_CLIENT_SECRET as configured: trimmed, and ignored (no tag is sent, logged once) when shorter than
 * MIN_CLIENT_SECRET characters.
 */
export function miyakeysSecret(raw: string | undefined, warn: (msg: string) => void = console.warn): string | undefined {
  const secret = raw?.trim()
  if (!secret) return undefined
  if (secret.length >= MIN_CLIENT_SECRET) return secret
  if (!warnedSecret) {
    warnedSecret = true
    warn(`miyakeys: MIYAKEYS_CLIENT_SECRET is shorter than ${MIN_CLIENT_SECRET} characters and is ignored; shares carry no ${CLIENT_TAG_HEADER} tag`)
  }
  return undefined
}

/**
 * The visitor a share is counted against: an IPv4 address as it is, IPv6 by its /48. Takes clientKey's answer (IPv6
 * already cut to "a:b:c:d::/64", see ipBucket) and cuts it further.
 */
export function shareBucket(key: string): string {
  const v6 = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):[0-9a-f]{1,4}::\/64$/.exec(key)
  return v6 ? `${v6[1]}:${v6[2]}:${v6[3]}::/48` : key
}

/** Which of GALLERY_CLIENT_SLOTS rows counts this visitor: SHA-256 of the bucket, so no address is stored. */
export async function shareSlot(bucket: string, slots = GALLERY_CLIENT_SLOTS): Promise<string> {
  const sig = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`miyakeys-share:${bucket}`))
  const n = new DataView(sig).getUint32(0) % slots
  return `miyakeys:shares:${n.toString(16).padStart(3, '0')}`
}

export type ShareCap = {
  /** Takes one share for this visitor (shareBucket) and the site, or says which count is used up for the hour. */
  take: (now: number, client: string) => Promise<'ok' | 'client' | 'site'>
  /** Gives the site's share back: nuroctane.xyz turned the build down, so nothing was added. */
  giveBack: (now: number) => Promise<void>
}

/** One clock hour's count in one shared_state row: takes one, or (changes 0) refuses at `limit`. */
const TAKE = `INSERT INTO shared_state (key, body, at, expires_at, lock_until) VALUES (?, '1', ?, ?, 0)
  ON CONFLICT (key) DO UPDATE SET
    body = CASE WHEN shared_state.at < excluded.at THEN '1' ELSE CAST(CAST(shared_state.body AS INTEGER) + 1 AS TEXT) END,
    at = MAX(shared_state.at, excluded.at),
    expires_at = MAX(shared_state.expires_at, excluded.expires_at)
  WHERE shared_state.at < excluded.at OR CAST(shared_state.body AS INTEGER) < ?`
/** Hands one back, only within the same hour and never below 0. */
const GIVE_BACK = `UPDATE shared_state SET body = CAST(MAX(CAST(body AS INTEGER) - 1, 0) AS TEXT) WHERE key = ? AND at = ?`

/**
 * The share caps, counted in D1 so every isolate and data centre shares one count, in shared_state
 * (migrations/0003_hardening.sql, already applied for miyatv): `at` is the clock hour, `body` its count, the row
 * overwritten in place when the hour turns. The site has one row ('miyakeys:shares'); visitors have
 * GALLERY_CLIENT_SLOTS rows between them (shareSlot), so there are never more than that many, whoever comes.
 * Each count is one statement, so two isolates can never both take the last share. The visitor's is taken first; when
 * the site's is used up, the visitor's is handed back.
 */
export function d1ShareCap(
  db: D1Like,
  perHour = GALLERY_SITE_SHARES_PER_HOUR,
  perClient = GALLERY_CLIENT_SHARES_PER_HOUR,
  slots = GALLERY_CLIENT_SLOTS
): ShareCap {
  const hourOf = (now: number) => Math.floor(now / 3_600_000) * 3_600_000
  const take = async (key: string, hour: number, limit: number) =>
    (await db.prepare(TAKE).bind(key, hour, hour + 3_600_000, limit).run()).meta.changes > 0
  return {
    async take(now, client) {
      const hour = hourOf(now)
      const slot = await shareSlot(client, slots)
      if (!(await take(slot, hour, perClient))) return 'client'
      if (await take('miyakeys:shares', hour, perHour)) return 'ok'
      await db.prepare(GIVE_BACK).bind(slot, hour).run()
      return 'site'
    },
    async giveBack(now) {
      await db.prepare(GIVE_BACK).bind('miyakeys:shares', hourOf(now)).run()
    },
  }
}

/** The body as text, or undefined when it runs past `limit` bytes (stated or actual). Never a cut-short body. */
export async function readCapped(response: Response, limit: number): Promise<string | undefined> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined)
    return undefined
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const out = new Uint8Array(limit)
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (size + value.byteLength > limit) return undefined
      out.set(value, size)
      size += value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return new TextDecoder().decode(out.subarray(0, size))
}

/**
 * The gallery as nuroctane.xyz holds it, every entry rebuilt (validGalleryEntry); invalid entries dropped. Past
 * `max` builds, the newest `max` are kept (in the order given) and the reply says `more: true`, never passing a cut
 * list off as the whole gallery.
 */
export function cleanGallery(
  data: unknown,
  max = GALLERY_MAX_TEMPLATES
): { templates: unknown[]; more?: true } | undefined {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { templates?: unknown }).templates)) return undefined
  const templates = (data as { templates: unknown[] }).templates.map(validGalleryEntry).filter(Boolean)
  if (templates.length <= max) return { templates }
  const time = (t: unknown) => Date.parse(String((t as { createdAt?: unknown }).createdAt ?? '')) || 0
  const keep = new Set(
    templates
      .map((t, i) => ({ i, at: time(t) }))
      .sort((a, b) => b.at - a.at || a.i - b.i)
      .slice(0, max)
      .map((x) => x.i)
  )
  return { templates: templates.filter((_, i) => keep.has(i)), more: true }
}

/** A share as the page sends it ({ name, snap }), rebuilt; or an error to show. Images never go to the gallery. */
export function cleanShare(body: string): { name: string; snap: object } | { error: string } {
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    return { error: 'That is not a build.' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'That is not a build.' }
  const d = data as { name?: unknown; snap?: unknown }
  const name = (cleanText(d.name, MAX_NAME) ?? '').replace(/\n/g, ' ').trim()
  if (!name) return { error: 'A shared build needs a name.' }
  // validBuild.js is plain JS: its inferred type does not list the enum fields it copies across.
  const snap = validBuild(d.snap, { images: false }) as (object & { layout?: string }) | null
  if (!snap || !snap.layout) return { error: 'That is not a build.' }
  return { name, snap }
}

/**
 * GET: the gallery. POST: share one build. OPTIONS: the CORS preflight a JSON POST makes. `body` is the POST body,
 * already read with a cap (worker.ts): undefined means it was too large.
 */
export async function handleMiyakeysGallery(
  request: { method: string; url: string; headers?: Headers; body?: string },
  env: Guard
): Promise<Response> {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname !== MIYAKEYS_GALLERY_PATH) return reply(404, { error: 'Not found.' })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'GET' && request.method !== 'POST') return reply(405, { error: 'GET or POST only.' }, { allow: 'GET, POST, OPTIONS' })
  // Fail closed: a caller that forgets a guard gets an error, never an open proxy.
  if (!env?.clientKey || !env.readLimiter || !env.writeLimiter) return reply(500, { error: 'The gallery is not configured.' })

  const fetchImpl = env.fetchImpl ?? fetch
  const timeoutMs = env.timeoutMs ?? GALLERY_TIMEOUT_MS
  const now = (env.now ?? Date.now)()
  const key = env.clientKey(request.headers)
  // Only the page's own fields go out: no cookie, no address, nothing of the visitor's request.
  const upstreamHeaders: Record<string, string> = { accept: 'application/json', origin: url.origin }

  if (request.method === 'GET') {
    if (!env.readLimiter(key)) return reply(429, { error: 'Too many gallery reads.' }, { 'retry-after': '5' })
    // A copy at most GALLERY_CACHE_SECONDS old; `body: null` is a share's "read it again".
    const saved = await env.cache?.get(GALLERY_CACHE_KEY).catch(() => undefined)
    if (saved?.body && now - saved.at >= 0 && now - saved.at < GALLERY_CACHE_SECONDS * 1000) return reply(200, saved.body)
    let upstream: Response
    try {
      upstream = await fetchImpl(MIYAKEYS_UPSTREAM, {
        headers: upstreamHeaders,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      const slow = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError'
      return reply(slow ? 504 : 502, { error: slow ? 'The gallery did not answer in time.' : 'The gallery did not answer.' })
    }
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => undefined)
      if (upstream.status === 429) return reply(429, { error: BUSY }, { 'retry-after': '60' })
      return reply(502, { error: 'The gallery is unavailable.' })
    }
    const text = await readCapped(upstream, GALLERY_RESPONSE_LIMIT).catch(() => undefined)
    if (text === undefined) return reply(502, { error: 'The gallery answered with more than it should.' })
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      return reply(502, { error: 'The gallery answered with something that is not a gallery.' })
    }
    const gallery = cleanGallery(data)
    if (!gallery) return reply(502, { error: 'The gallery answered with something that is not a gallery.' })
    // A share that went through while this read was out may be missing from it: then it is answered but not kept, so
    // the sharer's next read is fresh. (Checked just before keeping it; the share marks its time after upstream took it.)
    if (env.cache) {
      const shared = await env.cache.get(GALLERY_SHARED_KEY).catch(() => undefined)
      if (!(shared && typeof shared.at === 'number' && shared.at >= now))
        await env.cache.put(GALLERY_CACHE_KEY, { at: now, body: gallery }, GALLERY_CACHE_SECONDS).catch(() => undefined)
    }
    return reply(200, gallery)
  }

  // POST. The Origin check stops ordinary pages on other sites (they send their own origin), and nothing more: the
  // frame's Origin is "null", and so is that of ANY site's sandboxed frame, or a data: page; scripts send what they
  // like. So "null" is let through, and what holds a share back is the same for everyone: the per-visitor limit
  // (per isolate), the per-visitor and site-wide caps (shareCap, across isolates), and the tag nuroctane.xyz can
  // throttle one visitor on.
  const origin = request.headers?.get('origin')
  if (origin !== 'null' && origin !== url.origin) return reply(403, { error: 'Only miyakeys can share builds here.' })
  if (!env.writeLimiter(key)) return reply(429, { error: 'Too many shares just now.' }, { 'retry-after': '30' })
  if (request.body === undefined) return reply(413, { error: 'That build is too large.' })
  const share = cleanShare(request.body)
  if ('error' in share) return reply(400, { error: share.error })
  if (env.shareCap) {
    let taken: 'ok' | 'client' | 'site'
    try {
      taken = await env.shareCap.take(now, shareBucket(key))
    } catch {
      return reply(503, { error: 'Sharing is paused just now. Try again later.' }, { 'retry-after': '300' })
    }
    const nextHour = String(Math.ceil((Math.floor(now / 3_600_000) * 3_600_000 + 3_600_000 - now) / 1000))
    if (taken === 'client') return reply(429, { error: 'You have shared all the builds you can this hour. Try again later.' }, { 'retry-after': nextHour })
    if (taken !== 'ok') return reply(429, { error: 'The gallery has taken all the shares it can this hour. Try again later.' }, { 'retry-after': nextHour })
  }
  const tag: Record<string, string> = env.clientSecret ? { [CLIENT_TAG_HEADER]: await clientTag(env.clientSecret, key) } : {}

  let upstream: Response
  try {
    upstream = await fetchImpl(MIYAKEYS_UPSTREAM, {
      method: 'POST',
      headers: { ...upstreamHeaders, ...tag, 'content-type': 'application/json' },
      body: JSON.stringify(share),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    const slow = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError'
    // A timeout is not "not shared": the gallery may have taken it. The page says so.
    return reply(slow ? 504 : 502, { error: slow ? 'The gallery did not answer in time.' : 'The gallery did not answer.' })
  }
  await upstream.body?.cancel().catch(() => undefined)
  if (upstream.status === 429) return reply(429, { error: BUSY }, { 'retry-after': '60' })
  if (!upstream.ok) {
    // Turned down (4xx): nothing was added, so the site's hour gets that share back. The visitor's stays spent, so
    // one visitor sending builds upstream refuses still meets their own cap. A 429 (upstream is pressed) and 5xx /
    // redirects (it may have been taken) keep it spent.
    if (upstream.status >= 400 && upstream.status < 500) await env.shareCap?.giveBack(now).catch(() => undefined)
    return reply(502, { error: 'The gallery turned the build down.' })
  }
  // The sharer's next Gallery (in this data centre) reads afresh and shows their build; a read already out when the
  // build went in does not keep what it read (GALLERY_SHARED_KEY).
  const sharedAt = (env.now ?? Date.now)()
  await env.cache?.put(GALLERY_SHARED_KEY, { at: sharedAt, body: null }, GALLERY_CACHE_SECONDS).catch(() => undefined)
  await env.cache?.put(GALLERY_CACHE_KEY, { at: sharedAt, body: null }, GALLERY_CACHE_SECONDS).catch(() => undefined)
  return reply(200, { ok: true })
}
