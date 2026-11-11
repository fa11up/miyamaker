/**
 * Server-side proxy for the 0x Swap API v2 (AllowanceHolder flow). Rules mirror the imdUSD swap
 * worker (infer-pilot web/worker/swap.js):
 *
 * - Only GET /api/0x/swap/allowance-holder/{price,quote}, same-origin only (a same-origin signal is
 *   required, not just the absence of a cross-site one), rate-limited per IP (per instance).
 * - Only allowlisted query params; anything else (including any fee field) is refused, not forwarded.
 *   Duplicates are refused. Every field is validated.
 * - chainId 1 (Ethereum) and 4663 (Robinhood Chain).
 * - The fee is set HERE, never by the page: 0.1% to the imdUSD Treasury, taken in the token bought,
 *   on Ethereum, on every swap where neither side is imdUSD.
 * - The key (ZEROX_API_KEY) is injected here. An upstream 401/403 is reported as "unavailable",
 *   never echoing anything about the key.
 *
 * Shared by the Cloudflare Worker (api/worker.ts) and the Vite dev middleware (vite.config.ts).
 * Do not import this from browser code.
 * This file has no imports so `node --test` can load it directly (tests/zeroex.test.mts).
 */

export const ZEROX_BASE_URL = 'https://api.0x.org/swap/allowance-holder/'
export const PROXY_PREFIX = '/api/0x'
export const ROUTE_PREFIX = `${PROXY_PREFIX}/swap/allowance-holder/`

/** Native token placeholder in 0x v2 (docs: "Handle Native Tokens"). */
export const ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
/** imdUSD on Ethereum: trades with imdUSD on either side carry no fee. */
export const IMDUSD = '0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25'
export const FEE_BPS = 10 // 0.1%

/**
 * Fee recipient per chain. Only chains listed here charge a fee.
 * TODO(robinhood): add 4663 once an imdUSD Treasury exists on Robinhood Chain. The mainnet
 * Treasury (0x6Ac8...27Bc) is only known to exist on chain 1, so 4663 sends no fee params for now.
 */
export const FEE_TREASURY: Record<string, string | undefined> = {
  '1': '0x6Ac8fF96Fb8DCF5d79A8eF1E59D9AC23f2BD27Bc',
}

export const ALLOWED_CHAIN_IDS = ['1', '4663'] as const
const ALLOWED_PARAMS = ['chainId', 'sellToken', 'buyToken', 'sellAmount', 'slippageBps', 'taker'] as const
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

export type Kind = 'price' | 'quote'

/** True when no fee applies: either side is imdUSD. */
export const feeFree = (sellToken: string, buyToken: string) =>
  [sellToken, buyToken].some((t) => String(t).toLowerCase() === IMDUSD.toLowerCase())

/** Fee params 0x should get for this trade, or undefined. */
export function feeFor(chainId: string, sellToken: string, buyToken: string) {
  const recipient = FEE_TREASURY[chainId]
  if (!recipient || feeFree(sellToken, buyToken)) return undefined
  return { swapFeeRecipient: recipient, swapFeeBps: String(FEE_BPS), swapFeeToken: buyToken }
}

/**
 * The query 0x is asked, from the page's query: `{ query }` or `{ error }`. Pure, so the rules
 * are unit-tested.
 */
