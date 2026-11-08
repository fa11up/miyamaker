/**
 * The app's keyed RPC, kept on the server: POST /api/rpc/<chainId> forwards JSON-RPC reads to RPC_URL_<chainId> (a
 * Worker secret, e.g. an Alchemy URL with its key in it), and GET /api/nft/<chainId>/getNFTsForOwner forwards to
 * Alchemy's NFT API with ALCHEMY_API_KEY. Nothing with a key is bundled into the page any more.
 *
 * - Same-origin only, rate-limited per IP (per isolate; see createRateLimiter in zeroex.ts for the global WAF rule).
 * - Reads only: METHODS below. Anything else is answered here with a JSON-RPC "method not found" (-32601), so the
 *   page's fallback transport sends it to a public RPC instead. Batches hold at most MAX_BATCH calls.
 * - eth_getLogs ranges are capped at MAX_LOG_BLOCKS (an open "earliest" range is refused the same way).
 * - Bodies are capped at RPC_BODY_LIMIT: the caller reads at most that much (readCappedText in body.ts) and passes
 *   `body: undefined` when the request said it was larger.
 * - When a chain's secret is not set the answer is 503 with `x-rpc-proxy: off`: the page stops asking this route
 *   for that chain and uses its public RPCs (src/config/wagmi.ts), so the app works with no secrets at all.
 *
 * Shared by the Worker (api/worker.ts) and the Vite dev middleware (vite.config.ts). No imports, so `node --test` can
 * load it (tests/rpc-proxy.test.mts).
 */

export const RPC_PREFIX = '/api/rpc'
export const NFT_PREFIX = '/api/nft'

/** Chains this route serves, and the env name of each one's secret URL. */
export const RPC_CHAINS: Record<string, string> = {
  '1': 'RPC_URL_1',
  '11155111': 'RPC_URL_11155111',
  '4663': 'RPC_URL_4663',
}

/** Read methods only. Nothing that signs, sends, subscribes or keeps state on the node. */
export const METHODS: ReadonlySet<string> = new Set([
  'eth_call',
  'eth_getBalance',
  'eth_blockNumber',
  'eth_getLogs',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_chainId',
  'eth_getCode',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_getBlockByNumber',
  'eth_getTransactionCount',
  'eth_getStorageAt',
  // Alchemy's transfer index, for Trade's "Your <token> history". Public RPCs don't have it.
  'alchemy_getAssetTransfers',
])

export const MAX_BATCH = 20
/** The widest eth_getLogs range forwarded. Wider ones go to the public RPCs (the page's fallback). */
export const MAX_LOG_BLOCKS = 10_000n
/** An eth_call or eth_estimateGas can carry a contract's creation code (~50 KB as hex); a batch of 20 calls more. */
export const RPC_BODY_LIMIT = 128 * 1024
/** alchemy_getAssetTransfers: at most this many rows per call (the page asks for 8). */
const MAX_TRANSFER_ROWS = 100

export type RpcEnv = Partial<Record<string, string | undefined>>

export type RpcGuards = {
  sameOrigin: (headers: Headers | undefined, url: URL) => boolean
  clientKey: (headers: Headers | undefined) => string
  limiter: (key: string, now?: number) => boolean
}

type Call = { jsonrpc: '2.0'; id: number | string | null; method: string; params?: unknown[] }
type Answer = { jsonrpc: '2.0'; id: number | string | null; result?: unknown; error?: { code: number; message: string } }

const rpcError = (id: Call['id'], code: number, message: string): Answer => ({ jsonrpc: '2.0', id, error: { code, message } })

const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  })

/** The secret URL for a chain, when it is set and is an https URL. */
export function upstreamFor(chainId: string, env: RpcEnv): string | undefined {
  const name = RPC_CHAINS[chainId]
  const raw = name ? env[name]?.trim() : undefined
  if (!raw) return undefined
  try {
    return new URL(raw).protocol === 'https:' ? raw : undefined
  } catch {
    return undefined
  }
}

