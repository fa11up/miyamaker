// Trade → NFTs markets: the OpenSea proxy (api/_lib/opensea.ts), venue links, OpenSea parsing, best price and the
// checks on a Seaport fill before the wallet opens (src/pages/Swap/nft/markets.ts + seaport.ts). Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decodeErrorResult, decodeFunctionData, encodeErrorResult, encodeFunctionData, parseAbi } from 'viem'

import { handleOpenSeaRequest, openSeaGet, openSeaPost, quoteBigInts } from '../api/_lib/opensea.ts'
import { clientKey, createRateLimiter, sameOrigin } from '../api/_lib/zeroex.ts'
import {
  lowerPrice,
  bestQuote,
  collectionUrl,
  formatAmount,
  formatPrice,
  groupAccountNfts,
  itemUrl,
  otherMarkets,
  parseCollection,
  parseListings,
  parseOfferAggregate,
  parseOrder,
  parseSearch,
  parseStats,
  payee,
  planFill,
  accountNftsPage,
  priceFromFloat,
  seaportArgs,
  venuesFor,
} from '../src/pages/Swap/nft/markets.ts'
import {
  INPUT_ALIASES,
  OPENSEA_FEE_RECIPIENT,
  seaportAbi,
  SEAPORT_ADDRESSES,
  seaportCallAbi,
} from '../src/pages/Swap/nft/seaport.ts'
import { parseTradePath, tradePath } from '../src/pages/Swap/tradePath.ts'

/** A request the proxy built (not refused). */
type Built = Extract<ReturnType<typeof openSeaGet>, { path: string }>

const MILADY = '0x5af0d9827e0c53e4799bb226655a1de152a425a5'
const ME = '0x5167d014a056e43883e1bbea5530c3c0dc993281'
const SELLER = '0x1111111111111111111111111111111111111111'
const CREATOR = '0x6426df811c4e223ccb16448f08f42bf2f54e0ade'
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const SEAPORT = SEAPORT_ADDRESSES[0]
const HASH = `0x${'ab'.repeat(32)}`
const OS_KEY = '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000'
const ZERO32 = `0x${'0'.repeat(64)}`

/* ---------- proxy ---------- */

test('GET ops: only known ops and params, validated, never a page-chosen path', () => {
  const ok = openSeaGet(new URLSearchParams({ op: 'stats', slug: 'milady' })) as Built
  assert.equal(ok.path, '/api/v2/collections/milady/stats')
  assert.equal(ok.keyless, true)
  assert.equal((openSeaGet(new URLSearchParams({ op: 'listings', slug: 'milady' })) as Built).query?.get('limit'), '6')
  assert.equal(
    openSeaGet(new URLSearchParams({ op: 'listings', slug: 'milady', limit: '50' })).error,
    'limit is not valid.',
  )
  assert.equal(
    openSeaGet(new URLSearchParams({ op: 'contract', chain: 'ethereum', address: MILADY })).path,
    `/api/v2/chain/ethereum/contract/${MILADY}`,
  )
  assert.match(openSeaGet(new URLSearchParams({ op: 'contract', chain: 'sepolia', address: MILADY })).error!, /chain/)
  assert.match(openSeaGet(new URLSearchParams({ op: 'stats', slug: '../auth/keys' })).error!, /slug/)
  assert.match(openSeaGet(new URLSearchParams({ op: 'stats', slug: 'milady', x: '1' })).error!, /x is not accepted/)
  assert.match(openSeaGet(new URLSearchParams('op=stats&slug=a&slug=b')).error!, /twice/)
  assert.match(openSeaGet(new URLSearchParams({ op: 'auth' })).error!, /Unknown/)
  assert.match(openSeaGet(new URLSearchParams({ op: 'toString' })).error!, /Unknown/)
  assert.match(
    openSeaGet(new URLSearchParams({ op: 'nft', chain: 'ethereum', address: MILADY, id: '1e5' })).error!,
    /id/,
  )
  const s = openSeaGet(new URLSearchParams({ op: 'search', query: 'milady', chain: 'robinhood' })) as Built
  assert.equal(s.query?.get('asset_types'), 'collection')
  assert.equal(s.query?.get('chains'), 'robinhood')
  assert.equal(s.keyless, false)
})

