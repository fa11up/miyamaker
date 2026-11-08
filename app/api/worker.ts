// Cloudflare Worker: the 0x and OpenSea proxies (keys injected server-side, see api/_lib), the apex -> www redirect,
// and everything else from the static build in dist/ (wrangler.jsonc).
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

import { jsonReply, noSniff, readCappedText } from './_lib/body'
import { edgeCache, handleMarketRequest, MARKET_PREFIX, openSeaReader } from './_lib/market'
import { handleOpenSeaRequest, OPENSEA_PROXY_PATH, quoteBigInts } from './_lib/opensea'
import { d1TapeStore, handlePublicAccessRequest, PUBLIC_ACCESS_PATH, youtubeLookup } from './_lib/publicaccess'
import { serveRange } from './_lib/ranges'
import type { D1Like } from './_lib/station'
import { d1Store, gatewayContentType, handleStationRequest, STATION_PATH } from './_lib/station'
import { kickOnAir, kickReader } from './_lib/tvkick'
import { handleTvLiveRequest, TV_LIVE_PATH } from './_lib/tvlive'
import { CONTRACT_CHECK_PATH, etherscanReader, handleContractCheck } from './_lib/contractcheck'
import { clientKey, createRateLimiter, handleZeroExRequest, PROXY_PREFIX, sameOrigin } from './_lib/zeroex'

/** Checks wallet signatures: plain wallets locally, and passkey smart wallets by asking the chain. */
const signatureClient = createPublicClient({
  chain: mainnet,
  transport: http('https://ethereum-rpc.publicnode.com', { timeout: 8_000 }),
})

type Env = {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  ZEROX_API_KEY?: string
  OPENSEA_API_KEY?: string
  /** Finds miyatv's current YouTube streams (api/_lib/tvlive.ts). */
  YOUTUBE_API_KEY?: string
  /** Whether contracts are verified, for My Files' Scam folder (api/_lib/contractcheck.ts). */
  ETHERSCAN_API_KEY?: string
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
const contractCheckLimiter = createRateLimiter({ capacity: 30, perSecond: 0.5 })
const stationLimiter = createRateLimiter({ capacity: 20, perSecond: 0.2 })
const publicAccessLimiter = createRateLimiter({ capacity: 20, perSecond: 0.2 })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.hostname === APEX) {
      url.hostname = `www.${APEX}`
      return Response.redirect(url.toString(), 308)
    }
    if (url.pathname.startsWith('/api/')) return noSniff(await api(request, env, url))

    if (url.pathname.startsWith('/commercials/')) {
      // Asked for without its range, because the asset store answers those whole anyway.
      return serveRange(request, await env.ASSETS.fetch(new Request(url.toString())))
    }

    return env.ASSETS.fetch(request)
  },
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname.startsWith(`${PROXY_PREFIX}/`)) {
    return handleZeroExRequest(request, { ZEROX_API_KEY: env.ZEROX_API_KEY })
  }

  if (url.pathname === OPENSEA_PROXY_PATH) {
    const body = request.method === 'POST' ? await readCappedText(request) : undefined
    if (body === undefined && request.method === 'POST') return jsonReply(413, { error: 'That is too large.' })
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
    const body = request.method === 'POST' ? await readCappedText(request) : undefined
    if (body === undefined && request.method === 'POST') return jsonReply(413, { error: 'That is too large.' })
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
          signatureClient.verifyMessage({ address: address as any, message, signature: signature as any }).catch(() => false),
        contentType: gatewayContentType,
        sameOrigin,
        clientKey,
        limiter: stationLimiter,
      }
    )
  }

  if (url.pathname === CONTRACT_CHECK_PATH) {
    return handleContractCheck(request, {
      key: env.ETHERSCAN_API_KEY,
      etherscan: env.ETHERSCAN_API_KEY ? etherscanReader(env.ETHERSCAN_API_KEY) : undefined,
      cache: edgeCache((caches as unknown as { default?: Cache }).default),
      sameOrigin,
      clientKey,
      limiter: contractCheckLimiter,
    })
  }

  if (url.pathname === TV_LIVE_PATH) {
    const cache = edgeCache((caches as unknown as { default?: Cache }).default)
    return handleTvLiveRequest(request, {
      key: env.YOUTUBE_API_KEY,
      cache,
      kick: () => kickOnAir({ read: kickReader, cache, now: Date.now() }),
    })
  }

  if (url.pathname === PUBLIC_ACCESS_PATH || url.pathname.startsWith(`${PUBLIC_ACCESS_PATH}/`)) {
    const body = request.method === 'POST' ? await readCappedText(request) : undefined
    if (body === undefined && request.method === 'POST') return jsonReply(413, { error: 'That is too large.' })
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
          signatureClient.verifyMessage({ address: address as any, message, signature: signature as any }).catch(() => false),
        lookup: youtubeLookup,
        sameOrigin,
        clientKey,
        limiter: publicAccessLimiter,
      }
    )
  }

  // Not the app's page: a JSON answer the caller can read, not index.html with a 200.
  return jsonReply(404, { error: 'Not found.' })
}
