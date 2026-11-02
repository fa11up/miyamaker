import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

import type { SignatureVerifier } from './auth'
import { makeNonce, signToken, verifySiweLogin } from './auth'
import { BadgeResolver, viemHoldingReader } from './badges'
import type { Env } from './env'
import { allowedOrigins, modSet } from './env'
import { ROOM_RE } from './protocol'
import { RateLimiter } from './ratelimit'

export { ChatRoom } from './room'

/*
 * Best-effort per-IP limit on /auth/*: in-memory per isolate, so it resets when the isolate is
 * recycled and is not shared across Cloudflare locations. It stops casual hammering of the RPC-backed
 * verify endpoint; use a Cloudflare WAF rate-limiting rule on /auth/* for a hard global limit.
 */
const authLimiter = new RateLimiter(20, 60_000)
let badgeResolver: BadgeResolver | undefined
let verifier: SignatureVerifier | undefined

function clientIp(request: Request) {
  return request.headers.get('CF-Connecting-IP') || '0.0.0.0'
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin')
  const headers: Record<string, string> = { Vary: 'Origin' }
  if (origin && allowedOrigins(env).includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type'
    headers['Access-Control-Max-Age'] = '600'
  }
  return headers
}

function json(request: Request, env: Env, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(request, env),
      ...extra,
    },
  })
}

function getVerifier(env: Env): SignatureVerifier {
  if (!verifier) {
    const client = createPublicClient({ chain: mainnet, transport: http(env.RPC_URL, { timeout: 8_000 }) })
    // Handles EOAs locally and ERC-1271 / ERC-6492 smart accounts over RPC.
    verifier = ({ address, message, signature }) => client.verifyMessage({ address, message, signature })
  }
  return verifier
}

function getBadges(env: Env) {
  badgeResolver ??= new BadgeResolver(viemHoldingReader(env.RPC_URL), modSet(env))
  return badgeResolver
}

async function handleAuth(request: Request, env: Env, path: string): Promise<Response> {
  const limited = authLimiter.take(clientIp(request), Date.now())
  if (!limited.ok)
    return json(request, env, { error: 'rate limited' }, 429, { 'Retry-After': String(Math.ceil(limited.retryAfterMs / 1000)) })

  if (path === '/auth/nonce' && request.method === 'GET') {
    return json(request, env, { nonce: await makeNonce(env.SESSION_SECRET, Date.now()) })
  }

  if (path === '/auth/verify' && request.method === 'POST') {
    const length = Number(request.headers.get('Content-Length') || '0')
    if (length > 8192) return json(request, env, { error: 'body too large' }, 413)
    let body: { message?: unknown; signature?: unknown }
    try {
      const text = await request.text()
      if (text.length > 8192) return json(request, env, { error: 'body too large' }, 413)
      body = JSON.parse(text)
    } catch {
      return json(request, env, { error: 'invalid JSON' }, 400)
    }
    const now = Date.now()
    const result = await verifySiweLogin({
      message: body.message,
      signature: body.signature,
      origin: request.headers.get('Origin'),
      allowedOrigins: allowedOrigins(env),
      secret: env.SESSION_SECRET,
      now,
      verify: getVerifier(env),
    })
    if (!result.ok) return json(request, env, { error: result.error }, result.status)
    const { token, exp } = await signToken(env.SESSION_SECRET, result.address, now)
    const resolver = getBadges(env)
    const badges = await resolver.badgesFor(result.address)
    return json(request, env, { token, address: result.address, expiresAt: exp, badges, mod: resolver.isMod(result.address) })
  }

  return json(request, env, { error: 'not found' }, 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) })

    if (path === '/health') return json(request, env, { ok: true })

    if (path.startsWith('/auth/')) {
      try {
        return await handleAuth(request, env, path)
      } catch (e) {
        console.error('auth error', e)
        return json(request, env, { error: 'internal error' }, 500)
      }
    }

    const roomMatch = /^\/rooms\/([^/]+)$/.exec(path)
    if (roomMatch) {
      const room = decodeURIComponent(roomMatch[1]!)
      if (!ROOM_RE.test(room)) return json(request, env, { error: 'bad room' }, 400)
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
        return json(request, env, { error: 'expected websocket' }, 426)
      const origin = request.headers.get('Origin')
      if (!origin || !allowedOrigins(env).includes(origin)) return new Response('origin not allowed', { status: 403 })

      // Forward only what the room needs; the IP comes from Cloudflare, never from the client.
      const headers = new Headers(request.headers)
      headers.set('x-miyatv-room', room)
      headers.set('x-miyatv-ip', clientIp(request))
      const stub = env.ROOMS.get(env.ROOMS.idFromName(room))
      return stub.fetch(new Request(request.url, { method: 'GET', headers }))
    }

    return json(request, env, { error: 'not found' }, 404)
  },
} satisfies ExportedHandler<Env>