test('POST ops: the proxy builds OpenSea body; no recipient, no extra fields, never optional creator fees', () => {
  const base = { chain: 'ethereum', hash: HASH, protocol_address: SEAPORT, fulfiller: ME }
  const l = openSeaPost('fulfill_listing', base) as Built
  assert.equal(l.path, '/api/v2/listings/fulfillment_data')
  assert.deepEqual(JSON.parse(l.body!), {
    listing: { chain: 'ethereum', hash: HASH, protocol_address: SEAPORT },
    fulfiller: { address: ME },
    include_optional_creator_fees: false,
  })
  // The page cannot ask for optional creator fees.
  assert.match(
    openSeaPost('fulfill_listing', { ...base, include_optional_creator_fees: true }).error!,
    /include_optional_creator_fees is not accepted/,
  )
  assert.match(openSeaPost('fulfill_listing', { ...base, recipient: SELLER }).error!, /recipient is not accepted/)
  assert.match(openSeaPost('fulfill_listing', { ...base, hash: '0x12' }).error!, /hash/)
  assert.match(openSeaPost('fulfill_listing', { ...base, fulfiller: `0x${'0'.repeat(40)}` }).error!, /fulfiller/)
  assert.match(openSeaPost('fulfill_listing', [1]).error!, /object/)
  const o = openSeaPost('fulfill_offer', { ...base, contract: MILADY, token_id: '42' }) as Built
  assert.deepEqual(JSON.parse(o.body!).consideration, { asset_contract_address: MILADY, token_id: '42' })
  assert.match(openSeaPost('fulfill_offer', base).error!, /contract/)
  assert.match(openSeaPost('nope', base).error!, /Unknown/)
})

test('big integers survive JSON.parse after quoteBigInts', () => {
  const salt = '24446860302761739304752683030156737591518664810215442929818227897836383814680'
  const text = `{"salt": ${salt}, "n": 12, "f": 0.69999889, "s": "x ${salt}", "a": [${salt},1], "neg": -12345678901234567890}`
  const j = JSON.parse(quoteBigInts(text))
  assert.equal(j.salt, salt)
  assert.equal(j.n, 12)
  assert.equal(j.f, 0.69999889)
  assert.equal(j.s, `x ${salt}`)
  assert.deepEqual(j.a, [salt, 1])
  assert.equal(j.neg, '-12345678901234567890')
  assert.equal(quoteBigInts('{"e":"a\\"1234567890123456789"}'), '{"e":"a\\"1234567890123456789"}')
})

test('quoteBigInts leaves long decimals as numbers (OpenSea sends 16+ fraction digits in volumes)', () => {
  const text =
    '{"volume": 0.4335819821334922, "big": 2454.626698788311123, "e": 1.5e+25, "f": 12345678901234567e2, "n": [0.1234567890123456789,7]}'
  const j = JSON.parse(quoteBigInts(text))
  assert.equal(j.volume, 0.4335819821334922)
  assert.equal(j.big, 2454.626698788311123)
  assert.equal(j.e, 1.5e25)
  assert.equal(j.f, 12345678901234567e2)
  assert.deepEqual(j.n, [0.1234567890123456789, 7])
})

const guards = () => ({
  sameOrigin,
  clientKey,
  readLimiter: createRateLimiter({ capacity: 100 }),
  fillLimiter: createRateLimiter({ capacity: 2, perSecond: 0 }),
})
const site = new Headers({ 'sec-fetch-site': 'same-origin' })
const req = (q: string, init: { method?: string; body?: string; headers?: Headers } = {}) => ({
  method: init.method || 'GET',
  url: `http://localhost/api/opensea?${q}`,
  headers: init.headers || site,
  body: init.body,
})

test('proxy: no key = keyless ops forwarded without a key, the rest 503 without calling OpenSea', async () => {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> })
    return new Response('{"total":{"floor_price":0.7}}', { status: 200 })
  }) as unknown as typeof fetch
  const r1 = await handleOpenSeaRequest(req('op=stats&slug=milady'), {}, guards(), fetchImpl)
  assert.equal(r1.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.url, 'https://api.opensea.io/api/v2/collections/milady/stats')
  assert.equal(calls[0]!.headers['x-api-key'], undefined)
  const r2 = await handleOpenSeaRequest(req('op=listings&slug=milady'), {}, guards(), fetchImpl)
  assert.equal(r2.status, 503)
  assert.equal((await r2.json()).name, 'MARKET_NOT_CONFIGURED')
  assert.equal(calls.length, 1)
  // status is answered locally and says whether a key is set, never what it is.
  assert.deepEqual(await (await handleOpenSeaRequest(req('op=status'), {}, guards(), fetchImpl)).json(), {
    configured: false,
  })
  const on = await handleOpenSeaRequest(req('op=status'), { OPENSEA_API_KEY: 'k-secret' }, guards(), fetchImpl)
  assert.equal(await on.text(), '{"configured":true}')
  assert.equal(calls.length, 1)
  assert.match(openSeaGet(new URLSearchParams({ op: 'status', slug: 'x' })).error!, /slug is not accepted/)
})

