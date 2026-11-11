// Cloudflare Worker: the keyed RPC and NFT index (api/_lib/rpc.ts), the 0x and OpenSea proxies (keys injected server-side, see api/_lib), the apex -> www redirect,
// and everything else from the static build in dist/ (wrangler.jsonc).
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

import { ALLOWLIST_BODY_LIMIT, ALLOWLIST_PATH, d1AllowlistStore, handleAllowlistRequest } from './_lib/allowlist'
import { jsonReply, noSniff, readCappedText } from './_lib/body'
import { edgeCache, handleMarketRequest, MARKET_PREFIX, openSeaReader } from './_lib/market'
import { handleOpenSeaRequest, OPENSEA_PROXY_PATH, quoteBigInts } from './_lib/opensea'
import { d1TapeStore, handlePublicAccessRequest, PUBLIC_ACCESS_PATH, youtubeLookup } from './_lib/publicaccess'
import { handleSampleMediaRequest, SAMPLE_MEDIA_PATH, SAMPLE_MEDIA_RATE } from './_lib/samplemedia'
import { serveRange } from './_lib/ranges'
import { handleNftRequest, handleRpcRequest, NFT_PREFIX, RPC_BODY_LIMIT, RPC_PREFIX } from './_lib/rpc'
import type { SharedCache } from './_lib/sharedstate'
import { d1SharedState, sharedCache } from './_lib/sharedstate'
import type { D1Like } from './_lib/station'
import { d1Store, gatewayContentType, handleStationRequest, STATION_PATH } from './_lib/station'
import { kickOnAir, kickReader } from './_lib/tvkick'
import { handleTvLiveRequest, TV_LIVE_PATH } from './_lib/tvlive'
import { handleVideoAudioRequest, VIDEO_AUDIO_COST, VIDEO_AUDIO_PATH, VIDEO_AUDIO_RATE } from './_lib/videoaudio'
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
  /** Keyed JSON-RPC URLs per chain (api/_lib/rpc.ts), e.g. https://eth-mainnet.g.alchemy.com/v2/<key>. Unset = public RPCs. */
  RPC_URL_1?: string
  RPC_URL_11155111?: string
  RPC_URL_4663?: string
  /** Alchemy NFT API key for My Files and Trade → NFTs (/api/nft). Unset = known collections read from the chain. */
  ALCHEMY_API_KEY?: string
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
// A dapp's reads: a page load is a few dozen batched calls, then polling every 12 seconds per open window.
const rpcLimiter = createRateLimiter({ capacity: 300, perSecond: 6 })
const nftLimiter = createRateLimiter({ capacity: 60, perSecond: 1 })
const marketLimiter = createRateLimiter({ capacity: 120, perSecond: 2 })
const contractCheckLimiter = createRateLimiter({ capacity: 30, perSecond: 0.5 })
const stationLimiter = createRateLimiter({ capacity: 20, perSecond: 0.2 })
const publicAccessLimiter = createRateLimiter({ capacity: 20, perSecond: 0.2 })
// The listings' GETs: a page load or two a minute is plenty, and they are cached for 10 seconds anyway.
const stationReadLimiter = createRateLimiter({ capacity: 60, perSecond: 1 })
const publicAccessReadLimiter = createRateLimiter({ capacity: 60, perSecond: 1 })
// Drop allowlists: a wallet asks for its proof once per list phase; saving a list happens once per launch.
const allowlistLimiter = createRateLimiter({ capacity: 60, perSecond: 1 })
const allowlistWriteLimiter = createRateLimiter({ capacity: 5, perSecond: 0.05 })
// These limiters are per isolate. The global limit is the Cloudflare WAF rate-limiting rule on /api/* described at
// createRateLimiter (api/_lib/zeroex.ts); set it up in the dashboard.

const edge = () => edgeCache((caches as unknown as { default?: Cache }).default)

/**
 * miyatv's lookups: one copy in D1 for every data centre (falling back to this data centre's cache until the
 * shared_state table exists). Made once per isolate, so one refresh at a time here as well.
 */
let tvCache: SharedCache | undefined
const tvState = (env: Env) => (tvCache ??= sharedCache(env.DB ? d1SharedState(env.DB) : undefined, edge(), Date.now, 'tv'))
// A kit reads one sample per pad at once. A video link costs more: it makes three or more upstream fetches.
const sampleMediaLimiter = createRateLimiter(SAMPLE_MEDIA_RATE)
const videoAudioLimiter = createRateLimiter(VIDEO_AUDIO_RATE)

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
  if (url.pathname.startsWith(`${RPC_PREFIX}/`)) {
    const body = request.method === 'POST' ? await readCappedText(request, RPC_BODY_LIMIT) : undefined
    return handleRpcRequest(
      { method: request.method, url: request.url, headers: request.headers, body },
      { RPC_URL_1: env.RPC_URL_1, RPC_URL_11155111: env.RPC_URL_11155111, RPC_URL_4663: env.RPC_URL_4663 },
      { sameOrigin, clientKey, limiter: rpcLimiter }
    )
  }

  if (url.pathname.startsWith(`${NFT_PREFIX}/`)) {
    return handleNftRequest(request, { ALCHEMY_API_KEY: env.ALCHEMY_API_KEY }, { sameOrigin, clientKey, limiter: nftLimiter })
  }

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
        cache: edge(),
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
        readLimiter: stationReadLimiter,
        listCache: edge(),
      }
    )
  }

  if (url.pathname === CONTRACT_CHECK_PATH) {
    return handleContractCheck(request, {
      key: env.ETHERSCAN_API_KEY,
      etherscan: env.ETHERSCAN_API_KEY ? etherscanReader(env.ETHERSCAN_API_KEY) : undefined,
      cache: edge(),
      sameOrigin,
      clientKey,
      limiter: contractCheckLimiter,
    })
  }

  if (url.pathname === SAMPLE_MEDIA_PATH) {
    return handleSampleMediaRequest(
      { method: request.method, url: request.url, headers: request.headers },
      { sameOrigin, clientKey, limiter: sampleMediaLimiter }
    )
  }

  if (url.pathname === VIDEO_AUDIO_PATH) {
    return handleVideoAudioRequest(
      { method: request.method, url: request.url, headers: request.headers },
      { sameOrigin, clientKey, limiter: videoAudioLimiter, cost: VIDEO_AUDIO_COST }
    )
  }

  if (url.pathname === TV_LIVE_PATH) {
    const cache = tvState(env)
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
        readLimiter: publicAccessReadLimiter,
        listCache: edge(),
      }
    )
  }

  if (url.pathname === ALLOWLIST_PATH || url.pathname.startsWith(`${ALLOWLIST_PATH}/`)) {
    const body = request.method === 'POST' ? await readCappedText(request, ALLOWLIST_BODY_LIMIT) : undefined
    if (body === undefined && request.method === 'POST') return jsonReply(413, { error: 'That list is too large.' })
    return handleAllowlistRequest(
      { method: request.method, url: request.url, headers: request.headers, body },
      {
        // Lists shipped with the build. A missing file is the app's index.html (single-page fallback): not JSON.
        readStatic: async (root) => {
          const r = await env.ASSETS.fetch(new Request(new URL(`/allowlists/${root}.json`, url).toString()))
          return r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : undefined
        },
        store: env.DB ? d1AllowlistStore(env.DB) : undefined,
        sameOrigin,
        clientKey,
        limiter: allowlistLimiter,
        writeLimiter: allowlistWriteLimiter,
      }
    )
  }

  // Not the app's page: a JSON answer the caller can read, not index.html with a 200.
  return jsonReply(404, { error: 'Not found.' })
}