export function zeroXQuery(
  kind: string,
  params: URLSearchParams | Record<string, string>
): { query: URLSearchParams; error?: undefined } | { query?: undefined; error: string } {
  if (kind !== 'price' && kind !== 'quote') return { error: 'Unknown swap route.' }
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params)
  for (const k of p.keys()) if (!(ALLOWED_PARAMS as readonly string[]).includes(k)) return { error: `${k} is not accepted.` }
  for (const k of new Set(p.keys())) if (p.getAll(k).length > 1) return { error: `${k} is given twice.` }

  const chainId = p.get('chainId') ?? ''
  if (!(ALLOWED_CHAIN_IDS as readonly string[]).includes(chainId))
    return { error: 'Only Ethereum (chainId=1) and Robinhood Chain (chainId=4663) are served.' }
  const sellToken = p.get('sellToken') ?? ''
  const buyToken = p.get('buyToken') ?? ''
  if (!ADDRESS.test(sellToken)) return { error: 'sellToken must be a token address.' }
  if (!ADDRESS.test(buyToken)) return { error: 'buyToken must be a token address.' }
  if (sellToken.toLowerCase() === buyToken.toLowerCase()) return { error: 'sellToken and buyToken are the same.' }
  const sellAmount = p.get('sellAmount') ?? ''
  if (!/^[1-9][0-9]{0,77}$/.test(sellAmount)) return { error: 'sellAmount must be a positive whole number of base units.' }
  const taker = p.get('taker')
  if (kind === 'quote' && taker === null) return { error: "A quote needs the taker's address." }
  if (taker !== null && (!ADDRESS.test(taker) || /^0x0{40}$/.test(taker))) return { error: 'taker must be an address.' }
  const slippage = p.get('slippageBps')
  if (slippage !== null && !(/^[0-9]{2,3}$/.test(slippage) && Number(slippage) >= 10 && Number(slippage) <= 300))
    return { error: 'slippageBps must be a whole number from 10 to 300.' }

  const query = new URLSearchParams({ chainId, sellToken, buyToken, sellAmount })
  if (taker !== null) query.set('taker', taker)
  if (slippage !== null) query.set('slippageBps', slippage)
  const fee = feeFor(chainId, sellToken, buyToken)
  if (fee) for (const [k, v] of Object.entries(fee)) query.set(k, v)
  return { query }
}

export type ProxyEnv = { ZEROX_API_KEY?: string }

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  })

/**
 * Same-origin check. Browsers send Sec-Fetch-Site on every fetch (all current engines) and Origin on
 * cross-origin ones, so a page on this site always carries at least one of them: Sec-Fetch-Site:
 * same-origin, or an Origin equal to ours. A request with neither (curl, scripts, other servers) or with a
 * foreign value is refused. Non-browser clients can forge these headers, so this only stops other sites
 * from spending the key through visitors' browsers; the rate limit below is what bounds scripted use.
 */
export function sameOrigin(headers: Headers | undefined, url: URL) {
  if (!headers) return false
  const site = headers.get('sec-fetch-site')
  const origin = headers.get('origin')
  if (site && site !== 'same-origin') return false
  if (origin && origin !== url.origin) return false
  return site === 'same-origin' || origin === url.origin
}

export type RateLimiter = (key: string, now?: number) => boolean

/**
 * In-memory token bucket per client key (IP, see clientKey): `capacity` requests in a burst, refilled at `perSecond`.
 * At `maxKeys` the least recently seen key is dropped, one at a time, so a flood of new keys only pushes out idle
 * clients rather than resetting everyone (a Map iterates in insertion order, and every hit re-inserts its key).
 *
 * NOTE: state lives in this process only. On Cloudflare every Worker isolate has its own buckets, so this is a first
 * layer against a single noisy client, not a global quota. The real global limit is a Cloudflare WAF rate-limiting rule
 * on the zone (dashboard: Security > WAF > Rate limiting rules), recommended:
 *
 *   If incoming requests match:  (http.host eq "www.miyamaker.com" and starts_with(http.request.uri.path, "/api/"))
 *   With the same characteristics: IP  (Cloudflare counts IPv6 per /64)
 *   When rate exceeds: 300 requests per 1 minute (POSTs: a second rule, 30 per 1 minute)
 *   Then: Block for 1 minute, response 429
 *
 * It is not created from this repo; set it up in the dashboard.
 */
export function createRateLimiter({ capacity = 60, perSecond = 1, maxKeys = 10_000 } = {}): RateLimiter {
  const buckets = new Map<string, { tokens: number; at: number }>()
  return (key, now = Date.now()) => {
    const prev = buckets.get(key)
    const tokens = prev ? Math.min(capacity, prev.tokens + ((now - prev.at) / 1000) * perSecond) : capacity
    if (prev) buckets.delete(key)
    else if (buckets.size >= maxKeys) {
      // Bound memory: drop the least recently seen key.
      const oldest = buckets.keys().next()
      if (!oldest.done) buckets.delete(oldest.value)
    }

    if (tokens < 1) {
      buckets.set(key, { tokens, at: now })
      return false
    }

    buckets.set(key, { tokens: tokens - 1, at: now })
    return true
  }
}

const defaultLimiter = createRateLimiter()