test('proxy: key injected; 401 → not configured; 404 → NOT_FOUND; cross-site refused; fills rate-limited', async () => {
  let status = 200
  let seen: Record<string, string> = {}
  let body: string | undefined
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    seen = init.headers as Record<string, string>
    body = init.body as string | undefined
    return new Response(status === 200 ? '{"ok":true,"salt":123456789012345678901}' : '{"errors":["x"]}', { status })
  }) as unknown as typeof fetch
  const env = { OPENSEA_API_KEY: 'k-secret' }
  const g = guards()
  const ok = await handleOpenSeaRequest(req('op=listings&slug=milady'), env, g, fetchImpl)
  assert.equal(seen['x-api-key'], 'k-secret')
  assert.equal((await ok.json()).salt, '123456789012345678901')
  assert.match(ok.headers.get('cache-control')!, /s-maxage/)

  status = 401
  const r401 = await handleOpenSeaRequest(req('op=listings&slug=milady'), env, g, fetchImpl)
  assert.equal(r401.status, 503)
  assert.doesNotMatch(await r401.text(), /k-secret/)
  status = 404
  assert.equal(
    (await (await handleOpenSeaRequest(req('op=stats&slug=nope'), env, g, fetchImpl)).json()).name,
    'NOT_FOUND',
  )

  const cross = await handleOpenSeaRequest(
    req('op=stats&slug=milady', { headers: new Headers({ 'sec-fetch-site': 'cross-site' }) }),
    env,
    g,
    fetchImpl,
  )
  assert.equal(cross.status, 403)
  assert.equal(
    (await handleOpenSeaRequest(req('op=stats&slug=milady', { headers: new Headers() }), env, g, fetchImpl)).status,
    403,
  )

  status = 200
  const fillBody = JSON.stringify({ chain: 'ethereum', hash: HASH, protocol_address: SEAPORT, fulfiller: ME })
  const fill = await handleOpenSeaRequest(
    req('op=fulfill_listing', { method: 'POST', body: fillBody }),
    env,
    g,
    fetchImpl,
  )
  assert.equal(fill.status, 200)
  assert.equal(fill.headers.get('cache-control'), 'no-store')
  assert.equal(JSON.parse(body!).fulfiller.address, ME)
  assert.equal(
    (await handleOpenSeaRequest(req('op=fulfill_listing&x=1', { method: 'POST', body: fillBody }), env, g, fetchImpl))
      .status,
    400,
  )
  assert.equal(
    (await handleOpenSeaRequest(req('op=fulfill_listing', { method: 'POST', body: fillBody }), env, g, fetchImpl))
      .status,
    429,
  )
  assert.equal((await handleOpenSeaRequest(req('op=stats&slug=a', { method: 'PUT' }), env, g, fetchImpl)).status, 405)
})

/* ---------- paths, venues, links ---------- */

test('collection and item paths round-trip', () => {
  const c = { chainId: 1, address: MILADY as `0x${string}` }
  assert.equal(tradePath('nfts', undefined, c), `/trade/nfts/collection/1/${MILADY}`)
  assert.deepEqual(parseTradePath(tradePath('nfts', undefined, c)), { mode: 'nfts', collection: c })
  const i = { ...c, chainId: 4663, tokenId: '42' }
  assert.deepEqual(parseTradePath(tradePath('nfts', undefined, i)), { mode: 'nfts', collection: i })
  assert.deepEqual(parseTradePath(`/trade/nfts/collection/10/${MILADY}`), { mode: 'nfts' })
  assert.deepEqual(parseTradePath('/trade/nfts/collection/1/nope'), { mode: 'nfts' })
  assert.deepEqual(parseTradePath(`/trade/nfts/collection/1/${MILADY}/x`), { mode: 'nfts', collection: c })
})

test('venues per chain, MiyaPool first; links work with no key', () => {
  assert.deepEqual(
    venuesFor(1).map((v) => v.id),
    ['miyapool', 'opensea'],
  )
  assert.deepEqual(
    venuesFor(4663).map((v) => v.id),
    ['miyapool', 'opensea'],
  )
  assert.deepEqual(
    venuesFor(11155111).map((v) => v.id),
    ['miyapool'],
  )
  assert.equal(collectionUrl('opensea', 1, MILADY, 'milady'), 'https://opensea.io/collection/milady')
  assert.equal(
    collectionUrl('opensea', 4663, MILADY.toUpperCase().replace('0X', '0x')),
    `https://opensea.io/contract/robinhood/${MILADY}`,
  )
  assert.equal(collectionUrl('opensea', 11155111, MILADY), undefined)
  assert.equal(itemUrl('opensea', 1, MILADY, '7'), `https://opensea.io/item/ethereum/${MILADY}/7`)
  assert.equal(itemUrl('magiceden' as never, 1, MILADY, '7'), undefined)
  assert.equal(otherMarkets(1), 'OpenSea')
  assert.equal(otherMarkets(4663), 'OpenSea')
  assert.equal(otherMarkets(11155111), '')
})

