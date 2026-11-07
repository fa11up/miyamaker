/* eslint-disable no-restricted-syntax -- the converters read clearer as loops with early returns */
/**
 * Pure logic for Trade → NFTs "Markets": where a collection or one NFT trades, links out to each venue, OpenSea
 * response parsing, the best-price line, and the checks run on an OpenSea fill before the wallet opens. No runtime
 * imports, so `node --test` can load it (tests/markets.test.mts).
 *
 * Venues (checked Nov 2026):
 *   MiyaPool  our pools, on-chain, 0% fees (Ethereum, Sepolia, Robinhood Chain once the factory is live).
 *   OpenSea   API v2 through our proxy (/api/opensea): prices, listings, offers, in-app Seaport fills.
 *             Ethereum + Robinhood Chain. OpenSea closed its testnets, so no Sepolia.
 * Left out: Reservoir (api.reservoir.tools no longer resolves), LooksRare (API v2 answers 404), X2Y2 (API down).
 */

export type MarketChainKey = 'ethereum' | 'robinhood'

/** OpenSea's chain identifier per chain id (undefined = OpenSea does not serve that chain). */
export const OPENSEA_CHAIN: Record<number, MarketChainKey | undefined> = { 1: 'ethereum', 4663: 'robinhood' }

export type VenueId = 'miyapool' | 'opensea'

export type Venue = {
  id: VenueId
  name: string
  /** Plain fee words for the card. */
  fees: string
  chains: number[]
  /** Where its numbers come from. */
  data: 'onchain' | 'opensea' | 'none'
  /** Buy / accept an offer without leaving miyaOS. */
  inApp: boolean
}

export const VENUES: Venue[] = [
  { id: 'miyapool', name: 'MiyaPool', fees: '0% fees', chains: [1, 11155111, 4663], data: 'onchain', inApp: true },
  // In-app OpenSea fills never add optional creator fees; only ones a collection enforces apply.
  {
    id: 'opensea',
    name: 'OpenSea',
    fees: '1% fee + any required creator fee',
    chains: [1, 4663],
    data: 'opensea',
    inApp: true,
  },
]

export const venuesFor = (chainId: number) => VENUES.filter((v) => v.chains.includes(chainId))

/** "OpenSea" where it trades, "" where only MiyaPool does. */
export function otherMarkets(chainId: number): string {
  const names = venuesFor(chainId)
    .filter((v) => v.id !== 'miyapool')
    .map((v) => v.name)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || ''
}

/** The collection page on a venue, or undefined when it is not on that chain (MiyaPool is in-app). */
export function collectionUrl(venue: VenueId, chainId: number, contract: string, slug?: string): string | undefined {
  const c = contract.toLowerCase()
  const os = OPENSEA_CHAIN[chainId]
  // opensea.io/contract/<chain>/<address> redirects to the collection page, so no slug is needed.
  if (venue === 'opensea' && os)
    return slug ? `https://opensea.io/collection/${encodeURIComponent(slug)}` : `https://opensea.io/contract/${os}/${c}`
  return undefined
}

/** One NFT's page on a venue. */
export function itemUrl(venue: VenueId, chainId: number, contract: string, tokenId: string): string | undefined {
  const c = contract.toLowerCase()
  const os = OPENSEA_CHAIN[chainId]
  if (venue === 'opensea' && os) return `https://opensea.io/item/${os}/${c}/${tokenId}`
  return undefined
}

/* ---------- prices ---------- */

export type Price = { amount: bigint; decimals: number; symbol: string; token?: string }

/** A float from OpenSea stats (0.69999889) as a Price. Rounded to 1e-9. */
export function priceFromFloat(n: unknown, symbol: unknown, decimals = 18): Price | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return undefined
  const nano = BigInt(Math.round(n * 1e9))
  const amount = decimals >= 9 ? nano * 10n ** BigInt(decimals - 9) : nano / 10n ** BigInt(9 - decimals)
  return { amount, decimals, symbol: typeof symbol === 'string' && symbol ? symbol : 'ETH' }
}

