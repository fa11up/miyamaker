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
 * Guards are passed in (see zeroex.ts) so `node --test` loads this with only the import-free validator.
 */
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

/**
 * The embed's files as the asset store answered, plus: the CSP on its pages, nosniff, and CORS for all of them (an
 * opaque-origin page loads its emoji with crossOrigin, so the textures it draws them into stay readable).
 */
export function embedResponse(response: Response): Response {
  const headers = new Headers(response.headers)
  if (/text\/html/i.test(headers.get('content-type') ?? '')) {
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
  fetchImpl?: typeof fetch
  timeoutMs?: number
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

/** The gallery as nuroctane.xyz holds it, every entry rebuilt (validGalleryEntry); invalid entries dropped. */
export function cleanGallery(data: unknown): { templates: unknown[] } | undefined {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { templates?: unknown }).templates)) return undefined
  const templates = (data as { templates: unknown[] }).templates.map(validGalleryEntry).filter(Boolean)
  return { templates }
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
  const key = env.clientKey(request.headers)
  // Only the page's own fields go out: no cookie, no address, nothing of the visitor's request.
  const upstreamHeaders: Record<string, string> = { accept: 'application/json', origin: url.origin }

  if (request.method === 'GET') {
    if (!env.readLimiter(key)) return reply(429, { error: 'Too many gallery reads.' }, { 'retry-after': '5' })
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
    return reply(200, gallery)
  }

  // POST: from the frame (Origin "null") or this site; not from another site's page spending this route.
  const origin = request.headers?.get('origin')
  if (origin !== 'null' && origin !== url.origin) return reply(403, { error: 'Only miyakeys can share builds here.' })
  if (!env.writeLimiter(key)) return reply(429, { error: 'Too many shares just now.' }, { 'retry-after': '30' })
  if (request.body === undefined) return reply(413, { error: 'That build is too large.' })
  const share = cleanShare(request.body)
  if ('error' in share) return reply(400, { error: share.error })

  let upstream: Response
  try {
    upstream = await fetchImpl(MIYAKEYS_UPSTREAM, {
      method: 'POST',
      headers: { ...upstreamHeaders, 'content-type': 'application/json' },
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
  if (upstream.status === 429) return reply(429, { error: 'The gallery is taking too many shares just now.' }, { 'retry-after': '60' })
  if (!upstream.ok) return reply(502, { error: 'The gallery turned the build down.' })
  return reply(200, { ok: true })
}