const TAGS = new Set(['latest', 'safe', 'finalized', 'pending'])
const QUANTITY = /^0x(0|[1-9a-f][0-9a-f]{0,15})$/i

/**
 * Whether an eth_getLogs filter stays within MAX_LOG_BLOCKS. `latest` is the chain head (asked for once when a range
 * ends there). A blockHash filter is one block. Returns an error message or undefined.
 */
export async function logRangeError(params: unknown, head: () => Promise<bigint>): Promise<string | undefined> {
  const filter = Array.isArray(params) && params.length === 1 ? params[0] : undefined
  if (!filter || typeof filter !== 'object') return 'eth_getLogs takes one filter object.'
  const { fromBlock = 'latest', toBlock = 'latest', blockHash } = filter as Record<string, unknown>
  if (blockHash !== undefined) return typeof blockHash === 'string' ? undefined : 'blockHash must be a hash.'
  const at = async (b: unknown): Promise<bigint | undefined> => {
    if (typeof b !== 'string') return undefined
    if (b === 'earliest') return 0n
    if (TAGS.has(b)) return head()
    return QUANTITY.test(b) ? BigInt(b) : undefined
  }
  if (fromBlock === toBlock && typeof fromBlock === 'string' && TAGS.has(fromBlock)) return undefined
  const from = await at(fromBlock)
  const to = await at(toBlock)
  if (from === undefined || to === undefined) return 'fromBlock and toBlock must be block numbers or tags.'
  if (to < from) return undefined // an empty range: the node answers []
  if (to - from + 1n > MAX_LOG_BLOCKS) return `eth_getLogs is limited to ${MAX_LOG_BLOCKS} blocks here.`
  return undefined
}

/** alchemy_getAssetTransfers asks for a bounded page. */
function transfersError(params: unknown): string | undefined {
  const q = Array.isArray(params) && params.length === 1 ? (params[0] as Record<string, unknown>) : undefined
  if (!q || typeof q !== 'object') return 'alchemy_getAssetTransfers takes one query object.'
  const max = q.maxCount
  if (typeof max !== 'string' || !QUANTITY.test(max) || BigInt(max) === 0n || BigInt(max) > BigInt(MAX_TRANSFER_ROWS))
    return `maxCount must be 1 to ${MAX_TRANSFER_ROWS}.`
  return undefined
}

function asCall(raw: unknown): Call | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const c = raw as Record<string, unknown>
  const id = c.id
  if (!(id === null || typeof id === 'number' || (typeof id === 'string' && id.length <= 64))) return undefined
  if (c.jsonrpc !== '2.0' || typeof c.method !== 'string' || c.method.length > 64) return undefined
  if (c.params !== undefined && !Array.isArray(c.params)) return undefined
  return { jsonrpc: '2.0', id, method: c.method, ...(c.params !== undefined ? { params: c.params as unknown[] } : {}) }
}

/**
 * Splits a request into the calls to forward and the answers given here (refused methods, oversized ranges). Pure but
 * for `head`, which is only asked when an eth_getLogs range ends at a tag.
 */
export async function screen(
  body: unknown,
  head: () => Promise<bigint>
): Promise<{ batch: boolean; forward: Call[]; local: Answer[] } | { error: string }> {
  const batch = Array.isArray(body)
  const items = batch ? (body as unknown[]) : [body]
  if (items.length === 0) return { error: 'Empty batch.' }
  if (items.length > MAX_BATCH) return { error: `At most ${MAX_BATCH} calls per batch.` }
  const forward: Call[] = []
  const local: Answer[] = []
  for (const raw of items) {
    const call = asCall(raw)
    if (!call) return { error: 'Not a JSON-RPC 2.0 request.' }
    if (!METHODS.has(call.method)) {
      local.push(rpcError(call.id, -32601, `${call.method} is not served here.`))
      continue
    }
    const problem =
      call.method === 'eth_getLogs'
        ? await logRangeError(call.params, head) // eslint-disable-line no-await-in-loop -- head() is asked once at most
        : call.method === 'alchemy_getAssetTransfers'
          ? transfersError(call.params)
          : undefined
    if (problem) local.push(rpcError(call.id, -32005, problem))
    else forward.push(call)
  }
  return { batch, forward, local }
}

