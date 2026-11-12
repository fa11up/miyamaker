// Cloudflare Worker: the keyed RPC and NFT index (api/_lib/rpc.ts), the 0x and OpenSea proxies (keys injected server-side, see api/_lib), the apex -> www redirect,
// the per-mint reveal (/reveal/*, and its every-minute cron: api/_lib/reveal.ts), and everything else from the static build in dist/ (wrangler.jsonc).
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

import { ALLOWLIST_BODY_LIMIT, ALLOWLIST_PATH, d1AllowlistStore, handleAllowlistRequest } from './_lib/allowlist'
import { jsonReply, noSniff, readCappedText } from './_lib/body'
import { edgeCache, handleMarketRequest, MARKET_PREFIX, openSeaReader } from './_lib/market'
import { handleOpenSeaRequest, OPENSEA_PROXY_PATH, quoteBigInts } from './_lib/opensea'
import { d1TapeStore, handlePublicAccessRequest, PUBLIC_ACCESS_PATH, youtubeLookup } from './_lib/publicaccess'
import { handleSampleMediaRequest, SAMPLE_MEDIA_PATH, SAMPLE_MEDIA_RATE } from './_lib/samplemedia'
import { serveRange } from './_lib/ranges'
import type { RevealBucket, RevealDb } from './_lib/reveal'
import {
  handleRevealRequest,
  openSeaRefresher,
  REVEAL_CHAIN_ID,
  REVEAL_PREFIX,
  revealSettings,
  rpcChain,
  runRevealCron,
} from './_lib/reveal'
import { handleNftRequest, handleRpcRequest, NFT_PREFIX, RPC_BODY_LIMIT, RPC_PREFIX, upstreamFor } from './_lib/rpc'
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
  /** The radio's community station, the reveal's state (migrations/). */
  DB?: D1Like & Pick<RevealDb, 'batch'>
  /** The reveal's private art (R2 bucket miyamaker-reveal): never public, served only for drawn tokens. */
  REVEAL?: RevealBucket
  /** Bearer key for /reveal/<slug>/admin/* (scripts/reveal/load.mjs, arweave.mjs). Unset = admin off. */
  REVEAL_ADMIN_KEY?: string
  /** Local rehearsals only: "1" lets REVEAL_RPC_URL and a local http REVEAL_ORIGIN count. Never set in production. */
  REVEAL_DEV?: string
  /** With REVEAL_DEV=1 only, and only a local host (an anvil fork): the reveal reads the chain here, not RPC_URL_1. */
  REVEAL_RPC_URL?: string
  /** The origin a reveal drop's baseURI must start with (default https://www.miyamaker.com). */
  REVEAL_ORIGIN?: string
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

/**
 * A list shipped with the build (public/allowlists/<root>.json). A missing file is a 404 or the app's index.html (the
 * single-page fallback, not JSON): no list. Any other failure throws, so the route says "couldn't check", not "no list".
 */
async function readShippedList(assets: Env['ASSETS'], url: URL, root: string): Promise<unknown> {
  const r = await assets.fetch(new Request(new URL(`/allowlists/${root}.json`, url).toString()))
  if (r.status === 404) return undefined
  if (!r.ok) throw new Error(`asset store answered ${r.status}`)
  if (!(r.headers.get('content-type') || '').includes('json')) return undefined
  return r.json()
}

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
// assignments.json is every draw (a few MB at sell-out): a verifier reads it once.
const revealListLimiter = createRateLimiter({ capacity: 10, perSecond: 0.2 })

/**
 * The reveal's chain reads: Ethereum only, from the keyed RPC_URL_1 (archive: the cron reads totalSupply at past
 * blocks), or a local anvil fork with REVEAL_DEV=1. Each call is a new client, which checks eth_chainId once.
 */
const revealChain = (env: Env) => (chainId: number) => {
  if (chainId !== REVEAL_CHAIN_ID) return undefined
  const url = revealSettings(env).devRpc ?? upstreamFor(String(chainId), { RPC_URL_1: env.RPC_URL_1 })
  return url ? rpcChain(url, chainId) : undefined
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.hostname === APEX) {
      url.hostname = `www.${APEX}`
      return Response.redirect(url.toString(), 308)
    }
    if (url.pathname.startsWith('/api/')) return noSniff(await api(request, env, url))
    if (url.pathname.startsWith(`${REVEAL_PREFIX}/`)) {
      return handleRevealRequest(request, {
        db: env.DB,
        bucket: env.REVEAL,
        adminKey: env.REVEAL_ADMIN_KEY,
        origin: revealSettings(env).origin,
        chain: revealChain(env),
        clientKey,
        listLimiter: revealListLimiter,
      })
    }

    if (url.pathname.startsWith('/commercials/')) {
      // Asked for without its range, because the asset store answers those whole anyway.
      return serveRange(request, await env.ASSETS.fetch(new Request(url.toString())))
    }

    return env.ASSETS.fetch(request)
  },

  /** Every minute (wrangler.jsonc triggers): the reveal reads new mints and draws their pieces. */
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }): Promise<void> {
    if (!env.DB) return
    ctx.waitUntil(
      runRevealCron({
        db: env.DB,
        chain: revealChain(env),
        bucket: env.REVEAL,
        refresh: openSeaRefresher(env.OPENSEA_API_KEY),
      }).catch(
        (e) =>
          // Before migrations/0004_reveal.sql there is no table to read: nothing to do yet.
          console.log(`reveal cron: ${String((e as Error)?.message ?? e).slice(0, 300)}`)
      )
    )
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
        readStatic: (root) => readShippedList(env.ASSETS, url, root),
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
