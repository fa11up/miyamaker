// Vercel Function: GET /api/0x/swap/allowance-holder/price -> 0x Swap API v2 (key injected server-side).
import { envFromProcess, handleZeroExRequest } from '../../../_lib/zeroex'

export function GET(request: Request): Promise<Response> {
  return handleZeroExRequest(request, envFromProcess())
}