/** A head lookup kept for a few seconds per upstream, so a burst of log reads asks once. */
const heads = new Map<string, { at: number; value: Promise<bigint> }>()
function headReader(upstream: string, fetchImpl: typeof fetch, now: number) {
  return () => {
    const hit = heads.get(upstream)
    if (hit && now - hit.at < 4_000) return hit.value
    const value = fetchImpl(upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(8_000),
    })
      .then((r) => r.json() as Promise<{ result?: unknown }>)
      .then((j) => {
        if (typeof j?.result !== 'string' || !QUANTITY.test(j.result)) throw new Error('no head')
        return BigInt(j.result)
      })
    value.catch(() => heads.delete(upstream))
    heads.set(upstream, { at: now, value })
    return value
  }
}

const OFF = { 'x-rpc-proxy': 'off' }

export type RpcRequest = { method: string; url: string; headers?: Headers; body?: string }

/** POST /api/rpc/<chainId>. `body` is the request's text cut at RPC_BODY_LIMIT, or undefined when it said it was larger. */
export async function handleRpcRequest(
  request: RpcRequest,
  env: RpcEnv,
  guards: RpcGuards,
  fetchImpl: typeof fetch = fetch,
  now = Date.now()
): Promise<Response> {
  const url = new URL(request.url)
  const chainId = url.pathname.slice(RPC_PREFIX.length + 1)
  if (!(chainId in RPC_CHAINS)) return reply(404, { error: 'Unknown chain.' })
  if (request.method !== 'POST') return reply(405, { error: 'POST only.' }, { allow: 'POST' })
  if (!guards.sameOrigin(request.headers, url)) return reply(403, { error: 'Same-origin only.' })
  if (!guards.limiter(guards.clientKey(request.headers)))
    return reply(429, { error: 'Too many requests, slow down.' }, { 'retry-after': '2' })

  const upstream = upstreamFor(chainId, env)
  if (!upstream) return reply(503, { error: 'This chain uses public RPCs.' }, OFF)

  const text = request.body
  // At the limit means it was cut there: a cut body is not forwarded as if it were whole.
  if (text === undefined || new TextEncoder().encode(text).byteLength >= RPC_BODY_LIMIT)
    return reply(413, { error: 'That is too large.' })
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return reply(400, rpcError(null, -32700, 'Parse error.'))
  }

  const screened = await screen(body, headReader(upstream, fetchImpl, now)).catch(() => ({
    error: 'The chain head could not be read.',
  }))
  if ('error' in screened) return reply(400, rpcError(null, -32600, screened.error))
  const { batch, forward, local } = screened
  if (forward.length === 0) return reply(200, batch ? local : local[0])

  let res: Response
  try {
    res = await fetchImpl(upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(batch ? forward : forward[0]),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return reply(502, { error: 'The RPC could not be reached.' })
  }
  // A refused key: say only that this route is unavailable, never anything the node said about the key.
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel().catch(() => undefined)
    console.log(`rpc: the node refused the key for chain ${chainId} (${res.status})`)
    return reply(503, { error: 'This chain uses public RPCs.' }, OFF)
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined)
    return reply(502, { error: `The RPC answered ${res.status}.` }, res.status === 429 ? { 'retry-after': '2' } : {})
  }
  if (!batch && local.length === 0) {
    // One call, passed through as the node sent it.
    return new Response(res.body, {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    })
  }
  let answers: unknown
  try {
    answers = await res.json()
  } catch {
    return reply(502, { error: 'The RPC answered without JSON.' })
  }
  if (!Array.isArray(answers)) return reply(502, { error: 'The RPC did not answer the batch.' })
  return reply(200, [...answers, ...local])
}

