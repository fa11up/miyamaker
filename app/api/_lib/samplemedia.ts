/**
 * Same-origin reader for sample audio and video that a collection host will not
 * let the browser fetch directly (Ravepigs animations, public IPFS gateways).
 * The host list is closed. This is not an open proxy, and it never sees a wallet key.
 * sameOrigin, clientKey and the limiter are passed in (see zeroex.ts) so this file
 * can load under `node --test` with no imports.
 */

export const SAMPLE_MEDIA_PATH = '/api/sample-media'
export const SAMPLE_MEDIA_LIMIT = 24 * 1024 * 1024

const HOSTS = new Set([
  'api.ravepigs.dev',
  'gateway.pinata.cloud',
  'ipfs.io',
  'cloudflare-ipfs.com',
  'dweb.link',
  'nftstorage.link',
  'w3s.link',
])

type Guard = {
  sameOrigin: (headers: Headers | undefined, url: URL) => boolean
  clientKey: (headers: Headers | undefined) => string
  limiter: (key: string, now?: number) => boolean
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
  const host = url.hostname.toLowerCase()
  const suffix = host.endsWith('.ipfs.dweb.link') || host.endsWith('.ipfs.nftstorage.link')
  if (!HOSTS.has(host) && !suffix) return null
  return url
}

function json(status: number, message: string, extra?: Record<string, string>) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  })
}

async function readCapped(response: Response): Promise<Uint8Array | 'too-large'> {
  const length = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(length) && length > SAMPLE_MEDIA_LIMIT) return 'too-large'
  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer())
    return buf.byteLength > SAMPLE_MEDIA_LIMIT ? 'too-large' : buf
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    const value = step.value
    if (!value) continue
    total += value.byteLength
    if (total > SAMPLE_MEDIA_LIMIT) {
      await reader.cancel()
      return 'too-large'
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export async function handleSampleMediaRequest(
  request: { method: string; url: string; headers?: Headers },
  env: Guard
): Promise<Response> {
  const url = new URL(request.url, 'http://localhost')
  // Dev middleware can leave a slash between the mount path and the query.
  if (url.pathname.replace(/\/+$/, '') !== SAMPLE_MEDIA_PATH) return json(404, 'Not found.')
  if (request.method !== 'GET') return json(405, 'GET only.', { allow: 'GET' })
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
  const body = await readCapped(upstream)
  if (body === 'too-large') return json(413, 'That file is over 24 MB.')
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      'content-length': String(body.byteLength),
      'cache-control': 'private, max-age=300',
    },
  })
}
