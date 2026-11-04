import type { SwapRequest, ZeroExPrice, ZeroExQuote } from './types'

/** Same-origin proxy (Cloudflare Worker in prod, Vite middleware in dev). The 0x key stays server-side. */
const PROXY_BASE = '/api/0x/swap/allowance-holder'

export class SwapApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message)
  }

  get notConfigured() {
    return this.code === 'SWAP_NOT_CONFIGURED'
  }
}

const FRIENDLY: Record<string, string> = {
  SWAP_NOT_CONFIGURED: 'Swap service not configured.',
  TOKEN_NOT_SUPPORTED: '0x does not support one of these tokens.',
  INSUFFICIENT_BALANCE: 'Not enough balance for this trade.',
  UPSTREAM_UNREACHABLE: 'Could not reach the swap service.',
}

async function call<T>(endpoint: 'price' | 'quote', req: SwapRequest, signal?: AbortSignal): Promise<T> {
  const params = new URLSearchParams({
    chainId: String(req.chainId),
    sellToken: req.sellToken,
    buyToken: req.buyToken,
    sellAmount: req.sellAmount.toString(),
    slippageBps: String(req.slippageBps),
  })
  if (req.taker) params.set('taker', req.taker)

  let res: Response
  try {
    res = await fetch(`${PROXY_BASE}/${endpoint}?${params}`, { signal, headers: { accept: 'application/json' } })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new SwapApiError('Could not reach the swap service.', 'NETWORK', 0)
  }

  const text = await res.text()
  let body: any
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    // e.g. a static host with no /api route returns index.html
    throw new SwapApiError('Swap service not configured.', 'SWAP_NOT_CONFIGURED', res.status)
  }

  if (!res.ok) {
    const code: string = body?.name || `HTTP_${res.status}`
    const detail = body?.data?.details?.[0]?.reason
    throw new SwapApiError(FRIENDLY[code] || detail || body?.message || 'Swap request failed.', code, res.status)
  }

  return body as T
}

export const fetchPrice = (req: SwapRequest, signal?: AbortSignal) => call<ZeroExPrice>('price', req, signal)
export const fetchQuote = (req: SwapRequest, signal?: AbortSignal) => call<ZeroExQuote>('quote', req, signal)