/** Alchemy NFT API networks by chain. */
const NFT_NETWORKS: Record<string, string> = { '1': 'eth-mainnet' }
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** The NFT API query forwarded, from the page's: `{ query }` or `{ error }`. */
export function nftQuery(params: URLSearchParams): { query: URLSearchParams } | { error: string } {
  const allowed = new Set(['owner', 'withMetadata', 'pageSize', 'pageKey', 'contractAddresses[]'])
  for (const k of params.keys()) if (!allowed.has(k)) return { error: `${k} is not accepted.` }
  for (const k of new Set(params.keys()))
    if (k !== 'contractAddresses[]' && params.getAll(k).length > 1) return { error: `${k} is given twice.` }
  const owner = params.get('owner') ?? ''
  if (!ADDRESS.test(owner)) return { error: 'owner must be an address.' }
  const contracts = params.getAll('contractAddresses[]')
  if (contracts.length > 45 || contracts.some((c) => !ADDRESS.test(c))) return { error: 'contractAddresses[] must be up to 45 addresses.' }
  const withMetadata = params.get('withMetadata') ?? 'true'
  if (withMetadata !== 'true' && withMetadata !== 'false') return { error: 'withMetadata must be true or false.' }
  const pageSize = params.get('pageSize') ?? '100'
  if (!/^[1-9][0-9]{0,2}$/.test(pageSize) || Number(pageSize) > 100) return { error: 'pageSize must be 1 to 100.' }
  const pageKey = params.get('pageKey')
  if (pageKey !== null && !/^[\w\-:.=+/]{1,512}$/.test(pageKey)) return { error: 'pageKey is not one Alchemy gave.' }
  const query = new URLSearchParams({ owner, withMetadata, pageSize })
  for (const c of contracts) query.append('contractAddresses[]', c)
  if (pageKey !== null) query.set('pageKey', pageKey)
  return { query }
}

/** GET /api/nft/<chainId>/getNFTsForOwner. */
export async function handleNftRequest(
  request: Omit<RpcRequest, 'body'>,
  env: { ALCHEMY_API_KEY?: string },
  guards: RpcGuards,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const url = new URL(request.url)
  const [chainId, route, ...rest] = url.pathname.slice(NFT_PREFIX.length + 1).split('/')
  const network = chainId ? NFT_NETWORKS[chainId] : undefined
  if (!network || route !== 'getNFTsForOwner' || rest.length) return reply(404, { error: 'Not found.' })
  if (request.method !== 'GET') return reply(405, { error: 'GET only.' }, { allow: 'GET' })
  if (!guards.sameOrigin(request.headers, url)) return reply(403, { error: 'Same-origin only.' })
  if (!guards.limiter(guards.clientKey(request.headers)))
    return reply(429, { error: 'Too many requests, slow down.' }, { 'retry-after': '2' })
  const key = env.ALCHEMY_API_KEY?.trim()
  if (!key) return reply(503, { error: 'The NFT index is not set up.' }, OFF)
  const parsed = nftQuery(url.searchParams)
  if ('error' in parsed) return reply(400, { error: parsed.error })

  let res: Response
  try {
    res = await fetchImpl(
      `https://${network}.g.alchemy.com/nft/v3/${encodeURIComponent(key)}/getNFTsForOwner?${parsed.query}`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }
    )
  } catch {
    return reply(502, { error: 'The NFT index could not be reached.' })
  }
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel().catch(() => undefined)
    console.log(`nft: Alchemy refused the key (${res.status})`)
    return reply(503, { error: 'The NFT index is not set up.' }, OFF)
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined)
    return reply(502, { error: `The NFT index answered ${res.status}.` })
  }
  return new Response(res.body, {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })
}