/**
 * One client's key for an address: an IPv4 address as it is, an IPv6 address by its /64 (one home or one server is
 * usually handed a whole /64, so per-address keys would let it take any number of buckets). IPv4-mapped IPv6 counts as
 * the IPv4 address. Anything that does not parse is kept as it is.
 */
export function ipBucket(raw: string): string {
  const ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  if (!ip.includes(':')) return ip
  const halves = ip.split('::')
  if (halves.length > 2) return ip
  const part = (s: string | undefined): string[] | undefined => {
    if (!s) return []
    const groups = s.split(':')
    const last = groups[groups.length - 1]!
    if (!last.includes('.')) return groups
    // An embedded IPv4 tail is the last two groups.
    const o = last.split('.').map((n) => (/^\d{1,3}$/.test(n) ? Number(n) : NaN))
    if (o.length !== 4 || o.some((n) => !(n >= 0 && n <= 255))) return undefined
    return [...groups.slice(0, -1), ((o[0]! << 8) | o[1]!).toString(16), ((o[2]! << 8) | o[3]!).toString(16)]
  }
  const head = part(halves[0])
  const tail = part(halves[1])
  if (!head || !tail) return ip
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  if (halves.length === 2 ? fill < 1 : head.length !== 8) return ip
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail]
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return ip
  const n = groups.map((g) => parseInt(g, 16))
  if (n.slice(0, 5).every((g) => g === 0) && n[5] === 0xffff)
    return [n[6]! >> 8, n[6]! & 255, n[7]! >> 8, n[7]! & 255].join('.')
  return `${n
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`
}

/**
 * Client key as Cloudflare reports it, IPv6 by /64 (ipBucket). cf-connecting-ip is the only one Cloudflare sets
 * itself: a client can send its own x-real-ip / x-forwarded-for, so those are only a fallback for the Vite dev server
 * (which replaces them with the socket's address, vite.config.ts).
 */
export function clientKey(headers: Headers | undefined) {
  const forwarded = headers?.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = headers?.get('cf-connecting-ip')?.trim() || headers?.get('x-real-ip')?.trim() || forwarded
  return ip ? ipBucket(ip) : 'unknown'
}

/**
 * Full proxy. Error bodies are `{ name, message }`; `name: "SWAP_NOT_CONFIGURED"` means no key
 * (or 0x refused it), which the page shows as "Swap service not configured".
 */
export async function handleZeroExRequest(
  request: { method: string; url: string; headers?: Headers },
  env: ProxyEnv,
  fetchImpl: typeof fetch = fetch,
  limiter: RateLimiter = defaultLimiter
): Promise<Response> {
  const url = new URL(request.url, 'http://localhost')
  const kind = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) : ''
  if (kind !== 'price' && kind !== 'quote') return json(404, { name: 'NOT_FOUND', message: 'Not found.' })
  if (request.method !== 'GET') return json(405, { name: 'METHOD_NOT_ALLOWED', message: 'GET only.' }, { allow: 'GET' })
  if (!sameOrigin(request.headers, url)) return json(403, { name: 'FORBIDDEN', message: 'Same-origin only.' })
  if (!limiter(clientKey(request.headers)))
    return json(429, { name: 'RATE_LIMITED', message: 'Too many swap requests, slow down.' }, { 'retry-after': '5' })

  const { query, error } = zeroXQuery(kind, url.searchParams)
  if (error) return json(400, { name: 'INPUT_INVALID', message: error })

  const key = env.ZEROX_API_KEY?.trim()
  if (!key) return json(503, { name: 'SWAP_NOT_CONFIGURED', message: 'Swap service not configured.' })

  let res: Response
  try {
    res = await fetchImpl(`${ZEROX_BASE_URL}${kind}?${query}`, {
      headers: { '0x-api-key': key, '0x-version': 'v2', accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return json(502, { name: 'UPSTREAM_UNREACHABLE', message: 'The swap router could not be reached.' })
  }
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return json(502, { name: 'UPSTREAM_INVALID', message: `The swap router answered ${res.status} without JSON.` })
  }
  // A 401/403 from 0x means the key is wrong: say "not configured", never echo anything about the key.
  if (res.status === 401 || res.status === 403) {
    console.log(`swap: 0x refused the key (${res.status})`)
    return json(503, { name: 'SWAP_NOT_CONFIGURED', message: 'Swap service not configured.', reason: 'upstream' })
  }
  return json(res.status, body)
}
