// Vercel Function: GET/POST /api/opensea?op=... -> OpenSea API v2 (key injected server-side, see api/_lib/opensea.ts).
import { envFromProcess, handleOpenSeaRequest } from './_lib/opensea'
import { clientKey, createRateLimiter, sameOrigin } from './_lib/zeroex'

const guards = {
  sameOrigin,
  clientKey,
  readLimiter: createRateLimiter({ capacity: 120, perSecond: 2 }),
  fillLimiter: createRateLimiter({ capacity: 10, perSecond: 0.2 }),
}

export function GET(request: Request): Promise<Response> {
  return handleOpenSeaRequest({ method: 'GET', url: request.url, headers: request.headers }, envFromProcess(), guards)
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.text()).slice(0, 4096)
  return handleOpenSeaRequest(
    { method: 'POST', url: request.url, headers: request.headers, body },
    envFromProcess(),
    guards
  )
}