/* ---------- prices and parsing ---------- */

test('amounts format plainly', () => {
  assert.equal(formatAmount(700000000000000000n, 18), '0.7')
  assert.equal(formatAmount(1234500000000000000000n, 18), '1,234.5')
  assert.equal(formatAmount(1n, 18), '<0.0001')
  assert.equal(formatAmount(99999n * 10n ** 13n, 18), '1')
  assert.equal(formatAmount(0n, 18), '0')
  assert.equal(formatPrice(priceFromFloat(0.69999889, 'ETH')), '0.7 ETH')
  assert.equal(priceFromFloat(0, 'ETH'), undefined)
  assert.equal(priceFromFloat(0.5, 'USDG', 6)!.amount, 500000n)
})

test('OpenSea collection, stats, offers, search and wallet NFTs parse', () => {
  const c = parseCollection({
    collection: 'milady',
    name: 'Milady Maker',
    safelist_status: 'verified',
    contracts: [
      { address: MILADY, chain: 'ethereum' },
      { address: 'bad', chain: 'x' },
    ],
    fees: [
      { fee: 1.0, recipient: OPENSEA_FEE_RECIPIENT, required: true },
      { fee: 5.0, recipient: CREATOR, required: false },
    ],
  })!
  assert.equal(c.slug, 'milady')
  assert.equal(c.verified, true)
  assert.equal(c.contracts.length, 1)
  assert.equal(c.fees.filter((f) => !f.required)[0]!.percent, 5)
  assert.equal(parseCollection({}), undefined)

  const s = parseStats({
    total: { floor_price: 0.69999889, floor_price_symbol: 'ETH', num_owners: 5134 },
    intervals: [{ interval: 'seven_day', sales: 36, volume: 31.8 }],
  })
  assert.equal(formatPrice(s.floor), '0.7 ETH')
  assert.equal(s.sales7d, 36)
  assert.deepEqual(parseStats(null), { floor: undefined, owners: undefined, sales7d: undefined, volume7d: undefined })

  const o = parseOfferAggregate({
    offer_aggregates: [
      {
        offer_price: { token_unit: 0.65, symbol: 'WETH', chain: 'ethereum', usd_price: '1' },
        total_offers: 3,
        bidders: [],
        total_value: {},
      },
    ],
  })!
  assert.equal(formatPrice(o.price), '0.65 WETH')
  assert.equal(o.count, 3)

  assert.deepEqual(
    parseSearch({
      results: [
        {
          type: 'collection',
          collection: { collection: 'milady', name: 'Milady Maker', is_disabled: false, is_nsfw: false },
        },
        { type: 'collection', collection: { collection: 'bad', name: 'Bad', is_disabled: false, is_nsfw: true } },
        { type: 'token', token: {} },
      ],
    }).map((h) => h.slug),
    ['milady'],
  )
  const g = groupAccountNfts({
    nfts: [
      { contract: MILADY, collection: 'milady', identifier: '1' },
      { contract: MILADY.toUpperCase().replace('0X', '0x'), collection: 'milady', identifier: '2' },
      { contract: SELLER, collection: 'other', identifier: '9' },
      { contract: CREATOR, collection: 'spam', identifier: '3', is_nsfw: true },
    ],
  })
  assert.deepEqual(
    g.map((x) => [x.slug, x.ids.length]),
    [
      ['milady', 2],
      ['other', 1],
    ],
  )
})

const listingJson = (id: string, wei: string, extra: Record<string, unknown> = {}) => ({
  order_hash: HASH,
  chain: 'ethereum',
  protocol_address: SEAPORT,
  status: 'ACTIVE',
  remaining_quantity: 1,
  type: 'basic',
  price: { current: { currency: 'ETH', decimals: 18, value: wei } },
  protocol_data: {
    parameters: { offer: [{ itemType: 2, token: MILADY, identifierOrCriteria: id, startAmount: '1', endAmount: '1' }] },
  },
  ...extra,
})

