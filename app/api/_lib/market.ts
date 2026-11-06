/* eslint-disable no-restricted-syntax -- merging reads clearer as a plain loop */
/**
 * One market view per collection, the way imd.fun/seats does it: the server gathers listings from every source it can
 * read, merges them into one list (each NFT once, at its cheapest, tagged with where it is), and everyone reads the
 * same cached copy. If the source is down it serves the last good copy, marked `stale`, rather than nothing.
 *
 *   GET /api/market/listings?slug=<slug>   { at, stale, count, sources, floor, listings }
 *   GET /api/market/sales?slug=<slug>      { at, stale, day: { count, volume }, sales }
 *
 * Only OpenSea today. MiyaPool joins as a second source when pools are live.
 * Upstream, the key and the cache are passed in, so `node --test` runs all of it (tests/market.test.mts).
 */

export const MARKET_PREFIX = '/api/market'
const SLUG = /^[a-z0-9][a-z0-9_-]{0,99}$/i
const FRESH_MS = 30_000
export const STALE_LIMIT_MS = 15 * 60_000
const DAY_S = 86_400
const WEEK_S = 7 * DAY_S

export type MarketSource = 'opensea' | 'miyapool'

export type MarketListing = {
  tokenId: string
  /** Wei, as a string: too big for a JS number. */
  price: string
  currency: string
  source: MarketSource
  /** The order to fill, when it can be bought here. */
  hash: string | null
  protocol: string | null
  seller: string | null
  /** Seconds; 0 when unknown. */
  expiry: number
}

export type MarketSale = {
  tokenId: string
  price: string
  currency: string
  at: number
  buyer: string
  seller: string
  tx: string
}

const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined)
const arr = (v: unknown) => (Array.isArray(v) ? v : [])
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const CURRENCY: Record<string, string> = {
  '0x0000000000000000000000000000000000000000': 'ETH',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
}

/** One OpenSea listing as a market row; undefined for anything that is not a single live NFT at a known price. */
export function fromOpenSea(raw: unknown): MarketListing | undefined {
  const o = obj(raw)
  const hash = str(o?.order_hash)
  if (!o || !hash || (str(o.status) && o.status !== 'ACTIVE')) return undefined
  const current = obj(obj(o.price)?.current)
  const value = str(current?.value) ?? (typeof current?.value === 'number' ? String(current.value) : undefined)
  if (!value || !/^[0-9]+$/.test(value) || value === '0') return undefined
  const params = obj(obj(o.protocol_data)?.parameters)
  const nft = arr(params?.offer)
    .map(obj)
    .find((i) => i?.itemType === 2 || i?.itemType === 3)
  const id = nft?.identifierOrCriteria !== undefined ? String(nft.identifierOrCriteria) : undefined
  if (!id || !/^[0-9]+$/.test(id)) return undefined
  const token = arr(params?.consideration).map(obj)[0]?.token
  const currency = str(current?.currency) || CURRENCY[String(token).toLowerCase()] || 'ETH'
  return {
    tokenId: id,
    price: value,
    currency,
    source: 'opensea',
    hash,
    protocol: str(o.protocol_address) ?? null,
    seller: str(params?.offerer)?.toLowerCase() ?? null,
    expiry: Number(params?.endTime) || 0,
  }
}

/**
 * Each NFT once, at its cheapest, cheapest first. Only same-currency prices can be compared, so ETH rows win over a
 * token-priced row for the same NFT, and a token-priced row is listed after every ETH one.
 */
export function mergeListings(rows: readonly MarketListing[], nowSeconds: number) {
  const best = new Map<string, MarketListing>()
  const eth = (l: MarketListing) => l.currency === 'ETH'
  for (const l of rows) {
    if (!l.expiry || l.expiry > nowSeconds) {
      const held = best.get(l.tokenId)
      if (!held || (eth(l) && !eth(held)) || (eth(l) === eth(held) && BigInt(l.price) < BigInt(held.price)))
        best.set(l.tokenId, l)
    }
  }

  const listings = [...best.values()].sort((a, b) => {
    if (eth(a) !== eth(b)) return eth(a) ? -1 : 1
    const [x, y] = [BigInt(a.price), BigInt(b.price)]
    return x < y ? -1 : x > y ? 1 : 0
  })
  const sources: Record<string, number> = {}
  for (const l of listings) sources[l.source] = (sources[l.source] ?? 0) + 1
  const cheapest = listings[0]
  return {
    count: listings.length,
    sources,
    floor:
      cheapest && eth(cheapest) ? { price: cheapest.price, tokenId: cheapest.tokenId, source: cheapest.source } : null,
    listings,
  }
}

export function fromOpenSeaSale(raw: unknown): MarketSale | undefined {
  const e = obj(raw)
  const pay = obj(e?.payment)
  const id = str(obj(e?.nft)?.identifier)
  const price = str(pay?.quantity)
  const tx = str(e?.transaction)
  const at = Number(e?.event_timestamp ?? e?.closing_date)
  if (!id || !price || !/^[0-9]+$/.test(price) || !tx || !Number.isFinite(at)) return undefined
  return {
    tokenId: id,
    price,
    currency: str(pay?.symbol) || 'ETH',
    at,
    buyer: str(e?.buyer) ?? '',
    seller: str(e?.seller) ?? '',
    tx,
  }
}

