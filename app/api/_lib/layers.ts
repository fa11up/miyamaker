/** The published MiyaMaker layers. koolskull.com does not send CORS, so the editor reads them through this path. */

export const LAYERS_PROXY_PATH = '/miyamaker-layers'
export const LAYERS_ORIGIN = 'https://koolskull.com/miyamaker/layers'

/** Upstream URL for a same-origin layers request, or null when the path is not that folder. */
export function layersTarget(pathname: string): string | null {
  if (pathname !== LAYERS_PROXY_PATH && !pathname.startsWith(`${LAYERS_PROXY_PATH}/`)) return null
  let rest = pathname.slice(LAYERS_PROXY_PATH.length)
  if (rest === '') rest = '/'
  try {
    rest = decodeURIComponent(rest)
  } catch {
    return null
  }
  if (!rest.startsWith('/') || rest.includes('\\') || rest.includes('\0')) return null
  const directory = rest.endsWith('/')
  const parts = rest.split('/').filter((part) => part.length > 0)
  if (parts.some((part) => part === '.' || part === '..')) return null
  const suffix = parts.map((part) => encodeURIComponent(part)).join('/')
  if (!suffix) return `${LAYERS_ORIGIN}/`
  return `${LAYERS_ORIGIN}/${suffix}${directory ? '/' : ''}`
}

export async function handleLayersRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  const target = layersTarget(new URL(request.url).pathname)
  if (!target) return new Response('Not found', { status: 404 })
  const upstream = await fetch(target, { method: request.method, redirect: 'follow' })
  const headers = new Headers()
  const type = upstream.headers.get('content-type')
  if (type) headers.set('content-type', type)
  else if (target.endsWith('.png')) headers.set('content-type', 'image/png')
  else if (target.endsWith('/')) headers.set('content-type', 'text/html; charset=utf-8')
  headers.set('cache-control', 'public, max-age=300')
  if (request.method === 'HEAD') return new Response(null, { status: upstream.status, headers })
  return new Response(upstream.body, { status: upstream.status, headers })
}