test('listings and offers parse; inactive ones are dropped', () => {
  const ls = parseListings({
    listings: [listingJson('42', '720000000000000000'), listingJson('7', '1', { status: 'CANCELLED' })],
  })
  assert.equal(ls.length, 1)
  assert.equal(ls[0]!.tokenId, '42')
  assert.equal(formatPrice(ls[0]!.price), '0.72 ETH')
  const offer = parseOrder({
    order_hash: HASH,
    chain: 'ethereum',
    protocol_address: SEAPORT,
    remaining_quantity: 1,
    status: 'ACTIVE',
    price: { currency: 'WETH', decimals: 18, value: '1300000000000000000' },
    price_per_item: { currency: 'WETH', decimals: 18, value: '650000000000000000' },
  })!
  assert.equal(formatPrice(offer.price), '0.65 WETH')
  assert.equal(parseOrder({ order_hash: '0x12', protocol_address: SEAPORT }), undefined)
})

test('best price: cheapest listing / highest offer in one money; ETH and WETH compare', () => {
  const eth = (n: number, symbol = 'ETH') => priceFromFloat(n, symbol)
  assert.equal(bestQuote([{ v: 'a', price: eth(0.8) }, { v: 'b', price: eth(0.7, 'WETH') }, { v: 'c' }])!.v, 'b')
  assert.equal(
    bestQuote(
      [
        { v: 'a', price: eth(0.6) },
        { v: 'b', price: eth(0.65) },
      ],
      'highest',
    )!.v,
    'b',
  )
  assert.equal(
    bestQuote([
      { v: 'a', price: eth(0.8) },
      { v: 'pool', price: { amount: 1n, decimals: 18, symbol: 'mMIL' } },
    ])!.v,
    'a',
  )
  assert.equal(bestQuote([{ v: 'none', price: undefined }]), undefined)
})

/* ---------- Seaport fills ---------- */

const PRICE = 700000000000000000n // what the buyer pays
const OS_FEE = PRICE / 100n
const ROYALTY = (PRICE * 5n) / 100n
const SALT = '24446860302761739304752683030156737591518664810215442929818227897836383814680'

function basicBuy(over: { to?: string; value?: string; chain?: number; id?: string; fn?: string } = {}) {
  const id = over.id ?? '42'
  const params = {
    offerer: SELLER,
    zone: '0x0000000000000000000000000000000000000000',
    offer: [{ itemType: 2, token: MILADY, identifierOrCriteria: id, startAmount: '1', endAmount: '1' }],
    consideration: [
      {
        itemType: 0,
        token: '0x0000000000000000000000000000000000000000',
        identifierOrCriteria: '0',
        startAmount: String(PRICE - OS_FEE - ROYALTY),
        endAmount: String(PRICE - OS_FEE - ROYALTY),
        recipient: SELLER,
      },
      {
        itemType: 0,
        token: '0x0000000000000000000000000000000000000000',
        identifierOrCriteria: '0',
        startAmount: String(OS_FEE),
        endAmount: String(OS_FEE),
        recipient: OPENSEA_FEE_RECIPIENT,
      },
      {
        itemType: 0,
        token: '0x0000000000000000000000000000000000000000',
        identifierOrCriteria: '0',
        startAmount: String(ROYALTY),
        endAmount: String(ROYALTY),
        recipient: CREATOR,
      },
    ],
    orderType: 2,
    startTime: '1790000000',
    endTime: '1800000000',
    zoneHash: ZERO32,
    salt: SALT,
    conduitKey: OS_KEY,
    totalOriginalConsiderationItems: 3,
    counter: 0,
  }
  return JSON.parse(
    quoteBigInts(
      JSON.stringify({
        protocol: 'seaport1.6',
        fulfillment_data: {
          orders: [{ parameters: params, signature: `0x${'11'.repeat(64)}` }],
          transaction: {
            function:
              over.fn ??
              'fulfillBasicOrder_efficient_6GL6yc((address,uint256,uint256,address,address,address,uint256,uint256,uint8,uint256,uint256,bytes32,uint256,bytes32,bytes32,uint256,(uint256,address)[],bytes))',
            chain: over.chain ?? 1,
            to: over.to ?? SEAPORT,
            value: over.value ?? String(PRICE),
            input_data: {
              parameters: {
                considerationToken: '0x0000000000000000000000000000000000000000',
                considerationIdentifier: 0,
                considerationAmount: String(PRICE - OS_FEE - ROYALTY),
                offerer: SELLER,
                zone: '0x0000000000000000000000000000000000000000',
                offerToken: MILADY,
                offerIdentifier: Number(id),
                offerAmount: 1,
                basicOrderType: 2,
                startTime: 1790000000,
                endTime: 1800000000,
                zoneHash: ZERO32,
                salt: SALT,
                offererConduitKey: OS_KEY,
                fulfillerConduitKey: OS_KEY,
                totalOriginalAdditionalRecipients: 2,
                additionalRecipients: [
                  { amount: String(OS_FEE), recipient: OPENSEA_FEE_RECIPIENT },
                  { amount: String(ROYALTY), recipient: CREATOR },
                ],
                signature: `0x${'11'.repeat(64)}`,
              },
            },
          },
        },
      }),
    ),
  )
}

