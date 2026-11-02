/**
 * Server-side proxy for the OpenSea API v2 (https://docs.opensea.io/reference/api-overview), used by
 * Trade → NFTs for marketplace prices and in-app Seaport fills. Same rules as the 0x proxy (api/_lib/zeroex.ts):
 *
 * - One route, `/api/opensea?op=<op>&...`. Only the ops below; every param is validated and anything else is refused,
 *   not forwarded. The page never chooses an upstream path.
 * - Same-origin only, rate-limited per IP (per instance). Fulfillment (POST) has its own, tighter bucket.
 * - Chains: `ethereum` and `robinhood` (OpenSea closed its testnets, so Sepolia has no OpenSea).
 * - The key (OPENSEA_API_KEY, sent as X-API-KEY) is injected here and never reaches the browser. Without a key the
 *   few ops OpenSea serves keyless (collection, stats, contract) are still tried; the rest answer
 *   503 MARKET_NOT_CONFIGURED without calling OpenSea. An upstream 401/403 is also MARKET_NOT_CONFIGURED.
 * - Integers too big for a JS number (Seaport salts, amounts) are turned into strings before the page parses the
 *   JSON, so signatures and amounts survive (`quoteBigInts`).
 *
 * Shared by the Vercel function (api/opensea.ts) and the Vite dev middleware (vite.config.ts). No imports, so
 * `node --test` loads it directly (tests/markets.test.mts). The same-origin check and the rate limiter come from
 * api/_lib/zeroex.ts and are passed in (`guards`).
 */

export const OPENSEA_API = 'https://api.opensea.io'
export const OPENSEA_PROXY_PATH = '/api/opensea'

export const OPENSEA_CHAINS = ['ethereum', 'robinhood'] as const
export type OpenSeaChain = (typeof OPENSEA_CHAINS)[number]

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const HASH = /^0x[0-9a-fA-F]{64}$/
const SLUG = /^[a-z0-9][a-z0-9_-]{0,99}$/i
const TOKEN_ID = /^[0-9]{1,78}$/
const ZERO = /^0x0{40}$/

type Rule = (v: string) => boolean
const isChain: Rule = (v) => (OPENSEA_CHAINS as readonly string[]).includes(v)
const isAddress: Rule = (v) => ADDRESS.test(v)
const isSlug: Rule = (v) => SLUG.test(v)
const isTokenId: Rule = (v) => TOKEN_ID.test(v)
const isLimit = (max: number): Rule => (v) => /^[1-9][0-9]{0,2}$/.test(v) && Number(v) <= max
const isQuery: Rule = (v) => v.trim().length >= 2 && v.length <= 64 && !/[\u0000-\u001f]/.test(v)

type GetOp = {
  params: Record<string, Rule>
  optional?: Record<string, Rule>
  /** OpenSea serves it without a key (checked Nov 2026), so it is tried even when no key is set. */
  keyless?: boolean
  path: (p: Record<string, string>) => string
  query?: (p: Record<string, string>) => Record<string, string>
}

const e = encodeURIComponent

/** Every GET the page may ask for. */
const STATUS_PATH = 'status'

export const GET_OPS: Record<string, GetOp> = {
  // Whether a key is set (no upstream call).
  status: { params: {}, keyless: true, path: () => STATUS_PATH },
  // Contract → collection slug.
  contract: {
    params: { chain: isChain, address: isAddress },
    keyless: true,
    path: (p) => `/api/v2/chain/${p.chain}/contract/${p.address}`,
  },
  collection: { params: { slug: isSlug }, keyless: true, path: (p) => `/api/v2/collections/${e(p.slug!)}` },
  stats: { params: { slug: isSlug }, keyless: true, path: (p) => `/api/v2/collections/${e(p.slug!)}/stats` },
  // Cheapest listings, price ascending.
  listings: {
    params: { slug: isSlug },
    optional: { limit: isLimit(20) },
    path: (p) => `/api/v2/listings/collection/${e(p.slug!)}/best`,
    query: (p) => ({ limit: p.limit || '6' }),
  },
  // Collection offers grouped by price level: the first bucket is the best offer.
  offers: {
    params: { slug: isSlug },
    path: (p) => `/api/v2/collections/${e(p.slug!)}/offer_aggregates`,
    query: () => ({ limit: '1' }),
  },
  nft: {
    params: { chain: isChain, address: isAddress, id: isTokenId },
    path: (p) => `/api/v2/chain/${p.chain}/contract/${p.address}/nfts/${p.id}`,
  },
  nft_listing: {
    params: { slug: isSlug, id: isTokenId },
    path: (p) => `/api/v2/listings/collection/${e(p.slug!)}/nfts/${p.id}/best`,
  },
  nft_offer: {
    params: { slug: isSlug, id: isTokenId },
    path: (p) => `/api/v2/offers/collection/${e(p.slug!)}/nfts/${p.id}/best`,
  },
  search: {
    params: { query: isQuery, chain: isChain },
    path: () => `/api/v2/search`,
    query: (p) => ({ query: p.query!.trim(), chains: p.chain!, asset_types: 'collection', limit: '8' }),
  },
  account_nfts: {
    params: { chain: isChain, address: isAddress },
    path: (p) => `/api/v2/chain/${p.chain}/account/${p.address}/nfts`,
    query: () => ({ limit: '100' }),
  },
}