const toBig = (v: unknown): bigint | undefined => {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v)
  if (typeof v === 'string' && /^(0x[0-9a-f]+|[0-9]+)$/i.test(v)) return BigInt(v)
  return undefined
}

/** OpenSea's Price object `{ currency, decimals, value }`. */
export function priceFromApi(p: unknown, symbolFor?: (currency: string) => string | undefined): Price | undefined {
  if (!p || typeof p !== 'object') return undefined
  const o = p as Record<string, unknown>
  const amount = toBig(o.value)
  const decimals = typeof o.decimals === 'number' ? o.decimals : 18
  if (amount === undefined) return undefined
  const currency = typeof o.currency === 'string' ? o.currency : ''
  const symbol = symbolFor?.(currency) || (/^0x/i.test(currency) ? 'tokens' : currency || 'ETH')
  return { amount, decimals, symbol, token: /^0x/i.test(currency) ? currency : undefined }
}

/** "0.7", "1,234.5", "<0.0001". */
export function formatAmount(amount: bigint, decimals: number, maxFraction = 4): string {
  const neg = amount < 0n
  const a = neg ? -amount : amount
  const base = 10n ** BigInt(decimals)
  const whole = a / base
  const frac = a % base
  const scale = 10n ** BigInt(maxFraction)
  let fracScaled = (frac * scale) / base
  let w = whole
  // round half up
  if (((frac * scale * 10n) / base) % 10n >= 5n) fracScaled += 1n
  if (fracScaled >= scale) {
    w += 1n
    fracScaled -= scale
  }

  if (w === 0n && fracScaled === 0n && a > 0n) return `<0.${'0'.repeat(maxFraction - 1)}1`
  const f = fracScaled.toString().padStart(maxFraction, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${w.toLocaleString('en-US')}${f ? `.${f}` : ''}`
}

/** Dollar tokens: shown to the cent. */
const DOLLARS = /^(imdUSD|USDC|USDG|USDT|DAI)$/i

/**
 * Decimals worth showing: dollar tokens 2; otherwise by size, 0 from 1,000 up (2,163 IMD), 2 from 10 up, else 4
 * (0.7113 ETH).
 */
export function priceDecimals(p: Price): number {
  if (DOLLARS.test(p.symbol)) return 2
  const whole = p.amount / 10n ** BigInt(p.decimals)
  return whole >= 1000n ? 0 : whole >= 10n ? 2 : 4
}

/** The lower of two prices, when they can be compared (same token); else the first that exists. */
export function lowerPrice(a: Price | undefined, b: Price | undefined): Price | undefined {
  if (!a || !b) return a || b
  if (a.symbol !== b.symbol || a.decimals !== b.decimals) return a
  return b.amount < a.amount ? b : a
}

export const formatPrice = (p: Price | undefined) =>
  p ? `${formatAmount(p.amount, p.decimals, priceDecimals(p))} ${p.symbol}` : '–'

/** ETH and WETH are the same money for comparing. */
const family = (symbol: string) => symbol.toUpperCase().replace(/^W(?=ETH$)/, '')

/** Compare prices in one currency family (scaled to 18 decimals). */
const scaled = (p: Price) =>
  p.decimals <= 18 ? p.amount * 10n ** BigInt(18 - p.decimals) : p.amount / 10n ** BigInt(p.decimals - 18)

/**
 * The cheapest (`lowest`) or highest offer among venue quotes in the same money as the first priced one (ETH and
 * WETH count as one). MiyaPool joins with its pool token priced in ETH through 0x (pairs.ts).
 */
export function bestQuote<T extends { price?: Price }>(
  quotes: T[],
  pick: 'lowest' | 'highest' = 'lowest'
): T | undefined {
  const priced = quotes.filter((q): q is T & { price: Price } => !!q.price && q.price.amount > 0n)
  if (!priced.length) return undefined
  const fam = family(priced[0]!.price.symbol)
  return priced
    .filter((q) => family(q.price.symbol) === fam)
    .reduce((best, q) => {
      const a = scaled(q.price)
      const b = scaled(best.price)
      return (pick === 'lowest' ? a < b : a > b) ? q : best
    })
}

/* ---------- OpenSea responses ---------- */

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const obj = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const arr = (v: unknown) => (Array.isArray(v) ? v : [])

export type OsCollection = {
  slug: string
  name: string
  image?: string
  contracts: { address: string; chain: string }[]
  /** Percent, e.g. 1 or 5. */
  fees: { percent: number; recipient: string; required: boolean }[]
  verified: boolean
  disabled: boolean
  url?: string
}

export function parseCollection(j: unknown): OsCollection | undefined {
  const o = obj(j)
  const slug = str(o?.collection)
  if (!o || !slug) return undefined
  return {
    slug,
    name: str(o.name) || slug,
    image: str(o.image_url) || undefined,
    contracts: arr(o.contracts)
      .map((c) => ({ address: str(obj(c)?.address) || '', chain: str(obj(c)?.chain) || '' }))
      .filter((c) => /^0x[0-9a-f]{40}$/i.test(c.address)),
    fees: arr(o.fees)
      .map((f) => ({
        percent: typeof obj(f)?.fee === 'number' ? (obj(f)!.fee as number) : 0,
        recipient: str(obj(f)?.recipient) || '',
        required: obj(f)?.required === true,
      }))
      .filter((f) => f.percent > 0),
    verified: o.safelist_status === 'verified',
    disabled: o.is_disabled === true,
    url: str(o.opensea_url),
  }
}

export type OsStats = { floor?: Price; owners?: number; sales7d?: number; volume7d?: number }

export function parseStats(j: unknown): OsStats {
  const total = obj(obj(j)?.total)
  const seven = arr(obj(j)?.intervals)
    .map(obj)
    .find((i) => i?.interval === 'seven_day')
  return {
    floor: priceFromFloat(total?.floor_price, total?.floor_price_symbol),
    owners: typeof total?.num_owners === 'number' ? (total.num_owners as number) : undefined,
    sales7d: typeof seven?.sales === 'number' ? (seven.sales as number) : undefined,
    volume7d: typeof seven?.volume === 'number' ? (seven.volume as number) : undefined,
  }
}

/** One Seaport order as the page needs it (a listing or an offer). */
export type OsOrder = {
  hash: string
  chain: string
  protocolAddress: string
  /** Per item. */
  price: Price
  tokenId?: string
  contract?: string
  /** Who listed it, when the order says. */
  maker?: string
  remaining: number
}

const KNOWN_SYMBOLS: Record<string, string> = {
  '0x0000000000000000000000000000000000000000': 'ETH',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
}

const symbolFor = (currency: string) =>
  KNOWN_SYMBOLS[currency.toLowerCase()] || (/^0x/i.test(currency) ? undefined : currency)

export function parseOrder(j: unknown): OsOrder | undefined {
  const o = obj(j)
  if (!o) return undefined
  const hash = str(o.order_hash)
  const protocolAddress = str(o.protocol_address)
  if (!hash || !/^0x[0-9a-f]{64}$/i.test(hash) || !protocolAddress) return undefined
  const status = str(o.status)
  if (status && status !== 'ACTIVE') return undefined
  const priceObj = obj(o.price)
  // Listings: price.current is the whole order, price_per_item one item. Offers: price_per_item.
  const price =
    priceFromApi(o.price_per_item, symbolFor) ||
    priceFromApi(priceObj?.current, symbolFor) ||
    priceFromApi(priceObj, symbolFor)
  if (!price) return undefined
  const params = obj(obj(o.protocol_data)?.parameters)
  const nft = arr(params?.offer)
    .map(obj)
    .find((i) => i && (i.itemType === 2 || i.itemType === 3))
  const asset = obj(o.asset)
  const id = str(asset?.identifier) ?? (nft ? String(nft.identifierOrCriteria) : undefined)
  return {
    hash,
    chain: str(o.chain) || '',
    protocolAddress,
    price,
    tokenId: id && /^[0-9]+$/.test(id) ? id : undefined,
    contract: str(asset?.contract) || str(nft?.token),
    maker: str(params?.offerer) || undefined,
    remaining: typeof o.remaining_quantity === 'number' ? (o.remaining_quantity as number) : 1,
  }
}

export const parseListings = (j: unknown): OsOrder[] =>
  arr(obj(j)?.listings)
    .map(parseOrder)
    .filter((l): l is OsOrder => !!l)

/** Best collection offer from offer_aggregates (first bucket), with how many offers sit at that price. */
export function parseOfferAggregate(j: unknown): { price: Price; count: number } | undefined {
  const first = obj(arr(obj(j)?.offer_aggregates)[0])
  const price = obj(first?.offer_price)
  const p = priceFromFloat(price?.token_unit, str(price?.symbol) || 'WETH')
  if (!p) return undefined
  return { price: p, count: typeof first?.total_offers === 'number' ? (first.total_offers as number) : 1 }
}

/** Plain words for a fill planFill could not read: its own messages name fields, for developers. */
const UNREADABLE = 'OpenSea sent an order we could not read. Nothing has moved. Try again.'

export type OsNft = { name?: string; image?: string; owners: string[]; standard?: string; suspicious: boolean }

export function parseNft(j: unknown): OsNft | undefined {
  const n = obj(obj(j)?.nft)
  if (!n) return undefined
  return {
    name: str(n.name) || undefined,
    image: str(n.display_image_url) || str(n.image_url) || undefined,
    owners: arr(n.owners)
      .map((x) => str(obj(x)?.address) || '')
      .filter(Boolean),
    standard: str(n.token_standard),
    suspicious: n.is_suspicious === true,
  }
}

export type OsSearchHit = {
  slug: string
  name: string
  image?: string
  /** OpenSea's badge, when the search result carries it. Undefined means look it up (useCollectionsVerified). */
  verified?: boolean
}

export const parseSearch = (j: unknown): OsSearchHit[] =>
  arr(obj(j)?.results)
    .map(obj)
    .filter((r) => r?.type === 'collection')
    .map((r) => obj(r!.collection))
    .filter((c) => !!c && !!str(c.collection) && c.is_disabled !== true && c.is_nsfw !== true)
    .map((c) => ({
      slug: str(c!.collection)!,
      name: str(c!.name) || str(c!.collection)!,
      image: str(c!.image_url) || undefined,
      verified: str(c!.safelist_status) ? c!.safelist_status === 'verified' : undefined,
    }))

export type OwnedGroup = {
  contract: string
  slug?: string
  name: string
  image?: string
  ids: string[]
  /** Every NFT held here is flagged by OpenSea: likely spam, kept out of the main list. */
  flagged?: boolean
}

/** The wallet's NFTs (OpenSea account_nfts) grouped per contract, biggest holding first. */
export function groupAccountNfts(j: unknown): OwnedGroup[] {
  const map = new Map<string, OwnedGroup>()
  for (const raw of arr(obj(j)?.nfts)) {
    const n = obj(raw)
    const contract = str(n?.contract)?.toLowerCase()
    if (!n || !contract || n.is_disabled === true || n.is_nsfw === true) continue
    const g = map.get(contract) || {
      contract,
      slug: str(n.collection),
      name: str(n.collection) || contract,
      image: undefined,
      ids: [],
      flagged: true,
    }
    g.ids.push(String(n.identifier))
    g.image = g.image || str(n.display_image_url) || str(n.image_url) || undefined
    g.flagged = g.flagged && n.is_suspicious === true
    map.set(contract, g)
  }

  return [...map.values()].sort((a, b) => b.ids.length - a.ids.length)
}

/* ---------- Seaport fills ---------- */

type AbiParam = { name?: string; type: string; components?: readonly AbiParam[] }

/** OpenSea sometimes wraps a value as `{ value }` (Address). */
const unwrap = (v: unknown) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  'value' in (v as object) &&
  Object.keys(v as object).every((k) => k === 'value' || k === 'typeAsString')
    ? (v as { value: unknown }).value
    : v

/** One input_data value converted to what the ABI type expects (bigint for ints, objects for tuples). */
export function toAbiValue(param: AbiParam, raw: unknown): unknown {
  const v = unwrap(raw)
  const t = param.type
  if (t.endsWith(']')) {
    const inner = { ...param, type: t.slice(0, t.lastIndexOf('[')) }
    if (!Array.isArray(v)) throw new Error(`${param.name || t} should be a list.`)
    return v.map((x) => toAbiValue(inner, x))
  }

  if (t === 'tuple') {
    const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
    if (!o) throw new Error(`${param.name || t} is missing.`)
    const out: Record<string, unknown> = {}
    ;(param.components || []).forEach((c, i) => {
      const value = Array.isArray(o) ? o[i] : o[c.name!]
      out[c.name!] = toAbiValue(c, value)
    })
    return out
  }

  if (/^u?int/.test(t)) {
    const b = toBig(v)
    if (b === undefined) throw new Error(`${param.name || t} is not a whole number.`)
    return b
  }

  if (t === 'address') {
    if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(v))
      throw new Error(`${param.name || t} is not an address.`)
    return v
  }

  if (t === 'bool') return v === true || v === 'true'
  if (t.startsWith('bytes')) {
    if (v === undefined || v === null || v === '') return '0x'
    if (typeof v !== 'string' || !/^0x[0-9a-fA-F]*$/.test(v)) throw new Error(`${param.name || t} is not hex.`)
    return v
  }

  throw new Error(`Unsupported type ${t}.`)
}

/** The positional args for a Seaport function from OpenSea's named `input_data`. */
export function seaportArgs(
  fn: { inputs: readonly AbiParam[] },
  input: unknown,
  aliases: Record<string, string> = {}
): unknown[] {
  const o = obj(input)
  if (!o) throw new Error('The fill data is missing.')
  return fn.inputs.map((p) => toAbiValue(p, o[p.name!] ?? (aliases[p.name!] ? o[aliases[p.name!]!] : undefined)))
}

type Item = { itemType: number; token: string; id: bigint; start: bigint; end: bigint; recipient?: string }

const items = (list: unknown): Item[] =>
  arr(list).map((raw) => {
    const i = obj(raw) || {}
    return {
      itemType: Number(i.itemType),
      token: String(i.token || '').toLowerCase(),
      id: toBig(i.identifierOrCriteria) ?? -1n,
      start: toBig(i.startAmount) ?? 0n,
      end: toBig(i.endAmount) ?? 0n,
      recipient: typeof i.recipient === 'string' ? i.recipient.toLowerCase() : undefined,
    }
  })

const isCurrency = (i: Item) => i.itemType === 0 || i.itemType === 1
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const ZERO_KEY = /^0x0{64}$/

export type FillLine = { label: string; amount: bigint }

export type FillPlan = {
  ok: true
  functionName: string
  to: string
  value: bigint
  /** Positional args for seaportAbi[functionName]. */
  args: unknown[]
  /** The money token: ETH (native) or an ERC-20 (e.g. WETH, USDG). */
  currency: { native: boolean; token: string }
  /** Buy: what the buyer pays, split by who gets it. Sell: the offer, then what comes off it. */
  lines: FillLine[]
  /** Buy: total paid. Sell: what the seller gets. */
  total: bigint
  /** Who must be approved to move the buyer's ERC-20 (buy) or the seller's NFT (sell): a conduit key. */
  conduitKey: string
  /**
   * The ERC-20 the fulfiller's allowance must cover. Buy: the price. Sell: the fees, which Seaport pulls from the seller
   * out of the offer they have just received. Without it the fill reverts (seen on a fork).
   */
  fromYou: bigint
  /** The NFT's standard, from the signed order itself. Decides whether one token can be approved (ERC-721) or not. */
  nftKind: 'erc721' | 'erc1155'
}

export type FillContext = {
  side: 'buy' | 'sell'
  chainId: number
  contract: string
  tokenId: string
  account: string
  seaports: readonly string[]
  abi: readonly { name: string; inputs: readonly AbiParam[] }[]
  aliases?: Record<string, string>
}

const who = (recipient: string | undefined, offerer: string) =>
  recipient === offerer ? 'seller' : recipient === '0x0000a26b00c1f0df003000390027140000faa719' ? 'opensea' : 'creator'

/** Every line is part of the signed order, so each one is required: no optional creator fees are ever added. */
const LABEL = { seller: 'To the seller', opensea: 'OpenSea fee', creator: 'Creator fee (required)' } as const

/**
 * Checks OpenSea's fulfillment_data before anything is signed, and works out what the person pays or gets.
 * Refuses (ok: false, with plain words) when the call is not to Seaport, not on this chain, not a known fill
 * function, not for this NFT, sends the goods elsewhere, the price moves (auction), or it carries anything beyond
 * the signed order (an optional creator fee or extra ETH).
 */
export function planFill(
  resp: unknown,
  ctx: FillContext
): FillPlan | { ok: false; error: string; openSea?: boolean } {
  try {
    const data = obj(obj(resp)?.fulfillment_data)
    const tx = obj(data?.transaction)
    if (!tx) return { ok: false, error: 'OpenSea sent no transaction for this order.' }
    const signature = str(tx.function) || ''
    const functionName = signature.split('(')[0]!
    const fn = ctx.abi.find((f) => f.name === functionName)
    if (!fn) return { ok: false, error: 'This order needs a kind of fill miyaOS does not do.', openSea: true }
    const to = str(tx.to) || ''
    if (!ctx.seaports.some((s) => s.toLowerCase() === to.toLowerCase()))
      return { ok: false, error: 'The order is not on the Seaport contract we know.', openSea: true }
    if (Number(tx.chain) !== ctx.chainId) return { ok: false, error: 'The order is for another network.' }
    const value = toBig(tx.value) ?? toBig(tx.value_hex) ?? 0n
    const input = obj(tx.input_data)
    if (!input) return { ok: false, error: 'The fill data is missing.' }

    const order = obj(obj(arr(data?.orders)[0])?.parameters)
    if (!order) return { ok: false, error: 'The order details are missing.' }
    const offerer = String(order.offerer || '').toLowerCase()
    const offer = items(order.offer)
    const consideration = items(order.consideration)
    const contract = ctx.contract.toLowerCase()
    const tokenId = BigInt(ctx.tokenId)
    const me = ctx.account.toLowerCase()

    const recipient = unwrap(input.recipient)
    if (typeof recipient === 'string' && recipient.toLowerCase() !== ZERO_ADDR && recipient.toLowerCase() !== me)
      return { ok: false, error: 'The fill would send the NFT to someone else.' }

    // Partial fills (ERC-1155): Seaport scales every amount by numerator / denominator.
    const adv = obj(input.advancedOrder) || obj(arr(input.orders)[0])
    const num = toBig(adv?.numerator) ?? 1n
    const den = toBig(adv?.denominator) ?? 1n
    if (num <= 0n || den <= 0n || num > den) return { ok: false, error: 'The fill amount is not valid.' }
    const part = (x: bigint) => (x * num) / den

    const money = (side: Item[]) => side.filter(isCurrency)
    if ([...money(offer), ...money(consideration)].some((i) => i.start !== i.end))
      return { ok: false, error: 'This price changes over time (an auction).', openSea: true }

    const parameters = obj(input.parameters)
    // Never pay optional extras (creator "tips"): Seaport lets the fulfiller append recipients past the signed
    // order's own (basic orders) or consideration items past the original count (advanced orders). Refuse both.
    const extraRecipients = arr(unwrap(parameters?.additionalRecipients)).length
    const originalRecipients = Number(unwrap(parameters?.totalOriginalAdditionalRecipients) ?? extraRecipients)
    const advParams = obj(adv?.parameters)
    const advItems = arr(advParams?.consideration).length
    const advOriginal = Number(unwrap(advParams?.totalOriginalConsiderationItems) ?? advItems)
    if (extraRecipients > originalRecipients || advItems > advOriginal)
      return {
        ok: false,
        error: 'OpenSea added an optional fee to this fill. miyaOS only pays what the order requires.',
      }
    const conduitKey = String(
      unwrap(input.fulfillerConduitKey) ?? unwrap(parameters?.fulfillerConduitKey) ?? `0x${'0'.repeat(64)}`
    )
    const args = seaportArgs(fn, input, ctx.aliases)

    if (ctx.side === 'buy') {
      const nft = offer.find((i) => (i.itemType === 2 || i.itemType === 3) && i.token === contract && i.id === tokenId)
      if (!nft) return { ok: false, error: 'This order is not for this NFT.' }
      const pay = money(consideration)
      if (!pay.length) return { ok: false, error: 'The order has no price.' }
      const { token } = pay[0]!
      if (pay.some((i) => i.token !== token || i.itemType !== pay[0]!.itemType))
        return { ok: false, error: 'The order is priced in more than one token.', openSea: true }
      const native = pay[0]!.itemType === 0
      const sums = { seller: 0n, opensea: 0n, creator: 0n }
      for (const i of pay) sums[who(i.recipient, offerer)] += part(i.start)
      const total = sums.seller + sums.opensea + sums.creator
      const lines: FillLine[] = (Object.keys(sums) as (keyof typeof sums)[])
        .filter((k) => sums[k] > 0n)
        .map((k) => ({ label: LABEL[k], amount: sums[k] }))
      if (native) {
        if (value < total) return { ok: false, error: 'The payment does not cover the price.' }
        // More ETH than the order asks for would be an optional extra; miyaOS never adds one.
        if (value > total)
          return {
            ok: false,
            error: 'OpenSea asked for more than the order requires. miyaOS only pays what the order requires.',
          }
      } else if (value !== 0n) {
        return { ok: false, error: 'This token-priced order should not send ETH.' }
      }

      return {
        ok: true,
        functionName,
        to,
        value,
        args,
        currency: { native, token },
        lines,
        total,
        conduitKey,
        fromYou: total,
        nftKind: nft.itemType === 3 ? 'erc1155' : 'erc721',
      }
    }

    // Sell: accept an offer. The bidder gives an ERC-20 and wants this NFT (or any NFT of the collection).
    if (value !== 0n) return { ok: false, error: 'Accepting an offer should not send ETH.' }
    const wants = consideration.find(
      (i) =>
        i.token === contract &&
        i.recipient === offerer &&
        (i.itemType === 2 || i.itemType === 3 ? i.id === tokenId : i.itemType === 4 || i.itemType === 5)
    )
    if (!wants) return { ok: false, error: 'This offer is not for this NFT.' }
    const gives = money(offer)
    if (!gives.length || gives.some((i) => i.itemType !== 1 || i.token !== gives[0]!.token))
      return { ok: false, error: 'This offer is not a plain token offer.', openSea: true }
    const { token } = gives[0]!
    const gross = gives.reduce((s, i) => s + part(i.start), 0n)
    const lines: FillLine[] = [{ label: 'Offer', amount: gross }]
    const cuts = { opensea: 0n, creator: 0n, seller: 0n }
    for (const i of money(consideration)) {
      if (i.token !== token) return { ok: false, error: 'The offer fees are in another token.', openSea: true }
      cuts[who(i.recipient, offerer)] += part(i.start)
    }

    const fees = cuts.opensea + cuts.creator + cuts.seller
    if (cuts.opensea) lines.push({ label: 'OpenSea fee', amount: -cuts.opensea })
    if (cuts.creator) lines.push({ label: LABEL.creator, amount: -cuts.creator })
    if (cuts.seller) lines.push({ label: 'Back to the bidder', amount: -cuts.seller })
    if (fees >= gross) return { ok: false, error: 'After fees this offer pays nothing.' }
    return {
      ok: true,
      functionName,
      to,
      value,
      args,
      currency: { native: false, token },
      lines,
      total: gross - fees,
      conduitKey,
      fromYou: fees,
      nftKind: wants.itemType === 3 || wants.itemType === 5 ? 'erc1155' : 'erc721',
    }
  } catch {
    return { ok: false, error: UNREADABLE }
  }
}

export const usesSeaportItself = (conduitKey: string) => ZERO_KEY.test(conduitKey)