const ctx = (over: Record<string, unknown> = {}) => ({
  side: 'buy' as const,
  chainId: 1,
  contract: MILADY,
  tokenId: '42',
  account: ME,
  seaports: SEAPORT_ADDRESSES,
  abi: seaportAbi,
  aliases: INPUT_ALIASES,
  creatorFees: [CREATOR],
  ...over,
})

test('a payee that is not the seller, OpenSea or the collection creator fee is an "Other fee"', () => {
  const plan = planFill(basicBuy(), ctx({ creatorFees: undefined }))
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.deepEqual(
    plan.lines.map((l) => l.label),
    ['To the seller', 'OpenSea fee', 'Other fee (required)'],
  )
  assert.equal(plan.total, PRICE, 'the total still counts every required line')
  assert.equal(payee(CREATOR.toLowerCase(), SELLER.toLowerCase(), [CREATOR.toUpperCase().replace('0X', '0x')]), 'creator')
  assert.equal(payee(SELLER.toLowerCase(), SELLER.toLowerCase(), []), 'seller')
})

test('account NFT pages: rows and a sane next cursor', () => {
  assert.deepEqual(accountNftsPage({ nfts: [1, 2], next: 'abc' }), { nfts: [1, 2], next: 'abc' })
  assert.deepEqual(accountNftsPage({ nfts: [1], next: '' }), { nfts: [1], next: undefined })
  assert.deepEqual(accountNftsPage({ next: 'x'.repeat(600) }), { nfts: [], next: undefined })
  assert.deepEqual(accountNftsPage(null), { nfts: [], next: undefined })
})

test('buying a listing: who gets what, and calldata that decodes back to the same order', () => {
  const plan = planFill(basicBuy(), ctx())
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.equal(plan.total, PRICE)
  assert.equal(plan.currency.native, true)
  assert.deepEqual(
    plan.lines.map((l) => l.label),
    ['To the seller', 'OpenSea fee', 'Creator fee (required)'],
  )
  assert.equal(plan.lines[1]!.amount, OS_FEE)
  assert.equal(plan.conduitKey, OS_KEY)
  const data = encodeFunctionData({
    abi: seaportAbi,
    functionName: plan.functionName as 'fulfillBasicOrder',
    args: plan.args as never,
  })
  const back = decodeFunctionData({ abi: seaportAbi, data })
  assert.equal(back.functionName, 'fulfillBasicOrder_efficient_6GL6yc')
  const p = (back.args as any)[0]
  assert.equal(p.salt, BigInt(SALT))
  assert.equal(p.offerIdentifier, 42n)
  assert.equal(p.additionalRecipients[1].recipient.toLowerCase(), CREATOR)
})

test('optional creator fees are never paid: extra ETH or tip recipients are refused', () => {
  const err = (r: ReturnType<typeof planFill>) => (r.ok ? '' : r.error)
  assert.match(err(planFill(basicBuy({ value: String(PRICE + 1000n) }), ctx())), /only pays what the order requires/)
  // A basic order with a recipient past the signed ones (a tip).
  const tipped = basicBuy({ value: String(PRICE + 1000n) })
  tipped.fulfillment_data.transaction.input_data.parameters.additionalRecipients.push({
    amount: '1000',
    recipient: CREATOR,
  })
  assert.match(err(planFill(tipped, ctx())), /optional fee/)
  // An advanced order with a consideration item past the original count.
  const adv = offerAccept()
  const p = adv.fulfillment_data.transaction.input_data.advancedOrder.parameters
  adv.fulfillment_data.transaction.input_data.advancedOrder.parameters = {
    ...p,
    consideration: [
      ...p.consideration,
      { itemType: 1, token: WETH, identifierOrCriteria: '0', startAmount: '5', endAmount: '5', recipient: CREATOR },
    ],
  }
  assert.match(err(planFill(adv, ctx({ side: 'sell' }))), /optional fee/)
  // Required creator fees in the signed order still show, plainly.
  const plan = planFill(basicBuy(), ctx())
  assert.equal(plan.ok && plan.lines.find((l) => l.label === 'Creator fee (required)')!.amount, ROYALTY)
})

