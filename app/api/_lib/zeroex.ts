/**
 * Server-side proxy for the 0x Swap API v2 (AllowanceHolder flow).
 *
 * Shared by the Vercel functions in `api/0x/...` (production) and the Vite dev middleware
 * (`vite.config.ts`), so dev and prod enforce exactly the same rules:
 *   - only GET /api/0x/swap/allowance-holder/{price,quote}
 *   - only chainId 1 (Ethereum) and 4663 (Robinhood Chain)
 *   - only known query params pass through, each validated
 *   - the API key (ZEROX_API_KEY) and the optional integrator fee
 *     (SWAP_FEE_BPS + SWAP_FEE_RECIPIENT) are injected here; the client cannot set fees
 *   - the upstream status and body are forwarded as-is
 *
 * This file lives in `api/_lib` (underscore = not a route on Vercel) and must never be imported
 * from browser code: it reads server secrets from the environment.
 */

export const ZEROX_BASE_URL = 'https://api.0x.org'
export const PROXY_PREFIX = '/api/0x'
export const ALLOWED_ENDPOINTS = ['/swap/allowance-holder/price', '/swap/allowance-holder/quote'] as const
export const ALLOWED_CHAIN_IDS = ['1', '4663'] as const

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const UINT = /^[0-9]{1,78}$/

/** Query params the client may send, with a validator for each. Anything else is dropped. */
const PASSTHROUGH: Record<string, (v: string) => boolean> = {
  chainId: (v) => (ALLOWED_CHAIN_IDS as readonly string[]).includes(v),
  sellToken: (v) => ADDRESS.test(v),
  buyToken: (v) => ADDRESS.test(v),
  sellAmount: (v) => UINT.test(v) && v !== '0',
  taker: (v) => ADDRESS.test(v),
  slippageBps: (v) => /^[0-9]{1,5}$/.test(v) && Number(v) <= 10_000,
}
const REQUIRED = ['chainId', 'sellToken', 'buyToken', 'sellAmount'] as const

export type ProxyEnv = {
  ZEROX_API_KEY?: string
  SWAP_FEE_BPS?: string
  SWAP_FEE_RECIPIENT?: string
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

/** Fee config from env, or undefined when not (validly) configured. 0x caps swapFeeBps at 1000. */
export function integratorFee(env: ProxyEnv): { bps: string; recipient: string } | undefined {
  const bps = env.SWAP_FEE_BPS?.trim()
  const recipient = env.SWAP_FEE_RECIPIENT?.trim()
  if (!bps || !recipient) return undefined
  if (!/^[0-9]{1,4}$/.test(bps) || Number(bps) <= 0 || Number(bps) > 1000) return undefined
  if (!ADDRESS.test(recipient)) return undefined
  return { bps, recipient }
}

export type UpstreamPlan =
  | { ok: true; url: string; headers: Record<string, string> }
  | { ok: false; status: number; body: { name: string; message: string } }

/** Validate an incoming proxy request and build the upstream 0x request. Pure; no network. */
export function planUpstream(method: string, requestUrl: string, env: ProxyEnv): UpstreamPlan {
  const url = new URL(requestUrl, 'http://localhost')
  if (method !== 'GET') {
    return { ok: false, status: 405, body: { name: 'METHOD_NOT_ALLOWED', message: 'Only GET is allowed.' } }
  }

  const path = url.pathname.startsWith(PROXY_PREFIX) ? url.pathname.slice(PROXY_PREFIX.length) : url.pathname
  if (!(ALLOWED_ENDPOINTS as readonly string[]).includes(path)) {
    return { ok: false, status: 404, body: { name: 'NOT_FOUND', message: 'Unknown swap endpoint.' } }
  }

  const params = new URLSearchParams()
  for (const [key, validate] of Object.entries(PASSTHROUGH)) {
    const value = url.searchParams.get(key)
    if (value === null || value === '') continue
    if (!validate(value)) {
      const message =
        key === 'chainId' ? 'Swaps are only available on Ethereum and Robinhood Chain.' : `Invalid ${key}.`
      return { ok: false, status: 400, body: { name: 'INPUT_INVALID', message } }
    }
    params.set(key, value)
  }
  const missing = REQUIRED.filter((key) => !params.has(key))
  if (missing.length) {
    return { ok: false, status: 400, body: { name: 'INPUT_INVALID', message: `Missing ${missing.join(', ')}.` } }
  }

  const key = env.ZEROX_API_KEY?.trim()
  if (!key) {
    return {
      ok: false,
      status: 503,
      body: { name: 'SWAP_NOT_CONFIGURED', message: 'Swap service not configured (missing ZEROX_API_KEY).' },
    }
  }

  const fee = integratorFee(env)
  if (fee) {
    params.set('swapFeeBps', fee.bps)
    params.set('swapFeeRecipient', fee.recipient)
  }

  return {
    ok: true,
    url: `${ZEROX_BASE_URL}${path}?${params.toString()}`,
    headers: { '0x-api-key': key, '0x-version': 'v2', accept: 'application/json' },
  }
}

/** Full proxy: validate, call 0x, forward status + body. */
export async function handleZeroExRequest(
  request: { method: string; url: string },
  env: ProxyEnv,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const plan = planUpstream(request.method, request.url, env)
  if (!plan.ok) return json(plan.status, plan.body)

  try {
    const upstream = await fetchImpl(plan.url, { headers: plan.headers })
    const body = await upstream.text()
    return new Response(body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'cache-control': 'no-store',
      },
    })
  } catch {
    return json(502, { name: 'UPSTREAM_UNREACHABLE', message: 'Could not reach the 0x API.' })
  }
}

export const envFromProcess = (): ProxyEnv => ({
  ZEROX_API_KEY: process.env.ZEROX_API_KEY,
  SWAP_FEE_BPS: process.env.SWAP_FEE_BPS,
  SWAP_FEE_RECIPIENT: process.env.SWAP_FEE_RECIPIENT,
})
