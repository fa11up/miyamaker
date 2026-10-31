/**
 * Server-side proxy for the 0x Swap API v2 (AllowanceHolder flow). Rules mirror the imdUSD swap
 * worker (infer-pilot web/worker/swap.js):
 *
 * - Only GET /api/0x/swap/allowance-holder/{price,quote}, same-origin only.
 * - Only allowlisted query params; anything else (including any fee field) is refused, not forwarded.
 *   Duplicates are refused. Every field is validated.
 * - chainId 1 (Ethereum) and 4663 (Robinhood Chain).
 * - The fee is set HERE, never by the page: 0.1% to the imdUSD Treasury, taken in the token bought,
 *   on Ethereum, on every swap where neither side is imdUSD.
 * - The key (ZEROX_API_KEY) is injected here. An upstream 401/403 is reported as "unavailable",
 *   never echoing anything about the key.
 *
 * Shared by the Vercel functions (api/0x/...) and the Vite dev middleware (vite.config.ts).
 * `api/_lib` is not a route on Vercel (underscore prefix). Do not import this from browser code.
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

/** A request from another site: a browser says so in Sec-Fetch-Site or Origin. */
function crossSite(headers: Headers | undefined, url: URL) {
  if (!headers) return false
  const site = headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return true
  const origin = headers.get('origin')
  return !!origin && origin !== url.origin
}

/**
 * Full proxy. Error bodies are `{ name, message }`; `name: "SWAP_NOT_CONFIGURED"` means no key
 * (or 0x refused it), which the page shows as "Swap service not configured".
 */
export async function handleZeroExRequest(
  request: { method: string; url: string; headers?: Headers },
  env: ProxyEnv,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const url = new URL(request.url, 'http://localhost')
  const kind = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) : ''
  if (kind !== 'price' && kind !== 'quote') return json(404, { name: 'NOT_FOUND', message: 'Not found.' })
  if (request.method !== 'GET') return json(405, { name: 'METHOD_NOT_ALLOWED', message: 'GET only.' }, { allow: 'GET' })
  if (crossSite(request.headers, url)) return json(403, { name: 'FORBIDDEN', message: 'Same-origin only.' })

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

export const envFromProcess = (): ProxyEnv => ({ ZEROX_API_KEY: process.env.ZEROX_API_KEY })