test('fills are refused when anything is off', () => {
  const err = (r: ReturnType<typeof planFill>) => (r.ok ? '' : r.error)
  assert.match(err(planFill(basicBuy({ to: SELLER }), ctx())), /Seaport/)
  assert.match(err(planFill(basicBuy({ chain: 4663 }), ctx())), /another network/)
  assert.match(err(planFill(basicBuy({ id: '43' }), ctx())), /not for this NFT/)
  assert.match(err(planFill(basicBuy({ value: '1' }), ctx())), /does not cover/)
  assert.match(err(planFill(basicBuy({ fn: 'matchOrders(...)' }), ctx())), /does not do/)
  assert.match(err(planFill({}, ctx())), /no transaction/)
  const auction = basicBuy()
  auction.fulfillment_data.orders[0].parameters.consideration[0].endAmount = '1'
  assert.match(err(planFill(auction, ctx())), /auction/)
})

function offerAccept(recipient = '0x0000000000000000000000000000000000000000') {
  const gross = 1300000000000000000n // a 2-unit collection offer: 0.65 WETH each
  const fee = gross / 100n
  const bidder = '0x2222222222222222222222222222222222222222'
  const params = {
    offerer: bidder,
    zone: '0x000056f7000000ece9003ca63978907a00ffd100',
    offer: [
      { itemType: 1, token: WETH, identifierOrCriteria: '0', startAmount: String(gross), endAmount: String(gross) },
    ],
    consideration: [
      { itemType: 4, token: MILADY, identifierOrCriteria: '0', startAmount: '2', endAmount: '2', recipient: bidder },
      {
        itemType: 1,
        token: WETH,
        identifierOrCriteria: '0',
        startAmount: String(fee),
        endAmount: String(fee),
        recipient: OPENSEA_FEE_RECIPIENT,
      },
    ],
    orderType: 3,
    startTime: '1790000000',
    endTime: '1800000000',
    zoneHash: ZERO32,
    salt: '7',
    conduitKey: OS_KEY,
    totalOriginalConsiderationItems: 2,
  }
  return {
    fulfillment_data: {
      orders: [{ parameters: params, signature: '0x' }],
      transaction: {
        function:
          'fulfillAdvancedOrder(((address,address,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[],uint8,uint256,uint256,bytes32,uint256,bytes32,uint256),uint120,uint120,bytes,bytes),(uint256,uint8,uint256,uint256,bytes32[])[],bytes32,address)',
        chain: 1,
        to: SEAPORT,
        value: '0',
        input_data: {
          advancedOrder: { parameters: params, numerator: 1, denominator: 2, signature: '0x1234', extraData: '0x' },
          criteriaResolvers: [{ orderIndex: 0, side: 1, index: 0, identifier: '42', criteriaProof: [] }],
          fulfillerConduitKey: OS_KEY,
          recipient,
        },
      },
    },
  }
}

test('accepting an offer: one unit of a 2-unit offer, minus the OpenSea fee', () => {
  const plan = planFill(offerAccept(), ctx({ side: 'sell' }))
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.equal(plan.total, 650000000000000000n - 6500000000000000n)
  assert.deepEqual(
    plan.lines.map((l) => l.label),
    ['Offer', 'OpenSea fee'],
  )
  assert.equal(plan.currency.token, WETH)
  const data = encodeFunctionData({ abi: seaportAbi, functionName: 'fulfillAdvancedOrder', args: plan.args as never })
  const back = decodeFunctionData({ abi: seaportAbi, data }).args as any
  assert.equal(back[0].denominator, 2n)
  assert.equal(back[1][0].identifier, 42n)
  assert.match(String(planFill(offerAccept(SELLER), ctx({ side: 'sell' })).ok === false && 'refused'), /refused/)
  assert.equal(planFill(offerAccept(), ctx({ side: 'sell', contract: SELLER })).ok, false)
})

test('seaportArgs maps OpenSea names (orders → advancedOrders) and unwraps { value }', () => {
  const fn = seaportAbi.find((f) => f.name === 'fulfillAvailableAdvancedOrders')!
  const order = offerAccept().fulfillment_data.transaction.input_data.advancedOrder
  const args = seaportArgs(
    fn,
    {
      orders: [order],
      criteriaResolvers: [],
      offerFulfillments: [[{ orderIndex: 0, itemIndex: 0 }]],
      considerationFulfillments: [],
      fulfillerConduitKey: OS_KEY,
      recipient: { value: ME, typeAsString: 'address' },
      maximumFulfilled: '1',
    },
    INPUT_ALIASES,
  )
  assert.equal(args[5], ME)
  assert.equal((args[0] as any[])[0].numerator, 1n)
  assert.equal((args[2] as any[][])[0]![0].itemIndex, 0n)
  assert.throws(() => seaportArgs(fn, { orders: 'x' }, INPUT_ALIASES), /list/)
})

