import { swapApiWords } from './swapLogic'
import type { SwapRequest, ZeroExPrice, ZeroExQuote } from './types'

/** Same-origin proxy (Cloudflare Worker in prod, Vite middleware in dev). The 0x key stays server-side. */
const PROXY_BASE = '/api/0x/swap/allowance-holder'

export class SwapApiError extends Error {
  /** Written for the screen: describeTxError shows it as it is. */
  readonly plainWords = true

  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message)
  }

  get notConfigured() {
    return this.code === 'SWAP_NOT_CONFIGURED'
  }
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
    throw new SwapApiError(swapApiWords('NETWORK'), 'NETWORK', 0)
  }

  const text = await res.text()
  let body: any
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    // e.g. a static host with no /api route returns index.html
    throw new SwapApiError(swapApiWords('SWAP_NOT_CONFIGURED'), 'SWAP_NOT_CONFIGURED', res.status)
  }

  if (!res.ok) {
    const code: string = body?.name || `HTTP_${res.status}`
    // Only words we wrote reach the screen: what 0x says is for developers.
    throw new SwapApiError(swapApiWords(code), code, res.status)
  }

  return body as T
}

export const fetchPrice = (req: SwapRequest, signal?: AbortSignal) => call<ZeroExPrice>('price', req, signal)
export const fetchQuote = (req: SwapRequest, signal?: AbortSignal) => call<ZeroExQuote>('quote', req, signal)