export const POST_OPS = ['fulfill_listing', 'fulfill_offer'] as const
export type PostOp = (typeof POST_OPS)[number]

type Built = { path: string; query?: URLSearchParams; body?: string; keyless: boolean; error?: undefined }
type Refused = { error: string; path?: undefined }

/** The upstream request for a GET: `{ path, query }` or `{ error }`. Pure, so the rules are unit-tested. */
export function openSeaGet(params: URLSearchParams): Built | Refused {
  for (const k of new Set(params.keys())) if (params.getAll(k).length > 1) return { error: `${k} is given twice.` }
  const op = params.get('op') || ''
  const spec = Object.prototype.hasOwnProperty.call(GET_OPS, op) ? GET_OPS[op] : undefined
  if (!spec) return { error: 'Unknown market request.' }
  const allowed = { ...spec.params, ...(spec.optional || {}) }
  const p: Record<string, string> = {}
  for (const k of params.keys()) {
    if (k === 'op') continue
    if (!Object.prototype.hasOwnProperty.call(allowed, k)) return { error: `${k} is not accepted.` }
  }

  for (const [k, rule] of Object.entries(allowed)) {
    const v = params.get(k)
    if (v === null) {
      if (k in spec.params) return { error: `${k} is missing.` }
      continue
    }

    if (!rule(v)) return { error: `${k} is not valid.` }
    p[k] = v
  }

  const q = spec.query?.(p)
  return { path: spec.path(p), query: q ? new URLSearchParams(q) : undefined, keyless: !!spec.keyless }
}

/**
 * The upstream request for a fulfillment POST. The page sends a flat, small body; the proxy builds OpenSea's body
 * from it, so the page cannot add fields (no custom recipient: NFTs and payment go to the fulfiller).
 *
 *   fulfill_listing: { chain, hash, protocol_address, fulfiller, include_optional_creator_fees? }
 *   fulfill_offer:   { chain, hash, protocol_address, fulfiller, contract, token_id }
 */
export function openSeaPost(op: string, raw: unknown): Built | Refused {
  if (!(POST_OPS as readonly string[]).includes(op)) return { error: 'Unknown market request.' }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The request body must be an object.' }
  const b = raw as Record<string, unknown>
  const keys = op === 'fulfill_listing'
    ? ['chain', 'hash', 'protocol_address', 'fulfiller', 'include_optional_creator_fees']
    : ['chain', 'hash', 'protocol_address', 'fulfiller', 'contract', 'token_id']
  for (const k of Object.keys(b)) if (!keys.includes(k)) return { error: `${k} is not accepted.` }
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '')
  if (!isChain(str('chain'))) return { error: 'chain is not valid.' }
  if (!HASH.test(str('hash'))) return { error: 'hash must be an order hash.' }
  if (!isAddress(str('protocol_address'))) return { error: 'protocol_address must be an address.' }
  if (!isAddress(str('fulfiller')) || ZERO.test(str('fulfiller'))) return { error: 'fulfiller must be an address.' }

  const order = { chain: str('chain'), hash: str('hash'), protocol_address: str('protocol_address') }
  const fulfiller = { address: str('fulfiller') }
  if (op === 'fulfill_listing') {
    const optional = b.include_optional_creator_fees
    if (optional !== undefined && typeof optional !== 'boolean')
      return { error: 'include_optional_creator_fees must be true or false.' }
    return {
      path: '/api/v2/listings/fulfillment_data',
      body: JSON.stringify({ listing: order, fulfiller, include_optional_creator_fees: !!optional }),
      keyless: false,
    }
  }

  if (!isAddress(str('contract'))) return { error: 'contract must be an address.' }
  if (!isTokenId(str('token_id'))) return { error: 'token_id must be a token number.' }
  return {
    path: '/api/v2/offers/fulfillment_data',
    body: JSON.stringify({
      offer: order,
      fulfiller,
      consideration: { asset_contract_address: str('contract'), token_id: str('token_id') },
    }),
    keyless: false,
  }
}

/**
 * JSON integer literals with 16+ digits become strings (`"salt": 123…` → `"salt": "123…"`), so JSON.parse keeps
 * every digit. Only bare numbers after `:`, `[` or `,` and before `,`, `]` or `}` are touched; decimals and numbers
 * inside strings are left alone.
 */
export function quoteBigInts(text: string): string {
  let out = ''
  let inString = false
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (inString) {
      out += c
      if (c === '\\') {
        out += text[i + 1] ?? ''
        i += 2
        continue
      }

      if (c === '"') inString = false
      i += 1
      continue
    }

    if (c === '"') {
      inString = true
      out += c
      i += 1
      continue
    }

    if (c === '-' || (c >= '0' && c <= '9')) {
      let j = i + (c === '-' ? 1 : 0)
      while (j < text.length && text[j]! >= '0' && text[j]! <= '9') j += 1
      const next = text[j]
      const digits = j - i - (c === '-' ? 1 : 0)
      const whole = next !== '.' && next !== 'e' && next !== 'E'
      out += whole && digits >= 16 ? `"${text.slice(i, j)}"` : text.slice(i, j)
      i = j
      continue
    }

    out += c
    i += 1
  }

  return out
}

