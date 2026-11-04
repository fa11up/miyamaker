// Cloudflare Worker: the 0x and OpenSea proxies (keys injected server-side, see api/_lib), the apex -> www redirect,
// and everything else from the static build in dist/ (wrangler.jsonc).
import { handleOpenSeaRequest, OPENSEA_PROXY_PATH } from './_lib/opensea'
import { clientKey, createRateLimiter, handleZeroExRequest, PROXY_PREFIX, sameOrigin } from './_lib/zeroex'

type Env = {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  ZEROX_API_KEY?: string
  OPENSEA_API_KEY?: string
}

const APEX = 'miyamaker.com'

const guards = {
  sameOrigin,
  clientKey,
  readLimiter: createRateLimiter({ capacity: 120, perSecond: 2 }),
  fillLimiter: createRateLimiter({ capacity: 10, perSecond: 0.2 }),
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.hostname === APEX) {
      url.hostname = `www.${APEX}`
      return Response.redirect(url.toString(), 308)
    }

    if (url.pathname.startsWith(`${PROXY_PREFIX}/`)) {
      return handleZeroExRequest(request, { ZEROX_API_KEY: env.ZEROX_API_KEY })
    }

    if (url.pathname === OPENSEA_PROXY_PATH) {
      const body = request.method === 'POST' ? (await request.text()).slice(0, 4096) : undefined
      return handleOpenSeaRequest(
        { method: request.method, url: request.url, headers: request.headers, body },
        { OPENSEA_API_KEY: env.OPENSEA_API_KEY },
        guards
      )
    }

    return env.ASSETS.fetch(request)
  },
}