/** Newest first, with the last day's count and ETH volume. */
export function summarizeSales(rows: readonly MarketSale[], nowSeconds: number) {
  const sales = [...rows].sort((a, b) => b.at - a.at)
  const day = sales.filter((s) => nowSeconds - s.at <= DAY_S)
  const volume = day
    .filter((s) => s.currency === 'ETH' || s.currency === 'WETH')
    .reduce((v, s) => v + BigInt(s.price), 0n)
  return { day: { count: day.length, volume: volume.toString() }, sales }
}

export type MarketCache = {
  get: (key: string) => Promise<{ at: number; body: unknown } | undefined>
  put: (key: string, value: { at: number; body: unknown }) => Promise<void>
}

export type MarketDeps = {
  /** An OpenSea API v2 GET, returning parsed JSON; throws when it fails. */
  openSea: (path: string, query: Record<string, string>) => Promise<unknown>
  cache: MarketCache
  sameOrigin: (headers: Headers | undefined, url: URL) => boolean
  clientKey: (headers: Headers | undefined) => string
  limiter: (key: string) => boolean
  now?: () => number
}

const reply = (status: number, body: unknown, cache = 'no-store') =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cache },
  })

export async function handleMarketRequest(
  request: { method: string; url: string; headers: Headers },
  deps: MarketDeps
): Promise<Response> {
  const url = new URL(request.url)
  const now = deps.now?.() ?? Date.now()
  const nowS = Math.floor(now / 1000)
  if (request.method !== 'GET') return reply(405, { message: 'Not allowed.' })
  if (!deps.sameOrigin(request.headers, url)) return reply(403, { message: 'Wrong origin.' })
  if (!deps.limiter(deps.clientKey(request.headers))) return reply(429, { message: 'Too many requests.' })
  const slug = url.searchParams.get('slug') ?? ''
  if (!SLUG.test(slug)) return reply(400, { message: 'That is not a collection.' })
  const kind = url.pathname.slice(MARKET_PREFIX.length + 1)
  if (kind !== 'listings' && kind !== 'sales') return reply(404, { message: 'Not found.' })

  const key = `${kind}:${slug.toLowerCase()}`
  const saved = await deps.cache.get(key).catch(() => undefined)
  const send = (at: number, body: object, stale: boolean) => reply(200, { at, stale, ...body }, 'public, max-age=10')
  if (saved && now - saved.at < FRESH_MS) return send(saved.at, saved.body as object, false)

  try {
    let body: object
    if (kind === 'listings') {
      const path = `/api/v2/listings/collection/${encodeURIComponent(slug)}/best`
      // As many as OpenSea gives in one call; the proxy's known-good 20 if it turns the larger page down.
      const j = obj(await deps.openSea(path, { limit: '100' }).catch(() => deps.openSea(path, { limit: '20' })))
      const rows = arr(j?.listings)
        .map(fromOpenSea)
        .filter((l): l is MarketListing => !!l)
      body = mergeListings(rows, nowS)
    } else {
      const j = obj(
        await deps.openSea(`/api/v2/events/collection/${encodeURIComponent(slug)}`, {
          event_type: 'sale',
          limit: '50',
          after: String(nowS - WEEK_S),
        })
      )
      const rows = arr(j?.asset_events)
        .map(fromOpenSeaSale)
        .filter((s): s is MarketSale => !!s)
      body = summarizeSales(rows, nowS)
    }

    await deps.cache.put(key, { at: now, body }).catch(() => undefined)
    return send(now, body, false)
  } catch (e) {
    // The last good copy beats an empty page, for a while, and says it is old.
    if (saved && now - saved.at < STALE_LIMIT_MS) return send(saved.at, saved.body as object, true)
    const name = (e as { name?: string })?.name
    return reply(name === 'MARKET_NOT_CONFIGURED' ? 503 : 502, {
      name,
      message: 'The market is unavailable right now.',
    })
  }
}

/** The Worker's shared cache (the Cloudflare Cache API, per data centre). */
export function edgeCache(cache: Cache | undefined): MarketCache {
  const req = (key: string) => new Request(`https://market.cache/${encodeURIComponent(key)}`)
  return {
    get: async (key) => {
      const hit = await cache?.match(req(key))
      return hit ? ((await hit.json()) as { at: number; body: unknown }) : undefined
    },
    put: async (key, value) => {
      await cache?.put(
        req(key),
        new Response(JSON.stringify(value), {
          headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${STALE_LIMIT_MS / 1000}` },
        })
      )
    },
  }
}

export function memoryCache(): MarketCache {
  const m = new Map<string, { at: number; body: unknown }>()
  return {
    get: async (key) => m.get(key),
    put: async (key, value) => {
      m.set(key, value)
    },
  }
}

/** OpenSea API v2 GET for the Worker: the key server-side, big integers kept as strings. A missing key names itself. */
export const openSeaReader =
  (key: string | undefined, quote: (text: string) => string, base = 'https://api.opensea.io') =>
  async (path: string, query: Record<string, string>) => {
    if (!key) throw Object.assign(new Error('no key'), { name: 'MARKET_NOT_CONFIGURED' })
    const res = await fetch(`${base}${path}?${new URLSearchParams(query)}`, {
      headers: { accept: 'application/json', 'x-api-key': key },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401 || res.status === 403)
      throw Object.assign(new Error('refused'), { name: 'MARKET_NOT_CONFIGURED' })
    if (!res.ok) throw new Error(`OpenSea ${res.status}`)
    return JSON.parse(quote(await res.text())) as unknown
  }