export type OpenSeaEnv = { OPENSEA_API_KEY?: string }

export type Guards = {
  sameOrigin: (headers: Headers | undefined, url: URL) => boolean
  clientKey: (headers: Headers | undefined) => string
  readLimiter: (key: string) => boolean
  fillLimiter: (key: string) => boolean
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  })

const NOT_CONFIGURED = { name: 'MARKET_NOT_CONFIGURED', message: 'Marketplace prices need an API key.' }

/**
 * Full proxy. Error bodies are `{ name, message }`. `MARKET_NOT_CONFIGURED` = no key (or OpenSea refused it): the
 * page shows link-outs and a quiet note. `NOT_FOUND` = OpenSea has no such collection / NFT / order.
 */
export async function handleOpenSeaRequest(
  request: { method: string; url: string; headers?: Headers; body?: string },
  env: OpenSeaEnv,
  guards: Guards,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname !== OPENSEA_PROXY_PATH && url.pathname !== `${OPENSEA_PROXY_PATH}/`)
    return json(404, { name: 'NOT_FOUND', message: 'Not found.' })
  if (request.method !== 'GET' && request.method !== 'POST')
    return json(405, { name: 'METHOD_NOT_ALLOWED', message: 'GET or POST only.' }, { allow: 'GET, POST' })
  if (!guards.sameOrigin(request.headers, url)) return json(403, { name: 'FORBIDDEN', message: 'Same-origin only.' })
  const fill = request.method === 'POST'
  const client = guards.clientKey(request.headers)
  if (!(fill ? guards.fillLimiter(client) : guards.readLimiter(client)))
    return json(429, { name: 'RATE_LIMITED', message: 'Too many market requests, slow down.' }, { 'retry-after': '5' })

  let built: Built | Refused
  if (fill) {
    const op = url.searchParams.get('op') || ''
    if ([...url.searchParams.keys()].some((k) => k !== 'op')) built = { error: 'Only op goes in the query.' }
    else {
      let body: unknown
      try {
        body = JSON.parse(request.body || '')
      } catch {
        body = undefined
      }

      built = openSeaPost(op, body)
    }
  } else {
    built = openSeaGet(url.searchParams)
  }

  if (built.error !== undefined) return json(400, { name: 'INPUT_INVALID', message: built.error })

  const key = env.OPENSEA_API_KEY?.trim()
  // Answered here, never upstream: lets the page skip keyed requests (and their 503s) when no key is set.
  if (built.path === STATUS_PATH)
    return json(200, { configured: !!key }, { 'cache-control': 'public, max-age=60, s-maxage=300' })
  if (!key && !built.keyless) return json(503, NOT_CONFIGURED)

  const target = `${OPENSEA_API}${built.path}${built.query ? `?${built.query}` : ''}`
  let res: Response
  try {
    res = await fetchImpl(target, {
      method: fill ? 'POST' : 'GET',
      headers: {
        accept: 'application/json',
        ...(key ? { 'x-api-key': key } : {}),
        ...(fill ? { 'content-type': 'application/json' } : {}),
      },
      body: fill ? built.body : undefined,
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return json(502, { name: 'UPSTREAM_UNREACHABLE', message: 'OpenSea could not be reached.' })
  }

  if (res.status === 401 || res.status === 403) {
    if (key) console.log(`opensea: the key was refused (${res.status})`)
    return json(503, { ...NOT_CONFIGURED, reason: key ? 'upstream' : 'no-key' })
  }

  if (res.status === 404) return json(404, { name: 'NOT_FOUND', message: 'OpenSea has no such item.' })
  if (res.status === 429)
    return json(429, { name: 'RATE_LIMITED', message: 'OpenSea is busy, try again in a moment.' }, { 'retry-after': '10' })

  const text = await res.text()
  try {
    JSON.parse(text)
  } catch {
    return json(502, { name: 'UPSTREAM_INVALID', message: `OpenSea answered ${res.status} without JSON.` })
  }

  if (!res.ok) {
    let message = 'OpenSea refused the request.'
    try {
      const b = JSON.parse(text)
      const first = Array.isArray(b?.errors) ? b.errors[0] : b?.error?.message || b?.message
      if (typeof first === 'string') message = first.slice(0, 200)
    } catch {
      /* keep the generic message */
    }

    return json(res.status >= 500 ? 502 : 400, { name: 'UPSTREAM_ERROR', message })
  }

  // Market data is public: let the CDN share it for a few seconds. Fulfillment data is per buyer: never cached.
  const cache = fill ? 'no-store' : 'public, max-age=10, s-maxage=30, stale-while-revalidate=60'
  return new Response(quoteBigInts(text), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': cache },
  })
}

export const envFromProcess = (): OpenSeaEnv => ({ OPENSEA_API_KEY: process.env.OPENSEA_API_KEY })
