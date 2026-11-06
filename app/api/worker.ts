// Cloudflare Worker: the 0x and OpenSea proxies (keys injected server-side, see api/_lib), the apex -> www redirect,
// and everything else from the static build in dist/ (wrangler.jsonc).
import { verifyMessage } from 'viem'

import { edgeCache, handleMarketRequest, MARKET_PREFIX, openSeaReader } from './_lib/market'
import { handleOpenSeaRequest, OPENSEA_PROXY_PATH, quoteBigInts } from './_lib/opensea'
import { d1TapeStore, handlePublicAccessRequest, PUBLIC_ACCESS_PATH, youtubeLookup } from './_lib/publicaccess'
import type { D1Like } from './_lib/station'
import { d1Store, gatewayContentType, handleStationRequest, STATION_PATH } from './_lib/station'
import { handleTvLiveRequest, TV_LIVE_PATH } from './_lib/tvlive'
import { clientKey, createRateLimiter, handleZeroExRequest, PROXY_PREFIX, sameOrigin } from './_lib/zeroex'

type Env = {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  ZEROX_API_KEY?: string
  OPENSEA_API_KEY?: string
  /** Finds miyatv's current YouTube streams (api/_lib/tvlive.ts). */
  YOUTUBE_API_KEY?: string
  /** The radio's community station (migrations/). */
  DB?: D1Like
  /** Wallets that can remove any station track, comma-separated. */
  STATION_ADMINS?: string
}

const APEX = 'miyamaker.com'

const guards = {
  sameOrigin,
  clientKey,
  readLimiter: createRateLimiter({ capacity: 120, perSecond: 2 }),
  fillLimiter: createRateLimiter({ capacity: 10, perSecond: 0.2 }),
}
const marketLimiter = createRateLimiter({ capacity: 120, perSecond: 2 })
const stationLimiter = createRateLimiter({ capacity: 20, perSecond: 0.2 })
const publicAccessLimiter = createRateLimiter({ capacity: 20, perSecond: 0.2 })

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

    if (url.pathname.startsWith(`${MARKET_PREFIX}/`)) {
      return handleMarketRequest(
        { method: request.method, url: request.url, headers: request.headers },
        {
          openSea: openSeaReader(env.OPENSEA_API_KEY, quoteBigInts),
          cache: edgeCache((caches as unknown as { default?: Cache }).default),
          sameOrigin,
          clientKey,
          limiter: marketLimiter,
        }
      )
    }

    if (url.pathname === STATION_PATH || url.pathname.startsWith(`${STATION_PATH}/`)) {
      const body = request.method === 'POST' ? (await request.text()).slice(0, 4096) : undefined
      return handleStationRequest(
        { method: request.method, url: request.url, headers: request.headers, body },
        {
          store: env.DB ? d1Store(env.DB) : undefined,
          admins: (env.STATION_ADMINS ?? '')
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          verify: (address, message, signature) =>
            verifyMessage({ address: address as any, message, signature: signature as any }).catch(() => false),
          contentType: gatewayContentType,
          sameOrigin,
          clientKey,
          limiter: stationLimiter,
        }
      )
    }

    if (url.pathname === TV_LIVE_PATH) {
      return handleTvLiveRequest(request, {
        key: env.YOUTUBE_API_KEY,
        cache: edgeCache((caches as unknown as { default?: Cache }).default),
      })
    }

    if (url.pathname === PUBLIC_ACCESS_PATH || url.pathname.startsWith(`${PUBLIC_ACCESS_PATH}/`)) {
      const body = request.method === 'POST' ? (await request.text()).slice(0, 4096) : undefined
      return handlePublicAccessRequest(
        { method: request.method, url: request.url, headers: request.headers, body },
        {
          store: env.DB ? d1TapeStore(env.DB) : undefined,
          admins: (env.STATION_ADMINS ?? '')
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          verify: (address, message, signature) =>
            verifyMessage({ address: address as any, message, signature: signature as any }),
          lookup: youtubeLookup,
          sameOrigin,
          clientKey,
          limiter: publicAccessLimiter,
        }
      )
    }

    return env.ASSETS.fetch(request)
  },
}
