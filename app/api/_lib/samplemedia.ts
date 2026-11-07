/**
 * Same-origin reader for sample audio and video that a collection host will not
 * let the browser fetch directly (Ravepigs animations, public IPFS gateways).
 * The host list is closed (media/allow.js, the same list the app checks). This is not an open proxy, and it never
 * sees a wallet key. What comes back is served as audio, video or plain bytes, never as a page (media/serve.js).
 * sameOrigin, clientKey and the limiter are passed in (see zeroex.ts) so this file
 * can load under `node --test` with only import-free modules. Without them every request is refused.
 */

import { isMediaHost, SAMPLE_MEDIA_LIMIT } from '../../src/pages/MusicMaker/media/allow.js'
import { cappedStream, mediaHeaders } from '../../src/pages/MusicMaker/media/serve.js'

export { SAMPLE_MEDIA_LIMIT }
export const SAMPLE_MEDIA_PATH = '/api/sample-media'
/** A kit asks once per pad, all at once, so a whole 64-pad kit fits in one burst; then about one a second. */
export const SAMPLE_MEDIA_RATE = { capacity: 64, perSecond: 1 }

type Guard = {
  sameOrigin?: (headers: Headers | undefined, url: URL) => boolean
  clientKey?: (headers: Headers | undefined) => string
  limiter?: (key: string, now?: number) => boolean
  fetchImpl?: typeof fetch
}

/** https URL on the host list, or null. A base resolves one relative redirect. */
export function allowedMediaUrl(raw: string | null | undefined, base?: string): URL | null {
  if (raw == null || raw === '') return null
  let url: URL
  try {
    url = base ? new URL(raw, base) : new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (!isMediaHost(url.hostname)) return null
  return url
}

function json(status: number, message: string, extra?: Record<string, string>) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  })
}

export async function handleSampleMediaRequest(
  request: { method: string; url: string; headers?: Headers },
  env: Guard
): Promise<Response> {
  const url = new URL(request.url, 'http://localhost')
  // The Worker routes this exact path only, so the handler answers the same one.
  if (url.pathname !== SAMPLE_MEDIA_PATH) return json(404, 'Not found.')
  if (request.method !== 'GET') return json(405, 'GET only.', { allow: 'GET' })
  // Fail closed: a caller that forgets a guard gets an error, never an open proxy.
  if (!env?.sameOrigin || !env.clientKey || !env.limiter) return json(500, 'The sample reader is not configured.')
  if (!env.sameOrigin(request.headers, url)) return json(403, 'Same-origin only.')
  if (!env.limiter(env.clientKey(request.headers))) return json(429, 'Too many sample reads.', { 'retry-after': '5' })

  const target = allowedMediaUrl(url.searchParams.get('url'))
  if (!target) return json(400, 'That host is not allowed.')

  const fetchImpl = env.fetchImpl ?? fetch
  let upstream: Response
  try {
    upstream = await fetchImpl(target, { redirect: 'manual' })
  } catch {
    return json(502, 'The sample host did not answer.')
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    const next = allowedMediaUrl(upstream.headers.get('location'), target.href)
    if (!next) return json(400, 'That redirect is not allowed.')
    try {
      upstream = await fetchImpl(next, { redirect: 'manual' })
    } catch {
      return json(502, 'The sample host did not answer.')
    }

    if (upstream.status >= 300 && upstream.status < 400) return json(400, 'That redirect is not allowed.')
  }

  if (!upstream.ok) return json(502, 'The sample host refused the file.')
  const length = Number(upstream.headers.get('content-length') || 0)
  if (Number.isFinite(length) && length > SAMPLE_MEDIA_LIMIT) {
    await upstream.body?.cancel().catch(() => undefined)
    return json(413, 'That file is over 24 MB.')
  }

  // Passed on as it arrives rather than held whole. A file that runs past the cap without saying its length fails.
  const body = upstream.body ? cappedStream(upstream.body, SAMPLE_MEDIA_LIMIT) : null
  try {
    return new Response(body, { status: 200, headers: mediaHeaders(upstream.headers.get('content-type')) })
  } catch {
    return json(502, 'The sample host sent a file this site cannot pass on.')
  }
}