test('lowerPrice compares only the same token', () => {
  const eth = (amount: bigint) => ({ amount, decimals: 18, symbol: 'ETH' })
  assert.equal(lowerPrice(eth(5n), eth(3n))?.amount, 3n)
  assert.equal(lowerPrice(eth(3n), eth(5n))?.amount, 3n)
  assert.equal(lowerPrice(undefined, eth(5n))?.amount, 5n)
  assert.equal(lowerPrice(eth(5n), { amount: 1n, decimals: 18, symbol: 'WETH' })?.amount, 5n)
  assert.equal(lowerPrice(undefined, undefined), undefined)
})

test('the plan says what the seller allows: the fees, and which kind of NFT', () => {
  const plan = planFill(offerAccept(), ctx({ side: 'sell' }))
  assert.ok(plan.ok)
  assert.equal((plan as any).nftKind, 'erc721', 'an ERC-721 collection offer')
  // Half of a 2-unit offer, so half of its 1.3% fee: exactly what Seaport pulls out of what the seller receives.
  assert.equal((plan as any).fromYou, 6500000000000000n)
  const buy = planFill(basicBuy(), ctx())
  assert.ok(buy.ok)
  assert.equal((buy as any).fromYou, (buy as any).total)
  assert.equal((buy as any).nftKind, 'erc721')
})

test('an ERC-1155 offer is told apart, so the screen can say the approval is blanket', () => {
  const offer = offerAccept()
  offer.fulfillment_data.orders[0]!.parameters.consideration[0]!.itemType = 5
  offer.fulfillment_data.transaction.input_data.advancedOrder.parameters = offer.fulfillment_data.orders[0]!.parameters
  const plan = planFill(offer, ctx({ side: 'sell' }))
  assert.equal(plan.ok && plan.nftKind, 'erc1155')
})

test('fills only OpenSea can do say so; unreadable ones stay plain', () => {
  const auction = basicBuy()
  auction.fulfillment_data.orders[0].parameters.consideration[0].endAmount = '1'
  const refused = planFill(auction, ctx())
  assert.equal(!refused.ok && refused.openSea, true)
  const garbled = basicBuy()
  garbled.fulfillment_data.transaction.input_data.parameters.salt = 'not a number'
  const bad = planFill(garbled, ctx())
  assert.equal(bad.ok, false)
  assert.doesNotMatch((bad as any).error, /salt|whole number/)
})

test('Seaport refusals decode by name, and an error can never pass for a fill function', () => {
  // OrderAlreadyFilled(bytes32): the selector a real second fill reverted with on a fork.
  const data = encodeErrorResult({
    abi: parseAbi(['error OrderAlreadyFilled(bytes32 orderHash)']),
    errorName: 'OrderAlreadyFilled',
    args: [ZERO32 as `0x${string}`],
  })
  assert.equal(decodeErrorResult({ abi: seaportCallAbi, data }).errorName, 'OrderAlreadyFilled')
  assert.equal(data.slice(0, 10), '0x10fda3e1')
  assert.match(
    (planFill(basicBuy({ fn: 'OrderAlreadyFilled(bytes32)' }), ctx()) as any).error,
    /does not do/,
  )
})

test('search keeps the badge when it is there, and leaves it unknown when not', () => {
  const hit = (extra: object) => ({ type: 'collection', collection: { collection: 'x', name: 'X', ...extra } })
  const parse = (extra: object) => parseSearch({ results: [hit(extra)] })[0]!.verified
  assert.equal(parse({ safelist_status: 'verified' }), true)
  assert.equal(parse({ safelist_status: 'not_requested' }), false)
  assert.equal(parse({}), undefined)
})

test('a collection is hidden as flagged only when everything held in it is', () => {
  const nft = (contract: string, id: string, is_suspicious: boolean) => ({ contract, identifier: id, collection: contract, is_suspicious })
  const groups = groupAccountNfts({ nfts: [nft('0xaa', '1', true), nft('0xaa', '2', true), nft('0xbb', '3', true), nft('0xbb', '4', false)] })
  assert.equal(groups.find((g) => g.contract === '0xaa')!.flagged, true)
  assert.equal(groups.find((g) => g.contract === '0xbb')!.flagged, false)
})
